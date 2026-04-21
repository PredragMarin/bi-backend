"use strict";

const fs = require("fs");
const path = require("path");
const { getGrmConfig } = require("./config/grm_config");
const { validateRequest } = require("./domain/request_validator");
const { getRequestRoute } = require("./domain/request_router");
const { WARNING_CODES } = require("./domain/warning_codes");
const { ensureBaseFolders, resolveTargetFolders } = require("./services/target_folder_service");
const { fetchParentRows } = require("./adapters/erp_parent_fetch");
const { fetchChildRows } = require("./adapters/erp_child_fetch");
const { enrichChildRows } = require("./adapters/erp_child_enrichment");
const { buildDxfArtifact } = require("./adapters/erp_child_dxf_parse");
const { buildManifest } = require("./services/manifest_builder_service");
const { writeJson, writeCsvBundle, writeJsonPayloadPackage } = require("./services/response_package_service");

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

function groupChildRowsByDnid(rows) {
  const out = new Map();
  for (const row of rows) {
    const dnid = Number(row.dnid ?? row.DNID);
    if (!Number.isFinite(dnid)) continue;
    if (!out.has(dnid)) out.set(dnid, []);
    out.get(dnid).push(row);
  }
  return out;
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
  const route = getRequestRoute(validated);
  const folders = resolveTargetFolders({
    config,
    targetDrop: validated.target_drop,
    requestId: validated.request_id
  });

  try {
    const parentResult = await fetchParentRows({ request: validated });
    const parentRows = parentResult.rows || [];
    const childResult = await fetchChildRows({ request: validated, parentRows });
    const childRows = childResult.rows || [];
    const baseWarnings = []
      .concat(parentResult.warnings || [])
      .concat(childResult.warnings || []);

    const manifestName = `${validated.request_id}.manifest.json`;
    const manifestPath = `${folders.responsePackageDir}/${manifestName}`;
    let artifact = null;
    let manifest = null;
    let outputPaths = {};

    if (route.kind === "dxf_manipulation_json") {
      const childRowsByDnid = groupChildRowsByDnid(childRows);
      const dxfWarnings = [...baseWarnings];
      for (const row of parentRows) {
        const dnid = Number(row.DNID);
        const dnidRows = childRowsByDnid.get(dnid) || [];
        if (!dnidRows.length) {
          dxfWarnings.push({
            code: WARNING_CODES.SIFRADN_NO_PARTS,
            message: `SIFRADN ${row.SIFRADN} matched V_DN but has no POTREBA rows with # opombe`
          });
        }
      }

      const dxfArtifact = buildDxfArtifact({
        request: validated,
        parentRows,
        childRowsByDnid
      });
      artifact = dxfArtifact.payload;
      dxfWarnings.push(...dxfArtifact.warnings);
      const payloadPackage = writeJsonPayloadPackage({
        responsePackageDir: folders.responsePackageDir,
        requestId: validated.request_id,
        payload: artifact
      });
      outputPaths = payloadPackage.paths;
      manifest = buildManifest({
        request: validated,
        processedAt: new Date().toISOString(),
        files: payloadPackage.files,
        vDnRows: parentRows,
        potrebaRows: childRows,
        warnings: dxfWarnings,
        countsOverride: {
          requested_sifradn: validated.params.sifradn_list.length,
          matched_v_dn_rows: parentRows.length,
          total_parts: artifact.items.reduce((acc, item) => acc + item.parts.length, 0),
          warning_count: dxfWarnings.length
        },
        lineageOverride: {
          source_system: "gosoft",
          parent_source: "V_DN",
          child_source: "POTREBA",
          child_filter: "part_name_list matched in opombe after #",
          child_parse_rule: "functional payload from V_DN opombe plus ordered parts selected from POTREBA"
        }
      });
      writeJson(manifestPath, manifest);
    } else {
      const enrichment = await enrichChildRows({ request: validated, childRows });
      const csvPackage = writeCsvBundle({
        responsePackageDir: folders.responsePackageDir,
        requestId: validated.request_id,
        vDnRows: parentRows,
        vDnColumns: VDN_COLUMNS,
        potrebaRows: enrichment.rows,
        potrebaColumns: POTREBA_COLUMNS
      });
      outputPaths = csvPackage.paths;
      manifest = buildManifest({
        request: validated,
        processedAt: new Date().toISOString(),
        files: csvPackage.files,
        vDnRows: parentRows,
        potrebaRows: enrichment.rows,
        warnings: baseWarnings.concat(enrichment.warnings || [])
      });
      writeJson(manifestPath, manifest);
    }

    archiveRequestFile({
      requestFilePath,
      archiveDir: folders.archiveProcessedDir
    });

    return {
      ok: true,
      request_id: validated.request_id,
      response_dir: folders.responsePackageDir,
      manifest_path: manifestPath,
      ...outputPaths,
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
