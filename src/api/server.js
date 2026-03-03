// src/api/server.js
const { exportAndPublish } = require("../modules/epr_attendance_v1/export_and_publish");

const express = require("express");
const path = require("path");
const fs = require("fs");
const createSmsApprovalsRouterV1 = require("./routes/sms_approvals_v1");
const { runUseCase } = require("../core/runtime");
const { fetchEprDatasets } = require("../dev/db_fetch_epr");

const app = express();
app.use(express.json({ limit: "10mb" }));
const repoRoot = path.resolve(__dirname, "..", ".."); // src/api -> repo
const outRoot = path.join(repoRoot, "out");
app.use("/api/approvals/v1", createSmsApprovalsRouterV1({ outRoot }));
// ---- Idle shutdown (minutes) ----
const IDLE_SHUTDOWN_MINUTES = Number(process.env.IDLE_SHUTDOWN_MINUTES || 10);
const IDLE_SHUTDOWN_MS = Number.isFinite(IDLE_SHUTDOWN_MINUTES) ? IDLE_SHUTDOWN_MINUTES * 60 * 1000 : 0;
let lastActivityAt = Date.now();
let idleTimer = null;

function armIdleShutdown(server) {
  if (!IDLE_SHUTDOWN_MS || IDLE_SHUTDOWN_MS <= 0) return;

  const schedule = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const idleFor = Date.now() - lastActivityAt;
      if (idleFor >= IDLE_SHUTDOWN_MS) {
        console.log(`Idle for ${Math.round(idleFor / 60000)} min. Shutting down server.`);
        server.close(() => process.exit(0));
      } else {
        schedule();
      }
    }, IDLE_SHUTDOWN_MS);
  };

  schedule();
}

app.use((req, res, next) => {
  res.on("finish", () => {
    lastActivityAt = Date.now();
  });
  next();
});

// --- Static UI folder ---
const uiDir = path.join(__dirname, "ui");
const eprHtmlPath = path.join(uiDir, "epr.html");
const smsHtmlPath = path.join(uiDir, "sms.html"); // +++

app.use("/ui", express.static(uiDir, { extensions: ["html"] }));

app.get("/ui/epr", (req, res) => res.sendFile(eprHtmlPath));
app.get("/ui/epr.html", (req, res) => res.sendFile(eprHtmlPath));
// +++ ADD:
app.get("/ui/sms", (req, res) => res.sendFile(smsHtmlPath));
app.get("/ui/sms.html", (req, res) => res.sendFile(smsHtmlPath));
// health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

// A) run with provided datasets (current behavior)
app.post("/api/epr/run", async (req, res) => {
  try {
    const result = await runUseCase(req.body);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "EPR_RUN_FAILED", message: err.message });
  }
});
//////////////////////////////////***** */
// B) run-db: server pulls from DB and runs deterministic pipeline
app.post("/api/epr/run-db", async (req, res) => {
  try {
    const fromISO = req.body?.from;
    const toISO = req.body?.to;
    const group = String(req.body?.group || "").trim(); // OPTIONAL: "INOX" | "MAXDOOR" | "ADMIN" ...
    const hzzoEnabled = Boolean(req.body?.hzzo_enabled);
    const hzzoDir = String(req.body?.hzzo_dir || "").trim();
    const hzzoAsOf = String(req.body?.hzzo_as_of || "").trim();

    if (!fromISO || !toISO) {
      return res.status(400).json({
        error: "EPR_RUN_DB_FAILED",
        message: "Missing body fields: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', group?: 'INOX|MAXDOOR|ADMIN|...', hzzo_enabled?: boolean, hzzo_dir?: string, hzzo_as_of?: 'YYYY-MM-DD' }"
      });
    }

    const { epr_data, calendar, osebe_raw, meta } = await fetchEprDatasets({
      fromISO,
      toISO,
      dsn: (process.env.ERP_DSN || "ERP_POC_RO"),
      hzzoEnabled,
      hzzoDir,
      hzzoAsOfDate: hzzoAsOf || toISO
    });

   
    const useCaseReq = {
      use_case: "epr_attendance_v1",
      period: { date_from: fromISO, date_to: toISO },
      debug: { dry_run: true },
      datasets: { epr_data, calendar, osebe_raw }
    };

    const full = await runUseCase(useCaseReq);
    const baseActions = Array.isArray(full.actions_queue) ? full.actions_queue.slice() : [];
    const erpAbsenceDayKeys = new Set(
      (Array.isArray(full.interval_results) ? full.interval_results : [])
        .filter(r => {
          const t = Number(r?.tipizhod);
          if (!(t === 3 || t === 8 || t === 9)) return false;
          const notes = String(r?.notes || "").trim().toUpperCase();
          // Exclude synthetic HZZO rows; we need only real ERP absence entries.
          if (notes.startsWith("HZZO_AUTO_FROM_XLS")) return false;
          return true;
        })
        .map(r => `${Number(r.osebid)}|${String(r.work_date || "")}`)
        .filter(k => !k.endsWith("|"))
    );

    const hzzoActions = buildHzzoOverlayActions({
      hzzoMeta: meta && meta.hzzo ? meta.hzzo : null,
      osebeRaw: osebe_raw,
      coveredAbsenceDayKeys: erpAbsenceDayKeys
    });
    const hzzoCoveredDayKeys = new Set(
      hzzoActions
        .map(a => `${Number(a.osebid)}|${String(a.work_date || "")}`)
        .filter(k => !k.endsWith("|"))
    );
    const baseActionsFiltered = baseActions.filter(a => {
      if (String(a.action_type || "") !== "MISSING_ATTENDANCE_DAY") return true;
      const k = `${Number(a.osebid)}|${String(a.work_date || "")}`;
      return !hzzoCoveredDayKeys.has(k);
    });
    const actionsById = new Map();
    for (const a of [...baseActionsFiltered, ...hzzoActions]) {
      const id = String(a.action_id || "").trim();
      if (!id) continue;
      if (!actionsById.has(id)) actionsById.set(id, a);
    }
    const mergedActions = Array.from(actionsById.values()).sort((a, b) => {
      const pa = Number.isFinite(Number(a.priority_rank)) ? Number(a.priority_rank) : 99;
      const pb = Number.isFinite(Number(b.priority_rank)) ? Number(b.priority_rank) : 99;
      if (pa !== pb) return pa - pb;
      return String(a.action_id || "").localeCompare(String(b.action_id || ""));
    });

    const hzzoConflictActionsCount = mergedActions.filter(a => a.action_type === "CONFLICT_HZZO_PRESENCE").length;
    const hzzoFillActionsCount = mergedActions.filter(a => a.action_type === "HZZO_MISSING_FILL").length;
    const runMetadata = {
      ...(full.run_metadata || {}),
      hzzo_conflict_actions_count: hzzoConflictActionsCount,
      hzzo_fill_actions_count: hzzoFillActionsCount,
      payroll_blocked: hzzoConflictActionsCount > 0
    };

    const hzzoRawRows = Array.isArray(meta?.hzzo?.raw_json) ? meta.hzzo.raw_json : [];
    const hzzoParsedRows = hzzoRawRows.map(r => ({
      source_file: r.file || "",
      oib: r.oib || "",
      ime_prezime: r.ime_prezime || "",
      vrsta: r.vrsta || "",
      vrsta_norm: r.vrsta_norm || "",
      razlog: r.razlog || "",
      datum_evid: r.datum_evid || "",
      datum_pocetka: r.start || "",
      datum_zavrsetka: r.end || "",
      parsed_interval: !!(r.start && r.end),
      parsed_open_signal: !!(!r.start && !r.end && String(r.vrsta_norm || "") === "OBAVIJEST"),
      parsed_storno_signal: !!(!r.start && !r.end && String(r.vrsta_norm || "") === "OBAVIJEST_STORNIRANA")
    }));

    // Return UI-friendly subset
    const slim = {
      run_metadata: runMetadata,
      run_facts: full.run_facts,
      recap_lines: full.recap_lines || [],
      interval_results: full.interval_results || [],
      daily_summary: full.daily_summary || [],
      period_summary: full.period_summary || [],
      actions_queue: mergedActions,
      hzzo_parsed_rows: hzzoParsedRows,
      hzzo_synthesized_days: Array.isArray(meta?.hzzo?.synthesized_days) ? meta.hzzo.synthesized_days : [],
      hzzo_conflict_days: Array.isArray(meta?.hzzo?.conflict_days) ? meta.hzzo.conflict_days : [],
      debug_db: {
        ...meta,
        group: group || null,
        hzzo_enabled: hzzoEnabled,
        hzzo_dir: hzzoDir || null,
        hzzo_as_of: hzzoAsOf || toISO,
        osebe_raw: Array.isArray(osebe_raw) ? osebe_raw.length : 0,
        epr_data: Array.isArray(epr_data) ? epr_data.length : 0,
        osebe_raw_sample: (osebe_raw || []).slice(0, 10).map(p => ({
        osebid: p.osebid,
        priimek: p.priimek,
        ime: p.ime,
        group_code: p.group_code,
        mode: p.mode,
        tags_raw: p.tags_raw
  }))
      }
    };

    res.json(slim);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "EPR_RUN_DB_FAILED", message: err.message });
  }
});
//////////////////////////////novo za export i publish/
// C) export-and-publish: trajni output na disk
app.post("/api/export-and-publish", async (req, res) => {
  try {
    const runData = req.body;
    const result = await exportAndPublish(runData);
    res.json(result);
  } catch (err) {
    console.error("EXPORT FAIL", err);
    res.status(500).json({ error: "EXPORT_FAILED", message: err.message });
  }
});
//////////////////////////////kraj export i publish /
// 24/01/2026 dodano za tretman grupa  

const ALLOWED_GROUPS = ["INOX", "MXD", "ADM", "ALL"];

function buildHzzoOverlayActions({ hzzoMeta, osebeRaw, coveredAbsenceDayKeys }) {
  const out = [];
  const people = new Map((osebeRaw || []).map(p => [Number(p.osebid), p]));
  const synthesized = Array.isArray(hzzoMeta?.synthesized_days) ? hzzoMeta.synthesized_days : [];
  const conflicts = Array.isArray(hzzoMeta?.conflict_days) ? hzzoMeta.conflict_days : [];
  const covered = coveredAbsenceDayKeys instanceof Set ? coveredAbsenceDayKeys : new Set();

  for (const d of synthesized) {
    const osebid = Number(d.osebid);
    const dayKey = `${osebid}|${String(d.work_date || "")}`;
    if (covered.has(dayKey)) continue;
    const person = people.get(osebid) || {};
    out.push({
      action_id: `HZZO_FILL_${osebid}_${d.work_date}`,
      action_type: "HZZO_MISSING_FILL",
      severity: "ACTION",
      priority_rank: 2,
      ui_highlight: "YELLOW_BG",
      osebid,
      group_code: person.group_code || "",
      ime: person.ime || "",
      priimek: person.priimek || "",
      tel_gsm: person.tel_gsm || "",
      reason_codes: "HZZO_MISSING_FILL",
      work_date: d.work_date,
      summary: "Predložen unos bolovanja iz HZZO izvještaja",
      suggested_fix: "Potvrditi i upisati bolovanje u ERP za navedeni datum.",
      source: "hzzo.synthesized_days",
      sms_candidate: 0,
      sms_candidate_type: "",
      status: "OPEN",
      hzzo_oib: d.oib || "",
      hzzo_reason: d.hzzo_reason || ""
    });
  }

  for (const d of conflicts) {
    const osebid = Number(d.osebid);
    const person = people.get(osebid) || {};
    out.push({
      action_id: `HZZO_CONFLICT_${osebid}_${d.work_date}`,
      action_type: "CONFLICT_HZZO_PRESENCE",
      severity: "ACTION",
      priority_rank: 1,
      ui_highlight: "RED_BG",
      osebid,
      group_code: person.group_code || "",
      ime: person.ime || "",
      priimek: person.priimek || "",
      tel_gsm: person.tel_gsm || "",
      reason_codes: "CONFLICT_HZZO_PRESENCE",
      work_date: d.work_date,
      summary: "Konflikt: isti dan evidentirano bolovanje i prisustvo",
      suggested_fix: "Ručno provjeriti i razriješiti konflikt prije payroll zaključka.",
      source: "hzzo.conflict_days",
      sms_candidate: 0,
      sms_candidate_type: "",
      status: "OPEN",
      hzzo_oib: d.oib || "",
      hzzo_reason: d.hzzo_reason || ""
    });
  }

  return out;
}

function normalizeGroup(value) {
  if (!value) return null;
  const v = String(value).trim().toUpperCase();
  return ALLOWED_GROUPS.includes(v) ? v : null;
}

function parseBoolEnv(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "y";
}

app.get("/api/config", (req, res) => {
  const defaultViewGroup =
    normalizeGroup(process.env.BI_DEFAULT_VIEW_GROUP) || "ALL";

  const canPublishFinal = parseBoolEnv(process.env.BI_CAN_PUBLISH_FINAL, false);

  res.json({
    service: "bi-backend",
    dataset_mode: "ALL_COMPANY",
    dataset_label: "Dataset: ALL (company-wide)",
    default_view_group: defaultViewGroup,
    allowed_groups: ALLOWED_GROUPS,
    can_publish_final: canPublishFinal,
    server_time: new Date().toISOString(),
  });
});
// postavljeno zbog razlicitih korisnika koji ce raditi na razlicitim grupama (INOX, MXD, ADM)
const PORT = 3000;
const server = app.listen(PORT, () => {
  console.log(`EPR API listening on http://localhost:${PORT}`);
  console.log(`UI: http://localhost:${PORT}/ui/epr`);
  console.log(`UI (alt): http://localhost:${PORT}/ui/epr.html`);
  console.log("EMPLOYEE_TAGS_V1 =", process.env.EMPLOYEE_TAGS_V1);
  if (IDLE_SHUTDOWN_MS > 0) {
    console.log(`Idle shutdown: ${IDLE_SHUTDOWN_MINUTES} min`);
  } else {
    console.log("Idle shutdown: disabled");
  }
});

armIdleShutdown(server);
