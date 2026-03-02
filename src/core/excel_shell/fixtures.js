"use strict";

const fs = require("fs");
const path = require("path");

const FIXTURE_ROOT = path.resolve(process.cwd(), "fixtures", "excel_ingest");

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, "utf8").replace(/^\uFEFF/, ""));
}

function listFixtureModules() {
  if (!fs.existsSync(FIXTURE_ROOT)) return [];
  return fs.readdirSync(FIXTURE_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();
}

function listFixtureCases(moduleKey) {
  const dir = path.join(FIXTURE_ROOT, moduleKey);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();
}

function loadFixtureManifest(moduleKey, caseId) {
  const manifestPath = path.join(FIXTURE_ROOT, moduleKey, caseId, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Fixture manifest not found: ${manifestPath}`);
  }
  return readJson(manifestPath);
}

function loadFixtureData(moduleKey, caseId, relativeJsonPath) {
  const filePath = path.join(FIXTURE_ROOT, moduleKey, caseId, relativeJsonPath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Fixture data not found: ${filePath}`);
  }
  return readJson(filePath);
}

module.exports = {
  FIXTURE_ROOT,
  listFixtureModules,
  listFixtureCases,
  loadFixtureManifest,
  loadFixtureData
};

