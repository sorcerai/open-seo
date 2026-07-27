import type {
  demandPulseCoverageChecks,
  demandPulseDuplicateEdges,
  demandPulseEvidenceEvents,
  demandPulseFamilies,
  demandPulseFamilyEvidence,
  demandPulseObservationEvents,
  demandPulseObservations,
  demandPulseScores,
} from "@/db/schema";

export type DemandPulseObservationInput = Omit<
  typeof demandPulseObservations.$inferInsert,
  "createdAt" | "updatedAt"
>;
export type DemandPulseEvidenceEventInput = Omit<
  typeof demandPulseEvidenceEvents.$inferInsert,
  "createdAt" | "updatedAt"
>;
export type DemandPulseObservationEventInput = Omit<
  typeof demandPulseObservationEvents.$inferInsert,
  "createdAt"
>;
export type DuplicateEdgeInput = Omit<
  typeof demandPulseDuplicateEdges.$inferInsert,
  "createdAt"
>;
export type DemandPulseFamilyInput = Omit<
  typeof demandPulseFamilies.$inferInsert,
  "createdAt" | "updatedAt"
>;
export type DemandPulseFamilyEvidenceInput = Omit<
  typeof demandPulseFamilyEvidence.$inferInsert,
  "createdAt"
>;
export type DemandPulseCoverageCheckInput = Omit<
  typeof demandPulseCoverageChecks.$inferInsert,
  "createdAt" | "evaluatedAt"
>;
export type DemandPulseScoreInput = Omit<
  typeof demandPulseScores.$inferInsert,
  "createdAt"
>;

export type DemandPulseScope = {
  profileId: string;
  projectId: string;
  runId: string;
  evidenceVersion: string;
};
export type EvidenceGraphInput = {
  scope: DemandPulseScope;
  evidenceEvents: readonly DemandPulseEvidenceEventInput[];
  observationEvents: readonly DemandPulseObservationEventInput[];
  duplicateEdges: readonly DuplicateEdgeInput[];
};
export type FamilyResultsInput = {
  scope: DemandPulseScope;
  scoringVersion: string;
  families: readonly DemandPulseFamilyInput[];
  familyEvidence: readonly DemandPulseFamilyEvidenceInput[];
  coverageChecks: readonly DemandPulseCoverageCheckInput[];
  scores: readonly DemandPulseScoreInput[];
};

export type DemandPulseObservation =
  typeof demandPulseObservations.$inferSelect;
export type DemandPulseEvidenceEvent =
  typeof demandPulseEvidenceEvents.$inferSelect;
export type DemandPulseObservationEvent =
  typeof demandPulseObservationEvents.$inferSelect;
export type DemandPulseDuplicateEdge =
  typeof demandPulseDuplicateEdges.$inferSelect;
export type DemandPulseFamily = typeof demandPulseFamilies.$inferSelect;
export type DemandPulseFamilyEvidence =
  typeof demandPulseFamilyEvidence.$inferSelect;
export type DemandPulseCoverageCheck =
  typeof demandPulseCoverageChecks.$inferSelect;
export type DemandPulseScore = typeof demandPulseScores.$inferSelect;

export type DemandPulseProcessingSnapshot = {
  observations: DemandPulseObservation[];
  evidenceEvents: DemandPulseEvidenceEvent[];
  observationEvents: DemandPulseObservationEvent[];
  duplicateEdges: DemandPulseDuplicateEdge[];
  families: DemandPulseFamily[];
  familyEvidence: DemandPulseFamilyEvidence[];
  coverageChecks: DemandPulseCoverageCheck[];
  scores: DemandPulseScore[];
};
export type DemandPulseFamilyEvidenceDetail = {
  family: DemandPulseFamily | null;
  familyEvidence: Array<{
    membership: DemandPulseFamilyEvidence;
    evidenceEvent: DemandPulseEvidenceEvent;
    observation: DemandPulseObservation;
  }>;
};

export const scopeFields = [
  "projectId",
  "profileId",
  "runId",
  "evidenceVersion",
] as const;
export type ScopeField = (typeof scopeFields)[number];
export type LineageRow = Partial<Record<ScopeField, string>>;

export function validateScope(scope: DemandPulseScope): DemandPulseScope {
  for (const field of scopeFields) {
    if (typeof scope[field] !== "string" || scope[field].trim() === "") {
      throw new Error(`Demand pulse scope ${field} must be non-empty`);
    }
  }
  return scope;
}

function isRecord(value: object): value is Record<string, unknown> {
  return Object.keys(value).every((key) => typeof key === "string");
}

function rowKeyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return `${value}`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "symbol") return value.description ?? "";
  if (value === null || value === undefined) return "";
  return Object.prototype.toString.call(value);
}

function rowKey(row: object, fields: readonly string[]): string {
  const record = isRecord(row) ? row : {};
  return fields.map((field) => rowKeyValue(record[field])).join("\u0000");
}

export function validateRows<T extends LineageRow>(
  rows: readonly T[],
  scope: DemandPulseScope,
  fields: readonly ScopeField[],
  keyFields: readonly string[],
  label: string,
): T[] {
  const seen = new Map<string, string>();
  const ordered = [...rows];
  for (const row of ordered) {
    for (const field of fields) {
      if (row[field] !== scope[field]) {
        throw new Error(`${label} ${field} mismatch`);
      }
    }
    const key = rowKey(row, keyFields);
    const fingerprint = rowKey(row, Object.keys(row).toSorted());
    const prior = seen.get(key);
    if (prior !== undefined && prior !== fingerprint) {
      throw new Error(`${label} conflicting duplicate key`);
    }
    seen.set(key, fingerprint);
  }
  return ordered.toSorted((left, right) =>
    `${rowKey(left, keyFields)}\u0000${rowKey(left, ["id"])}`.localeCompare(
      `${rowKey(right, keyFields)}\u0000${rowKey(right, ["id"])}`,
    ),
  );
}

export function omit<T extends object, K extends PropertyKey>(
  row: T,
  ...fields: K[]
): Omit<T, Extract<K, keyof T>> {
  const result = { ...row };
  for (const field of fields) Reflect.deleteProperty(result, field);
  return result;
}

export function assertScoringVersion(
  rows: readonly DemandPulseScoreInput[],
  scoringVersion: string,
): void {
  if (typeof scoringVersion !== "string" || scoringVersion.trim() === "") {
    throw new Error("Demand pulse scoringVersion must be non-empty");
  }
  for (const row of rows) {
    if (row.scoringVersion !== scoringVersion) {
      throw new Error("Demand pulse score scoringVersion mismatch");
    }
  }
}
