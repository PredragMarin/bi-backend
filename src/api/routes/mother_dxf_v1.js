"use strict";

const express = require("express");
const motherDxfRuntime = require("../../modules/mother_dxf_v1/module_runtime");

function createMotherDxfRouterV1() {
  const router = express.Router();

  router.post("/sessions", async (req, res) => {
    try {
      const session = await motherDxfRuntime.createSession({
        dxfText: String(req.body?.dxf_text || ""),
        sourceName: String(req.body?.source_name || "mother_dxf_input.dxf"),
        bands: req.body?.bands || {}
      });
      res.json({
        ok: true,
        session: motherDxfRuntime.projectViewModel(session)
      });
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_CREATE_SESSION_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.get("/sessions/:sessionId", async (req, res) => {
    try {
      const session = await motherDxfRuntime.getSession({
        sessionId: String(req.params.sessionId || "")
      });
      res.json({
        ok: true,
        session: motherDxfRuntime.projectViewModel(session),
        validation: session.validation || null
      });
    } catch (err) {
      res.status(404).json({
        error: "MOTHER_DXF_SESSION_NOT_FOUND",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/sessions/:sessionId/bands", async (req, res) => {
    try {
      const session = await motherDxfRuntime.updateBands({
        sessionId: String(req.params.sessionId || ""),
        bands: req.body?.bands || {}
      });
      res.json({
        ok: true,
        session: motherDxfRuntime.projectViewModel(session)
      });
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_UPDATE_BANDS_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/sessions/:sessionId/assign", async (req, res) => {
    try {
      const session = await motherDxfRuntime.assignPrimaryLayer({
        sessionId: String(req.params.sessionId || ""),
        ids: Array.isArray(req.body?.ids) ? req.body.ids.map((id) => String(id)) : [],
        layer: String(req.body?.layer || "")
      });
      res.json({
        ok: true,
        session: motherDxfRuntime.projectViewModel(session)
      });
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_ASSIGN_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/sessions/:sessionId/validate", async (req, res) => {
    try {
      const result = await motherDxfRuntime.validateMotherDraft({
        sessionId: String(req.params.sessionId || "")
      });
      res.json({
        ok: result.validation.ok,
        validation: result.validation,
        session: motherDxfRuntime.projectViewModel(result.session)
      });
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_VALIDATE_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.get("/sessions/:sessionId/export", async (req, res) => {
    try {
      const result = await motherDxfRuntime.exportMotherDraft({
        sessionId: String(req.params.sessionId || "")
      });
      res.setHeader("Content-Type", "application/dxf; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${req.params.sessionId}_mother.dxf"`);
      res.send(result.dxf_text);
    } catch (err) {
      const validation = err && err.validation ? err.validation : null;
      res.status(400).json({
        error: "MOTHER_DXF_EXPORT_FAILED",
        message: err && err.message ? err.message : String(err),
        validation
      });
    }
  });

  return router;
}

module.exports = createMotherDxfRouterV1;
