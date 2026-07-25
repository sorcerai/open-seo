-- OpenSEO Demand Pulse v1 reference schema
--
-- DO NOT run directly against production. Translate into the current upstream
-- Drizzle schema and next migration sequence after the fork is synced.
-- SQLite/D1-compatible reference only.

PRAGMA foreign_keys = ON;

CREATE TABLE dp_source_connections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_class TEXT NOT NULL,
  source_platform TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disabled',
  enabled INTEGER NOT NULL DEFAULT 0,
  dry_run INTEGER NOT NULL DEFAULT 1,
  compliance_approved INTEGER NOT NULL DEFAULT 0,
  secret_ref TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  capability_snapshot_json TEXT NOT NULL DEFAULT '{}',
  terms_profile_json TEXT NOT NULL DEFAULT '{}',
  retention_profile_json TEXT NOT NULL DEFAULT '{}',
  rate_budget_json TEXT NOT NULL DEFAULT '{}',
  last_cursor TEXT,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, source_platform, display_name)
);

CREATE TABLE dp_discovery_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_connection_id TEXT NOT NULL,
  status TEXT NOT NULL,
  seed_set_version TEXT,
  scoring_version TEXT,
  code_version TEXT,
  window_start TEXT,
  window_end TEXT,
  cursor_in TEXT,
  cursor_out TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  source_request_count INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  discovered_count INTEGER NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  deduplicated_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(source_connection_id) REFERENCES dp_source_connections(id)
);

CREATE TABLE dp_raw_artifacts (
  id TEXT PRIMARY KEY,
  discovery_run_id TEXT NOT NULL,
  source_connection_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  content_type TEXT,
  content_hash TEXT NOT NULL,
  byte_size INTEGER,
  collected_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  deletion_status TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY(discovery_run_id) REFERENCES dp_discovery_runs(id),
  FOREIGN KEY(source_connection_id) REFERENCES dp_source_connections(id),
  UNIQUE(source_connection_id, content_hash)
);

CREATE TABLE dp_observations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_connection_id TEXT NOT NULL,
  discovery_run_id TEXT NOT NULL,
  raw_artifact_id TEXT,
  source_class TEXT NOT NULL,
  source_platform TEXT NOT NULL,
  source_domain TEXT,
  external_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  canonical_url_hash TEXT NOT NULL,
  outbound_url TEXT,
  title TEXT NOT NULL,
  excerpt TEXT,
  content_hash TEXT,
  published_at TEXT NOT NULL,
  source_updated_at TEXT,
  collected_at TEXT NOT NULL,
  locale TEXT,
  geography TEXT,
  question TEXT,
  problem_statement TEXT,
  decision_statement TEXT,
  intent TEXT,
  funnel_stage TEXT,
  entities_json TEXT NOT NULL DEFAULT '[]',
  extraction_version TEXT,
  extraction_confidence REAL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  retention_profile_id TEXT NOT NULL,
  excerpt_expires_at TEXT,
  deletion_status TEXT NOT NULL DEFAULT 'active',
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(source_connection_id) REFERENCES dp_source_connections(id),
  FOREIGN KEY(discovery_run_id) REFERENCES dp_discovery_runs(id),
  FOREIGN KEY(raw_artifact_id) REFERENCES dp_raw_artifacts(id),
  UNIQUE(source_connection_id, external_id)
);

CREATE TABLE dp_engagement_snapshots (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  score REAL,
  comments REAL,
  views REAL,
  reactions REAL,
  velocity_per_day REAL,
  community_percentile REAL,
  normalization_version TEXT,
  raw_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(observation_id) REFERENCES dp_observations(id),
  UNIQUE(observation_id, captured_at)
);

CREATE TABLE dp_observation_relations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  left_observation_id TEXT NOT NULL,
  right_observation_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence REAL NOT NULL,
  method_version TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(left_observation_id) REFERENCES dp_observations(id),
  FOREIGN KEY(right_observation_id) REFERENCES dp_observations(id),
  UNIQUE(left_observation_id, right_observation_id, relation_type)
);

CREATE TABLE dp_prompt_families (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  family_version INTEGER NOT NULL DEFAULT 1,
  canonical_question TEXT NOT NULL,
  problem_statement TEXT NOT NULL,
  decision_statement TEXT,
  entities_json TEXT NOT NULL DEFAULT '[]',
  aliases_json TEXT NOT NULL DEFAULT '[]',
  locale TEXT,
  geography TEXT,
  intent TEXT,
  funnel_stage TEXT,
  regime TEXT NOT NULL DEFAULT 'unknown',
  lifecycle_status TEXT NOT NULL DEFAULT 'discovered',
  frozen INTEGER NOT NULL DEFAULT 0,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE dp_family_memberships (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  observation_id TEXT NOT NULL,
  membership_type TEXT NOT NULL DEFAULT 'independent',
  confidence REAL NOT NULL,
  clustering_version TEXT NOT NULL,
  human_review_status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(family_id) REFERENCES dp_prompt_families(id),
  FOREIGN KEY(observation_id) REFERENCES dp_observations(id),
  UNIQUE(family_id, observation_id)
);

CREATE TABLE dp_family_scores (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  window TEXT NOT NULL,
  window_end TEXT NOT NULL,
  scoring_version TEXT NOT NULL,
  vector_json TEXT NOT NULL,
  positive_components_json TEXT NOT NULL,
  penalty_components_json TEXT NOT NULL,
  positive_score REAL NOT NULL,
  penalty_score REAL NOT NULL,
  priority_score REAL NOT NULL,
  confidence REAL NOT NULL,
  band TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(family_id) REFERENCES dp_prompt_families(id),
  UNIQUE(family_id, window, window_end, scoring_version)
);

CREATE TABLE dp_family_actions (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  target_url TEXT,
  target_artifact_id TEXT,
  owner_id TEXT,
  rationale TEXT NOT NULL,
  expected_kpis_json TEXT NOT NULL DEFAULT '[]',
  family_version INTEGER NOT NULL,
  scoring_version TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  implemented_at TEXT,
  deploy_reference TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(family_id) REFERENCES dp_prompt_families(id)
);

CREATE TABLE dp_page_coverage (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  url TEXT NOT NULL,
  coverage_status TEXT NOT NULL,
  relevance_score REAL,
  answer_completeness REAL,
  cannibalization_risk REAL,
  evaluator_version TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  evaluated_at TEXT NOT NULL,
  FOREIGN KEY(family_id) REFERENCES dp_prompt_families(id),
  UNIQUE(family_id, url, evaluator_version)
);

CREATE TABLE dp_outcome_snapshots (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  window_label TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  gsc_json TEXT NOT NULL DEFAULT '{}',
  ai_visibility_json TEXT NOT NULL DEFAULT '{}',
  conversion_json TEXT NOT NULL DEFAULT '{}',
  support_json TEXT NOT NULL DEFAULT '{}',
  product_json TEXT NOT NULL DEFAULT '{}',
  notes TEXT,
  FOREIGN KEY(action_id) REFERENCES dp_family_actions(id),
  UNIQUE(action_id, window_label)
);

CREATE TABLE dp_deletion_queue (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_connection_id TEXT NOT NULL,
  external_id TEXT,
  canonical_url_hash TEXT,
  requested_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  completed_at TEXT,
  audit_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(source_connection_id) REFERENCES dp_source_connections(id)
);

CREATE INDEX idx_dp_source_connections_project_status
  ON dp_source_connections(project_id, status, enabled);
CREATE INDEX idx_dp_runs_project_started
  ON dp_discovery_runs(project_id, started_at DESC);
CREATE INDEX idx_dp_observations_project_published
  ON dp_observations(project_id, published_at DESC);
CREATE INDEX idx_dp_observations_url_hash
  ON dp_observations(project_id, canonical_url_hash);
CREATE INDEX idx_dp_observations_content_hash
  ON dp_observations(project_id, content_hash);
CREATE INDEX idx_dp_family_status_regime
  ON dp_prompt_families(project_id, lifecycle_status, regime);
CREATE INDEX idx_dp_family_score_priority
  ON dp_family_scores(window, window_end, priority_score DESC);
CREATE INDEX idx_dp_deletion_due
  ON dp_deletion_queue(status, due_at);
