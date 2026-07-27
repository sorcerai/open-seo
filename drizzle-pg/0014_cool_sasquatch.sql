CREATE TABLE "demand_pulse_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"policy_repository" text NOT NULL,
	"policy_commit" text NOT NULL,
	"policy_path" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"publication_disabled" boolean DEFAULT true NOT NULL,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"daily_budget_micros" integer DEFAULT 1000000 NOT NULL,
	"scoring_version" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demand_pulse_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"local_date" text NOT NULL,
	"status" text NOT NULL,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"source_count" integer DEFAULT 0 NOT NULL,
	"healthy_source_count" integer DEFAULT 0 NOT NULL,
	"failed_source_count" integer DEFAULT 0 NOT NULL,
	"blocked_source_count" integer DEFAULT 0 NOT NULL,
	"unknown_source_count" integer DEFAULT 0 NOT NULL,
	"skipped_source_count" integer DEFAULT 0 NOT NULL,
	"artifact_key" text,
	"scoring_version" text NOT NULL,
	"started_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"completed_at" text,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "demand_pulse_source_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"run_id" text NOT NULL,
	"source_id" text NOT NULL,
	"health" text DEFAULT 'unknown' NOT NULL,
	"policy_state" text DEFAULT 'unknown' NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"cursor" text,
	"artifact_pointer" text,
	"error_message" text,
	"started_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"completed_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demand_pulse_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"adapter" text NOT NULL,
	"identity_key" text NOT NULL,
	"source_class" text NOT NULL,
	"canonical_url" text,
	"record_key" text,
	"approval_state" text DEFAULT 'pending' NOT NULL,
	"policy_state" text DEFAULT 'unknown' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"discovery_provenance" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"reviewed_by" text,
	"reviewed_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demand_pulse_profiles" ADD CONSTRAINT "demand_pulse_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_runs" ADD CONSTRAINT "demand_pulse_runs_profile_id_demand_pulse_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."demand_pulse_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_source_runs" ADD CONSTRAINT "demand_pulse_source_runs_profile_id_demand_pulse_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."demand_pulse_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_source_runs" ADD CONSTRAINT "demand_pulse_source_runs_run_profile_fk" FOREIGN KEY ("run_id","profile_id") REFERENCES "public"."demand_pulse_runs"("id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_source_runs" ADD CONSTRAINT "demand_pulse_source_runs_source_profile_fk" FOREIGN KEY ("source_id","profile_id") REFERENCES "public"."demand_pulse_sources"("id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_pulse_sources" ADD CONSTRAINT "demand_pulse_sources_profile_id_demand_pulse_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."demand_pulse_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_profiles_project_uidx" ON "demand_pulse_profiles" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_runs_id_profile_uidx" ON "demand_pulse_runs" USING btree ("id","profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_runs_profile_date_uidx" ON "demand_pulse_runs" USING btree ("profile_id","local_date");--> statement-breakpoint
CREATE INDEX "demand_pulse_runs_profile_started_idx" ON "demand_pulse_runs" USING btree ("profile_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_source_runs_run_source_uidx" ON "demand_pulse_source_runs" USING btree ("run_id","source_id");--> statement-breakpoint
CREATE INDEX "demand_pulse_source_runs_profile_idx" ON "demand_pulse_source_runs" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "demand_pulse_source_runs_run_idx" ON "demand_pulse_source_runs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "demand_pulse_source_runs_source_idx" ON "demand_pulse_source_runs" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "demand_pulse_sources_profile_idx" ON "demand_pulse_sources" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_sources_id_profile_uidx" ON "demand_pulse_sources" USING btree ("id","profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_pulse_sources_identity_uidx" ON "demand_pulse_sources" USING btree ("profile_id","adapter","identity_key");--> statement-breakpoint
CREATE INDEX "demand_pulse_sources_profile_state_idx" ON "demand_pulse_sources" USING btree ("profile_id","approval_state","enabled");