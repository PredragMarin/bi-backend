"use strict";

const catalogDb = require("../../core_shell/services/catalog_db_service");
const dbrDb = require("../../core_shell/services/dbr_db_service");
const motherDxfRuntime = require("../mother_dxf_v1/module_runtime");
const {
  fetchDbrOrdersBySifradnList,
  fetchStubSifradnRecords
} = require("./adapters/erp_fetch_dbr_orders");
const { parseSifradnImportPayload } = require("./domain/sifradn_import_parser");
const {
  mapFetchedDbrOrdersToProductionOrders,
  mapSifradnRecordsToProductionOrders
} = require("./domain/production_order_mapper");

const DEFAULT_KIT_VERSION = "PPV_OPS_S4P4_v0";

function requirePositiveInteger(value, name) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return numeric;
}

function requireNonEmptyString(value, name) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${name} is required.`);
  }
  return text;
}

function createBatchKey({ productionOrderId, productCode, technologyProfile, kitVersion }) {
  return [
    "dbr",
    "kit",
    productionOrderId,
    productCode,
    technologyProfile,
    kitVersion
  ].join(":");
}

function createPartJobIdempotencyKey({ kitBatchId, partCode }) {
  return ["dbr", "part_job", kitBatchId, partCode].join(":");
}

function normalizeChildGeneratorMode(value) {
  const normalized = String(value || "no_topo").trim().toLowerCase();
  if (["no_topo", "child_no_topo", "child_no_topo_poc_v0"].includes(normalized)) {
    return "no_topo";
  }
  if (["topo", "topo_poc", "child_topo_poc_v0"].includes(normalized)) {
    return "topo_poc";
  }
  throw new Error(`Unsupported child generator mode: ${value}`);
}

function createBulkKitBatchKey({ gosoftDnId, productCode, technologyProfile, kitVersion }) {
  return [
    "dbr",
    "bulk-kit",
    gosoftDnId,
    productCode,
    technologyProfile,
    kitVersion
  ].join(":");
}

function createSyntheticImportBase() {
  return Number(Date.now()) * 100;
}

async function runChildGeneratorBlackBox({ partJob, parameterSnapshot }) {
  const motherSessionId = parameterSnapshot.motherSessionId || parameterSnapshot.mother_session_id;

  if (!motherSessionId) {
    return {
      skipped: true,
      status: "resolver_not_configured",
      summary: {
        resolver: "not_implemented",
        childGeneratorCall: "not_executed",
        reason: "missing_mother_session_id",
        note: "DBR skeleton requires parameterSnapshot.motherSessionId to call the existing Mother DXF child generator."
      },
      warnings: [
        {
          code: "DBR_CHILD_GENERATOR_INPUT_MISSING",
          message: "Missing parameterSnapshot.motherSessionId; child generator was not called."
        }
      ]
    };
  }

  const mode = normalizeChildGeneratorMode(parameterSnapshot.childGeneratorMode);
  const request = {
    sessionId: motherSessionId,
    parameterSet: {
      product_code: partJob.partCode,
      technology_profile: parameterSnapshot.technologyProfile || parameterSnapshot.technology_profile,
      parameters: parameterSnapshot.parameters || parameterSnapshot
    },
    storeRoot: parameterSnapshot.storeRoot || parameterSnapshot.store_root
  };
  const result = mode === "topo_poc"
    ? await motherDxfRuntime.generateChildDxfTopoPocForSession(request)
    : await motherDxfRuntime.generateChildDxfNoTopoForSession(request);

  return {
    skipped: false,
    status: "generated",
    childArtifactPath: result.child_file || null,
    summary: {
      resolver: "not_implemented",
      childGeneratorCall: "executed",
      childGeneratorMode: mode,
      childFile: result.child_file || null,
      source: "mother_dxf_v1.module_runtime"
    }
  };
}

async function importSifradnList(payload = {}) {
  const useStub = !!(payload && !Array.isArray(payload) && payload.use_stub);
  const parsed = parseSifradnImportPayload(
    useStub ? fetchStubSifradnRecords({ count: payload.count || 20 }) : payload
  );
  let fetchContext = null;
  let mappedOrders = [];

  if (useStub) {
    mappedOrders = mapSifradnRecordsToProductionOrders(parsed.records, {
      syntheticBase: createSyntheticImportBase(),
      kitVersion: DEFAULT_KIT_VERSION
    });
  } else {
    const fetched = await fetchDbrOrdersBySifradnList({
      sifradnList: parsed.normalizedSifradn,
      dsn: payload.dsn
    });
    fetchContext = {
      requestId: fetched.requestId,
      dsn: fetched.dsn,
      queryId: fetched.queryId,
      validation: fetched.validation,
      fetchAudit: fetched.fetchAudit
    };
    if (!fetched.validation.ok) {
      const error = new Error("DBR SIFRADN import validation failed after ERP fetch.");
      error.details = {
        input: {
          inputMode: parsed.inputMode,
          recordCount: parsed.recordCount,
          normalizedSifradn: parsed.normalizedSifradn,
          validation: parsed.validation
        },
        fetch: {
          validation: fetched.validation,
          items: fetched.items
        }
      };
      throw error;
    }
    mappedOrders = mapFetchedDbrOrdersToProductionOrders(fetched.items, {
      kitVersion: DEFAULT_KIT_VERSION
    });
  }

  const kitPartCache = new Map();
  const bulkOrders = [];

  for (const order of mappedOrders) {
    const cacheKey = [order.productCode, order.technologyProfile, order.kitVersion].join(":");
    if (!kitPartCache.has(cacheKey)) {
      const kitParts = await catalogDb.listProductKitParts({
        productCode: order.productCode,
        technologyProfile: order.technologyProfile,
        kitVersion: order.kitVersion,
        status: "active"
      });
      if (!kitParts.length) {
        throw new Error(
          `No active kit mapping found for ${order.productCode}/${order.technologyProfile}/${order.kitVersion}.`
        );
      }
      kitPartCache.set(cacheKey, kitParts);
    }

    const kitParts = kitPartCache.get(cacheKey);
    bulkOrders.push({
      ...order,
      batchKey: createBulkKitBatchKey({
        gosoftDnId: order.gosoftDnId,
        productCode: order.productCode,
        technologyProfile: order.technologyProfile,
        kitVersion: order.kitVersion
      }),
      batchStatus: "planned",
      summary: {
        source: "catalog.product_kit_mapping",
        importSource: useStub ? "stub" : "payload",
        sifradn: order.sifradn,
        kitPartCount: kitParts.length
      },
      kitParts: kitParts.map((kitPart) => ({
        ...kitPart,
        status: "queued"
      }))
    });
  }

  const result = await dbrDb.createBulkProductionOrdersWithBatchesAndJobs({
    orders: bulkOrders
  });

  return {
    importMode: useStub ? "stub" : "payload",
    input: {
      inputMode: parsed.inputMode,
      recordCount: parsed.recordCount,
      normalizedSifradn: parsed.normalizedSifradn,
      validation: parsed.validation
    },
    fetchContext,
    requested: parsed.recordCount,
    imported: result.orders.length,
    orders: result.orders,
    batches: result.batches,
    jobs: result.jobs,
    totalJobs: result.jobs.length
  };
}

async function createProductionOrder(payload = {}) {
  const gosoftDnId = requirePositiveInteger(payload.gosoftDnId, "gosoftDnId");
  const parameterSnapshot = payload.parameterSnapshot || {};

  return dbrDb.upsertProductionOrder({
    gosoftDnId,
    gosoftDnKey: payload.gosoftDnKey,
    parameterSnapshot,
    status: payload.status || "imported"
  });
}

async function createKitBatch(productionOrderId, productCode, technologyProfile) {
  const normalizedProductionOrderId = requirePositiveInteger(productionOrderId, "productionOrderId");
  const normalizedProductCode = requireNonEmptyString(productCode, "productCode");
  const normalizedTechnologyProfile = requireNonEmptyString(technologyProfile, "technologyProfile");

  const kitParts = await catalogDb.listProductKitParts({
    productCode: normalizedProductCode,
    technologyProfile: normalizedTechnologyProfile,
    status: "active"
  });

  if (!kitParts.length) {
    throw new Error(
      `No active kit mapping found for ${normalizedProductCode}/${normalizedTechnologyProfile}.`
    );
  }

  const kitVersion = kitParts[0].kitVersion || DEFAULT_KIT_VERSION;
  const batch = await dbrDb.createKitBatch({
    productionOrderId: normalizedProductionOrderId,
    batchKey: createBatchKey({
      productionOrderId: normalizedProductionOrderId,
      productCode: normalizedProductCode,
      technologyProfile: normalizedTechnologyProfile,
      kitVersion
    }),
    productCode: normalizedProductCode,
    technologyProfile: normalizedTechnologyProfile,
    kitVersion,
    status: "planned",
    summary: {
      kitPartCount: kitParts.length,
      source: "catalog.product_kit_mapping"
    }
  });

  return {
    batch,
    kitParts
  };
}

async function createKitBatchWithJobs({
  productionOrderId,
  productCode,
  technologyProfile,
  parameterSnapshot = {}
}) {
  const normalizedProductionOrderId = requirePositiveInteger(productionOrderId, "productionOrderId");
  const normalizedProductCode = requireNonEmptyString(productCode, "productCode");
  const normalizedTechnologyProfile = requireNonEmptyString(technologyProfile, "technologyProfile");

  const kitParts = await catalogDb.listProductKitParts({
    productCode: normalizedProductCode,
    technologyProfile: normalizedTechnologyProfile,
    status: "active"
  });

  if (!kitParts.length) {
    throw new Error(
      `No active kit mapping found for ${normalizedProductCode}/${normalizedTechnologyProfile}.`
    );
  }

  const kitVersion = kitParts[0].kitVersion || DEFAULT_KIT_VERSION;
  const batchKey = createBatchKey({
    productionOrderId: normalizedProductionOrderId,
    productCode: normalizedProductCode,
    technologyProfile: normalizedTechnologyProfile,
    kitVersion
  });
  const atomicKitParts = kitParts.map((kitPart) => ({
    ...kitPart,
    idempotencyKey: createPartJobIdempotencyKey({
      kitBatchId: batchKey,
      partCode: kitPart.partCode
    }),
    status: "queued"
  }));

  const result = await dbrDb.createKitBatchWithPartJobs({
    productionOrderId: normalizedProductionOrderId,
    batchKey,
    productCode: normalizedProductCode,
    technologyProfile: normalizedTechnologyProfile,
    kitVersion,
    kitParts: atomicKitParts,
    parameterSnapshot,
    status: "planned",
    summary: {
      kitPartCount: kitParts.length,
      source: "catalog.product_kit_mapping"
    }
  });

  return {
    batch: result.batch,
    jobs: result.partJobs
  };
}

async function createPartJobs(kitBatchId, parameterSnapshot = {}) {
  const normalizedKitBatchId = requirePositiveInteger(kitBatchId, "kitBatchId");
  const batch = await dbrDb.getKitBatch(normalizedKitBatchId);

  if (!batch) {
    throw new Error(`Kit batch not found: ${normalizedKitBatchId}`);
  }

  const kitParts = await catalogDb.listProductKitParts({
    productCode: batch.productCode,
    technologyProfile: batch.technologyProfile,
    kitVersion: batch.kitVersion,
    status: "active"
  });

  if (!kitParts.length) {
    throw new Error(
      `No active kit mapping found for batch ${normalizedKitBatchId} (${batch.productCode}/${batch.technologyProfile}/${batch.kitVersion}).`
    );
  }

  const partJobs = [];
  for (const kitPart of kitParts) {
    const partJob = await dbrDb.createPartJob({
      kitBatchId: normalizedKitBatchId,
      partCode: kitPart.partCode,
      partSequence: kitPart.partSequence,
      parameterSnapshot,
      idempotencyKey: createPartJobIdempotencyKey({
        kitBatchId: normalizedKitBatchId,
        partCode: kitPart.partCode
      }),
      status: "queued"
    });
    partJobs.push(partJob);
  }

  return partJobs;
}

async function runPartJob(partJobId) {
  const normalizedPartJobId = requirePositiveInteger(partJobId, "partJobId");
  const partJob = await dbrDb.getPartJob(normalizedPartJobId);

  if (!partJob) {
    throw new Error(`Part job not found: ${normalizedPartJobId}`);
  }

  const childResult = await runChildGeneratorBlackBox({
    partJob,
    parameterSnapshot: partJob.parameterSnapshot || {}
  });

  return dbrDb.updatePartJobStatus({
    idempotencyKey: partJob.idempotencyKey,
    status: childResult.status,
    childArtifactPath: childResult.childArtifactPath || null,
    generationSummary: childResult.summary,
    warnings: childResult.warnings || null,
    finishedAt: new Date().toISOString()
  });
}

async function getBatchReport(kitBatchId) {
  const normalizedKitBatchId = requirePositiveInteger(kitBatchId, "kitBatchId");
  const batch = await dbrDb.getKitBatch(normalizedKitBatchId);

  if (!batch) {
    throw new Error(`Kit batch not found: ${normalizedKitBatchId}`);
  }

  const partJobs = await dbrDb.listPartJobsForBatch(normalizedKitBatchId);
  const statusCounts = partJobs.reduce((counts, job) => {
    counts[job.status] = (counts[job.status] || 0) + 1;
    return counts;
  }, {});

  return {
    batch,
    partJobCount: partJobs.length,
    statusCounts,
    partJobs
  };
}

async function getPartJobStatus(partJobId) {
  const normalizedPartJobId = requirePositiveInteger(partJobId, "partJobId");
  const partJob = await dbrDb.getPartJob(normalizedPartJobId);

  if (!partJob) {
    throw new Error(`Part job not found: ${normalizedPartJobId}`);
  }

  return partJob;
}

async function runBatch(kitBatchId) {
  const report = await getBatchReport(kitBatchId);
  return {
    batch: report.batch,
    status: "not_implemented",
    message: "DBR batch execution boundary is defined, but resolver execution is not implemented in v0.",
    partJobCount: report.partJobCount,
    statusCounts: report.statusCounts
  };
}

async function registerApprovedMotherArtifact(payload = {}) {
  const technologyProfile = payload.technologyProfile || payload.technology_profile || payload.kit_code;
  const partCode = payload.partCode || payload.part_code;
  const inferredProductCode = String(partCode || "").split("-")[0] || "";

  return dbrDb.createMotherArtifactRegistryEntry({
    productCode: requireNonEmptyString(
      payload.productCode || payload.product_code || inferredProductCode,
      "productCode"
    ),
    partCode: requireNonEmptyString(partCode, "partCode"),
    technologyProfile: requireNonEmptyString(technologyProfile, "technologyProfile"),
    motherSessionId: payload.motherSessionId || payload.mother_session_id || null,
    artifactPath: requireNonEmptyString(payload.artifactPath || payload.artifact_path, "artifactPath"),
    artifactHash: payload.artifactHash || payload.artifact_hash || null,
    approvalStatus: payload.approvalStatus || payload.approval_status || "approved",
    approvedAt: payload.approvedAt || payload.approved_at || null,
    approvedBy: payload.approvedBy || payload.approved_by || null,
    documentSem: payload.documentSem || payload.document_sem || null,
    metadataSummary: payload.metadataSummary || payload.metadata_summary || null
  });
}

async function deleteProductionOrder(productionOrderId) {
  const normalizedProductionOrderId = requirePositiveInteger(productionOrderId, "productionOrderId");
  return dbrDb.deleteProductionOrder(normalizedProductionOrderId);
}

module.exports = {
  use_case: "dbr_v1",
  current_pointer_use_case: "dbr_v1",
  createProductionOrder,
  importSifradnList,
  createKitBatch,
  createKitBatchWithJobs,
  createPartJobs,
  runPartJob,
  runBatch,
  getBatchReport,
  getPartJobStatus,
  registerApprovedMotherArtifact,
  deleteProductionOrder
};
