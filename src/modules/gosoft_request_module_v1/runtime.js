"use strict";

const fs = require("fs");
const path = require("path");
const { getGrmConfig } = require("./config/grm_config");
const { validateRequest } = require("./domain/request_validator");
const { ensureBaseFolders, resolveTargetFolders } = require("./services/target_folder_service");
const { fetchParentRows } = require("./adapters/erp_parent_fetch");
const { fetchChildRows } = require("./adapters/erp_child_fetch");
const { enrichChildRows } = require("./adapters/erp_child_enrichment");
const { writeCsv } = require("./services/csv_export_service");
const { buildManifest } = require("./services/manifest_builder_service");

const VDN_COLUMNS = [
  "DNID", "SIFRADN", "NALOGID", "Nalog", "Nalog_Naziv", "SifraID", "KOLICINA",
  "ADMCTR", "AdmCtr_Naziv", "STATUS", "Status_Sifra", "Status_Naziv",
  "TERMIN_ZAC", "TERMIN_KON", "DAT_LANS", "DAT_KONC", "OPOMBE"
];

const POTREBA_COLUMNS = [
  "potrid", "dnid", "ident", "status", "kolicina", "koltrn", "pozicija", "tehn",
  "termin", "opombe", "dnoprid", "izmetkolnakos", "kolvhod", "timecr", "timemod",
  "usercr", "usermod", "zamikvgr", "osebid", "potrdil", "kontr_pod",
  "artikel_artid", "artikel_artikel", "artikel_naziv1", "artikel_naziv2",
  "artikel_admid", "artikel_barkoda", "artikel_em", "artklas_kljucevi"
];

function writeJson(outPath, value) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(value, null, 2), "utf8");
}

function archiveRequestFile({ requestFilePath, archiveDir }) {
  if (!requestFilePath || !fs.existsSync(requestFilePath)) return;
  fs.mkdirSync(archiveDir, { recursive: true });
  const dest = path.join(archiveDir, path.basename(requestFilePath));
  fs.renameSync(requestFilePath, dest);
}

async function processRequest({ request, requestFilePath }) {
  const config = getGrmConfig();
  ensureBaseFolders(config);

  const validated = validateRequest({ request, config });
  const folders = resolveTargetFolders({
    config,
    targetDrop: validated.target_drop,
    requestId: validated.request_id
  });

  try {
    const parentRows = await fetchParentRows({ request: validated });
    const childRows = await fetchChildRows({ request: validated, parentRows });
    const enrichment = await enrichChildRows({ request: validated, childRows });

    const manifestName = `${validated.request_id}.manifest.json`;
    const vDnName = `${validated.request_id}.v_dn.csv`;
    const potrebaName = `${validated.request_id}.potreba.csv`;

    const vDnPath = path.join(folders.responsePackageDir, vDnName);
    const potrebaPath = path.join(folders.responsePackageDir, potrebaName);
    const manifestPath = path.join(folders.responsePackageDir, manifestName);

    writeCsv({ rows: parentRows, columns: VDN_COLUMNS, outPath: vDnPath });
    writeCsv({ rows: enrichment.rows, columns: POTREBA_COLUMNS, outPath: potrebaPath });

    const manifest = buildManifest({
      request: validated,
      processedAt: new Date().toISOString(),
      files: {
        v_dn: vDnName,
        potreba: potrebaName
      },
      vDnRows: parentRows,
      potrebaRows: enrichment.rows,
      warnings: enrichment.warnings
    });
    writeJson(manifestPath, manifest);

    archiveRequestFile({
      requestFilePath,
      archiveDir: folders.archiveProcessedDir
    });

    return {
      ok: true,
      request_id: validated.request_id,
      response_dir: folders.responsePackageDir,
      manifest_path: manifestPath,
      v_dn_path: vDnPath,
      potreba_path: potrebaPath,
      counts: manifest.counts,
      warnings: manifest.warnings
    };
  } catch (err) {
    const failedManifest = {
      request_id: validated.request_id,
      module_id: validated.module_id,
      contract_version: validated.contract_version,
      status: "failed",
      requested_at: validated.requested_at,
      processed_at: new Date().toISOString(),
      fetch_mode: validated.fetch_mode,
      params: validated.params,
      files: {},
      counts: {
        v_dn_rows: 0,
        potreba_rows: 0,
        unique_dnid: 0,
        unique_potrid: 0,
        warning_count: 0
      },
      warnings: [],
      error: {
        code: "GRM_PROCESSING_FAILED",
        message: err && err.message ? err.message : String(err)
      },
      lineage: {
        source_system: "gosoft",
        parent_source: "V_DN",
        child_source: "POTREBA",
        child_enrichment_sources: ["ARTIKEL", "ARTKLAS"]
      }
    };
    const failedPath = path.join(folders.errorPackageDir, `${validated.request_id}.manifest.json`);
    writeJson(failedPath, failedManifest);
    archiveRequestFile({
      requestFilePath,
      archiveDir: folders.archiveFailedDir
    });
    return {
      ok: false,
      request_id: validated.request_id,
      error_manifest_path: failedPath,
      error: failedManifest.error.message
    };
  }
}

function loadRequestFromFile(requestFilePath) {
  return JSON.parse(fs.readFileSync(requestFilePath, "utf8"));
}

async function processRequestFile(requestFilePath) {
  const request = loadRequestFromFile(requestFilePath);
  return processRequest({ request, requestFilePath });
}

module.exports = {
  use_case: "gosoft_request_module_v1",
  processRequest,
  processRequestFile
};
