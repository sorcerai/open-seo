import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { projects } from "./app.schema";
import { demandPulseProfiles, demandPulseRuns } from "./demand-pulse.schema";
import { demandPulseEvidenceEvents } from "./demand-pulse-evidence.schema";

const isoNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const demandPulseFamilies = sqliteTable(
  "demand_pulse_families",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id").notNull(),
    familyKey: text("family_key").notNull(),
    version: integer("version").notNull().default(1),
    canonicalQuestion: text("canonical_question").notNull(),
    problemStatement: text("problem_statement").notNull(),
    decisionBeingMade: text("decision_being_made"),
    locale: text("locale"),
    geography: text("geography"),
    intent: text("intent"),
    funnelStage: text("funnel_stage"),
    regime: text("regime", {
      enum: [
        "emerging",
        "persistent",
        "seasonal",
        "event_driven",
        "evergreen_latent",
        "decaying",
        "unknown",
      ],
    })
      .notNull()
      .default("unknown"),
    lifecycleStatus: text("lifecycle_status", {
      enum: [
        "discovered",
        "normalized",
        "clustered",
        "corroborated",
        "promoted",
        "actioned",
        "measured",
        "decayed",
        "rejected",
      ],
    })
      .notNull()
      .default("discovered"),
    frozen: integer("frozen", { mode: "boolean" }).notNull().default(false),
    firstObservedAt: text("first_observed_at"),
    lastObservedAt: text("last_observed_at"),
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
        "reject",
      ],
    }),
    recommendedTargetUrl: text("recommended_target_url"),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    foreignKey({
      name: "demand_pulse_families_profile_project_fk",
      columns: [table.profileId, table.projectId],
      foreignColumns: [demandPulseProfiles.id, demandPulseProfiles.projectId],
    }).onDelete("cascade"),
    uniqueIndex("demand_pulse_families_id_profile_project_uidx").on(
      table.id,
      table.profileId,
      table.projectId,
    ),
    uniqueIndex("demand_pulse_families_profile_key_uidx").on(
      table.profileId,
      table.familyKey,
    ),
    index("demand_pulse_families_project_status_regime_idx").on(
      table.projectId,
      table.lifecycleStatus,
      table.regime,
    ),
  ],
);

export const demandPulseFamilyEvidence = sqliteTable(
  "demand_pulse_family_evidence",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id").notNull(),
    runId: text("run_id").notNull(),
    evidenceVersion: text("evidence_version").notNull(),
    familyId: text("family_id").notNull(),
    eventId: text("event_id").notNull(),
    membershipType: text("membership_type", {
      enum: [
        "independent",
        "duplicate",
        "cross_post",
        "reply",
        "translation",
        "superseded",
      ],
    })
      .notNull()
      .default("independent"),
    observedLanguage: text("observed_language"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    foreignKey({
      name: "demand_pulse_family_evidence_profile_project_fk",
      columns: [table.profileId, table.projectId],
      foreignColumns: [demandPulseProfiles.id, demandPulseProfiles.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_family_evidence_run_profile_fk",
      columns: [table.runId, table.profileId],
      foreignColumns: [demandPulseRuns.id, demandPulseRuns.profileId],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_family_evidence_family_fk",
      columns: [table.familyId, table.profileId, table.projectId],
      foreignColumns: [
        demandPulseFamilies.id,
        demandPulseFamilies.profileId,
        demandPulseFamilies.projectId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_family_evidence_event_fk",
      columns: [table.eventId, table.profileId, table.projectId],
      foreignColumns: [
        demandPulseEvidenceEvents.id,
        demandPulseEvidenceEvents.profileId,
        demandPulseEvidenceEvents.projectId,
      ],
    }).onDelete("cascade"),
    uniqueIndex(
      "demand_pulse_family_evidence_run_family_event_version_uidx",
    ).on(
      table.profileId,
      table.runId,
      table.familyId,
      table.eventId,
      table.evidenceVersion,
    ),
    index("demand_pulse_family_evidence_profile_run_idx").on(
      table.profileId,
      table.runId,
    ),
    index("demand_pulse_family_evidence_project_family_idx").on(
      table.projectId,
      table.familyId,
    ),
    index("demand_pulse_family_evidence_project_event_idx").on(
      table.projectId,
      table.eventId,
    ),
  ],
);

export const demandPulseCoverageChecks = sqliteTable(
  "demand_pulse_coverage_checks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id").notNull(),
    runId: text("run_id").notNull(),
    familyId: text("family_id").notNull(),
    status: text("status", {
      enum: ["covered", "partial", "gap", "unknown"],
    }).notNull(),
    existingCanonicalUrl: text("existing_canonical_url"),
    targetUrl: text("target_url"),
    prefersExistingUpdate: integer("prefers_existing_update", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    observedLanguage: text("observed_language").notNull(),
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
        "reject",
      ],
    }).notNull(),
    reason: text("reason").notNull(),
    evaluatorVersion: text("evaluator_version").notNull(),
    evaluatedAt: text("evaluated_at").notNull().default(isoNow),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    foreignKey({
      name: "demand_pulse_coverage_checks_profile_project_fk",
      columns: [table.profileId, table.projectId],
      foreignColumns: [demandPulseProfiles.id, demandPulseProfiles.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_coverage_checks_run_profile_fk",
      columns: [table.runId, table.profileId],
      foreignColumns: [demandPulseRuns.id, demandPulseRuns.profileId],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_coverage_checks_family_fk",
      columns: [table.familyId, table.profileId, table.projectId],
      foreignColumns: [
        demandPulseFamilies.id,
        demandPulseFamilies.profileId,
        demandPulseFamilies.projectId,
      ],
    }).onDelete("cascade"),
    uniqueIndex("demand_pulse_coverage_checks_id_profile_project_uidx").on(
      table.id,
      table.profileId,
      table.projectId,
    ),
    uniqueIndex(
      "demand_pulse_coverage_checks_id_profile_project_run_family_uidx",
    ).on(
      table.id,
      table.profileId,
      table.projectId,
      table.runId,
      table.familyId,
    ),
    uniqueIndex("demand_pulse_coverage_checks_run_family_version_uidx").on(
      table.profileId,
      table.runId,
      table.familyId,
      table.evaluatorVersion,
    ),
    index("demand_pulse_coverage_checks_project_family_status_idx").on(
      table.projectId,
      table.familyId,
      table.status,
    ),
    index("demand_pulse_coverage_checks_profile_run_idx").on(
      table.profileId,
      table.runId,
    ),
  ],
);
