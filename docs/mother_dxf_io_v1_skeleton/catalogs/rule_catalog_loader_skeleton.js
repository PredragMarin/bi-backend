// Mother DXF DB-ready I/O skeleton: rule catalog loader.
//
// Svrha:
// - Opisuje buduci loader za versioned Mother DXF rule cataloge.
// - Ovaj fajl nije runtime kod i ne smije se importati iz src.
//
// Rule catalog versioning:
// - Svaki catalog treba imati catalog_id, schema_version, version, lifecycle status i metadata.
// - Aktivna verzija je immutable.
// - Deprecated rules ostaju dostupne radi historical replaya.
//
// Rule groups:
// - Legacy rules trenutno implicitno grupiraju kroz action.stage, action.geometry i profile_scope.
// - Buduci catalog v1 treba eksplicitni rule_groups array.
//
// Buduca integracija s runtime-om:
// - Runtime danas cita JSON contract iz modula.
// - Kasnije Core Shell catalog service moze resolveati catalog version i vratiti domain-safe snapshot runtimeu.
// - Mother DXF runtime ne treba znati je li catalog dosao iz filesystema ili DB metadata sloja.
//
// Artefakti:
// - catalogs/rules/<catalog_id>/<version>/rule_catalog.json
// - optional DB rows za catalog i rules.
//
// Artifact registry:
// - Versioned rule catalog JSON dobiva artifact record.
// - Session, preview, child i batch metadata referenciraju rule_catalog_id i version.
//
// Path reference model:
// - Catalog reference cuva root_key i relative_path.
// - DB path ne smije biti absolute local path.
//
// Param setovi:
// - Rule evaluation mora biti vezan uz param set koji je koristen za evaluaciju.
//
// Event stream:
// - Catalog registered/validated/activated/deprecated eventovi idu u event stream.
//
// function loadRuleCatalog() {}
