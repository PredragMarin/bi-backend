-- Taxonomy legend:
-- source_kind: bi_native | gosoft_reference | gosoft_snapshot
-- data_class: config | operational | artifact_metadata | audit
-- mutation_owner: BI | Gosoft | derived

CREATE SCHEMA IF NOT EXISTS dbr;

CREATE TABLE IF NOT EXISTS dbr.dbr_production_order (
  id BIGSERIAL PRIMARY KEY,
  gosoft_dn_id BIGINT NOT NULL,
  gosoft_dn_key TEXT,
  parameter_snapshot JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'imported',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gosoft_dn_id)
);

COMMENT ON TABLE dbr.dbr_production_order IS
'source_kind: gosoft_reference+gosoft_snapshot | data_class: operational | mutation_owner: BI | gosoft_dn_id/key su reference, parameter_snapshot je frozen audit copy';

CREATE TABLE IF NOT EXISTS dbr.dbr_kit_batch (
  id BIGSERIAL PRIMARY KEY,
  production_order_id BIGINT NOT NULL REFERENCES dbr.dbr_production_order(id) ON DELETE CASCADE,
  batch_key TEXT NOT NULL UNIQUE,
  product_code TEXT NOT NULL,
  technology_profile TEXT NOT NULL,
  kit_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  summary JSONB
);

COMMENT ON TABLE dbr.dbr_kit_batch IS
'source_kind: bi_native | data_class: operational | mutation_owner: BI';

CREATE TABLE IF NOT EXISTS dbr.dbr_part_job (
  id BIGSERIAL PRIMARY KEY,
  kit_batch_id BIGINT NOT NULL REFERENCES dbr.dbr_kit_batch(id) ON DELETE CASCADE,
  part_code TEXT NOT NULL,
  part_sequence INTEGER NOT NULL,
  mother_artifact_id BIGINT REFERENCES dcm.mother_artifact_registry(id),
  parameter_snapshot JSONB NOT NULL,
  child_artifact_path TEXT,
  child_artifact_hash TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  generation_summary JSONB,
  warnings JSONB,
  errors JSONB,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL UNIQUE
);

COMMENT ON TABLE dbr.dbr_part_job IS
'source_kind: bi_native | data_class: operational | mutation_owner: BI | parameter_snapshot je frozen execution copy';

CREATE INDEX IF NOT EXISTS idx_dbr_kit_batch_order
  ON dbr.dbr_kit_batch (production_order_id, status);

CREATE INDEX IF NOT EXISTS idx_dbr_part_job_batch
  ON dbr.dbr_part_job (kit_batch_id, part_sequence);
