import type { DemandPulseReviewState } from "./DemandPulseFeedItem";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() &&
    Number.isFinite(Number(value))
  )
    return Number(value);
  return undefined;
}

export function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "true";
}

export function componentEntries(value: unknown): Array<[string, unknown]> {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!isRecord(parsed)) return [];
  return Object.entries(parsed);
}

export function formatNumber(value: number | undefined): string {
  return value === undefined
    ? "Not reported"
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function formatPercent(value: number | undefined): string {
  return value === undefined ? "Not reported" : `${Math.round(value * 100)}%`;
}

export function formatDate(value: string | undefined): string {
  if (!value) return "Time not reported";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function formatLabel(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function coverageBadgeClass(status: string): string {
  switch (status) {
    case "covered":
      return "badge-success";
    case "partial":
      return "badge-warning";
    case "gap":
      return "badge-error";
    default:
      return "badge-ghost";
  }
}

export function reviewStateFromDecision(
  value: unknown,
): DemandPulseReviewState | undefined {
  const kind = stringValue(readField(value, "kind"));
  if (kind !== "accept" && kind !== "reject") return undefined;
  return {
    kind,
    reason: stringValue(readField(value, "reason")) ?? "",
    decidedAt: stringValue(readField(value, "decidedAt")),
  };
}
