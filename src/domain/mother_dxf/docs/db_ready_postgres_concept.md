# DB-Ready Postgres Concept for A5.5+

This is a conceptual schema only. No DB implementation is introduced in this
phase.

## Versioned Catalog Tables

### `mxd_technology_units`

- `id text primary key`
- `name text not null`
- `material_scope jsonb not null default '[]'`
- `metadata jsonb not null default '{}'`
- `created_at timestamptz`
- `updated_at timestamptz`

### `mxd_parameter_sets`

- `id text not null`
- `version text not null`
- `base_values jsonb not null default '{}'`
- `normalization_hints jsonb not null default '{}'`
- `metadata jsonb not null default '{}'`
- primary key: `(id, version)`

### `mxd_parameter_set_technology_units`

- `parameter_set_id text not null`
- `parameter_set_version text not null`
- `technology_unit_id text not null`
- primary key: `(parameter_set_id, parameter_set_version, technology_unit_id)`

### `mxd_parameter_overrides`

- `id bigserial primary key`
- `parameter_set_id text not null`
- `parameter_set_version text not null`
- `level text not null`
- `selector jsonb not null default '{}'`
- `values jsonb not null default '{}'`
- `sort_order integer not null`

### `mxd_rule_sets`

- `id text not null`
- `version text not null`
- `technology_unit_id text not null`
- `metadata jsonb not null default '{}'`
- primary key: `(id, version)`

### `mxd_rules`

- `id text not null`
- `rule_set_id text not null`
- `rule_set_version text not null`
- `severity text not null`
- `expression_ref text`
- `tags jsonb not null default '[]'`
- `family_property_conditions jsonb not null default '{}'`
- `parameter_conditions jsonb not null default '{}'`
- `message text`
- primary key: `(rule_set_id, rule_set_version, id)`

### `mxd_rule_set_dependencies`

- `rule_set_id text not null`
- `rule_set_version text not null`
- `depends_on_rule_set_id text not null`
- primary key: `(rule_set_id, rule_set_version, depends_on_rule_set_id)`

## Family and Product Tables

### `mxd_family_properties`

- `family_id text not null`
- `version text not null`
- `material_scope jsonb not null default '[]'`
- `metadata jsonb not null default '{}'`
- primary key: `(family_id, version)`

### `mxd_family_property_defs`

- `family_id text not null`
- `family_version text not null`
- `key text not null`
- `value_type text not null`
- `required boolean not null default false`
- `enum_values jsonb not null default '[]'`
- `default_value jsonb`
- `affects_parameter_keys jsonb not null default '[]'`
- `affects_rule_tags jsonb not null default '[]'`
- primary key: `(family_id, family_version, key)`

### `mxd_product_structures`

- `product_id text not null`
- `version text not null`
- `family_id text`
- `program_id text`
- `erp_product_ref text`
- `metadata jsonb not null default '{}'`
- primary key: `(product_id, version)`

### `mxd_product_parts`

- `product_id text not null`
- `product_version text not null`
- `part_id text not null`
- `parent_part_id text`
- `erp_item_ref text`
- `material_family text`
- `technology_unit_id text not null`
- `parameter_set_id text not null`
- `rule_set_id text not null`
- `quantity numeric not null default 1`
- `constraints jsonb not null default '{}'`
- `metadata jsonb not null default '{}'`
- primary key: `(product_id, product_version, part_id)`

## Batch Tables

### `mxd_batch_models`

- `batch_id text not null`
- `version text not null`
- `batch_type text not null`
- `constraints jsonb not null default '{}'`
- `metadata jsonb not null default '{}'`
- primary key: `(batch_id, version)`

### `mxd_batch_items`

- `batch_id text not null`
- `batch_version text not null`
- `item_id text not null`
- `product_id text not null`
- `part_id text not null`
- `technology_unit_id text not null`
- `parameter_set_id text not null`
- `rule_set_id text not null`
- `quantity numeric not null default 1`
- `scheduling_group text`
- `constraints jsonb not null default '{}'`
- `overrides jsonb not null default '{}'`
- primary key: `(batch_id, batch_version, item_id)`

## Session and Artifact Integration Tables

These map to existing Core Shell contracts and should remain owned by Core
Shell:

- `mxd_session_envelopes`
- `mxd_artifact_registries`
- `mxd_artifacts`
- `mxd_event_stream`
- `mxd_preview_artifacts`
- `mxd_child_metadata`

## Normalization Notes

- Keep versioned catalog identity as `(id, version)`.
- Store selectors and expressions as JSONB until the configurator stabilizes.
- Promote frequently queried selector keys into generated columns only after
  real production queries are known.
- Preserve ERP refs as external source identifiers, not foreign keys to ERP.
- Keep Core Shell persistence tables separate from domain catalog tables.

