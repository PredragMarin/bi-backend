"use strict";

const { buildFunctionalPayloadFromVdnRow } = require("../../../core_shell/services/dxf_ops_functional_payload_service");
const { WARNING_CODES } = require("../domain/warning_codes");

function trimValue(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function startsWithHash(value) {
  return trimValue(value).startsWith("#");
}

function parsePartName(opombe) {
  const text = trimValue(opombe);
  if (!text.startsWith("#")) return null;
  const withoutHash = text.slice(1).trim();
  if (!withoutHash) return null;
  const firstToken = withoutHash.split(/\s+/, 1)[0];
  return firstToken || null;
}

function matchesRequestedPartName(opombe, partName) {
  const text = String(opombe || "");
  const token = String(partName || "").trim().toUpperCase();
  if (!token) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`#\\s*${escaped}(?:\\s|$)`, "i");
  return re.test(text);
}

function selectPartsForRow({ row, childRows, partNameList, warnings }) {
  const dnid = Number(row.DNID);
  return partNameList.reduce((acc, partName) => {
    const match = childRows.find((child) => matchesRequestedPartName(child.opombe, partName));
    if (!match) {
      warnings.push({
        code: WARNING_CODES.PART_NAME_NOT_FOUND,
        message: `SIFRADN ${trimValue(row.SIFRADN)} is missing part ${partName} for dnid=${dnid}`
      });
      return acc;
    }
    acc.push({
      part_key: `R${match.potrid}`,
      part_name: partName,
      opombe_raw: trimValue(match.opombe),
      kol: match.kolvhod
    });
    return acc;
  }, []);
}

function buildDxfPayload({ request, parentRows, childRowsByDnid }) {
  const warnings = [];
  const items = parentRows.map((row) => {
    const dnid = Number(row.DNID);
    const childRows = childRowsByDnid.get(dnid) || [];
    const functionalPayload = buildFunctionalPayloadFromVdnRow(row);
    const parts = selectPartsForRow({
      row,
      childRows,
      partNameList: request.params.part_name_list || [],
      warnings
    });
    return {
      functional_payload: {
        ...functionalPayload,
        sifradn: trimValue(row.SIFRADN)
      },
      N_broj: `N${dnid}`,
      parts
    };
  });

  return {
    schema_version: "1.0.0",
    request_id: request.request_id,
    module_id: request.module_id,
    contract_version: request.contract_version,
    generated_at: new Date().toISOString(),
    items
  };
}

function buildDxfArtifact({ request, parentRows, childRowsByDnid }) {
  const payload = buildDxfPayload({ request, parentRows, childRowsByDnid });
  const warnings = [];
  payload.items.forEach((item, index) => {
    const sourceRow = parentRows[index];
    const dnid = Number(sourceRow.DNID);
    const childRows = childRowsByDnid.get(dnid) || [];
    const itemWarnings = [];
    item.parts = selectPartsForRow({
      row: sourceRow,
      childRows,
      partNameList: request.params.part_name_list || [],
      warnings: itemWarnings
    });
    warnings.push(...itemWarnings);
  });
  return {
    payload,
    warnings
  };
}

module.exports = {
  startsWithHash,
  parsePartName,
  matchesRequestedPartName,
  buildDxfArtifact
};
