"use strict";

let handlers = null;

function assertConfigured() {
  if (!handlers) {
    throw new Error("EOJN API service is not configured.");
  }
  return handlers;
}

function configureEojnApiService(nextHandlers) {
  const input = nextHandlers && typeof nextHandlers === "object" ? nextHandlers : {};
  const required = [
    "runLayer1",
    "getLayer1Status",
    "getLayer1ViewData",
    "recomputeLayer1FromStoredRaw",
    "startLayer2Run",
    "getLayer2RunStatus",
    "getLayer2ViewData",
    "getReviewCatalog",
    "getOperatorReview",
    "saveOperatorReview"
  ];
  for (const key of required) {
    if (typeof input[key] !== "function") {
      throw new Error(`EOJN API service missing handler: ${key}`);
    }
  }
  handlers = { ...input };
  return handlers;
}

async function runLayer1(payload) {
  return assertConfigured().runLayer1(payload);
}

async function getLayer1Status(payload) {
  return assertConfigured().getLayer1Status(payload);
}

async function getLayer1ViewData(payload) {
  return assertConfigured().getLayer1ViewData(payload);
}

async function recomputeLayer1FromStoredRaw(payload) {
  return assertConfigured().recomputeLayer1FromStoredRaw(payload);
}

async function startLayer2Run(payload) {
  return assertConfigured().startLayer2Run(payload);
}

async function getLayer2RunStatus(payload) {
  return assertConfigured().getLayer2RunStatus(payload);
}

async function getLayer2ViewData(payload) {
  return assertConfigured().getLayer2ViewData(payload);
}

async function getReviewCatalog() {
  return assertConfigured().getReviewCatalog();
}

async function getOperatorReview(payload) {
  return assertConfigured().getOperatorReview(payload);
}

async function saveOperatorReview(payload) {
  return assertConfigured().saveOperatorReview(payload);
}

module.exports = {
  configureEojnApiService,
  runLayer1,
  getLayer1Status,
  getLayer1ViewData,
  recomputeLayer1FromStoredRaw,
  startLayer2Run,
  getLayer2RunStatus,
  getLayer2ViewData,
  getReviewCatalog,
  getOperatorReview,
  saveOperatorReview
};
