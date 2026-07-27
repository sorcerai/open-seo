import { Check, ExternalLink, ShieldCheck, X } from "lucide-react";
import type { ReactNode } from "react";
import type {
  DemandPulseFeedItemDetail,
  DemandPulseFeedItemRecord,
  DemandPulseReviewKind,
} from "./DemandPulseFeedItem";
import {
  booleanValue,
  componentEntries,
  coverageBadgeClass,
  formatDate,
  formatLabel,
  formatNumber,
  formatPercent,
  numberValue,
  readField,
  stringValue,
} from "./demandPulseDisplay";

export function DetailGrid({
  detail,
  item,
}: {
  detail: DemandPulseFeedItemDetail;
  item: DemandPulseFeedItemRecord;
}) {
  const coverageStatus =
    stringValue(readField(detail.coverageCheck, "status")) ?? "unknown";
  const coverageUrl = stringValue(
    readField(detail.coverageCheck, "existingCanonicalUrl"),
  );
  const coverageReason =
    stringValue(readField(detail.coverageCheck, "reason")) ??
    stringValue(readField(detail.coverageCheck, "observedLanguage"));
  const priorityScore = numberValue(readField(detail.score, "priorityScore"));
  const confidence = numberValue(readField(detail.score, "confidence"));
  const scoreBand = stringValue(readField(detail.score, "band"));
  const positiveScore = numberValue(readField(detail.score, "positiveScore"));
  const penaltyScore = numberValue(readField(detail.score, "penaltyScore"));
  const scoringVersion = stringValue(readField(detail.score, "scoringVersion"));
  const complianceBlocked = booleanValue(
    readField(detail.score, "complianceBlocked"),
  );
  const complianceNote = stringValue(readField(detail.score, "complianceNote"));
  const positiveComponents = componentEntries(
    readField(detail.score, "positiveComponents") ??
      readField(detail.score, "positiveComponentsJson"),
  );
  const penaltyComponents = componentEntries(
    readField(detail.score, "penaltyComponents") ??
      readField(detail.score, "penaltyComponentsJson"),
  );
  const independentCount = detail.familyEvidence.filter(
    (evidence) => readField(evidence, "membershipType") === "independent",
  ).length;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section
        className="min-w-0 rounded-lg border border-base-300 bg-base-100 p-4"
        aria-labelledby={`coverage-${item.id}`}
      >
        <div className="flex items-center justify-between gap-2">
          <h4 id={`coverage-${item.id}`} className="font-semibold">
            Coverage
          </h4>
          <span
            className={`badge badge-sm ${coverageBadgeClass(coverageStatus)}`}
          >
            {formatLabel(coverageStatus)}
          </span>
        </div>
        <dl className="mt-3 space-y-3 text-sm">
          <MetaField
            label="Canonical page"
            value={coverageUrl ?? "No canonical page recorded"}
          />
          <MetaField
            label="Coverage basis"
            value={coverageReason ?? "Coverage basis not reported"}
          />
          <MetaField
            label="Recommended action"
            value={formatLabel(item.recommendedAction)}
          />
        </dl>
      </section>

      <section
        className="min-w-0 rounded-lg border border-base-300 bg-base-100 p-4"
        aria-labelledby={`score-${item.id}`}
      >
        <div className="flex items-center justify-between gap-2">
          <h4 id={`score-${item.id}`} className="font-semibold">
            Score
          </h4>
          <span className="badge badge-primary badge-sm">
            {scoreBand ? formatLabel(scoreBand) : "Not reported"}
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <MetaField label="Priority" value={formatNumber(priorityScore)} />
          <MetaField label="Confidence" value={formatPercent(confidence)} />
          <MetaField label="Positive" value={formatNumber(positiveScore)} />
          <MetaField label="Penalties" value={formatNumber(penaltyScore)} />
        </dl>
        {scoringVersion ? (
          <p className="mt-3 break-words font-mono text-[11px] text-base-content/50">
            Scoring version {scoringVersion}
          </p>
        ) : null}
        {complianceBlocked ? (
          <div className="alert alert-warning mt-3 text-xs">
            <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
            <span>
              Compliance review blocks promotion.
              {complianceNote ? ` ${complianceNote}` : ""}
            </span>
          </div>
        ) : null}
        {positiveComponents.length || penaltyComponents.length ? (
          <div className="mt-4 space-y-3 border-t border-base-300 pt-3">
            <ComponentList
              label="Positive components"
              entries={positiveComponents}
            />
            <ComponentList
              label="Penalty components"
              entries={penaltyComponents}
            />
          </div>
        ) : null}
      </section>

      <section
        className="min-w-0 rounded-lg border border-base-300 bg-base-100 p-4 lg:col-span-2"
        aria-labelledby={`evidence-${item.id}`}
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h4 id={`evidence-${item.id}`} className="font-semibold">
              Source evidence
            </h4>
            <p className="text-sm text-base-content/60">
              Independent events are counted separately from retained copies.
            </p>
          </div>
          <span className="text-xs font-medium text-base-content/55">
            {detail.familyEvidence.length} evidence record
            {detail.familyEvidence.length === 1 ? "" : "s"} · {independentCount}{" "}
            independent
          </span>
        </div>
        {detail.familyEvidence.length === 0 ? (
          <p className="mt-4 text-sm text-base-content/60">
            No evidence records were attached to this item.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {detail.familyEvidence.map((evidence, index) => (
              <EvidenceRow
                key={`${stringValue(readField(evidence, "id")) ?? index}`}
                evidence={evidence}
              />
            ))}
          </ul>
        )}
      </section>

      <section
        className="min-w-0 rounded-lg border border-base-300 bg-base-100 p-4 lg:col-span-2"
        aria-labelledby={`history-${item.id}`}
      >
        <h4 id={`history-${item.id}`} className="font-semibold">
          Review history
        </h4>
        {detail.decisions.length === 0 ? (
          <p className="mt-2 text-sm text-base-content/60">
            No review records yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {detail.decisions.map((decision, index) => (
              <li
                key={`${stringValue(readField(decision, "id")) ?? index}`}
                className="rounded-md border border-base-300 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`badge badge-sm ${stringValue(readField(decision, "kind")) === "accept" ? "badge-success" : "badge-error"}`}
                  >
                    {formatLabel(
                      stringValue(readField(decision, "kind")) ?? "review",
                    )}
                  </span>
                  <span className="text-xs text-base-content/55">
                    {formatDate(stringValue(readField(decision, "decidedAt")))}
                  </span>
                </div>
                <p className="mt-2 max-h-24 overflow-y-auto break-words whitespace-pre-wrap text-base-content/75">
                  {stringValue(readField(decision, "reason")) ??
                    "No reason recorded"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function EvidenceRow({ evidence }: { evidence: unknown }) {
  const source =
    stringValue(readField(evidence, "sourcePlatform")) ??
    stringValue(readField(evidence, "sourceClass")) ??
    stringValue(readField(evidence, "sourceDomain")) ??
    stringValue(readField(evidence, "sourceId")) ??
    "Source event";
  const sourceUrl =
    stringValue(readField(evidence, "canonicalUrl")) ??
    stringValue(readField(evidence, "outboundUrl"));
  const excerpt =
    stringValue(readField(evidence, "excerpt")) ??
    stringValue(readField(evidence, "question")) ??
    stringValue(readField(evidence, "observedLanguage"));
  const eventId =
    stringValue(readField(evidence, "eventId")) ??
    stringValue(readField(evidence, "id"));
  const membership = stringValue(readField(evidence, "membershipType"));

  return (
    <li className="rounded-md border border-base-300 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-words font-medium">{source}</p>
          <p className="mt-1 text-xs text-base-content/55">
            {membership ? `${formatLabel(membership)} · ` : ""}
            {eventId ? `Event ${eventId}` : "Evidence event"}
          </p>
        </div>
        {sourceUrl ? (
          <a
            className="link link-primary inline-flex shrink-0 items-center gap-1 break-all text-xs"
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open source <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        ) : null}
      </div>
      {excerpt ? (
        <p className="mt-3 max-h-36 overflow-y-auto break-words whitespace-pre-wrap text-sm leading-6 text-base-content/75">
          {excerpt}
        </p>
      ) : null}
    </li>
  );
}

function ComponentList({
  label,
  entries,
}: {
  label: string;
  entries: readonly [string, unknown][];
}) {
  if (entries.length === 0) return null;
  return (
    <div>
      <h5 className="text-xs font-semibold uppercase tracking-wide text-base-content/55">
        {label}
      </h5>
      <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
        {entries.map(([name, value]) => (
          <li key={name} className="flex items-center justify-between gap-3">
            <span className="min-w-0 break-words text-base-content/65">
              {formatLabel(name)}
            </span>
            <span className="shrink-0 font-mono text-base-content/80">
              {formatNumber(numberValue(value))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DetailState({
  icon,
  title,
  message,
  tone,
}: {
  icon: ReactNode;
  title: string;
  message: string;
  tone: "error" | "neutral";
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${tone === "error" ? "border-error/50 bg-error/5" : "border-base-300 bg-base-100"}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-base-content/65">{icon}</span>
        <div className="min-w-0">
          <h4 className="font-semibold">{title}</h4>
          <p className="mt-1 break-words text-sm leading-6 text-base-content/70">
            {message}
          </p>
        </div>
      </div>
    </div>
  );
}

export function MetaField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="font-semibold uppercase tracking-wide text-base-content/45">
        {label}
      </dt>
      <dd
        className={`mt-1 truncate text-base-content/75 ${mono ? "font-mono text-[11px]" : ""}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

export function ReviewBadge({ kind }: { kind: DemandPulseReviewKind }) {
  return (
    <span className="badge badge-success badge-sm gap-1">
      {kind === "accept" ? (
        <Check className="size-3" aria-hidden="true" />
      ) : (
        <X className="size-3" aria-hidden="true" />
      )}
      {kind === "accept" ? "Accepted" : "Rejected"}
    </span>
  );
}
