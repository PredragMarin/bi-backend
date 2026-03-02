"use strict";

const {
  FIXTURE_ROOT,
  listFixtureModules,
  listFixtureCases,
  loadFixtureManifest
} = require("../core/excel_shell/fixtures");

function main() {
  const modules = listFixtureModules();
  console.log("FIXTURE_ROOT:", FIXTURE_ROOT);
  console.log("MODULES:", modules.join(", "));
  for (const mk of modules) {
    const cases = listFixtureCases(mk);
    console.log(`- ${mk}: ${cases.length} case(s)`);
    for (const cid of cases) {
      const m = loadFixtureManifest(mk, cid);
      console.log(`  * ${cid} [mode=${m.mode}]`);
    }
  }
}

main();

