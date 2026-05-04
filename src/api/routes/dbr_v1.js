"use strict";

const crypto = require("crypto");
const express = require("express");
const dbrRuntime = require("../../modules/dbr_v1/module_runtime");

const API_VERSION = "v1";

function createRequestId() {
  if (typeof crypto.randomUUID === "function") {
    return `dbr_${crypto.randomUUID()}`;
  }
  return `dbr_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function createMeta(requestId) {
  return {
    requestId,
    timestamp: new Date().toISOString(),
    version: API_VERSION
  };
}

function sendOk(res, requestId, data, statusCode = 200) {
  return res.status(statusCode).json({
    ok: true,
    data,
    error: null,
    meta: createMeta(requestId)
  });
}

function sendError(res, requestId, statusCode, code, error, details) {
  return res.status(statusCode).json({
    ok: false,
    data: null,
    error: {
      code,
      message: error && error.message ? error.message : String(error),
      ...(details === undefined ? {} : { details })
    },
    meta: createMeta(requestId)
  });
}

function parsePositiveInteger(value, name) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return numeric;
}

function createApiGeneratedGosoftDnId() {
  return Number(Date.now());
}

function buildOrderPayload(body) {
  const source = body && typeof body === "object" ? body : {};
  const gosoftDnId = source.gosoftDnId || source.gosoft_dn_id || createApiGeneratedGosoftDnId();
  const parameterSnapshot = source.parameterSnapshot && typeof source.parameterSnapshot === "object"
    ? source.parameterSnapshot
    : {
        ...source,
        dbrApiFrozenPayload: true
      };

  return {
    gosoftDnId,
    gosoftDnKey: source.gosoftDnKey || source.gosoft_dn_key || `DBR-API-${gosoftDnId}`,
    parameterSnapshot,
    status: source.status || "frozen"
  };
}

function createDbrRouterV1() {
  const router = express.Router();

  router.use((req, res, next) => {
    req.dbrRequestId = createRequestId();
    next();
  });

  router.post("/orders", async (req, res) => {
    const requestId = req.dbrRequestId;
    try {
      const order = await dbrRuntime.createProductionOrder(buildOrderPayload(req.body));
      return sendOk(res, requestId, { order }, 201);
    } catch (error) {
      return sendError(res, requestId, 400, "DBR_CREATE_ORDER_FAILED", error);
    }
  });

  router.post("/orders/:orderId/batches", async (req, res) => {
    const requestId = req.dbrRequestId;
    try {
      const orderId = parsePositiveInteger(req.params.orderId, "orderId");
      const productCode = req.body && req.body.productCode ? req.body.productCode : "PPV";
      const technologyProfile = req.body && req.body.technologyProfile ? req.body.technologyProfile : "OPS_S4P4";
      const parameterSnapshot = req.body && req.body.parameterSnapshot ? req.body.parameterSnapshot : {};
      const result = await dbrRuntime.createKitBatchWithJobs({
        productionOrderId: orderId,
        productCode,
        technologyProfile,
        parameterSnapshot
      });
      return sendOk(res, requestId, result, 201);
    } catch (error) {
      return sendError(res, requestId, 400, "DBR_CREATE_BATCH_FAILED", error);
    }
  });

  router.get("/batches/:batchId/report", async (req, res) => {
    const requestId = req.dbrRequestId;
    try {
      const batchId = parsePositiveInteger(req.params.batchId, "batchId");
      const report = await dbrRuntime.getBatchReport(batchId);
      return sendOk(res, requestId, { report });
    } catch (error) {
      return sendError(res, requestId, 404, "DBR_GET_BATCH_REPORT_FAILED", error);
    }
  });

  router.post("/batches/:batchId/run", async (req, res) => {
    const requestId = req.dbrRequestId;
    try {
      const batchId = parsePositiveInteger(req.params.batchId, "batchId");
      const result = await dbrRuntime.runBatch(batchId);
      return sendOk(res, requestId, result);
    } catch (error) {
      return sendError(res, requestId, 400, "DBR_RUN_BATCH_FAILED", error);
    }
  });

  router.get("/jobs/:jobId", async (req, res) => {
    const requestId = req.dbrRequestId;
    try {
      const jobId = parsePositiveInteger(req.params.jobId, "jobId");
      const job = await dbrRuntime.getPartJobStatus(jobId);
      return sendOk(res, requestId, { job });
    } catch (error) {
      return sendError(res, requestId, 404, "DBR_GET_JOB_FAILED", error);
    }
  });

  router.post("/artifacts", async (req, res) => {
    const requestId = req.dbrRequestId;
    try {
      const artifact = await dbrRuntime.registerApprovedMotherArtifact(req.body || {});
      return sendOk(res, requestId, { artifact }, 201);
    } catch (error) {
      return sendError(res, requestId, 400, "DBR_REGISTER_ARTIFACT_FAILED", error);
    }
  });

  return router;
}

module.exports = createDbrRouterV1;
