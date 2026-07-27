CREATE TABLE "demand_pulse_duplicate_edges" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"run_id" text NOT NULL,
	"evidence_version" text NOT NULL,
	"left_observation_id" text NOT NULL,
	"right_observation_id" text NOT NULL,
	"relation" text NOT NULL,
	"similarity" real NOT NULL,
	"reason" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demand_pulse_evidence_events" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"run_id" text NOT NULL,
	"event_key" text NOT NULL,
	"canonical_observation_id" text NOT NULL,
	"independent_count" integer DEFAULT 1 NOT NULL,
	"raw_observation_count" integer DEFAULT 1 NOT NULL,
	"first_observed_at" text NOT NULL,
	"last_observed_at" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "demand_pulse_evidence_events_independent_count_check" CHECK ("demand_pulse_evidence_events"."independent_count" = 1),
	CONSTRAINT "demand_pulse_evidence_events_raw_observation_count_check" CHECK ("demand_pulse_evidence_events"."raw_observation_count" >= 1)
);
--> statement-breakpoint
CREATE TABLE "demand_pulse_observation_events" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"run_id" text NOT NULL,
	"evidence_version" text NOT NULL,
	"observation_id" text NOT NULL,
	"event_id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demand_pulse_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"run_id" text NOT NULL,
	"source_id" text NOT NULL,
	"source_class" text NOT NULL,
	"source_platform" text NOT NULL,
	"source_domain" text,
	"external_id" text NOT NULL,
	"canonical_url" text NOT NULL,
	"outbound_url" text,
	"title" text NOT NULL,
	"excerpt" text,
	"observed_language" text NOT NULL,
	"published_at" text,
	"source_updated_at" text,
	"collected_at" text NOT NULL,
	"locale" text,
	"geography" text,
	"provenance" text NOT NULL,
	"retention_profile" text NOT NULL,
	"retention_expires_at" text,
	"raw_artifact_key" text,
	"canonical_url_hash" text,
	"content_hash" text,
	"question" text,
	"problem_statement" text,
	"decision_being_made" text,
	"intent" text,
	"funnel_stage" text,
	"engagement_score" real,
	"engagement_comments" real,
	"engagement_views" real,
	"engagement_reactions" real,
	"engagement_velocity_per_day" real,
	"engagement_community_percentile" real,
	"deletion_status" text DEFAULT 'active' NOT NULL,
	"deleted_at" text,
	"observation_key" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demand_pulse_coverage_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"run_id" text NOT NULL,
	"family_id" text NOT NULL,
	"status" text NOT NULL,
	"existing_canonical_url" text,
	"target_url" text,
	"prefers_existing_update" boolean DEFAULT false NOT NULL,
	"observed_language" text NOT NULL,
	"recommended_action" text NOT NULL,
	"reason" text NOT NULL,
	"evaluator_version" text NOT NULL,
	"evaluated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demand_pulse_families" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"family_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"canonical_question" text NOT NULL,
	"problem_statement" text NOT NULL,
	"decision_being_made" text,
	"locale" text,
	"geography" text,
	"intent" text,
	"funnel_stage" text,
	"regime" text DEFAULT 'unknown' NOT NULL,
	"lifecycle_status" text DEFAULT 'discovered' NOT NULL,
	"frozen" boolean DEFAULT false NOT NULL,
	"first_observed_at" text,
	"last_observed_at" text,
	"recommended_action" text,
	"recommended_target_url" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demand_pulse_family_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"run_id" text NOT NULL,
	"evidence_version" text NOT NULL,
	"family_id" text NOT NULL,
	"event_id" text NOT NULL,
	"membership_type" text DEFAULT 'independent' NOT NULL,
	"observed_language" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demand_pulse_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"run_id" text NOT NULL,
	"feed_item_id" text NOT NULL,
	"family_id" text NOT NULL,
	"kind" text NOT NULL,
	"action" text,
	"reason" text NOT NULL,
	"reviewed_by" text NOT NULL,
	"decided_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"publication_triggered" boolean DEFAULT false NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "demand_pulse_decisions_publication_disabled_check" CHECK ("demand_pulse_decisions"."publication_triggered" = false),
	CONSTRAINT "demand_pulse_decisions_accept_action_check" CHECK (("demand_pulse_decisions"."kind" = 'accept') = ("demand_pulse_decisions"."action" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "demand_pulse_feed_items" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"run_id" text NOT NULL,
	"family_id" text NOT NULL,
	"coverage_check_id" text NOT NULL,
	"score_id" text NOT NULL,
	"selection_version" text NOT NULL,
	"evidence_version" text NOT NULL,
	"rank" integer NOT NULL,
	"title" text NOT NULL,
	"recommended_action" text NOT NULL,
	"provenance" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "demand_pulse_feed_items_rank_check" CHECK ("demand_pulse_feed_items"."rank" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "demand_pulse_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"run_id" text NOT NULL,
	"family_id" text NOT NULL,
	"coverage_check_id" text NOT NULL,
	"scoring_version" text NOT NULL,
	"evidence_version" text NOT NULL,
	"vector_json" text NOT NULL,
	"positive_components_json" text NOT NULL,
	"penalty_components_json" text NOT NULL,
	"positive_score" real NOT NULL,
	"penalty_score" real NOT NULL,
	"priority_score" real NOT NULL,
	"confidence" real NOT NULL,
	"band" text NOT NULL,
	"compliance_blocked" boolean DEFAULT false NOT NULL,
	"compliance_reason" text,
	"compliance_note" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "demand_pulse_scores_compliance_reason_check" CHECK ("demand_pulse_scores"."compliance_blocked" = ("demand_pulse_scores"."compliance_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "demand_pulse_duplicate_edges" ADD CONSTRAINT "demand_pulse_duplicate_edges_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_duplicate_edges" ADD CONSTRAINT "demand_pulse_duplicate_edges_profile_project_fk" FOREIGN KEY ("profile_id","project_id") REFERENCES "public"."demand_pulse_profiles"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_duplicate_edges" ADD CONSTRAINT "demand_pulse_duplicate_edges_run_profile_fk" FOREIGN KEY ("run_id","profile_id") REFERENCES "public"."demand_pulse_runs"("id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_duplicate_edges" ADD CONSTRAINT "demand_pulse_duplicate_edges_left_observation_fk" FOREIGN KEY ("left_observation_id","profile_id","project_id") REFERENCES "public"."demand_pulse_observations"("id","profile_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_duplicate_edges" ADD CONSTRAINT "demand_pulse_duplicate_edges_right_observation_fk" FOREIGN KEY ("right_observation_id","profile_id","project_id") REFERENCES "public"."demand_pulse_observations"("id","profile_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_evidence_events" ADD CONSTRAINT "demand_pulse_evidence_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_evidence_events" ADD CONSTRAINT "demand_pulse_evidence_events_profile_project_fk" FOREIGN KEY ("profile_id","project_id") REFERENCES "public"."demand_pulse_profiles"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_evidence_events" ADD CONSTRAINT "demand_pulse_evidence_events_run_profile_fk" FOREIGN KEY ("run_id","profile_id") REFERENCES "public"."demand_pulse_runs"("id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_evidence_events" ADD CONSTRAINT "demand_pulse_evidence_events_observation_run_fk" FOREIGN KEY ("canonical_observation_id","profile_id","project_id","run_id") REFERENCES "public"."demand_pulse_observations"("id","profile_id","project_id","run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_observation_events" ADD CONSTRAINT "demand_pulse_observation_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_observation_events" ADD CONSTRAINT "demand_pulse_observation_events_profile_project_fk" FOREIGN KEY ("profile_id","project_id") REFERENCES "public"."demand_pulse_profiles"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_observation_events" ADD CONSTRAINT "demand_pulse_observation_events_run_profile_fk" FOREIGN KEY ("run_id","profile_id") REFERENCES "public"."demand_pulse_runs"("id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_observation_events" ADD CONSTRAINT "demand_pulse_observation_events_observation_fk" FOREIGN KEY ("observation_id","profile_id","project_id") REFERENCES "public"."demand_pulse_observations"("id","profile_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_observation_events" ADD CONSTRAINT "demand_pulse_observation_events_event_fk" FOREIGN KEY ("event_id","profile_id","project_id") REFERENCES "public"."demand_pulse_evidence_events"("id","profile_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_observations" ADD CONSTRAINT "demand_pulse_observations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_observations" ADD CONSTRAINT "demand_pulse_observations_profile_project_fk" FOREIGN KEY ("profile_id","project_id") REFERENCES "public"."demand_pulse_profiles"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_observations" ADD CONSTRAINT "demand_pulse_observations_run_profile_fk" FOREIGN KEY ("run_id","profile_id") REFERENCES "public"."demand_pulse_runs"("id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_observations" ADD CONSTRAINT "demand_pulse_observations_source_profile_fk" FOREIGN KEY ("source_id","profile_id") REFERENCES "public"."demand_pulse_sources"("id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_observations" ADD CONSTRAINT "demand_pulse_observations_source_run_fk" FOREIGN KEY ("run_id","source_id","profile_id") REFERENCES "public"."demand_pulse_source_runs"("run_id","source_id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_coverage_checks" ADD CONSTRAINT "demand_pulse_coverage_checks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_coverage_checks" ADD CONSTRAINT "demand_pulse_coverage_checks_profile_project_fk" FOREIGN KEY ("profile_id","project_id") REFERENCES "public"."demand_pulse_profiles"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_coverage_checks" ADD CONSTRAINT "demand_pulse_coverage_checks_run_profile_fk" FOREIGN KEY ("run_id","profile_id") REFERENCES "public"."demand_pulse_runs"("id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_coverage_checks" ADD CONSTRAINT "demand_pulse_coverage_checks_family_fk" FOREIGN KEY ("family_id","profile_id","project_id") REFERENCES "public"."demand_pulse_families"("id","profile_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_families" ADD CONSTRAINT "demand_pulse_families_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_families" ADD CONSTRAINT "demand_pulse_families_profile_project_fk" FOREIGN KEY ("profile_id","project_id") REFERENCES "public"."demand_pulse_profiles"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_family_evidence" ADD CONSTRAINT "demand_pulse_family_evidence_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_family_evidence" ADD CONSTRAINT "demand_pulse_family_evidence_profile_project_fk" FOREIGN KEY ("profile_id","project_id") REFERENCES "public"."demand_pulse_profiles"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_family_evidence" ADD CONSTRAINT "demand_pulse_family_evidence_run_profile_fk" FOREIGN KEY ("run_id","profile_id") REFERENCES "public"."demand_pulse_runs"("id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_family_evidence" ADD CONSTRAINT "demand_pulse_family_evidence_family_fk" FOREIGN KEY ("family_id","profile_id","project_id") REFERENCES "public"."demand_pulse_families"("id","profile_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_family_evidence" ADD CONSTRAINT "demand_pulse_family_evidence_event_fk" FOREIGN KEY ("event_id","profile_id","project_id") REFERENCES "public"."demand_pulse_evidence_events"("id","profile_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_decisions" ADD CONSTRAINT "demand_pulse_decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_decisions" ADD CONSTRAINT "demand_pulse_decisions_profile_project_fk" FOREIGN KEY ("profile_id","project_id") REFERENCES "public"."demand_pulse_profiles"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_decisions" ADD CONSTRAINT "demand_pulse_decisions_run_profile_fk" FOREIGN KEY ("run_id","profile_id") REFERENCES "public"."demand_pulse_runs"("id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_decisions" ADD CONSTRAINT "demand_pulse_decisions_feed_run_family_fk" FOREIGN KEY ("feed_item_id","profile_id","project_id","run_id","family_id") REFERENCES "public"."demand_pulse_feed_items"("id","profile_id","project_id","run_id","family_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_decisions" ADD CONSTRAINT "demand_pulse_decisions_family_fk" FOREIGN KEY ("family_id","profile_id","project_id") REFERENCES "public"."demand_pulse_families"("id","profile_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_feed_items" ADD CONSTRAINT "demand_pulse_feed_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_feed_items" ADD CONSTRAINT "demand_pulse_feed_items_profile_project_fk" FOREIGN KEY ("profile_id","project_id") REFERENCES "public"."demand_pulse_profiles"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_feed_items" ADD CONSTRAINT "demand_pulse_feed_items_run_profile_fk" FOREIGN KEY ("run_id","profile_id") REFERENCES "public"."demand_pulse_runs"("id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_feed_items" ADD CONSTRAINT "demand_pulse_feed_items_family_fk" FOREIGN KEY ("family_id","profile_id","project_id") REFERENCES "public"."demand_pulse_families"("id","profile_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_feed_items" ADD CONSTRAINT "demand_pulse_feed_items_coverage_run_family_fk" FOREIGN KEY ("coverage_check_id","profile_id","project_id","run_id","family_id") REFERENCES "public"."demand_pulse_coverage_checks"("id","profile_id","project_id","run_id","family_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_feed_items" ADD CONSTRAINT "demand_pulse_feed_items_score_coverage_run_family_evidence_fk" FOREIGN KEY ("score_id","profile_id","project_id","run_id","family_id","coverage_check_id","evidence_version") REFERENCES "public"."demand_pulse_scores"("id","profile_id","project_id","run_id","family_id","coverage_check_id","evidence_version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_scores" ADD CONSTRAINT "demand_pulse_scores_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_scores" ADD CONSTRAINT "demand_pulse_scores_profile_project_fk" FOREIGN KEY ("profile_id","project_id") REFERENCES "public"."demand_pulse_profiles"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_scores" ADD CONSTRAINT "demand_pulse_scores_run_profile_fk" FOREIGN KEY ("run_id","profile_id") REFERENCES "public"."demand_pulse_runs"("id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_scores" ADD CONSTRAINT "demand_pulse_scores_family_fk" FOREIGN KEY ("family_id","profile_id","project_id") REFERENCES "public"."demand_pulse_families"("id","profile_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_scores" ADD CONSTRAINT "demand_pulse_scores_coverage_run_family_fk" FOREIGN KEY ("coverage_check_id","profile_id","project_id","run_id","family_id") REFERENCES "public"."demand_pulse_coverage_checks"("id","profile_id","project_id","run_id","family_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_duplicate_edges_snapshot_pair_uidx" ON "demand_pulse_duplicate_edges" USING btree ("profile_id","run_id","evidence_version","left_observation_id","right_observation_id","relation");--> statement-breakpoint
CREATE INDEX "demand_pulse_duplicate_edges_snapshot_left_idx" ON "demand_pulse_duplicate_edges" USING btree ("project_id","run_id","evidence_version","left_observation_id");--> statement-breakpoint
CREATE INDEX "demand_pulse_duplicate_edges_snapshot_right_idx" ON "demand_pulse_duplicate_edges" USING btree ("project_id","run_id","evidence_version","right_observation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_evidence_events_id_profile_project_uidx" ON "demand_pulse_evidence_events" USING btree ("id","profile_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_evidence_events_id_profile_project_run_uidx" ON "demand_pulse_evidence_events" USING btree ("id","profile_id","project_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_evidence_events_profile_key_uidx" ON "demand_pulse_evidence_events" USING btree ("profile_id","event_key");--> statement-breakpoint
CREATE INDEX "demand_pulse_evidence_events_project_run_idx" ON "demand_pulse_evidence_events" USING btree ("project_id","run_id");--> statement-breakpoint
CREATE INDEX "demand_pulse_evidence_events_profile_observation_idx" ON "demand_pulse_evidence_events" USING btree ("profile_id","canonical_observation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_observation_events_version_uidx" ON "demand_pulse_observation_events" USING btree ("profile_id","run_id","observation_id","evidence_version");--> statement-breakpoint
CREATE INDEX "demand_pulse_observation_events_project_run_event_idx" ON "demand_pulse_observation_events" USING btree ("project_id","run_id","event_id");--> statement-breakpoint
CREATE INDEX "demand_pulse_observation_events_project_run_observation_idx" ON "demand_pulse_observation_events" USING btree ("project_id","run_id","observation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_observations_id_profile_project_uidx" ON "demand_pulse_observations" USING btree ("id","profile_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_observations_id_profile_project_run_uidx" ON "demand_pulse_observations" USING btree ("id","profile_id","project_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_observations_profile_key_uidx" ON "demand_pulse_observations" USING btree ("profile_id","observation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_observations_source_external_uidx" ON "demand_pulse_observations" USING btree ("profile_id","source_id","external_id");--> statement-breakpoint
CREATE INDEX "demand_pulse_observations_project_published_idx" ON "demand_pulse_observations" USING btree ("project_id","published_at");--> statement-breakpoint
CREATE INDEX "demand_pulse_observations_profile_run_idx" ON "demand_pulse_observations" USING btree ("profile_id","run_id");--> statement-breakpoint
CREATE INDEX "demand_pulse_observations_project_source_idx" ON "demand_pulse_observations" USING btree ("project_id","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_coverage_checks_id_profile_project_uidx" ON "demand_pulse_coverage_checks" USING btree ("id","profile_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_coverage_checks_id_profile_project_run_family_uidx" ON "demand_pulse_coverage_checks" USING btree ("id","profile_id","project_id","run_id","family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_coverage_checks_run_family_version_uidx" ON "demand_pulse_coverage_checks" USING btree ("profile_id","run_id","family_id","evaluator_version");--> statement-breakpoint
CREATE INDEX "demand_pulse_coverage_checks_project_family_status_idx" ON "demand_pulse_coverage_checks" USING btree ("project_id","family_id","status");--> statement-breakpoint
CREATE INDEX "demand_pulse_coverage_checks_profile_run_idx" ON "demand_pulse_coverage_checks" USING btree ("profile_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_families_id_profile_project_uidx" ON "demand_pulse_families" USING btree ("id","profile_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_families_profile_key_uidx" ON "demand_pulse_families" USING btree ("profile_id","family_key");--> statement-breakpoint
CREATE INDEX "demand_pulse_families_project_status_regime_idx" ON "demand_pulse_families" USING btree ("project_id","lifecycle_status","regime");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_family_evidence_run_family_event_version_uidx" ON "demand_pulse_family_evidence" USING btree ("profile_id","run_id","family_id","event_id","evidence_version");--> statement-breakpoint
CREATE INDEX "demand_pulse_family_evidence_profile_run_idx" ON "demand_pulse_family_evidence" USING btree ("profile_id","run_id");--> statement-breakpoint
CREATE INDEX "demand_pulse_family_evidence_project_family_idx" ON "demand_pulse_family_evidence" USING btree ("project_id","family_id");--> statement-breakpoint
CREATE INDEX "demand_pulse_family_evidence_project_event_idx" ON "demand_pulse_family_evidence" USING btree ("project_id","event_id");--> statement-breakpoint
CREATE INDEX "demand_pulse_decisions_feed_created_idx" ON "demand_pulse_decisions" USING btree ("feed_item_id","created_at");--> statement-breakpoint
CREATE INDEX "demand_pulse_decisions_project_created_idx" ON "demand_pulse_decisions" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "demand_pulse_decisions_profile_family_idx" ON "demand_pulse_decisions" USING btree ("profile_id","family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_feed_items_id_profile_project_uidx" ON "demand_pulse_feed_items" USING btree ("id","profile_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_feed_items_id_profile_project_run_family_uidx" ON "demand_pulse_feed_items" USING btree ("id","profile_id","project_id","run_id","family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_feed_items_run_family_evidence_version_uidx" ON "demand_pulse_feed_items" USING btree ("profile_id","run_id","family_id","evidence_version","selection_version");--> statement-breakpoint
CREATE INDEX "demand_pulse_feed_items_project_rank_idx" ON "demand_pulse_feed_items" USING btree ("project_id","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_feed_items_run_evidence_selection_rank_uidx" ON "demand_pulse_feed_items" USING btree ("profile_id","run_id","evidence_version","selection_version","rank");--> statement-breakpoint
CREATE INDEX "demand_pulse_feed_items_project_family_idx" ON "demand_pulse_feed_items" USING btree ("project_id","family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_scores_id_profile_project_uidx" ON "demand_pulse_scores" USING btree ("id","profile_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_scores_id_profile_project_run_family_uidx" ON "demand_pulse_scores" USING btree ("id","profile_id","project_id","run_id","family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_scores_id_profile_project_run_family_coverage_uidx" ON "demand_pulse_scores" USING btree ("id","profile_id","project_id","run_id","family_id","coverage_check_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_scores_run_family_coverage_evidence_uidx" ON "demand_pulse_scores" USING btree ("id","profile_id","project_id","run_id","family_id","coverage_check_id","evidence_version");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_scores_run_family_evidence_version_uidx" ON "demand_pulse_scores" USING btree ("profile_id","run_id","family_id","evidence_version","scoring_version");--> statement-breakpoint
CREATE INDEX "demand_pulse_scores_project_family_priority_idx" ON "demand_pulse_scores" USING btree ("project_id","family_id","priority_score");--> statement-breakpoint
CREATE INDEX "demand_pulse_scores_profile_run_idx" ON "demand_pulse_scores" USING btree ("profile_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_profiles_id_project_uidx" ON "demand_pulse_profiles" USING btree ("id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_source_runs_id_profile_uidx" ON "demand_pulse_source_runs" USING btree ("id","profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_source_runs_run_source_profile_uidx" ON "demand_pulse_source_runs" USING btree ("run_id","source_id","profile_id");