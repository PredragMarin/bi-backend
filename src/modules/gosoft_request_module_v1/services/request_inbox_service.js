"use strict";

const fs = require("fs");
const path = require("path");

function listRequestFiles(requestDir) {
  if (!fs.existsSync(requestDir)) return [];
  return fs.readdirSync(requestDir)
    .filter((name) => name.endsWith(".request.json"))
    .map((name) => {
      const fullPath = path.join(requestDir, name);
      const stat = fs.statSync(fullPath);
      return {
        name,
        fullPath,
        mtimeMs: stat.mtimeMs
      };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
}

module.exports = {
  listRequestFiles
};
