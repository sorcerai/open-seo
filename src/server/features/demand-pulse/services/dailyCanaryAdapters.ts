import { getOrCreateOrganizationCustomer } from "@/server/billing/subscription";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { GscService } from "@/server/features/gsc/services/GscService";
import type {
  AdapterKey,
  DemandPulseCanaryEnv,
  RunDemandPulseCanaryInput,
} from "./dailyCanaryTypes";
import type { DemandPulseFeatureFlags } from "../feature-flags";
import type {
  DemandPulseProfile,
  DemandPulseSource,
} from "../repositories/DemandPulseRepository";
import type { OfficialPageFetch } from "../canaries/onfarmcompost-official-sources";
import {
  dataforseoDiscussionsDemandSource,
  type DataForSeoSourceConfig,
} from "../sources/dataforseo-discussions-normalizer";
import { createDataForSeoDiscussionsPaidFetch } from "../sources/dataforseo-discussions-transport";
import { gscDemandSource, type GscSourceConfig } from "../sources/gsc";
import { hackerNewsDemandSource } from "../sources/hacker-news";
import {
  localNewsDemandSource,
  type LocalNewsSourceConfig,
} from "../sources/local-news";
import {
  manualFirstPartyDemandSource,
  type ManualFirstPartySourceConfig,
} from "../sources/manual-first-party";

export const defaultOfficialFetch: OfficialPageFetch = (input, init) =>
  fetch(input, init);

export const defaultAdapters = {
  "gsc-site": gscDemandSource,
  "dataforseo-discussions": dataforseoDiscussionsDemandSource,
  "manual-first-party": manualFirstPartyDemandSource,
  "local-news": localNewsDemandSource,
  "hacker-news": hackerNewsDemandSource,
};

export function envBoolean(
  value: string | undefined,
  fallback = false,
): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseJson(
  value: string | undefined,
  label: string,
  errors: string[],
): unknown {
  if (!value?.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch (error) {
    errors.push(`${label} config parse failed: ${errorText(error)}`);
    return undefined;
  }
}

export function isProfileSafe(profile: DemandPulseProfile): boolean {
  return profile.enabled && profile.dryRun && profile.publicationDisabled;
}

export function sourceFlagEnabled(
  adapter: string,
  flags: DemandPulseFeatureFlags,
  env: DemandPulseCanaryEnv,
): boolean {
  switch (adapter) {
    case "gsc-site":
      return envBoolean(env.DEMAND_PULSE_SOURCE_GSC, false);
    case "dataforseo-discussions":
      return flags.sourceDataForSeoDiscussions;
    case "manual-first-party":
      return flags.sourceFirstPartyImport;
    case "local-news":
      return envBoolean(env.DEMAND_PULSE_SOURCE_LOCAL_NEWS, false);
    case "hacker-news":
      return flags.sourceHackerNews;
    case "official_page_monitor":
      return flags.sourceOfficialPages;
    default:
      return false;
  }
}

export function sourceAdapterForRow(
  source: DemandPulseSource,
): AdapterKey | null {
  if (
    source.adapter === "gsc-site" ||
    source.adapter === "gsc" ||
    source.adapter === "gsc_site"
  ) {
    return "gsc-site";
  }
  if (
    source.adapter === "dataforseo-discussions" ||
    source.adapter === "dataforseo_discussions_and_forums"
  ) {
    return "dataforseo-discussions";
  }
  if (
    source.adapter === "manual-first-party" ||
    source.adapter === "manual_first_party"
  ) {
    return "manual-first-party";
  }
  if (source.adapter === "local-news" || source.adapter === "local_news") {
    return "local-news";
  }
  if (source.adapter === "hacker-news" || source.adapter === "hacker_news") {
    return "hacker-news";
  }
  return null;
}

async function defaultDataForSeoConfig(
  env: DemandPulseCanaryEnv,
  projectId: string,
  errors: string[],
): Promise<DataForSeoSourceConfig | undefined> {
  const queriesValue = parseJson(
    env.DEMAND_PULSE_DATAFORSEO_QUERIES,
    "DataForSEO queries",
    errors,
  );
  const queries = Array.isArray(queriesValue)
    ? queriesValue.filter((value): value is string => typeof value === "string")
    : [];
  if (queries.length === 0) {
    errors.push("DataForSEO source has no configured queries");
    return undefined;
  }
  const project = await ProjectRepository.getProjectById(projectId);
  if (!project?.organizationId) {
    errors.push("DataForSEO source project organization is unavailable");
    return undefined;
  }
  const billingContext = {
    organizationId: project.organizationId,
    userEmail:
      env.DEMAND_PULSE_DATAFORSEO_BILLING_EMAIL ??
      `demand-pulse@${project.organizationId}.internal`,
    userId:
      env.DEMAND_PULSE_DATAFORSEO_BILLING_USER_ID ?? "demand-pulse-scheduler",
    projectId,
  };
  try {
    await getOrCreateOrganizationCustomer(billingContext);
  } catch (error) {
    errors.push(`DataForSEO billing customer unavailable: ${errorText(error)}`);
    return undefined;
  }
  const locationCode = Number(
    env.DEMAND_PULSE_DATAFORSEO_LOCATION_CODE ?? 2840,
  );
  const languageCode =
    env.DEMAND_PULSE_DATAFORSEO_LANGUAGE_CODE?.trim() || "en";
  if (!Number.isInteger(locationCode)) {
    errors.push("DataForSEO location code must be an integer");
    return undefined;
  }
  return {
    readCache: async () => null,
    fetchPaid: createDataForSeoDiscussionsPaidFetch({
      customer: billingContext,
      locationCode,
      languageCode,
    }),
    queries,
    operationKey:
      env.DEMAND_PULSE_DATAFORSEO_OPERATION_KEY ?? `demand-pulse:${projectId}`,
  };
}

export async function sourceConfigFor(
  adapterKey: AdapterKey,
  source: DemandPulseSource,
  input: RunDemandPulseCanaryInput,
  errors: string[],
  projectId: string,
): Promise<unknown> {
  const sourceConfigs = input.sourceConfigs ?? {};
  if (Object.hasOwn(sourceConfigs, source.adapter)) {
    return sourceConfigs[source.adapter];
  }
  if (Object.hasOwn(sourceConfigs, adapterKey)) {
    return sourceConfigs[adapterKey];
  }
  switch (adapterKey) {
    case "gsc-site":
      return {
        getPerformance: GscService.getPerformance,
        dateRange: "last_28_days",
        maxRows: 1000,
      } satisfies Partial<GscSourceConfig>;
    case "manual-first-party": {
      const value = parseJson(
        input.env.DEMAND_PULSE_FIRST_PARTY_IMPORT_JSON,
        "manual first-party",
        errors,
      );
      return { input: value } satisfies Partial<ManualFirstPartySourceConfig>;
    }
    case "local-news": {
      const value = parseJson(
        input.env.DEMAND_PULSE_LOCAL_NEWS_CONFIG_JSON,
        "local news",
        errors,
      );
      return value ?? ({} satisfies Partial<LocalNewsSourceConfig>);
    }
    case "hacker-news": {
      const value = parseJson(
        input.env.DEMAND_PULSE_HACKER_NEWS_CONFIG_JSON,
        "Hacker News",
        errors,
      );
      return value ?? {};
    }
    case "dataforseo-discussions":
      return defaultDataForSeoConfig(input.env, projectId, errors);
  }
}
