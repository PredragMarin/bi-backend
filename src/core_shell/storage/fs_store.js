"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

function monthLabelFromPeriod(period) {
  const from = String(period?.date_from || "");
  const to = String(period?.date_to || "");
  const m1 = from.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const m2 = to.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m1 || !m2) return "unknown_period";
  if (m1[1] === m2[1] && m1[2] === m2[2] && m1[3] === "01") return `${m1[1]}_${m1[2]}`;
  return `${from.replace(/-/g, "_")}__${to.replace(/-/g, "_")}`;
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function writeJsonAtomic(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp_${process.pid}_${Date.now()}`;
  const text = JSON.stringify(value, null, 2);
  await fsp.writeFile(tmp, text, "utf8");
  try {
    await fsp.unlink(filePath);
  } catch (_) {
    // no-op
  }
  await fsp.rename(tmp, filePath);
}

function createFsStorage() {
  return {
    backend: "fs",

    async writeRunArtifacts({ storeRoot, period, run_id, run_ts, run_status, manifest, datasets, output, validation }) {
      const periodFolder = monthLabelFromPeriod(period);
      const runDir = path.join(storeRoot, "runs", periodFolder, String(run_id));
      const outputDir = path.join(runDir, "output");

      await ensureDir(outputDir);

      const runManifest = {
        use_case: String(manifest?.identity?.use_case || ""),
        run_id: String(run_id || ""),
        run_status: String(run_status || ""),
        generated_at: String(run_ts || ""),
        period: {
          date_from: String(period?.date_from || ""),
          date_to: String(period?.date_to || "")
        },
        contract_version: String(manifest?.identity?.contract_version || ""),
        module_version: String(manifest?.identity?.module_version || ""),
        artifacts: {
          output: "output/output.json",
          validation: "output/validation.json",
          datasets: "output/input_datasets.json"
        }
      };

      await Promise.all([
        writeJsonAtomic(path.join(runDir, "manifest.json"), runManifest),
        writeJsonAtomic(path.join(outputDir, "output.json"), output || {}),
        writeJsonAtomic(path.join(outputDir, "validation.json"), validation || {}),
        writeJsonAtomic(path.join(outputDir, "input_datasets.json"), datasets || {})
      ]);

      return {
        backend: "fs",
        store_root: storeRoot,
        period_folder: periodFolder,
        run_dir: runDir,
        output_file: path.join(outputDir, "output.json"),
        manifest_file: path.join(runDir, "manifest.json")
      };
    },

    async updateCurrentPointer({ storeRoot, period, storeInfo, use_case }) {
      const periodFolder = monthLabelFromPeriod(period);
      const pointerDir = path.join(storeRoot, "current");
      const pointerFile = path.join(pointerDir, `${periodFolder}.json`);

      const payload = {
        use_case: String(use_case || ""),
        period_folder: periodFolder,
        updated_at: new Date().toISOString(),
        store_info: storeInfo || {}
      };

      await writeJsonAtomic(pointerFile, payload);
      return { pointer_file: pointerFile };
    }
  };
}

module.exports = {
  createFsStorage,
  monthLabelFromPeriod,
  writeJsonAtomic
};
