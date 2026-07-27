import {
  evaluateSourceGate,
  type DemandSourceGateOutcome,
  type DemandSourcePolicyState,
} from "../sources/adapter";
import type { DemandPulseSource } from "../repositories/DemandPulseRepository";

export type OfficialSourceGateOutcome = DemandSourceGateOutcome;

export const UNREGISTERED_SOURCE_REASON =
  "source is not registered for configured official page seed";

function toPolicyState(value: string): DemandSourcePolicyState {
  switch (value) {
    case "unknown":
    case "pending":
    case "allowed":
    case "blocked":
      return value;
    default:
      return "unknown";
  }
}

export function evaluateOfficialSourceGate(
  source: Pick<DemandPulseSource, "approvalState" | "enabled" | "policyState">,
): OfficialSourceGateOutcome {
  return evaluateSourceGate({
    approvalState: source.approvalState,
    enabled: source.enabled,
    policyState: toPolicyState(source.policyState),
  });
}
