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

    if (!fromISO || !toISO) {
      return res.status(400).json({
        error: "EPR_RUN_DB_FAILED",
        message: "Missing body fields: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', group?: 'INOX|MAXDOOR|ADMIN|...' }"
      });
    }

    const { epr_data, calendar, osebe_raw, meta } = await fetchEprDatasets({
      fromISO,
      toISO,
      dsn: "Test_64"
    });

   
    const useCaseReq = {
      use_case: "epr_attendance_v1",
      period: { date_from: fromISO, date_to: toISO },
      debug: { dry_run: true },
      datasets: { epr_data, calendar, osebe_raw }
    };

    const full = await runUseCase(useCaseReq);

    // Return UI-friendly subset (keep ALL 5 outputs)
    const slim = {
      run_metadata: full.run_metadata,
      run_facts: full.run_facts,
      recap_lines: full.recap_lines || [],
      interval_results: full.interval_results || [],
      daily_summary: full.daily_summary || [],
      period_summary: full.period_summary || [],
      actions_queue: full.actions_queue || [],
      debug_db: {
        ...meta,
        group: group || null,
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
// postvljeno zbog različitih korisnika koji će raditi na različitim grupama (INOX, MXD,ADM )
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
