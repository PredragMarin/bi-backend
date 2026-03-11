"use strict";

const express = require("express");
const {
  runLayer1,
  getLayer1Status,
  getLayer1ViewData,
  recomputeLayer1FromStoredRaw,
  startLayer2Run,
  getLayer2RunStatus,
  getLayer2ViewData,
  getReviewCatalog,
  getOperatorReview,
  saveOperatorReview
} = require("../../core_shell/services/eojn_api_service");

function createEojnLayer1RouterV1() {
  const router = express.Router();

  router.get("/status", async (req, res) => {
    try {
      const status = await getLayer1Status({
        out_root: req.query && req.query.out_root ? String(req.query.out_root) : ""
      });
      res.json(status);
    } catch (err) {
      res.status(400).json({
        error: "EOJN_STATUS_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/run", async (req, res) => {
    try {
      const result = await runLayer1(req.body || {});
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: "EOJN_RUN_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.get("/layer1/view", async (req, res) => {
    try {
      const view = await getLayer1ViewData({
        out_root: req.query && req.query.out_root ? String(req.query.out_root) : "",
        run_date_ymd: req.query && req.query.run_date_ymd ? String(req.query.run_date_ymd) : ""
      });
      res.json(view);
    } catch (err) {
      res.status(400).json({
        error: "EOJN_LAYER1_VIEW_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/layer1/recompute", async (req, res) => {
    try {
      const result = await recomputeLayer1FromStoredRaw(req.body || {});
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: "EOJN_LAYER1_RECOMPUTE_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.get("/layer2/status", async (req, res) => {
    try {
      const status = await getLayer2RunStatus({
        out_root: req.query && req.query.out_root ? String(req.query.out_root) : ""
      });
      res.json(status);
    } catch (err) {
      res.status(400).json({
        error: "EOJN_LAYER2_STATUS_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/layer2/start", async (req, res) => {
    try {
      const result = await startLayer2Run(req.body || {});
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: "EOJN_LAYER2_START_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.get("/layer2/view", async (req, res) => {
    try {
      const view = await getLayer2ViewData({
        out_root: req.query && req.query.out_root ? String(req.query.out_root) : "",
        run_date_ymd: req.query && req.query.run_date_ymd ? String(req.query.run_date_ymd) : ""
      });
      res.json(view);
    } catch (err) {
      res.status(400).json({
        error: "EOJN_LAYER2_VIEW_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.get("/layer2/review/catalog", async (req, res) => {
    try {
      const view = await getReviewCatalog();
      res.json(view);
    } catch (err) {
      res.status(400).json({
        error: "EOJN_LAYER2_REVIEW_CATALOG_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.get("/layer2/review", async (req, res) => {
    try {
      const view = await getOperatorReview({
        out_root: req.query && req.query.out_root ? String(req.query.out_root) : "",
        run_date_ymd: req.query && req.query.run_date_ymd ? String(req.query.run_date_ymd) : "",
        tender_id: req.query && req.query.tender_id ? Number(req.query.tender_id) : 0
      });
      res.json(view);
    } catch (err) {
      res.status(400).json({
        error: "EOJN_LAYER2_REVIEW_GET_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/layer2/review", async (req, res) => {
    try {
      const result = await saveOperatorReview(req.body || {});
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: "EOJN_LAYER2_REVIEW_SAVE_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  return router;
}

module.exports = createEojnLayer1RouterV1;
