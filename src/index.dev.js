// src/index.js
const fs = require("fs");
const path = require("path");
const { runUseCase } = require("./core/runtime");

function getArg(name, def = null) {
  const key = `--${name}`;
  const idx = process.argv.indexOf(key);
  if (idx === -1) return def;
  const val = process.argv[idx + 1];
  if (!val || val.startsWith("--")) return def;
  return val;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function buildInlineReq() {
  return {
    use_case: "epr_attendance_v1",
    period: { date_from: "2025-12-01", date_to: "2025-12-31" },
    debug: { dry_run: true },
    datasets: {
      epr_data: [
        { osebid: 1, timevhod: "01/12/2025 07:40", timeizhod: "01/12/2025 15:30", tipizhod: 0, opomba: "" },
        { osebid: 2, timevhod: "01/12/2025 07:17", timeizhod: "01/12/2025 15:45", tipizhod: 0, opomba: "" },
        { osebid: 3, timevhod: "01/12/2025 07:30", timeizhod: "01/12/2025 16:30", tipizhod: 0, opomba: "" },
        { osebid: 4, timevhod: "01/12/2025 07:50", timeizhod: "01/12/2025 16:10", tipizhod: 0, opomba: "" }
      ],
      calendar: [
        { datum: "01/12/2025", dandelovni: 1, tekst: "", praznik: 0 }
      ],
      // backend-only; minimalno za FK validaciju u testu
      osebe_raw: [
        { osebid: 1, ime: "Test", priimek: "User" },
        { osebid: 2, ime: "Test", priimek: "User" },
        { osebid: 3, ime: "Test", priimek: "User" },
        { osebid: 4, ime: "Test", priimek: "User" }
      ]
    }
  };
}

function loadReqFromFile(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const raw = fs.readFileSync(abs, "utf8");
  return JSON.parse(raw);
}

function applyCliOverrides(req) {
  const use_case = getArg("use_case", null);
  const from = getArg("from", null);
  const to = getArg("to", null);

  if (use_case) req.use_case = use_case;
  if (from || to) {
    req.period = req.period || {};
    if (from) req.period.date_from = from;
    if (to) req.period.date_to = to;
  }

  // debug flags
  req.debug = req.debug || {};
  if (hasFlag("dry_run")) req.debug.dry_run = true;
  if (hasFlag("no_dry_run")) req.debug.dry_run = false;

  return req;
}

async function main() {
  const mode = getArg("mode", "inline"); // inline | file

  let req;
  if (mode === "file") {
    const input = getArg("input", null);
    if (!input) {
      throw new Error("Missing --input for --mode file. Example: --mode file --input ./input/req.json");
    }
    req = loadReqFromFile(input);
  } else if (mode === "inline") {
    req = buildInlineReq();
  } else {
    throw new Error(`Unknown --mode ${mode}. Supported: inline, file`);
  }

  req = applyCliOverrides(req);

  const result = await runUseCase(req);

  // output handling
  const out = getArg("out", null);
  const json = JSON.stringify(result, null, 2);

  if (out) {
    const absOut = path.isAbsolute(out) ? out : path.join(process.cwd(), out);
    fs.writeFileSync(absOut, json, "utf8");
    console.log(`Wrote result to: ${absOut}`);
  } else {
    console.log(json);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
