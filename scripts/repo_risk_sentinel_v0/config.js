"use strict";

const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const REPORT_DIR = path.join(ROOT, "out", "repo_health", "repo_risk_sentinel_v0");

const WATCH_AREAS = [
  {
    key: "core_shell",
    label: "Core Shell",
    paths: ["src/core_shell"],
    js_roots: ["src/core_shell"],
    large_file_threshold_lines: 700,
    severe_growth_percent: 25,
    moderate_growth_percent: 12
  },
  {
    key: "mother_dxf_v1",
    label: "Mother DXF v1",
    paths: ["src/modules/mother_dxf_v1", "src/api/ui/mother_dxf.html", "docs/MOTHER_DXF_CONTRACT_v1.md"],
    js_roots: ["src/modules/mother_dxf_v1"],
    large_file_threshold_lines: 700,
    severe_growth_percent: 20,
    moderate_growth_percent: 10
  },
  {
    key: "dbr_v1",
    label: "DBR v1",
    paths: ["src/modules/dbr_v1", "docs/DBR_API_CONTRACT_v0.md", "docs/DBR_WORKING_OUTLINE_v0.md"],
    js_roots: ["src/modules/dbr_v1"],
    large_file_threshold_lines: 600,
    severe_growth_percent: 20,
    moderate_growth_percent: 10
  },
  {
    key: "gosoft_request_module_v1",
    label: "GRM / Gosoft Request Module",
    paths: ["src/modules/gosoft_request_module_v1", "docs/GRM_POC_CONTRACT_v1.md", "docs/GRM_IMPLEMENTATION_OUTLINE_v1.md"],
    js_roots: ["src/modules/gosoft_request_module_v1"],
    large_file_threshold_lines: 600,
    severe_growth_percent: 18,
    moderate_growth_percent: 9
  },
  {
    key: "dxf_processor_docs",
    label: "DXF Processor Docs",
    paths: [
      "docs/MOTHER_DXF_CONTRACT_v1.md",
      "docs/MOTHER_DXF_TO_DXF_MODIFIER_ROADMAP_v1.md",
      "docs/DXF_PROCESSOR_CHARTER_v0.md",
      "docs/DXF_INSTRUCTIONSET_CONTRACT_v0.md",
      "docs/DBR_API_CONTRACT_v0.md",
      "docs/DBR_WORKING_OUTLINE_v0.md",
      "docs/GRM_POC_CONTRACT_v1.md"
    ],
    js_roots: [],
    large_file_threshold_lines: 1200,
    severe_growth_percent: 25,
    moderate_growth_percent: 12
  }
];

const JSON_CONTRACT_FILES = [
  "src/modules/mother_dxf_v1/contracts/parameter_catalog_legacy_door_v0.json",
  "src/modules/mother_dxf_v1/contracts/rule_catalog_mxd_door_v0.json",
  "src/modules/dbr_v1/contracts/dbr_api_contract_v0.json",
  "src/modules/dbr_v1/contracts/dbr_sifradn_import_contract_v0.json"
];

const DXF_PAYLOAD_SENTINEL = {
  label: "DXF payload canonical keys",
  required_keys: ["KONF_ID", "MODEL_VRATA", "TIP_VRATA", "VISINA_VRATA", "SKRACENJE", "VISINA_EFF"],
  primary_file: "src/core_shell/services/dxf_ops_functional_payload_service.js",
  evidence_files: [
    "src/core_shell/services/dxf_ops_functional_payload_service.js",
    "src/core_shell/services/dxf_resolver_service.js",
    "src/modules/mother_dxf_v1/contracts/parameter_catalog_legacy_door_v0.json",
    "src/modules/mother_dxf_v1/contracts/rule_catalog_mxd_door_v0.json",
    "src/modules/mother_dxf_v1/module_runtime.js",
    "src/api/ui/mother_dxf.html",
    "src/modules/dbr_v1/adapters/erp_fetch_dbr_orders.js",
    "docs/DBR_API_CONTRACT_v0.md",
    "docs/DBR_WORKING_OUTLINE_v0.md",
    "docs/DXF_INSTRUCTIONSET_CONTRACT_v0.md",
    "docs/DXF_PROCESSOR_CHARTER_v0.md",
    "docs/OLD_MOTHER_DXF_Contract_v0_1.md"
  ]
};

module.exports = {
  ROOT,
  REPORT_DIR,
  WATCH_AREAS,
  JSON_CONTRACT_FILES,
  DXF_PAYLOAD_SENTINEL
};
