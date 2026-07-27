import type { DemandPulseProfile } from "../repositories/DemandPulseRepository";
import type {
  BlockedCause,
  OnFarmCompostOfficialMonitorResult,
  RunOutcome,
} from "./onfarmcompost-official-artifact";

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return String(error).slice(0, 500);
}

// Pure mapping from a finalized outcome to the monitor's terminal result.
export function runResultFromOutcome(args: {
  status: RunOutcome["status"];
  runId: string;
  artifactKey: string | null;
  successfulSources: number;
  changedSources: number;
  configuredSources: number;
  cause?: BlockedCause;
  errorMessage: string | null;
}): OnFarmCompostOfficialMonitorResult {
  const {
    status,
    runId,
    artifactKey,
    successfulSources,
    changedSources,
    configuredSources,
    cause,
    errorMessage,
  } = args;
  switch (status) {
    case "completed":
      return {
        status: "completed",
        runId,
        artifactKey,
        successfulSources,
        changedSources,
      };
    case "incomplete":
      return {
        status: "insufficient_source_health",
        runId,
        artifactKey,
        successfulSources,
        configuredSources,
      };
    case "blocked":
      return {
        status: "blocked",
        runId,
        artifactKey,
        cause: cause ?? "corrupt_state",
      };
    case "failed":
      return {
        status: "failed",
        runId,
        artifactKey,
        errorMessage: errorMessage ?? "Run failed",
      };
  }
}

// Fold a persistence-stage failure into the run error message without losing
// the originating error.
export function appendRunError(
  base: string | null,
  label: string,
  error: unknown,
): string {
  const detail = error === null ? "" : `: ${describeError(error)}`;
  const next = `${label}${detail}`;
  return (base ? `${base}; ${next}` : next).slice(0, 500);
}

// A pre-collection blocked outcome (corrupt/wrong-project state): no sources
// were fetched, no observations, no state advance.
export function blockedOutcome(
  cause: BlockedCause,
  errorMessage: string,
): RunOutcome {
  return {
    status: "blocked",
    results: [],
    successful: [],
    errorMessage,
    cause,
    emitObservations: false,
    nextState: null,
  };
}

// Persisted profile safety gates: the canary only runs a profile that is
// enabled, dry-run, and publication-disabled.
export function isProfileSafe(profile: DemandPulseProfile): boolean {
  return profile.enabled && profile.dryRun && profile.publicationDisabled;
}
