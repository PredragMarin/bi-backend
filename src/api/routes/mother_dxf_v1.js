"use strict";

const express = require("express");
const motherDxfRuntime = require("../../modules/mother_dxf_v1/module_runtime");

function createMotherDxfRouterV1() {
  const router = express.Router();

  function buildSessionResponse(session) {
    return {
      ok: true,
      session: motherDxfRuntime.projectViewModel(session),
      dxf_text: motherDxfRuntime.serializeDocument(session.document),
      validation: session.validation || null
    };
  }

  router.get("/sessions", async (req, res) => {
    try {
      const sessions = await motherDxfRuntime.listSessionSummaries({});
      res.json({
        ok: true,
        sessions
      });
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_LIST_SESSIONS_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/sessions", async (req, res) => {
    try {
      const session = await motherDxfRuntime.createSession({
        dxfText: String(req.body?.dxf_text || ""),
        sourceName: String(req.body?.source_name || "mother_dxf_input.dxf"),
        bands: req.body?.bands || {}
      });
      res.json(buildSessionResponse(session));
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
      res.json(buildSessionResponse(session));
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
      res.json(buildSessionResponse(session));
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
      res.json(buildSessionResponse(session));
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_ASSIGN_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/sessions/:sessionId/config", async (req, res) => {
    try {
      const session = await motherDxfRuntime.updateConfigParameterSet({
        sessionId: String(req.params.sessionId || ""),
        configParameterSet: req.body?.config_parameter_set || {}
      });
      res.json(buildSessionResponse(session));
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_UPDATE_CONFIG_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/sessions/:sessionId/document-sem", async (req, res) => {
    try {
      const session = await motherDxfRuntime.updateDocumentSemMetadata({
        sessionId: String(req.params.sessionId || ""),
        payload: {
          nominal_width: req.body?.nominal_width,
          nominal_height: req.body?.nominal_height,
          family: req.body?.family,
          product: req.body?.product,
          part: req.body?.part
        }
      });
      res.json(buildSessionResponse(session));
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_UPDATE_DOCUMENT_SEM_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/sessions/:sessionId/topo", async (req, res) => {
    try {
      const session = await motherDxfRuntime.updateTopoMetadata({
        sessionId: String(req.params.sessionId || ""),
        topoText: String(req.body?.topo_text || "")
      });
      res.json(buildSessionResponse(session));
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_UPDATE_TOPO_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/sessions/:sessionId/simulate", async (req, res) => {
    try {
      const result = await motherDxfRuntime.simulateSession({
        sessionId: String(req.params.sessionId || ""),
        configParameterSet: req.body?.config_parameter_set || null
      });
      res.json({
        ...buildSessionResponse(result.session),
        simulation: result.simulation
      });
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_SIMULATE_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/sessions/:sessionId/execution-check/kskr", async (req, res) => {
    try {
      const result = await motherDxfRuntime.runKskrExecutionCheck({
        sessionId: String(req.params.sessionId || ""),
        parameterSet: req.body?.parameters || null
      });
      res.json({
        ok: true,
        session: motherDxfRuntime.projectViewModel(result.session),
        execution_check: result.execution_check
      });
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_KSKR_EXECUTION_CHECK_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/sessions/:sessionId/child/no-topo", async (req, res) => {
    try {
      const parameterSet = req.body?.config_parameter_set || req.body || {};
      const result = await motherDxfRuntime.generateChildDxfNoTopoForSession({
        sessionId: String(req.params.sessionId || ""),
        parameterSet
      });
      const summary = result.generation_summary || {};
      res.setHeader("Content-Type", "application/dxf; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${req.params.sessionId}_child_no_topo.dxf"`);
      res.setHeader("X-Mother-DXF-Child-Mode", String(summary.mode || "child_no_topo_poc_v0"));
      res.setHeader("X-Mother-DXF-Included-Count", String(summary.included_count ?? ""));
      res.setHeader("X-Mother-DXF-Excluded-Count", String(summary.excluded_count ?? ""));
      res.setHeader("X-Mother-DXF-Unsupported-Geometry-Ops", String((summary.unsupported_geometry_ops || []).length));
      res.send(result.dxf_text);
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_CHILD_NO_TOPO_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/sessions/:sessionId/meta", async (req, res) => {
    try {
      const session = await motherDxfRuntime.updateSessionMeta({
        sessionId: String(req.params.sessionId || ""),
        title: req.body?.title,
        status: req.body?.status
      });
      res.json(buildSessionResponse(session));
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_UPDATE_META_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/sessions/:sessionId/metadata", async (req, res) => {
    try {
      const result = await motherDxfRuntime.authorSemanticMetadata({
        sessionId: String(req.params.sessionId || ""),
        entityId: String(req.body?.entity_id || ""),
        operation: String(req.body?.operation || ""),
        parameter: String(req.body?.parameter || ""),
        expectedValue: req.body?.expected_value,
        semanticComment: req.body?.semantic_comment
      });
      res.json({
        ...buildSessionResponse(result.session),
        semantic_comment: result.semantic_comment
      });
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_AUTHOR_METADATA_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/sessions/:sessionId/entities/:entityId/topo-role", async (req, res) => {
    try {
      const result = await motherDxfRuntime.updateEntityTopoRoleMetadata({
        sessionId: String(req.params.sessionId || ""),
        entityId: String(req.params.entityId || ""),
        role: String(req.body?.role || ""),
        group: String(req.body?.group || ""),
        zone: String(req.body?.zone || "")
      });
      const view = motherDxfRuntime.projectViewModel(result.session);
      const entity = (view.objects || []).find((item) => item.entity_id === String(req.params.entityId || "")) || null;
      res.json({
        ok: true,
        session: view,
        entity,
        topo_comment: result.topo_comment
      });
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_AUTHOR_TOPO_ROLE_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.delete("/sessions/:sessionId/metadata/:entityId", async (req, res) => {
    try {
      const session = await motherDxfRuntime.clearSemanticMetadata({
        sessionId: String(req.params.sessionId || ""),
        entityId: String(req.params.entityId || "")
      });
      res.json(buildSessionResponse(session));
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_CLEAR_METADATA_FAILED",
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
        ...buildSessionResponse(result.session),
        ok: result.validation.ok,
        validation: result.validation
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
