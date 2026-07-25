import type { WorkflowStep } from "cloudflare:workers";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import {
  discoverUrls,
  fetchRobotsTxtText,
  parseRobotsTxt,
} from "@/server/lib/audit/discovery";
import {
  fetchAndStoreLighthouseResult,
  selectLighthouseSample,
} from "@/server/lib/audit/lighthouse";
import { getOrigin } from "@/server/lib/audit/url-utils";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { AuditProgressKV } from "@/server/lib/audit/progress-kv";
import { runMultipageChecks } from "@/server/lib/audit/issues/multipage";
import type { AuditConfig } from "@/server/lib/audit/types";
import { interpretAiCrawlerPolicy } from "@/server/lib/audit/aiCrawlerPolicyInterpretation";
import {
  generateAiCrawlerFindings,
  toDetectedIssues,
} from "@/server/lib/audit/aiCrawlerPolicyFindings";
import {
  liveCheckAiCrawlers,
  toLiveDetectedIssues,
} from "@/server/lib/audit/aiCrawlerPolicyLive";
import { captureServerEvent } from "@/server/lib/posthog";
import {
  runCrawlPhase,
  type CrawledPageSummary,
  type CrawlPhaseResult,
} from "@/server/workflows/siteAuditWorkflowCrawl";
import { pgStep } from "@/server/workflows/pgStep";

const LIGHTHOUSE_URL_BATCH_SIZE = 10;

// Workflows rejects step outputs over 1MiB; keep the sitemap seed list well
// under that. The crawl visits at most maxPages URLs, so extra seeds are moot.
const SITEMAP_SEED_BYTE_BUDGET = 768 * 1024;

function capSitemapSeeds(urls: string[], maxPages: number): string[] {
  const seeds: string[] = [];
  let bytes = 0;
  for (const url of urls) {
    if (seeds.length >= maxPages) break;
    bytes += url.length + 3; // JSON quotes + comma
    if (bytes > SITEMAP_SEED_BYTE_BUDGET) break;
    seeds.push(url);
  }
  return seeds;
}

type AuditPhasesParams = {
  auditId: string;
  workflowInstanceId: string;
  billingCustomer: BillingCustomerContext;
  projectId: string;
  startUrl: string;
  config: AuditConfig;
};

export async function runAuditPhases(
  step: WorkflowStep,
  params: AuditPhasesParams,
) {
  const {
    auditId,
    workflowInstanceId,
    billingCustomer,
    projectId,
    startUrl,
    config,
  } = params;
  const origin = getOrigin(startUrl);
  const maxPages = config.maxPages;

  const discovery = await runDiscoveryPhase(
    step,
    auditId,
    workflowInstanceId,
    origin,
    maxPages,
  );
  // Parsed outside the step from checkpointed text, so replays see the exact
  // robots rules the original run used (a live re-fetch could differ and
  // desync the frontier from already-persisted crawl batches).
  const robots = parseRobotsTxt(origin, discovery.robotsText);

  // AI-crawler policy analysis runs from the same checkpointed robots text.
  // Independent of crawl results so issues surface even if the crawl fails.
  await pgStep(step, "ai-crawler-analysis", undefined, async () => {
    const policy = interpretAiCrawlerPolicy(discovery.robotsText);
    const findings = generateAiCrawlerFindings(policy);
    const issues = toDetectedIssues(findings, `${origin}/robots.txt`);
    if (issues.length > 0) {
      await AuditRepository.insertIssues(auditId, issues);
    }
    return { issueCount: issues.length };
  });
  if (config.runAiCrawlerLiveCheck) {
    const liveResult = await step.do("ai-crawler-live-probe", () =>
      liveCheckAiCrawlers(startUrl),
    );
    await pgStep(step, "ai-crawler-live-issues", undefined, async () => {
      const issues = toLiveDetectedIssues(liveResult, startUrl);
      if (issues.length > 0) {
        await AuditRepository.insertIssues(auditId, issues);
      }
      return { issueCount: issues.length };
    });
  }
  const crawl = await runCrawlPhase(step, {
    auditId,
    workflowInstanceId,
    origin,
    startUrl,
    maxPages,
    robots,
    sitemapUrls: discovery.sitemapUrls,
  });
  await runLighthousePhase(step, {
    auditId,
    workflowInstanceId,
    billingCustomer,
    projectId,
    startUrl,
    config,
    pages: crawl.pages,
  });
  await finalizeAudit({
    step,
    auditId,
    workflowInstanceId,
    billingCustomer,
    projectId,
    startUrl,
    config,
    crawl,
  });
}

async function runDiscoveryPhase(
  step: WorkflowStep,
  auditId: string,
  workflowInstanceId: string,
  origin: string,
  maxPages: number,
) {
  const robotsText = await step.do("fetch-robots", () =>
    fetchRobotsTxtText(origin),
  );
  const discovery = await pgStep(step, "discover-urls", undefined, async () => {
    const result = await discoverUrls(origin, maxPages, robotsText);
    await AuditRepository.updateAuditProgress(auditId, workflowInstanceId, {
      pagesTotal: Math.min(result.urls.length + 1, maxPages),
      currentPhase: "crawling",
    });
    return { sitemapUrls: capSitemapSeeds(result.urls, maxPages) };
  });
  return { ...discovery, robotsText };
}

type LighthousePhaseParams = {
  auditId: string;
  workflowInstanceId: string;
  billingCustomer: BillingCustomerContext;
  projectId: string;
  startUrl: string;
  config: AuditConfig;
  pages: CrawledPageSummary[];
};

async function runLighthousePhase(
  step: WorkflowStep,
  params: LighthousePhaseParams,
) {
  const {
    auditId,
    workflowInstanceId,
    billingCustomer,
    projectId,
    startUrl,
    config,
    pages,
  } = params;
  if (config.lighthouseStrategy === "none") return;

  const lighthouseWork = await selectLighthousePages({
    step,
    auditId,
    workflowInstanceId,
    pages,
    startUrl,
    strategy: config.lighthouseStrategy,
  });

  let completedChecks = 0;
  let failedChecks = 0;
  let lighthouseBatchIndex = 0;

  for (let i = 0; i < lighthouseWork.length; i += LIGHTHOUSE_URL_BATCH_SIZE) {
    const batch = lighthouseWork.slice(i, i + LIGHTHOUSE_URL_BATCH_SIZE);
    lighthouseBatchIndex += 1;
    const priorCompleted = completedChecks;
    const priorFailed = failedChecks;

    // Fetch, store (R2 + D1) and update progress inside one step. The step
    // returns only counts; full results live in D1.
    const counts = await pgStep(
      step,
      `lighthouse-batch-${lighthouseBatchIndex}`,
      undefined,
      async () => {
        const perUrlResults = await Promise.all(
          batch.map(async ({ url, pageId }) => {
            const [mobileResult, desktopResult] = await Promise.all([
              fetchAndStoreLighthouseResult({
                url,
                pageId,
                strategy: "mobile",
                billingCustomer,
                projectId,
                auditId,
              }),
              fetchAndStoreLighthouseResult({
                url,
                pageId,
                strategy: "desktop",
                billingCustomer,
                projectId,
                auditId,
              }),
            ]);
            return [mobileResult, desktopResult];
          }),
        );
        const results = perUrlResults.flat();
        await AuditRepository.insertLighthouseResults(auditId, results);

        const failed = results.filter((result) => result.errorMessage).length;
        const completed = results.length - failed;
        await AuditRepository.updateAuditProgress(auditId, workflowInstanceId, {
          lighthouseCompleted: priorCompleted + completed,
          lighthouseFailed: priorFailed + failed,
        });
        return { completed, failed };
      },
    );

    completedChecks += counts.completed;
    failedChecks += counts.failed;
  }
}

async function selectLighthousePages(params: {
  step: WorkflowStep;
  auditId: string;
  workflowInstanceId: string;
  pages: CrawledPageSummary[];
  startUrl: string;
  strategy: AuditConfig["lighthouseStrategy"];
}) {
  const { step, auditId, workflowInstanceId, pages, startUrl, strategy } =
    params;
  return pgStep(step, "select-lighthouse-sample", undefined, async () => {
    const sample = selectLighthouseSample(pages, startUrl, strategy);
    const selectedUrls = new Set(sample);

    await AuditRepository.updateAuditProgress(auditId, workflowInstanceId, {
      currentPhase: "lighthouse",
      lighthouseTotal: sample.length * 2,
      lighthouseCompleted: 0,
      lighthouseFailed: 0,
    });
    return pages.flatMap((page) =>
      selectedUrls.has(page.url) ? [{ url: page.url, pageId: page.id }] : [],
    );
  });
}

async function finalizeAudit(args: {
  step: WorkflowStep;
  auditId: string;
  workflowInstanceId: string;
  billingCustomer: BillingCustomerContext;
  projectId: string;
  startUrl: string;
  config: AuditConfig;
  crawl: CrawlPhaseResult;
}) {
  const {
    step,
    auditId,
    workflowInstanceId,
    billingCustomer,
    projectId,
    startUrl,
    config,
    crawl,
  } = args;

  await pgStep(step, "multipage-checks", undefined, async () => {
    await AuditRepository.updateAuditProgress(auditId, workflowInstanceId, {
      currentPhase: "finalizing",
    });

    // Integrity guard: pages are persisted inside crawl-batch steps. If the
    // crawl claims pages but D1 has none (e.g. an instance started under the
    // pre-incremental-persistence code was replayed under this code), fail
    // loudly instead of completing with an empty audit.
    if (
      crawl.pages.length > 0 &&
      !(await AuditRepository.hasPagesForAudit(auditId))
    ) {
      throw new Error(
        `Audit ${auditId}: crawl reported ${crawl.pages.length} pages but none were persisted`,
      );
    }

    const issues = await runMultipageChecks({
      auditId,
      startUrl,
      crawlCompleted: crawl.completed,
    });
    await AuditRepository.insertIssues(auditId, issues);
    return { issueCount: issues.length };
  });

  await pgStep(step, "finalize", undefined, async () => {
    await AuditRepository.completeAudit(auditId, workflowInstanceId, {
      pagesCrawled: crawl.pages.length,
      pagesTotal: crawl.pages.length,
    });
    await captureServerEvent({
      distinctId: billingCustomer.userId,
      event: "site_audit:complete",
      organizationId: billingCustomer.organizationId,
      properties: {
        project_id: projectId,
        status: "completed",
        pages_crawled: crawl.pages.length,
        pages_total: crawl.pages.length,
        crawl_completed: crawl.completed,
        pages_blocked: crawl.pages.filter(
          (page) => page.fetchClass === "blocked",
        ).length,
        run_lighthouse: config.lighthouseStrategy !== "none",
      },
    });
    await AuditProgressKV.clear(auditId);
  });
}
