import {
  getDemandPulseFeatureFlags,
  type DemandPulseFeatureFlagEnv,
} from "../feature-flags";
import { mapWithConcurrency } from "../sources/adapter";
import {
  buildOnFarmCompostOfficialMonitorArtifact,
  isSuccessfulOfficialSource,
  type OfficialSourceResult,
} from "./onfarmcompost-official-artifact";
import {
  fetchOfficialPageSnapshot,
  ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS,
  type OfficialPageFetch,
  type OfficialPageSeed,
} from "./onfarmcompost-official-sources";
import {
  ONFARMCOMPOST_ARTIFACT_PREFIX,
  ONFARMCOMPOST_OFFICIAL_STATE_KEY,
  ONFARMCOMPOST_PROJECT_ID,
  readOfficialPageState,
  writeJsonArtifact,
  type DemandPulseJsonBucket,
  type OfficialPageState,
  type OfficialPageStateEntry,
} from "./onfarmcompost-official-store";

const TIME_ZONE = "America/Chicago";
const DAILY_RUN_HOUR = 5;
const MINIMUM_SUCCESSFUL_SOURCES = 3;

export interface OnFarmCompostOfficialMonitorEnv extends DemandPulseFeatureFlagEnv {
  R2: DemandPulseJsonBucket;
}

interface LocalDateTime {
  date: string;
  hour: number;
  minute: number;
}

export type OnFarmCompostOfficialMonitorResult =
  | { status: "disabled" }
  | { status: "unsafe_configuration" }
  | { status: "before_daily_window"; localDate: string }
  | { status: "already_completed"; artifactKey: string }
  | {
      status: "insufficient_source_health";
      successfulSources: number;
      configuredSources: number;
    }
  | {
      status: "completed";
      artifactKey: string;
      successfulSources: number;
      changedSources: number;
    };

const defaultOfficialPageFetch: OfficialPageFetch = (input, init) =>
  fetch(input, init);

export function getChicagoDateTime(now: Date): LocalDateTime {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);

  if (
    !year ||
    !month ||
    !day ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    throw new Error("Unable to resolve America/Chicago date parts");
  }

  return {
    date: `${year}-${month}-${day}`,
    hour,
    minute,
  };
}

export function isPastDailyRunTime(local: LocalDateTime): boolean {
  return local.hour >= DAILY_RUN_HOUR;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return String(error).slice(0, 500);
}

async function collectSource(
  seed: OfficialPageSeed,
  previousState: OfficialPageState | null,
  nextSources: Record<string, OfficialPageStateEntry>,
  fetchFn: OfficialPageFetch,
  generatedAt: string,
): Promise<OfficialSourceResult> {
  const previous = previousState?.sources[seed.id] ?? null;

  try {
    const snapshot = await fetchOfficialPageSnapshot(
      seed,
      fetchFn,
      generatedAt,
    );
    const changed = previous?.fingerprint !== snapshot.fingerprint;

    nextSources[seed.id] = {
      fingerprint: snapshot.fingerprint,
      finalUrl: snapshot.finalUrl,
      title: snapshot.title,
      lastFetchedAt: generatedAt,
      lastChangedAt: changed
        ? generatedAt
        : (previous?.lastChangedAt ?? generatedAt),
      lastModified: snapshot.lastModified,
      etag: snapshot.etag,
    };

    return {
      seed,
      snapshot,
      changed,
      previousFingerprint: previous?.fingerprint ?? null,
      error: null,
    };
  } catch (error) {
    return {
      seed,
      snapshot: null,
      changed: false,
      previousFingerprint: previous?.fingerprint ?? null,
      error: errorMessage(error),
    };
  }
}

export async function runScheduledOnFarmCompostOfficialMonitor(
  env: OnFarmCompostOfficialMonitorEnv,
  now = new Date(),
  fetchFn: OfficialPageFetch = defaultOfficialPageFetch,
): Promise<OnFarmCompostOfficialMonitorResult> {
  const flags = getDemandPulseFeatureFlags(env);
  if (
    !flags.enabled ||
    !flags.canaryOnFarmCompost ||
    !flags.sourceOfficialPages
  ) {
    return { status: "disabled" };
  }

  if (!flags.dryRun || flags.writeEnabled) {
    console.error(
      "[demand-pulse] OnFarmCompost canary refused unsafe feature flags",
    );
    return { status: "unsafe_configuration" };
  }

  const local = getChicagoDateTime(now);
  if (!isPastDailyRunTime(local)) {
    return { status: "before_daily_window", localDate: local.date };
  }

  const artifactKey = `${ONFARMCOMPOST_ARTIFACT_PREFIX}/runs/${local.date}.json`;
  if (await env.R2.head(artifactKey)) {
    return { status: "already_completed", artifactKey };
  }

  const generatedAt = now.toISOString();
  const previousState = await readOfficialPageState(env.R2);
  const nextSources: Record<string, OfficialPageStateEntry> = previousState
    ? { ...previousState.sources }
    : {};

  const results = await mapWithConcurrency(
    ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS,
    3,
    (seed) =>
      collectSource(seed, previousState, nextSources, fetchFn, generatedAt),
  );
  const successful = results.filter(isSuccessfulOfficialSource);

  if (successful.length < MINIMUM_SUCCESSFUL_SOURCES) {
    console.error(
      `[demand-pulse] OnFarmCompost official monitor source health ${successful.length}/${ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS.length}; retrying on the next cron`,
    );
    return {
      status: "insufficient_source_health",
      successfulSources: successful.length,
      configuredSources: ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS.length,
    };
  }

  const artifact = buildOnFarmCompostOfficialMonitorArtifact(
    results,
    successful,
    local.date,
    generatedAt,
  );
  const nextState: OfficialPageState = {
    schemaVersion: "1",
    projectId: ONFARMCOMPOST_PROJECT_ID,
    updatedAt: generatedAt,
    sources: nextSources,
  };

  // Preserve evidence before advancing fingerprints. A failed state write can
  // cause a later duplicate observation, but it cannot erase a collected change.
  await writeJsonArtifact(env.R2, artifactKey, artifact, {
    projectId: ONFARMCOMPOST_PROJECT_ID,
    artifactType: artifact.artifactType,
    localDate: local.date,
  });
  await writeJsonArtifact(env.R2, ONFARMCOMPOST_OFFICIAL_STATE_KEY, nextState, {
    projectId: ONFARMCOMPOST_PROJECT_ID,
    artifactType: "official-page-state",
  });

  console.log(
    `[demand-pulse] OnFarmCompost dry run wrote ${artifactKey}: ${artifact.summary.changedSources} changed, ${successful.length}/${results.length} healthy`,
  );

  return {
    status: "completed",
    artifactKey,
    successfulSources: successful.length,
    changedSources: artifact.summary.changedSources,
  };
}
