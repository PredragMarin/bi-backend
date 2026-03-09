"use strict";

const MODULE_REGISTRY = new Map();

function registerModuleRuntime(runtime) {
  const candidate = runtime && typeof runtime === "object" ? runtime : null;
  const useCase = String(candidate && candidate.use_case ? candidate.use_case : "").trim();
  if (!useCase) {
    throw new Error("Cannot register module runtime without use_case.");
  }
  MODULE_REGISTRY.set(useCase, candidate);
  return candidate;
}

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
  registerModuleRuntime,
  getModuleRuntime,
  listRegisteredUseCases
};
