import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { projects } from "./app.schema";
import {
  demandPulseProfiles,
  demandPulseRuns,
  demandPulseSources,
  demandPulseSourceRuns,
} from "./demand-pulse.schema";

const isoNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const demandPulseObservations = sqliteTable(
  "demand_pulse_observations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id").notNull(),
    runId: text("run_id").notNull(),
    sourceId: text("source_id").notNull(),
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
    sourcePlatform: text("source_platform").notNull(),
    sourceDomain: text("source_domain"),
    externalId: text("external_id").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    outboundUrl: text("outbound_url"),
    title: text("title").notNull(),
    excerpt: text("excerpt"),
    observedLanguage: text("observed_language").notNull(),
    publishedAt: text("published_at"),
    sourceUpdatedAt: text("source_updated_at"),
    collectedAt: text("collected_at").notNull(),
    locale: text("locale"),
    geography: text("geography"),
    provenance: text("provenance").notNull(),
    retentionProfile: text("retention_profile").notNull(),
    retentionExpiresAt: text("retention_expires_at"),
    rawArtifactKey: text("raw_artifact_key"),
    canonicalUrlHash: text("canonical_url_hash"),
    contentHash: text("content_hash"),
    question: text("question"),
    problemStatement: text("problem_statement"),
    decisionBeingMade: text("decision_being_made"),
    intent: text("intent"),
    funnelStage: text("funnel_stage"),
    engagementScore: real("engagement_score"),
    engagementComments: real("engagement_comments"),
    engagementViews: real("engagement_views"),
    engagementReactions: real("engagement_reactions"),
    engagementVelocityPerDay: real("engagement_velocity_per_day"),
    engagementCommunityPercentile: real("engagement_community_percentile"),
    deletionStatus: text("deletion_status", {
      enum: ["active", "pending", "deleted"],
    })
      .notNull()
      .default("active"),
    deletedAt: text("deleted_at"),
    observationKey: text("observation_key").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    foreignKey({
      name: "demand_pulse_observations_profile_project_fk",
      columns: [table.profileId, table.projectId],
      foreignColumns: [demandPulseProfiles.id, demandPulseProfiles.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_observations_run_profile_fk",
      columns: [table.runId, table.profileId],
      foreignColumns: [demandPulseRuns.id, demandPulseRuns.profileId],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_observations_source_profile_fk",
      columns: [table.sourceId, table.profileId],
      foreignColumns: [demandPulseSources.id, demandPulseSources.profileId],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_observations_source_run_fk",
      columns: [table.runId, table.sourceId, table.profileId],
      foreignColumns: [
        demandPulseSourceRuns.runId,
        demandPulseSourceRuns.sourceId,
        demandPulseSourceRuns.profileId,
      ],
    }).onDelete("cascade"),
    uniqueIndex("demand_pulse_observations_id_profile_project_uidx").on(
      table.id,
      table.profileId,
      table.projectId,
    ),
    uniqueIndex("demand_pulse_observations_id_profile_project_run_uidx").on(
      table.id,
      table.profileId,
      table.projectId,
      table.runId,
    ),
    uniqueIndex("demand_pulse_observations_profile_key_uidx").on(
      table.profileId,
      table.observationKey,
    ),
    uniqueIndex("demand_pulse_observations_source_external_uidx").on(
      table.profileId,
      table.sourceId,
      table.externalId,
    ),
    index("demand_pulse_observations_project_published_idx").on(
      table.projectId,
      table.publishedAt,
    ),
    index("demand_pulse_observations_profile_run_idx").on(
      table.profileId,
      table.runId,
    ),
    index("demand_pulse_observations_project_source_idx").on(
      table.projectId,
      table.sourceId,
    ),
  ],
);

export const demandPulseEvidenceEvents = sqliteTable(
  "demand_pulse_evidence_events",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id").notNull(),
    runId: text("run_id").notNull(),
    eventKey: text("event_key").notNull(),
    canonicalObservationId: text("canonical_observation_id").notNull(),
    independentCount: integer("independent_count").notNull().default(1),
    rawObservationCount: integer("raw_observation_count").notNull().default(1),
    firstObservedAt: text("first_observed_at").notNull(),
    lastObservedAt: text("last_observed_at").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    foreignKey({
      name: "demand_pulse_evidence_events_profile_project_fk",
      columns: [table.profileId, table.projectId],
      foreignColumns: [demandPulseProfiles.id, demandPulseProfiles.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_evidence_events_run_profile_fk",
      columns: [table.runId, table.profileId],
      foreignColumns: [demandPulseRuns.id, demandPulseRuns.profileId],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_evidence_events_observation_run_fk",
      columns: [
        table.canonicalObservationId,
        table.profileId,
        table.projectId,
        table.runId,
      ],
      foreignColumns: [
        demandPulseObservations.id,
        demandPulseObservations.profileId,
        demandPulseObservations.projectId,
        demandPulseObservations.runId,
      ],
    }).onDelete("cascade"),
    check(
      "demand_pulse_evidence_events_independent_count_check",
      sql`${table.independentCount} = 1`,
    ),
    check(
      "demand_pulse_evidence_events_raw_observation_count_check",
      sql`${table.rawObservationCount} >= 1`,
    ),
    uniqueIndex("demand_pulse_evidence_events_id_profile_project_uidx").on(
      table.id,
      table.profileId,
      table.projectId,
    ),
    uniqueIndex("demand_pulse_evidence_events_id_profile_project_run_uidx").on(
      table.id,
      table.profileId,
      table.projectId,
      table.runId,
    ),
    uniqueIndex("demand_pulse_evidence_events_profile_key_uidx").on(
      table.profileId,
      table.eventKey,
    ),
    index("demand_pulse_evidence_events_project_run_idx").on(
      table.projectId,
      table.runId,
    ),
    index("demand_pulse_evidence_events_profile_observation_idx").on(
      table.profileId,
      table.canonicalObservationId,
    ),
  ],
);

export const demandPulseObservationEvents = sqliteTable(
  "demand_pulse_observation_events",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id").notNull(),
    runId: text("run_id").notNull(),
    evidenceVersion: text("evidence_version").notNull(),
    observationId: text("observation_id").notNull(),
    eventId: text("event_id").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    foreignKey({
      name: "demand_pulse_observation_events_profile_project_fk",
      columns: [table.profileId, table.projectId],
      foreignColumns: [demandPulseProfiles.id, demandPulseProfiles.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_observation_events_run_profile_fk",
      columns: [table.runId, table.profileId],
      foreignColumns: [demandPulseRuns.id, demandPulseRuns.profileId],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_observation_events_observation_fk",
      columns: [table.observationId, table.profileId, table.projectId],
      foreignColumns: [
        demandPulseObservations.id,
        demandPulseObservations.profileId,
        demandPulseObservations.projectId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_observation_events_event_fk",
      columns: [table.eventId, table.profileId, table.projectId],
      foreignColumns: [
        demandPulseEvidenceEvents.id,
        demandPulseEvidenceEvents.profileId,
        demandPulseEvidenceEvents.projectId,
      ],
    }).onDelete("cascade"),
    uniqueIndex("demand_pulse_observation_events_version_uidx").on(
      table.profileId,
      table.runId,
      table.observationId,
      table.evidenceVersion,
    ),
    index("demand_pulse_observation_events_project_run_event_idx").on(
      table.projectId,
      table.runId,
      table.eventId,
    ),
    index("demand_pulse_observation_events_project_run_observation_idx").on(
      table.projectId,
      table.runId,
      table.observationId,
    ),
  ],
);

export const demandPulseDuplicateEdges = sqliteTable(
  "demand_pulse_duplicate_edges",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id").notNull(),
    runId: text("run_id").notNull(),
    evidenceVersion: text("evidence_version").notNull(),
    leftObservationId: text("left_observation_id").notNull(),
    rightObservationId: text("right_observation_id").notNull(),
    relation: text("relation", {
      enum: ["exact", "canonical", "syndicated", "semantic"],
    }).notNull(),
    similarity: real("similarity").notNull(),
    reason: text("reason").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    foreignKey({
      name: "demand_pulse_duplicate_edges_profile_project_fk",
      columns: [table.profileId, table.projectId],
      foreignColumns: [demandPulseProfiles.id, demandPulseProfiles.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_duplicate_edges_run_profile_fk",
      columns: [table.runId, table.profileId],
      foreignColumns: [demandPulseRuns.id, demandPulseRuns.profileId],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_duplicate_edges_left_observation_fk",
      columns: [table.leftObservationId, table.profileId, table.projectId],
      foreignColumns: [
        demandPulseObservations.id,
        demandPulseObservations.profileId,
        demandPulseObservations.projectId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_pulse_duplicate_edges_right_observation_fk",
      columns: [table.rightObservationId, table.profileId, table.projectId],
      foreignColumns: [
        demandPulseObservations.id,
        demandPulseObservations.profileId,
        demandPulseObservations.projectId,
      ],
    }).onDelete("cascade"),
    uniqueIndex("demand_pulse_duplicate_edges_snapshot_pair_uidx").on(
      table.profileId,
      table.runId,
      table.evidenceVersion,
      table.leftObservationId,
      table.rightObservationId,
      table.relation,
    ),
    index("demand_pulse_duplicate_edges_snapshot_left_idx").on(
      table.projectId,
      table.runId,
      table.evidenceVersion,
      table.leftObservationId,
    ),
    index("demand_pulse_duplicate_edges_snapshot_right_idx").on(
      table.projectId,
      table.runId,
      table.evidenceVersion,
      table.rightObservationId,
    ),
  ],
);
