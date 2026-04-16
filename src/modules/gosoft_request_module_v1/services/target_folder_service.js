"use strict";

const fs = require("fs");
const path = require("path");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function ensureBaseFolders(config) {
  ensureDir(config.integrationRoot);
  ensureDir(config.requestDir);
  Object.values(config.targetDrops).forEach((targetRoot) => {
    ensureDir(targetRoot);
    config.targetSubdirs.forEach((subdir) => ensureDir(path.join(targetRoot, subdir)));
  });
}

function resolveTargetFolders({ config, targetDrop, requestId }) {
  const targetRoot = config.targetDrops[targetDrop];
  if (!targetRoot) {
    throw new Error(`Unknown target_drop: ${targetDrop}`);
  }

  ensureDir(targetRoot);
  config.targetSubdirs.forEach((subdir) => ensureDir(path.join(targetRoot, subdir)));

  const responsePackageDir = ensureDir(path.join(targetRoot, "responses", requestId));
  const errorPackageDir = ensureDir(path.join(targetRoot, "errors", requestId));

  return {
    targetRoot,
    responsePackageDir,
    errorPackageDir,
    archiveProcessedDir: path.join(targetRoot, "archive_processed"),
    archiveFailedDir: path.join(targetRoot, "archive_failed")
  };
}

module.exports = {
  ensureBaseFolders,
  resolveTargetFolders
};
