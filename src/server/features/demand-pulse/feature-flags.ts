export interface DemandPulseFeatureFlags {
  enabled: boolean;
  writeEnabled: boolean;
  dryRun: boolean;
  sourceDataForSeoDiscussions: boolean;
  sourceHackerNews: boolean;
  sourceFirstPartyImport: boolean;
  sourceOfficialPages: boolean;
  sourceReddit: boolean;
  canaryOnFarmCompost: boolean;
}

export interface DemandPulseFeatureFlagEnv {
  DEMAND_PULSE_ENABLED?: string;
  DEMAND_PULSE_WRITE_ENABLED?: string;
  DEMAND_PULSE_DRY_RUN?: string;
  DEMAND_PULSE_SOURCE_DATAFORSEO_DISCUSSIONS?: string;
  DEMAND_PULSE_SOURCE_HACKER_NEWS?: string;
  DEMAND_PULSE_SOURCE_FIRST_PARTY_IMPORT?: string;
  DEMAND_PULSE_SOURCE_OFFICIAL_PAGES?: string;
  DEMAND_PULSE_SOURCE_REDDIT?: string;
  DEMAND_PULSE_CANARY_ONFARMCOMPOST?: string;
}

function envBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function getDemandPulseFeatureFlags(
  env: DemandPulseFeatureFlagEnv,
): DemandPulseFeatureFlags {
  return {
    enabled: envBoolean(env.DEMAND_PULSE_ENABLED, false),
    writeEnabled: envBoolean(env.DEMAND_PULSE_WRITE_ENABLED, false),
    dryRun: envBoolean(env.DEMAND_PULSE_DRY_RUN, true),
    sourceDataForSeoDiscussions: envBoolean(
      env.DEMAND_PULSE_SOURCE_DATAFORSEO_DISCUSSIONS,
      false,
    ),
    sourceHackerNews: envBoolean(env.DEMAND_PULSE_SOURCE_HACKER_NEWS, false),
    sourceFirstPartyImport: envBoolean(
      env.DEMAND_PULSE_SOURCE_FIRST_PARTY_IMPORT,
      false,
    ),
    sourceOfficialPages: envBoolean(
      env.DEMAND_PULSE_SOURCE_OFFICIAL_PAGES,
      false,
    ),
    sourceReddit: envBoolean(env.DEMAND_PULSE_SOURCE_REDDIT, false),
    canaryOnFarmCompost: envBoolean(
      env.DEMAND_PULSE_CANARY_ONFARMCOMPOST,
      false,
    ),
  };
}
