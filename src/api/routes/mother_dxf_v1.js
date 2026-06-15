"use strict";

const express = require("express");
const motherDxfRuntime = require("../../modules/mother_dxf_v1/module_runtime");

function createMotherDxfRouterV1() {
  const router = express.Router();

  function buildSessionResponse(session) {
    return {
      ok: true,
      session: motherDxfRuntime.projectViewModel(session),
      dxf_text: motherDxfRuntime.serializeCurrentMotherDraft(session),
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

  router.post("/sessions/context", async (req, res) => {
    try {
      const session = await motherDxfRuntime.createContextDraftSession({
        context: req.body?.session_context_v1 || req.body?.context || {}
      });
      res.json(buildSessionResponse(session));
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_CREATE_CONTEXT_SESSION_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/sessions", async (req, res) => {
    try {
      const result = await motherDxfRuntime.createSession({
        sessionId: req.body?.session_id ? String(req.body.session_id) : null,
        sessionContext: req.body?.session_context_v1 || null,
        dxfText: String(req.body?.dxf_text || ""),
        sourceName: String(req.body?.source_name || "mother_dxf_input.dxf"),
        rawSourceName: String(req.body?.raw_source_name || ""),
        title: req.body?.title == null ? null : String(req.body.title),
        bands: req.body?.bands || {},
        forceRefresh: req.body?.force_refresh === true
      });
      res.json({
        ...buildSessionResponse(result.session),
        session_action: result.action || "created_new"
      });
    } catch (err) {
      if (err && err.code === "DOMAIN_CONTEXT_REQUIRED") {
        return res.status(400).json({
          error: "DOMAIN_CONTEXT_REQUIRED",
          message: "Raw DXF upload is not allowed before session context is locked."
        });
      }
      res.status(400).json({
        error: "MOTHER_DXF_CREATE_SESSION_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/sessions/:sessionId/context/lock", async (req, res) => {
    try {
      const session = await motherDxfRuntime.lockSessionContext({
        sessionId: String(req.params.sessionId || ""),
        context: req.body?.session_context_v1 || req.body?.context || {}
      });
      res.json(buildSessionResponse(session));
    } catch (err) {
      res.status(400).json({
        error: err && err.code ? err.code : "MOTHER_DXF_LOCK_CONTEXT_FAILED",
        message: err && err.message ? err.message : String(err),
        validation: err && err.validation ? err.validation : null
      });
    }
  });

  router.post("/sessions/:sessionId/context/reset", async (req, res) => {
    try {
      const session = await motherDxfRuntime.resetSessionContext({
        sessionId: String(req.params.sessionId || "")
      });
      res.json(buildSessionResponse(session));
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_RESET_CONTEXT_FAILED",
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

  router.post("/sessions/:sessionId/compute-geometry", async (req, res) => {
    try {
      const result = await motherDxfRuntime.computeGeometryContext({
        sessionId: String(req.params.sessionId || ""),
        bands: req.body?.bands || null,
        geometryStrategy: req.body?.geometry_strategy
      });
      res.json({
        ...buildSessionResponse(result.session),
        geometry_validation_v1: result.validation,
        geometry_context_v1: result.validation.geometry_context_v1,
        geometry_slot_model: result.validation.geometry_slot_model,
        validation_summary: {
          ok: result.validation.ok,
          status: result.validation.status,
          blocking_error_count: result.validation.blocking_error_count,
          warning_count: result.validation.warning_count,
          slot_count: result.validation.slot_count,
          global_spans_multiple_slots: result.validation.global_spans_multiple_slots
        },
        validation_errors: result.validation.errors,
        validation_warnings: result.validation.warnings
      });
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_COMPUTE_GEOMETRY_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/sessions/:sessionId/config", async (req, res) => {
    try {
      const session = await motherDxfRuntime.updateConfigParameterSet({
        sessionId: String(req.params.sessionId || ""),
        configParameterSet: req.body?.config_parameter_set || req.body?.config || req.body || {},
        executionIntentAuthoringV1: req.body?.execution_intent_authoring_v1
      });
      res.json(buildSessionResponse(session));
    } catch (err) {
      res.status(400).json({
        error: err && err.code ? err.code : "MOTHER_DXF_UPDATE_CONFIG_FAILED",
        message: err && err.message ? err.message : String(err),
        validation: err && err.validation ? err.validation : null
      });
    }
  });

  router.post("/sessions/:sessionId/validate-domain", async (req, res) => {
    try {
      const result = await motherDxfRuntime.validateDomainContext({
        sessionId: String(req.params.sessionId || "")
      });
      res.json({
        ...buildSessionResponse(result.session),
        domain_validation_v1: result.validation,
        sem_evidence: result.validation.sem_evidence,
        xdata_evidence: result.validation.xdata_evidence,
        validation_summary: {
          ok: result.validation.ok,
          status: result.validation.status,
          blocking_error_count: result.validation.blocking_error_count,
          warning_count: result.validation.warning_count
        },
        validation_errors: result.validation.errors,
        validation_warnings: result.validation.warnings
      });
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_VALIDATE_DOMAIN_FAILED",
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

  router.post("/sessions/:sessionId/document-sem", async (req, res) => {
    try {
      const session = await motherDxfRuntime.updateDocumentSemMetadata({
        sessionId: String(req.params.sessionId || ""),
        payload: {
          nominal_dimensions: req.body?.nominal_dimensions,
          nominal_length: req.body?.nominal_length,
          nominal_width: req.body?.nominal_width,
          nominal_height: req.body?.nominal_height,
          family: req.body?.family,
          product: req.body?.product,
          part: req.body?.part,
          rule_refs: req.body?.rule_refs
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

  router.post("/sessions/:sessionId/label-definition", async (req, res) => {
    try {
      const session = await motherDxfRuntime.updateLabelDefinition({
        sessionId: String(req.params.sessionId || ""),
        payload: req.body || {}
      });
      res.json(buildSessionResponse(session));
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_UPDATE_LABEL_DEFINITION_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.delete("/sessions/:sessionId/label-definition/:ruleId", async (req, res) => {
    try {
      const session = await motherDxfRuntime.clearLabelDefinition({
        sessionId: String(req.params.sessionId || ""),
        ruleId: String(req.params.ruleId || "")
      });
      res.json(buildSessionResponse(session));
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_CLEAR_LABEL_DEFINITION_FAILED",
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

  router.delete("/sessions/:sessionId/topo", async (req, res) => {
    try {
      const session = await motherDxfRuntime.clearTopoMetadata({
        sessionId: String(req.params.sessionId || "")
      });
      res.json(buildSessionResponse(session));
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_CLEAR_TOPO_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/sessions/:sessionId/resolver/preview", async (req, res) => {
    try {
      const result = await motherDxfRuntime.generateResolverPreview({
        sessionId: String(req.params.sessionId || "")
      });
      res.json({
        ...buildSessionResponse(result.session),
        resolver_input_v1_minimal: result.resolver_input_v1_minimal,
        resolver_output_v1: result.resolver_output_v1,
        simulation: result.simulation
      });
    } catch (err) {
      res.status(400).json({
        error: err && err.code ? err.code : "MOTHER_DXF_RESOLVER_PREVIEW_FAILED",
        message: err && err.message ? err.message : String(err),
        validation: err && err.validation ? err.validation : null
      });
    }
  });

  router.post("/sessions/:sessionId/resolver/child", async (req, res) => {
    try {
      const result = await motherDxfRuntime.generateResolverChild({
        sessionId: String(req.params.sessionId || "")
      });
      res.json({
        ...buildSessionResponse(result.session),
        dxf_text: result.dxf_text,
        child_artifact: result.child_artifact,
        wysiwyg_gate_v1: result.wysiwyg_gate_v1,
        artifact_lineage_v1: result.artifact_lineage_v1
      });
    } catch (err) {
      res.status(400).json({
        error: err && err.code ? err.code : "MOTHER_DXF_RESOLVER_CHILD_FAILED",
        message: err && err.message ? err.message : String(err),
        validation: err && err.validation ? err.validation : null
      });
    }
  });

  router.post("/sessions/:sessionId/resolver/export", async (req, res) => {
    try {
      const result = await motherDxfRuntime.generateResolverExport({
        sessionId: String(req.params.sessionId || "")
      });
      res.json({
        ...buildSessionResponse(result.session),
        dxf_text: result.dxf_text,
        export_artifact: result.export_artifact,
        wysiwyg_gate_v1: result.wysiwyg_gate_v1,
        artifact_lineage_v1: result.artifact_lineage_v1
      });
    } catch (err) {
      res.status(400).json({
        error: err && err.code ? err.code : "MOTHER_DXF_RESOLVER_EXPORT_FAILED",
        message: err && err.message ? err.message : String(err),
        validation: err && err.validation ? err.validation : null
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

  router.post("/sessions/:sessionId/explode-block", async (req, res) => {
    try {
      const result = await motherDxfRuntime.explodeBlockInsert({
        sessionId: String(req.params.sessionId || ""),
        entityId: String(req.body?.entity_id || "")
      });
      res.json({
        ...buildSessionResponse(result.session),
        removed_entity_id: result.removed_entity_id,
        exploded_entity_ids: result.exploded_entity_ids,
        block_name: result.block_name
      });
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_EXPLODE_BLOCK_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/sessions/:sessionId/metadata", async (req, res) => {
    try {
      const result = await motherDxfRuntime.authorSemanticMetadata({
        sessionId: String(req.params.sessionId || ""),
        entityId: String(req.body?.entity_id || ""),
        entityIds: Array.isArray(req.body?.entity_ids) ? req.body.entity_ids.map((id) => String(id || "")) : [],
        operation: String(req.body?.operation || ""),
        parameter: String(req.body?.parameter || ""),
        expectedValue: req.body?.expected_value,
        semanticComment: req.body?.semantic_comment,
        replaceSemanticComment: req.body?.replace_semantic_comment
      });
      res.json({
        ...buildSessionResponse(result.session),
        semantic_comment: result.semantic_comment,
        affected_entity_ids: result.affected_entity_ids
      });
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_AUTHOR_METADATA_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/sessions/:sessionId/xdata", async (req, res) => {
    try {
      const result = await motherDxfRuntime.updateEntityXdataMetadata({
        sessionId: String(req.params.sessionId || ""),
        entityIds: Array.isArray(req.body?.entity_ids) ? req.body.entity_ids.map((id) => String(id || "")) : [],
        value: req.body?.value,
        previousValue: req.body?.previous_value
      });
      res.json({
        ...buildSessionResponse(result.session),
        xdata_value: result.xdata_value,
        previous_value: result.previous_value,
        affected_entity_ids: result.affected_entity_ids
      });
    } catch (err) {
      res.status(400).json({
        error: "MOTHER_DXF_XDATA_ASSIGN_FAILED",
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
        topo_comment: result.topo_comment,
        dxf_text: motherDxfRuntime.serializeCurrentMotherDraft(result.session)
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

  return router;
}

module.exports = createMotherDxfRouterV1;
