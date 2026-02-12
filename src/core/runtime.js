// src/core/runtime.js
const path = require("path");
const crypto = require("crypto");

const { loadManifest } = require("./manifest");
const { validateDatasets } = require("./validate");
const { sha256Hex } = require("./hash");
const { nowIsoWithOffset } = require("./time");
const { writeRunArtifacts, updateCurrentPointer } = require("./store");

const { computeEprOutputs } = require("./epr/compute");

function stableJsonStringify(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function buildRunId() {
  return crypto.randomUUID();
}

function periodLabel(period) {
  // deterministički label (mjesec ako je exact month)
  const from = period.date_from;
  const to = period.date_to;
  const fromYM = from.slice(0, 7);
  const toYM = to.slice(0, 7);
  const isSameMonth = (fromYM === toYM) && from.endsWith("-01");
  // “točno jedan mjesec” je strogo pitanje; ovdje minimalno:
  if (isSameMonth) return fromYM;
  return `${from}__${to}`;
}

async function runUseCase(req) {
  const { use_case, period, datasets, debug } = req;

  const manifest = loadManifest(use_case);
  const tz = manifest.runtime?.timezone || "Europe/Zagreb";

  // 1) Resolve run metadata
  const run_id = buildRunId();
  const generated_at = nowIsoWithOffset(tz);

  // 2) Validate inputs (no silent fix)
  const validation = validateDatasets({ manifest, datasets, period, timezone: tz });

  // 3) input_hash (deterministički hash payloada + perioda + use_case)
  const inputMaterial = {
    use_case,
    period,
    datasets
  };
  const input_hash = `sha256:${sha256Hex(stableJsonStringify(inputMaterial))}`;

  // 4) Compute outputs (module-specific compute is called from core routing)
  let computed;
  if (use_case === "epr_attendance_v1") {
    computed = computeEprOutputs({
      manifest,
      period,
      period_label: periodLabel(period),
      datasets,
      validation
    });
  } else {
    throw new Error(`Unknown use_case: ${use_case}`);
  }

  // 5) Determine run_status (minimalna politika: FINAL samo ako rejects=0 i needs_review=0)
  const rejects_count = computed.run_metadata.rejects_count;
  const needs_review_count = computed.run_metadata.needs_review_count;
  const run_status = (rejects_count === 0 && needs_review_count === 0) ? "FINAL" : "DRAFT";

  const output = {
    ...computed,
    run_metadata: {
      ...computed.run_metadata,
      run_id,
      use_case, // tehnički use_case modula
      contract_version: manifest.identity.contract_version,
      rules_version: "1.0.0",
      input_hash,
      run_status,
      generated_at
    }
  };

  // 6) Store artifacts (staging uvijek; published samo ako FINAL)
  if (!(debug && debug.dry_run)) {
    const storeRoot = path.resolve(manifest.storage.bi_store_root);
    const storeInfo = await writeRunArtifacts({
      storeRoot,
      period,
      run_id,
      run_ts: generated_at,
      run_status,
      manifest,
      datasets,
      output,
      validation
    });

    if (run_status === "FINAL") {
      await updateCurrentPointer({ storeRoot, period, storeInfo, use_case: "use_case_EPR" });
    }
  }

  return output;
}

module.exports = { runUseCase };
