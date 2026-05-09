"use strict";

const express = require("express");
const sanitizeDxfRuntime = require("../../modules/sanitize_dxf_v0/module_runtime");

function createSanitizeDxfRouterV0() {
  const router = express.Router();

  router.post("/check", async (req, res) => {
    try {
      const result = sanitizeDxfRuntime.runSanitizeCheck({
        dxfText: String(req.body?.dxf_text || ""),
        sourceName: String(req.body?.source_name || "sanitize_input.dxf")
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: "SANITIZE_DXF_CHECK_FAILED",
        message: err && err.message ? err.message : String(err)
      });
    }
  });

  router.get("/health", (req, res) => {
    res.json({
      ok: true,
      use_case: "sanitize_dxf_v0"
    });
  });

  return router;
}

module.exports = createSanitizeDxfRouterV0;
