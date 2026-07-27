import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  real,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";
import {
  demandPulseCoverageChecks,
  demandPulseFamilies,
} from "./demand-pulse-family.schema";
import { demandPulseProfiles, demandPulseRuns } from "./demand-pulse.schema";

// Keep Demand Pulse timestamps as ISO-8601 UTC text, matching the existing
// hand-written Postgres schemas and the SQLite schema's text timestamp shape.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const demandPulseScores = pgTable(
  "demand_pulse_scores",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id").notNull(),
    runId: text("run_id").notNull(),
    familyId: text("family_id").notNull(),
    coverageCheckId: text("coverage_check_id").notNull(),
    scoringVersion: text("scoring_version").notNull(),
    evidenceVersion: text("evidence_version").notNull(),
    vectorJson: text("vector_json").notNull(),
    positiveComponentsJson: text("positive_components_json").notNull(),
    penaltyComponentsJson: text("penalty_components_json").notNull(),
    positiveScore: real("positive_score").notNull(),
    penaltyScore: real("penalty_score").notNull(),
    priorityScore: real("priority_score").notNull(),
    confidence: real("confidence").notNull(),
    band: text("band", {
      enum: ["ship_now", "validate_next", "monitor", "reject"],
    }).notNull(),
    complianceBlocked: boolean("compliance_blocked").notNull().default(false),
    complianceReason: text("compliance_reason", {
      enum: ["compliance_uncertainty"],
    }),
    complianceNote: text("compliance_note"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    foreignKey({
      name: "demand_pulse_scores_profile_project_fk",
      columns: [table.profileId, table.projectId],
      foreignColumns: [demandPulseProfiles.id, demandPulseProfiles.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_scores_run_profile_fk",
      columns: [table.runId, table.profileId],
      foreignColumns: [demandPulseRuns.id, demandPulseRuns.profileId],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_scores_family_fk",
      columns: [table.familyId, table.profileId, table.projectId],
      foreignColumns: [
        demandPulseFamilies.id,
        demandPulseFamilies.profileId,
        demandPulseFamilies.projectId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_scores_coverage_run_family_fk",
      columns: [
        table.coverageCheckId,
        table.profileId,
        table.projectId,
        table.runId,
        table.familyId,
      ],
      foreignColumns: [
        demandPulseCoverageChecks.id,
        demandPulseCoverageChecks.profileId,
        demandPulseCoverageChecks.projectId,
        demandPulseCoverageChecks.runId,
        demandPulseCoverageChecks.familyId,
      ],
    }).onDelete("cascade"),
    check(
      "demand_pulse_scores_compliance_reason_check",
      sql`${table.complianceBlocked} = (${table.complianceReason} IS NOT NULL)`,
    ),
    uniqueIndex("demand_pulse_scores_id_profile_project_uidx").on(
      table.id,
      table.profileId,
      table.projectId,
    ),
    uniqueIndex("demand_pulse_scores_id_profile_project_run_family_uidx").on(
      table.id,
      table.profileId,
      table.projectId,
      table.runId,
      table.familyId,
    ),
    uniqueIndex(
      "demand_pulse_scores_id_profile_project_run_family_coverage_uidx",
    ).on(
      table.id,
      table.profileId,
      table.projectId,
      table.runId,
      table.familyId,
      table.coverageCheckId,
    ),
    uniqueIndex("demand_pulse_scores_run_family_coverage_evidence_uidx").on(
      table.id,
      table.profileId,
      table.projectId,
      table.runId,
      table.familyId,
      table.coverageCheckId,
      table.evidenceVersion,
    ),
    uniqueIndex("demand_pulse_scores_run_family_evidence_version_uidx").on(
      table.profileId,
      table.runId,
      table.familyId,
      table.evidenceVersion,
      table.scoringVersion,
    ),
    index("demand_pulse_scores_project_family_priority_idx").on(
      table.projectId,
      table.familyId,
      table.priorityScore,
    ),
    index("demand_pulse_scores_profile_run_idx").on(
      table.profileId,
      table.runId,
    ),
  ],
);

export const demandPulseFeedItems = pgTable(
  "demand_pulse_feed_items",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id").notNull(),
    runId: text("run_id").notNull(),
    familyId: text("family_id").notNull(),
    coverageCheckId: text("coverage_check_id").notNull(),
    scoreId: text("score_id").notNull(),
    selectionVersion: text("selection_version").notNull(),
    evidenceVersion: text("evidence_version").notNull(),
    rank: integer("rank").notNull(),
    title: text("title").notNull(),
    recommendedAction: text("recommended_action", {
      enum: [
        "update_existing_page",
        "create_supporting_page",
        "add_faq",
        "create_comparison",
        "create_tool",
        "create_troubleshooter",
        "update_product_or_offer",
        "create_sales_enablement",
        "create_support_article",
        "monitor_only",
      ],
    }).notNull(),
    provenance: text("provenance", {
      enum: ["observed", "baseline_fingerprint", "generated_only"],
    }).notNull(),
    reason: text("reason").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    foreignKey({
      name: "demand_pulse_feed_items_profile_project_fk",
      columns: [table.profileId, table.projectId],
      foreignColumns: [demandPulseProfiles.id, demandPulseProfiles.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_feed_items_run_profile_fk",
      columns: [table.runId, table.profileId],
      foreignColumns: [demandPulseRuns.id, demandPulseRuns.profileId],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_feed_items_family_fk",
      columns: [table.familyId, table.profileId, table.projectId],
      foreignColumns: [
        demandPulseFamilies.id,
        demandPulseFamilies.profileId,
        demandPulseFamilies.projectId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_feed_items_coverage_run_family_fk",
      columns: [
        table.coverageCheckId,
        table.profileId,
        table.projectId,
        table.runId,
        table.familyId,
      ],
      foreignColumns: [
        demandPulseCoverageChecks.id,
        demandPulseCoverageChecks.profileId,
        demandPulseCoverageChecks.projectId,
        demandPulseCoverageChecks.runId,
        demandPulseCoverageChecks.familyId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_feed_items_score_coverage_run_family_evidence_fk",
      columns: [
        table.scoreId,
        table.profileId,
        table.projectId,
        table.runId,
        table.familyId,
        table.coverageCheckId,
        table.evidenceVersion,
      ],
      foreignColumns: [
        demandPulseScores.id,
        demandPulseScores.profileId,
        demandPulseScores.projectId,
        demandPulseScores.runId,
        demandPulseScores.familyId,
        demandPulseScores.coverageCheckId,
        demandPulseScores.evidenceVersion,
      ],
    }).onDelete("cascade"),
    check(
      "demand_pulse_feed_items_rank_check",
      sql`${table.rank} BETWEEN 1 AND 5`,
    ),
    uniqueIndex("demand_pulse_feed_items_id_profile_project_uidx").on(
      table.id,
      table.profileId,
      table.projectId,
    ),
    uniqueIndex(
      "demand_pulse_feed_items_id_profile_project_run_family_uidx",
    ).on(
      table.id,
      table.profileId,
      table.projectId,
      table.runId,
      table.familyId,
    ),
    uniqueIndex("demand_pulse_feed_items_run_family_evidence_version_uidx").on(
      table.profileId,
      table.runId,
      table.familyId,
      table.evidenceVersion,
      table.selectionVersion,
    ),
    index("demand_pulse_feed_items_project_rank_idx").on(
      table.projectId,
      table.rank,
    ),
    uniqueIndex("demand_pulse_feed_items_run_evidence_selection_rank_uidx").on(
      table.profileId,
      table.runId,
      table.evidenceVersion,
      table.selectionVersion,
      table.rank,
    ),
    index("demand_pulse_feed_items_project_family_idx").on(
      table.projectId,
      table.familyId,
    ),
  ],
);

export const demandPulseDecisions = pgTable(
  "demand_pulse_decisions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id").notNull(),
    runId: text("run_id").notNull(),
    feedItemId: text("feed_item_id").notNull(),
    familyId: text("family_id").notNull(),
    kind: text("kind", {
      enum: ["accept", "reject", "defer", "request_research"],
    }).notNull(),
    action: text("action", {
      enum: [
        "update_existing_page",
        "create_supporting_page",
        "add_faq",
        "create_comparison",
        "create_tool",
        "create_troubleshooter",
        "update_product_or_offer",
        "create_sales_enablement",
        "create_support_article",
        "monitor_only",
      ],
    }),
    reason: text("reason").notNull(),
    reviewedBy: text("reviewed_by").notNull(),
    decidedAt: text("decided_at").notNull().default(isoNow),
    publicationTriggered: boolean("publication_triggered")
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    foreignKey({
      name: "demand_pulse_decisions_profile_project_fk",
      columns: [table.profileId, table.projectId],
      foreignColumns: [demandPulseProfiles.id, demandPulseProfiles.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_decisions_run_profile_fk",
      columns: [table.runId, table.profileId],
      foreignColumns: [demandPulseRuns.id, demandPulseRuns.profileId],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_decisions_feed_run_family_fk",
      columns: [
        table.feedItemId,
        table.profileId,
        table.projectId,
        table.runId,
        table.familyId,
      ],
      foreignColumns: [
        demandPulseFeedItems.id,
        demandPulseFeedItems.profileId,
        demandPulseFeedItems.projectId,
        demandPulseFeedItems.runId,
        demandPulseFeedItems.familyId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_decisions_family_fk",
      columns: [table.familyId, table.profileId, table.projectId],
      foreignColumns: [
        demandPulseFamilies.id,
        demandPulseFamilies.profileId,
        demandPulseFamilies.projectId,
      ],
    }).onDelete("cascade"),
    index("demand_pulse_decisions_feed_created_idx").on(
      table.feedItemId,
      table.createdAt,
    ),
    index("demand_pulse_decisions_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
    index("demand_pulse_decisions_profile_family_idx").on(
      table.profileId,
      table.familyId,
    ),
    check(
      "demand_pulse_decisions_publication_disabled_check",
      sql`${table.publicationTriggered} = false`,
    ),
    check(
      "demand_pulse_decisions_accept_action_check",
      sql`(${table.kind} = 'accept') = (${table.action} IS NOT NULL)`,
    ),
  ],
);
