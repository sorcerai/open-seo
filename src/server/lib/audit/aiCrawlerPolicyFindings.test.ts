import { describe, expect, it } from "vitest";
import { interpretAiCrawlerPolicy } from "./aiCrawlerPolicyInterpretation";
import {
  findingToRegisteredType,
  generateAiCrawlerFindings,
  toDetectedIssues,
} from "./aiCrawlerPolicyFindings";
import { AUDIT_ISSUE_TYPES } from "@/shared/audit-issues";

describe("generateAiCrawlerFindings", () => {
  it("emits a single warning when robots.txt is missing", () => {
    const policy = interpretAiCrawlerPolicy(null);
    const findings = generateAiCrawlerFindings(policy);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: "ai_crawler/no_robots_txt",
      severity: "warning",
    });
  });

  it("emits critical per-bot findings for explicitly blocked search bots", () => {
    const policy = interpretAiCrawlerPolicy(
      "User-agent: OAI-SearchBot\nDisallow: /",
    );
    const findings = generateAiCrawlerFindings(policy);
    const oai = findings.find(
      (f) => f.id === "ai_crawler/oai-searchbot_blocked",
    );
    expect(oai).toMatchObject({
      severity: "critical",
      bot: "OAI-SearchBot",
      purpose: "search",
    });
  });

  it("emits critical findings for wildcard-blocked search bots", () => {
    const policy = interpretAiCrawlerPolicy("User-agent: *\nDisallow: /");
    const findings = generateAiCrawlerFindings(policy);
    // Three search bots all wildcard-blocked → blanket + 3 per-bot criticals.
    const blanket = findings.find(
      (f) => f.id === "ai_crawler/all_search_blocked",
    );
    expect(blanket?.severity).toBe("critical");
    const gpt = findings.find(
      (f) => f.id === "ai_crawler/gptbot_training_blocked",
    );
    // GPTBot is training-purpose; its wildcard block is a warning, not critical.
    expect(gpt?.severity).toBe("warning");
    const oai = findings.find(
      (f) => f.id === "ai_crawler/oai-searchbot_wildcard",
    );
    expect(oai?.severity).toBe("critical");
  });

  it("emits info findings for not-mentioned search bots (cited by default)", () => {
    // No wildcard group and no explicit AI-bot group → every AI bot is
    // not_mentioned (cited by default). Googlebot is not in the AI taxonomy.
    const policy = interpretAiCrawlerPolicy(
      "User-agent: Googlebot\nDisallow: /tmp",
    );
    const findings = generateAiCrawlerFindings(policy);
    const oai = findings.find(
      (f) => f.id === "ai_crawler/oai-searchbot_default",
    );
    expect(oai?.severity).toBe("info");
  });

  it("emits a warning for Google-Extended training blocks and carries the AI Overviews caveat", () => {
    const policy = interpretAiCrawlerPolicy(
      "User-agent: Google-Extended\nDisallow: /",
    );
    const findings = generateAiCrawlerFindings(policy);
    const gx = findings.find(
      (f) => f.id === "ai_crawler/google-extended_training_blocked",
    );
    expect(gx?.severity).toBe("warning");
    expect(gx?.issue).toContain("Google AI Overviews");
  });

  it("emits a warning when a Content-Signal has conflicting values", () => {
    const policy = interpretAiCrawlerPolicy(
      "Content-Signal: search=yes\nContent-Signal: search=no",
    );
    const findings = generateAiCrawlerFindings(policy);
    const conflict = findings.find((f) =>
      f.id.startsWith("ai_crawler/content_signal_search_conflict"),
    );
    expect(conflict?.severity).toBe("warning");
  });

  it("emits policy findings for valid Content-Signal and AIPREF denials", () => {
    const policy = interpretAiCrawlerPolicy(
      "Content-Signal: search=no\nContent-Usage: / train-ai=n",
    );
    const findings = generateAiCrawlerFindings(policy);
    expect(findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([
        "ai_crawler/content_signal_search_blocked",
        "ai_crawler/aipref_train_ai_blocked",
      ]),
    );
    expect(findings.some((finding) => finding.id.endsWith("_default"))).toBe(
      false,
    );
  });
});

describe("toDetectedIssues", () => {
  it("maps every finding to a registered issueType with matching severity", () => {
    // Cover all finding patterns via representative policies.
    const policies = [
      interpretAiCrawlerPolicy(null),
      interpretAiCrawlerPolicy("User-agent: *\nDisallow: /"),
      interpretAiCrawlerPolicy("User-agent: OAI-SearchBot\nDisallow: /"),
      interpretAiCrawlerPolicy("User-agent: Googlebot\nDisallow: /tmp"),
      interpretAiCrawlerPolicy(
        "Content-Signal: search=yes\nContent-Signal: search=no\nContent-Usage: bad",
      ),
      interpretAiCrawlerPolicy(
        "Content-Signal: ai-input=no\nContent-Usage: / search=n",
      ),
    ];
    const allFindings = policies.flatMap((p) => generateAiCrawlerFindings(p));
    expect(allFindings.length).toBeGreaterThan(0);

    for (const finding of allFindings) {
      const issueType = findingToRegisteredType(finding);
      const descriptor = AUDIT_ISSUE_TYPES[issueType];
      expect(descriptor, `no descriptor for ${issueType}`).toBeDefined();
      expect(descriptor.severity, `severity mismatch for ${finding.id}`).toBe(
        finding.severity,
      );
    }
  });

  it("produces DetectedIssue rows with robots.txt as pageUrl and finding ID as dedupeKey", () => {
    const policy = interpretAiCrawlerPolicy(
      "User-agent: OAI-SearchBot\nDisallow: /",
    );
    const findings = generateAiCrawlerFindings(policy);
    const issues = toDetectedIssues(findings, "https://example.com/robots.txt");
    expect(issues.length).toBe(findings.length);
    for (const issue of issues) {
      expect(issue.pageUrl).toBe("https://example.com/robots.txt");
      expect(issue.pageId).toBeNull();
      expect(issue.dedupeKey).toBeTruthy();
      expect(issue.details?.findingId).toBe(issue.dedupeKey);
      expect(issue.details?.issue).toBeTruthy();
      expect(issue.details?.recommendation).toBeTruthy();
    }
  });
});
