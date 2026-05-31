"use strict";

const fs = require("fs");

const files = [
  "src/modules/mother_dxf_v1/module_runtime.js",
  "src/core_shell/storage/mother_dxf_store.js"
];

const forbidden = [
  "fs.writeFile",
  "fs.appendFile",
  "fs.createWriteStream",
  "fs.promises.writeFile",
  "fs.promises.appendFile"
];

let failed = false;

for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  for (const token of forbidden) {
    if (content.includes(token)) {
      console.error(`Forbidden I/O token "${token}" found in ${file}`);
      failed = true;
    }
  }

  // Ensure no legacy event writes remain.
  if (content.includes("events.ndjson") && content.includes("fs.")) {
    console.error(`Legacy event write detected in ${file}`);
    failed = true;
  }

  // Ensure no legacy child metadata writes remain.
  if (content.includes("child_metadata.json") && content.includes("fs.")) {
    console.error(`Legacy child metadata write detected in ${file}`);
    failed = true;
  }

  // Ensure no legacy preview writes remain.
  if (content.includes("preview.json") && content.includes("fs.")) {
    console.error(`Legacy preview write detected in ${file}`);
    failed = true;
  }

  // Ensure no legacy param set writes remain.
  if (content.includes("param_set.json") && content.includes("fs.")) {
    console.error(`Legacy param set write detected in ${file}`);
    failed = true;
  }

  // Ensure no legacy session writes remain.
  if (content.includes("mother.json") && content.includes("fs.")) {
    console.error(`Legacy session write detected in ${file}`);
    failed = true;
  }

  // Ensure no legacy artifact registry writes remain.
  if (content.includes("artifact_registry.json") && content.includes("fs.")) {
    console.error(`Legacy artifact registry write detected in ${file}`);
    failed = true;
  }
}

if (failed) process.exit(1);
