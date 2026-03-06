"use strict";

const eprAttendanceRuntime = require("../../modules/epr_attendance_v1/module_runtime");

const MODULE_REGISTRY = new Map([
  [eprAttendanceRuntime.use_case, eprAttendanceRuntime]
]);

function getModuleRuntime(useCase) {
  const key = String(useCase || "").trim();
  const runtime = MODULE_REGISTRY.get(key);
  if (!runtime) {
    throw new Error(`Unknown use_case: ${useCase}`);
  }
  return runtime;
}

function listRegisteredUseCases() {
  return Array.from(MODULE_REGISTRY.keys()).sort();
}

module.exports = {
  getModuleRuntime,
  listRegisteredUseCases
};
