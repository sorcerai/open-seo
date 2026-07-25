export interface DemandPulseFeatureFlags {
  enabled: boolean;
  writeEnabled: boolean;
  dryRun: boolean;
  sourceDataForSeoDiscussions: boolean;
  sourceHackerNews: boolean;
  sourceFirstPartyImport: boolean;
  sourceReddit: boolean;
}

function envBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function getDemandPulseFeatureFlags(
  env: Record<string, string | undefined>,
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
    sourceReddit: envBoolean(env.DEMAND_PULSE_SOURCE_REDDIT, false),
  };
}
