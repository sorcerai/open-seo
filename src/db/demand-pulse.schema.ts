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

// Demand Pulse is currently a disabled-by-default, dry-run-only canary. Keep
// its persisted relationships explicit so later acquisition and processing
// repositories can query them without decoding JSON.
const isoNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const demandPulseProfiles = sqliteTable(
  "demand_pulse_profiles",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    policyRepository: text("policy_repository").notNull(),
    policyCommit: text("policy_commit").notNull(),
    policyPath: text("policy_path").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    dryRun: integer("dry_run", { mode: "boolean" }).notNull().default(true),
    publicationDisabled: integer("publication_disabled", { mode: "boolean" })
      .notNull()
      .default(true),
    timezone: text("timezone").notNull().default("America/Chicago"),
    dailyBudgetMicros: integer("daily_budget_micros")
      .notNull()
      .default(1_000_000),
    scoringVersion: text("scoring_version").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("demand_pulse_profiles_project_uidx").on(table.projectId),
    uniqueIndex("demand_pulse_profiles_id_project_uidx").on(
      table.id,
      table.projectId,
    ),
  ],
);

export const demandPulseSources = sqliteTable(
  "demand_pulse_sources",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => demandPulseProfiles.id, { onDelete: "cascade" }),
    adapter: text("adapter").notNull(),
    identityKey: text("identity_key").notNull(),
    sourceClass: text("source_class", {
      enum: [
        "first_party_observed",
        "search_observed",
        "community_observed",
        "market_event_observed",
        "ai_surface_observed",
        "generated_candidate",
        "primary_authoritative",
      ],
    }).notNull(),
    canonicalUrl: text("canonical_url"),
    recordKey: text("record_key"),
    approvalState: text("approval_state", {
      enum: ["pending", "approved", "rejected"],
    })
      .notNull()
      .default("pending"),
    policyState: text("policy_state").notNull().default("unknown"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    discoveryProvenance: text("discovery_provenance").notNull(),
    version: integer("version").notNull().default(1),
    reviewedBy: text("reviewed_by"),
    reviewedAt: text("reviewed_at"),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    index("demand_pulse_sources_profile_idx").on(table.profileId),
    uniqueIndex("demand_pulse_sources_id_profile_uidx").on(
      table.id,
      table.profileId,
    ),
    uniqueIndex("demand_pulse_sources_identity_uidx").on(
      table.profileId,
      table.adapter,
      table.identityKey,
    ),
    index("demand_pulse_sources_profile_state_idx").on(
      table.profileId,
      table.approvalState,
      table.enabled,
    ),
  ],
);

export const demandPulseRuns = sqliteTable(
  "demand_pulse_runs",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => demandPulseProfiles.id, { onDelete: "cascade" }),
    localDate: text("local_date").notNull(),
    status: text("status").notNull(),
    costMicros: integer("cost_micros").notNull().default(0),
    sourceCount: integer("source_count").notNull().default(0),
    healthySourceCount: integer("healthy_source_count").notNull().default(0),
    failedSourceCount: integer("failed_source_count").notNull().default(0),
    blockedSourceCount: integer("blocked_source_count").notNull().default(0),
    unknownSourceCount: integer("unknown_source_count").notNull().default(0),
    skippedSourceCount: integer("skipped_source_count").notNull().default(0),
    artifactKey: text("artifact_key"),
    scoringVersion: text("scoring_version").notNull(),
    startedAt: text("started_at").notNull().default(isoNow),
    completedAt: text("completed_at"),
    errorMessage: text("error_message"),
  },
  (table) => [
    uniqueIndex("demand_pulse_runs_id_profile_uidx").on(
      table.id,
      table.profileId,
    ),
    uniqueIndex("demand_pulse_runs_profile_date_uidx").on(
      table.profileId,
      table.localDate,
    ),
    index("demand_pulse_runs_profile_started_idx").on(
      table.profileId,
      table.startedAt,
    ),
  ],
);

export const demandPulseSourceRuns = sqliteTable(
  "demand_pulse_source_runs",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => demandPulseProfiles.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    sourceId: text("source_id").notNull(),
    health: text("health", {
      enum: ["healthy", "failed", "blocked", "unknown", "skipped"],
    })
      .notNull()
      .default("unknown"),
    policyState: text("policy_state").notNull().default("unknown"),
    requestCount: integer("request_count").notNull().default(0),
    costMicros: integer("cost_micros").notNull().default(0),
    cursor: text("cursor"),
    artifactPointer: text("artifact_pointer"),
    errorMessage: text("error_message"),
    startedAt: text("started_at").notNull().default(isoNow),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    foreignKey({
      name: "demand_pulse_source_runs_run_profile_fk",
      columns: [table.runId, table.profileId],
      foreignColumns: [demandPulseRuns.id, demandPulseRuns.profileId],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_source_runs_source_profile_fk",
      columns: [table.sourceId, table.profileId],
      foreignColumns: [demandPulseSources.id, demandPulseSources.profileId],
    }).onDelete("cascade"),
    uniqueIndex("demand_pulse_source_runs_id_profile_uidx").on(
      table.id,
      table.profileId,
    ),
    uniqueIndex("demand_pulse_source_runs_run_source_uidx").on(
      table.runId,
      table.sourceId,
    ),
    uniqueIndex("demand_pulse_source_runs_run_source_profile_uidx").on(
      table.runId,
      table.sourceId,
      table.profileId,
    ),
    index("demand_pulse_source_runs_profile_idx").on(table.profileId),
    index("demand_pulse_source_runs_run_idx").on(table.runId),
    index("demand_pulse_source_runs_source_idx").on(table.sourceId),
  ],
);
