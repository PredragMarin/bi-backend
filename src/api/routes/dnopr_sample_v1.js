"use strict";

const express = require("express");
const XLSX = require("xlsx");
const {
  fetchDnoprLifecycleWindow,
  fetchDnoprLifecycleOrderDetail,
  fetchDnoprLifecycleActions
} = require("../../modules/dnopr_lifecycle_v1/adapters/db_fetch_dnopr_lifecycle");

function trimValue(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function safeFilePart(value, fallback) {
  const cleaned = trimValue(value).replace(/[^\w.-]+/g, "_");
  return cleaned || fallback;
}

function buildWowExportRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    Termin: trimValue(row.termin_zac),
    RN: trimValue(row.sifradn),
    Projekt: trimValue(row.projekt),
    Status: trimValue(row.status_sifra),
    AdmCtr: trimValue(row.admctr),
    Artikal: trimValue(row.artikel_sifra),
    "Naziv artikla": trimValue(row.artikel_naziv),
    Klas: trimValue(row.artikel_klas),
    JM: trimValue(row.artikel_jm),
    Kol: row.kolicina,
    "Art Ops": row.artikel_ops,
    "Artikal min": row.artikel_min,
    Ops: row.operation_count_window,
    Ledger: row.feedback_rows_window,
    "Plan min": row.planned_minutes_window,
    "Art/Plan variance": row.art_plan_variance_minutes,
    "Actual min": row.actual_minutes_window,
    Signals: Array.isArray(row.signals) ? row.signals.map((item) => trimValue(item.label)).filter(Boolean).join(" | ") : "",
    "Last feedback": trimValue(row.last_feedback_at_window)
  }));
}

function createDnoprSampleRouterV1() {
  const router = express.Router();

  router.get("/window", async (req, res) => {
    try {
      const result = await fetchDnoprLifecycleWindow({
        fromISO: req.query && req.query.from ? String(req.query.from) : "",
        toISO: req.query && req.query.to ? String(req.query.to) : "",
        dsn: req.query && req.query.dsn ? String(req.query.dsn) : (process.env.ERP_DSN || "ERP_POC_RO")
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: "DNOPR_WINDOW_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.get("/order/:dnid", async (req, res) => {
    try {
      const dnid = Number(req.params && req.params.dnid);
      if (!Number.isFinite(dnid)) {
        return res.status(400).json({ error: "DNOPR_ORDER_FAILED", message: "Invalid dnid" });
      }
      const result = await fetchDnoprLifecycleOrderDetail({
        dnid,
        dsn: req.query && req.query.dsn ? String(req.query.dsn) : (process.env.ERP_DSN || "ERP_POC_RO")
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: "DNOPR_ORDER_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.get("/actions", async (req, res) => {
    try {
      const result = await fetchDnoprLifecycleActions({
        fromISO: req.query && req.query.from ? String(req.query.from) : "",
        toISO: req.query && req.query.to ? String(req.query.to) : "",
        dsn: req.query && req.query.dsn ? String(req.query.dsn) : (process.env.ERP_DSN || "ERP_POC_RO")
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: "DNOPR_ACTIONS_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/export-wow-xlsx", async (req, res) => {
    try {
      const rows = buildWowExportRows(req.body && req.body.rows);
      const from = safeFilePart(req.body && req.body.from, "from");
      const to = safeFilePart(req.body && req.body.to, "to");
      const sheet = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, sheet, "WOW");
      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const fileName = `dnopr_wow_${from}_${to}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send(buffer);
    } catch (err) {
      res.status(400).json({
        error: "DNOPR_EXPORT_WOW_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  return router;
}

module.exports = createDnoprSampleRouterV1;
