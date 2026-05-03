-- Taxonomy legend:
-- source_kind: bi_native | gosoft_reference | gosoft_snapshot
-- data_class: config | operational | artifact_metadata | audit
-- mutation_owner: BI | Gosoft | derived

CREATE SCHEMA IF NOT EXISTS dcm;

CREATE TABLE IF NOT EXISTS dcm.mother_artifact_registry (
  id BIGSERIAL PRIMARY KEY,
  product_code TEXT NOT NULL,
  part_code TEXT NOT NULL,
  technology_profile TEXT NOT NULL,
  -- TODO: migrate to dcm session id when file-based storage is replaced
  mother_session_id TEXT,
  artifact_path TEXT NOT NULL,
  artifact_hash TEXT,
  approval_status TEXT NOT NULL,
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  document_sem JSONB,
  metadata_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE dcm.mother_artifact_registry IS
'source_kind: bi_native | data_class: artifact_metadata | mutation_owner: BI';

CREATE INDEX IF NOT EXISTS idx_mother_artifact_registry_lookup
  ON dcm.mother_artifact_registry (product_code, part_code, technology_profile, approval_status);
