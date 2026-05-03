-- Taxonomy legend:
-- source_kind: bi_native | gosoft_reference | gosoft_snapshot
-- data_class: config | operational | artifact_metadata | audit
-- mutation_owner: BI | Gosoft | derived

CREATE SCHEMA IF NOT EXISTS catalog;

CREATE TABLE IF NOT EXISTS catalog.parameter_catalog (
  id BIGSERIAL PRIMARY KEY,
  catalog_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  parameter_key TEXT NOT NULL,
  code TEXT,
  label TEXT,
  type TEXT NOT NULL,
  unit TEXT,
  min_value NUMERIC,
  max_value NUMERIC,
  step_value NUMERIC,
  values_json JSONB,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (catalog_id, parameter_key)
);

COMMENT ON TABLE catalog.parameter_catalog IS
'source_kind: bi_native | data_class: config | mutation_owner: BI';

CREATE TABLE IF NOT EXISTS catalog.rule_catalog (
  id BIGSERIAL PRIMARY KEY,
  catalog_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  profile_id TEXT,
  label TEXT,
  feature TEXT,
  applies_to_variant TEXT,
  expression TEXT,
  result TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (catalog_id, rule_id)
);

COMMENT ON TABLE catalog.rule_catalog IS
'source_kind: bi_native | data_class: config | mutation_owner: BI';

CREATE TABLE IF NOT EXISTS catalog.product_kit_mapping (
  id BIGSERIAL PRIMARY KEY,
  product_code TEXT NOT NULL,
  technology_profile TEXT NOT NULL,
  part_code TEXT NOT NULL,
  part_sequence INTEGER NOT NULL,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  kit_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_code, technology_profile, kit_version, part_code)
);

COMMENT ON TABLE catalog.product_kit_mapping IS
'source_kind: bi_native | data_class: config | mutation_owner: BI';
