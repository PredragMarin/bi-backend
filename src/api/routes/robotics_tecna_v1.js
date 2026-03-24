"use strict";

const express = require("express");
const {
  ensureRoboticsReady,
  createTecnaJob,
  createTecnaResult,
  listTecnaJobs,
  getTecnaJob
} = require("../../core_shell/services/robotics_tecna_db_service");

function createRoboticsTecnaRouterV1() {
  const router = express.Router();

  router.post("/bootstrap", async (req, res) => {
    try {
      await ensureRoboticsReady();
      res.json({
        ok: true,
        message: "Robot Tecna sandbox schema is ready."
      });
    } catch (err) {
      res.status(400).json({
        error: "ROBOTICS_TECNA_BOOTSTRAP_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.get("/jobs", async (req, res) => {
    try {
      const jobs = await listTecnaJobs({
        limit: req.query && req.query.limit ? Number(req.query.limit) : 20
      });
      res.json({
        items: jobs,
        count: jobs.length
      });
    } catch (err) {
      res.status(400).json({
        error: "ROBOTICS_TECNA_LIST_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/jobs", async (req, res) => {
    try {
      const job = await createTecnaJob({
        payload: req.body && req.body.payload ? req.body.payload : {},
        status: req.body && req.body.status ? req.body.status : "queued"
      });
      res.status(201).json({
        ok: true,
        job
      });
    } catch (err) {
      res.status(400).json({
        error: "ROBOTICS_TECNA_CREATE_JOB_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.get("/jobs/:jobKey", async (req, res) => {
    try {
      const view = await getTecnaJob(String(req.params && req.params.jobKey || ""));
      res.json(view);
    } catch (err) {
      res.status(err && err.statusCode ? err.statusCode : 400).json({
        error: "ROBOTICS_TECNA_GET_JOB_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/jobs/:jobKey/result", async (req, res) => {
    try {
      const view = await createTecnaResult({
        jobKey: String(req.params && req.params.jobKey || ""),
        payload: req.body && req.body.payload ? req.body.payload : {},
        status: req.body && req.body.status ? req.body.status : ""
      });
      res.status(201).json({
        ok: true,
        ...view
      });
    } catch (err) {
      res.status(err && err.statusCode ? err.statusCode : 400).json({
        error: "ROBOTICS_TECNA_CREATE_RESULT_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  return router;
}

module.exports = createRoboticsTecnaRouterV1;
