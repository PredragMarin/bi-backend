"use strict";

const { registerModuleRuntime } = require("../core_shell/kernel/module_registry");
const { configureEojnApiService } = require("../core_shell/services/eojn_api_service");
const eprAttendanceRuntime = require("../modules/epr_attendance_v1/module_runtime");
const eojnRuntime = require("../modules/eojn_v1/module_runtime");
const eojnLayer2Runtime = require("../modules/eojn_v1/layer2_runtime");
const eojnReviewRuntime = require("../modules/eojn_v1/review_runtime");

let bootstrapped = false;

function registerModules() {
  if (bootstrapped) return;
  registerModuleRuntime(eprAttendanceRuntime);
  registerModuleRuntime(eojnRuntime);
  configureEojnApiService({
    runLayer1: eojnRuntime.runLayer1,
    getLayer1Status: eojnRuntime.getLayer1Status,
    startLayer2Run: eojnLayer2Runtime.startLayer2Run,
    getLayer2RunStatus: eojnLayer2Runtime.getLayer2RunStatus,
    getLayer2ViewData: eojnLayer2Runtime.getLayer2ViewData,
    getReviewCatalog: eojnReviewRuntime.getReviewCatalog,
    getOperatorReview: eojnReviewRuntime.getOperatorReview,
    saveOperatorReview: eojnReviewRuntime.saveOperatorReview
  });
  bootstrapped = true;
}

module.exports = {
  registerModules
};
