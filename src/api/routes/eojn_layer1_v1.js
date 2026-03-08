"use strict";

const express = require("express");
const { runLayer1, getLayer1Status } = require("../../modules/eojn_v1/module_runtime");
const { startLayer2Run, getLayer2RunStatus } = require("../../modules/eojn_v1/layer2_runtime");

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

  return router;
}

module.exports = createEojnLayer1RouterV1;
