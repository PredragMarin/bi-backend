"use strict";

const express = require("express");
const {
  fetchDnoprLifecycleWindow,
  fetchDnoprLifecycleOrderDetail
} = require("../../modules/dnopr_lifecycle_v1/adapters/db_fetch_dnopr_lifecycle");

function trimValue(value) {
  return String(value === null || value === undefined ? "" : value).trim();
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

  return router;
}

module.exports = createDnoprSampleRouterV1;
