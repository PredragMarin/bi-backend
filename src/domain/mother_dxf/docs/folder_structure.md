# Mother DXF Domain Folder Structure

```text
src/domain/mother_dxf/
  README.md
  manifest.json
  index.js
  batch/
    batch_models.js
  catalogs/
    family_properties.js
    parameter_sets.js
    rules_catalog.js
    technology_units.js
  contracts/
    batch_model_v2.schema.json
    domain_registry_v2.schema.json
    family_properties_v2.schema.json
    parameter_set_v2.schema.json
    product_in_parts_v2.schema.json
    rule_set_v2.schema.json
    technology_unit_v2.schema.json
  core/
    constants.js
    dependency_graph.js
    identity.js
    validation.js
  docs/
    db_ready_postgres_concept.md
    domain_model_v2.md
    folder_structure.md
    integration_plan.md
  examples/
    inox_registry_v2.js
  product/
    product_in_parts.js
```

## Ownership

- `core/`: identity helpers, dependency graph, registry validation.
- `catalogs/`: pure builders and selectors for technology units, parameter
  sets, rule sets, and family properties.
- `product/`: product-in-parts structures with ERP-ready references.
- `batch/`: batch model structures and execution unit projection.
- `contracts/`: DB-ready JSON shape documentation for v2 entities.
- `docs/`: architecture, DB concept, folder layout, integration plan.
- `examples/`: in-memory fixtures that demonstrate valid domain composition.

