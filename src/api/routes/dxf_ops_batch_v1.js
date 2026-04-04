"use strict";

const express = require("express");
const { resolveErpDsn } = require("../../core_shell/config/erp_config");
const { prepareDxfOpsBatchPreview } = require("../../modules/dxf_ops_host_v1/adapters/db_fetch_dxf_ops_host");

function createDxfOpsBatchRouterV1() {
  const router = express.Router();

  router.post("/preview", async (req, res) => {
    try {
      const preview = await prepareDxfOpsBatchPreview({
        rnPaste: req.body && req.body.rn_paste ? String(req.body.rn_paste) : "",
        dsn: resolveErpDsn({ dsnOverride: req.body && req.body.dsn ? String(req.body.dsn) : "" })
      });
      res.json(preview);
    } catch (err) {
      res.status(400).json({
        error: "DXF_OPS_BATCH_PREVIEW_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.post("/handoff", async (req, res) => {
    res.status(501).json({
      error: "DXF_OPS_HANDOFF_NOT_IMPLEMENTED",
      message: "Host-side handoff to the external DXF/OPS pipeline is not wired yet.",
      ready_for_later: true
    });
  });

  return router;
}

module.exports = createDxfOpsBatchRouterV1;
