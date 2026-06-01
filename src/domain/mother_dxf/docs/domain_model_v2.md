# Mother DXF Domain Model v2

## Entity Map

### Technology Unit

A technology unit is a stable production capability boundary. Examples:
`inox_laser_cutting`, `inox_bending`, `alu_milling`, `paint_prep`.

Owns:

- parameter schema references
- rule set compatibility
- DXF transformation references
- constraint references
- preview model references
- batch model compatibility

Does not own durable I/O or runtime execution.

### Parameter Set v2

A parameter set is a versioned, modular parameter collection. It contains base
values plus ordered overrides.

Override hierarchy:

1. `base`
2. `technology_unit`
3. `family`
4. `product`
5. `part`
6. `batch_item`

The resolver returns an in-memory resolved parameter plan. Core Shell may later
persist the selected plan through `param_set` I/O, without changing this layer.

### Rules Catalog v2

A rule set is versioned and belongs to exactly one technology unit. Rule sets
may depend on other rule sets by stable ID. Individual rules carry tags,
severity, expression references, family property conditions, and parameter
conditions.

This prepares for a future dependency configurator without introducing a rule
engine in this phase.

### Family Properties v2

Family properties are typed and normalized by product family. They influence
parameter set override selection and rule set applicability.

Supported value types:

- `string`
- `number`
- `boolean`
- `enum`
- `json`

### Product-in-Parts v2

A product structure breaks a product into ERP-ready parts. Each part can select
its own technology unit, parameter set, rule set, constraints, and ERP item
reference.

This supports INOX and non-INOX structures without forcing one universal part
model.

### Batch Model v2

A batch model groups execution items. A single batch may contain multiple
technology units, parameter sets, rule sets, products, and parts. Scheduling is
represented only as metadata and grouping hints; real scheduling is deferred.

## Relations

- Product structure uses one family properties record.
- Product structure contains many parts.
- Product part uses one technology unit.
- Product part uses one parameter set.
- Product part uses one rule set.
- Parameter set is compatible with many technology units.
- Rule set belongs to one technology unit.
- Rule set may depend on many rule sets.
- Batch model contains many batch items.
- Batch item references product, part, technology unit, parameter set, rule set.

## Dependency Graph

Graph nodes:

- `technology_unit:<id>`
- `parameter_set:<id>`
- `rule_set:<id>`
- `family_properties:<family_id>`
- `product_structure:<product_id>`
- `product_structure:<product_id>:part:<part_id>`
- `batch_model:<batch_id>`
- `batch_model:<batch_id>:item:<item_id>`

Graph edges:

- `uses_technology_unit`
- `uses_parameter_set`
- `uses_rule_set`
- `uses_family_properties`
- `depends_on_rule_set`
- `contains_part`
- `contains_batch_item`

The validator checks for missing references and graph cycles.

## Constraints

Current phase constraints:

- IDs must be stable strings.
- Technology unit IDs are global within the registry.
- Parameter set IDs are global within the registry.
- Rule set IDs are global within the registry.
- Family IDs are global within the registry.
- Product part IDs are unique inside one product structure.
- Batch item IDs are unique inside one batch model.
- Product part references must resolve to existing technology unit, parameter
  set, and rule set.
- Batch item references must resolve to existing product, technology unit,
  parameter set, and rule set.

Deferred constraints:

- Geometry expression execution
- DXF transformation runtime wiring
- Real scheduler constraints
- ERP source validation
- DB foreign key enforcement

