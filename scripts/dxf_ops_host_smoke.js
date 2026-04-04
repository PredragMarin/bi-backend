"use strict";

const {
  parseRnListInput,
  buildErpFetchRequestFromRnList,
  extractCsv,
  validateChecksum,
  parseDimension,
  parseRange,
  parseCsvToJson
} = require("../src/modules/dxf_ops_host_v1/adapters/db_fetch_dxf_ops_host");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const rnPaste = [
    "Rn",
    "26T12V40",
    "26T12V41",
    "",
    "26T12V41",
    "  26T12V42  "
  ].join("\n");

  const parsed = parseRnListInput(rnPaste);
  assert(parsed.validation.ok, "RN parser should accept the sample input.");
  assert(parsed.header_handled === true, "RN header should be detected.");
  assert(parsed.normalized_rns.length === 3, "Expected 3 normalized RN values after dedupe.");

  const request = buildErpFetchRequestFromRnList({
    rnList: parsed.normalized_rns,
    dsn: "ERP_POC_RO"
  });
  assert(request.items.length === 3, "Fetch request should contain one batch item per RN.");
  assert(request.items[0].queryId === "V_DN_BY_SIFRADN", "Fetch request should target V_DN_BY_SIFRADN.");

  const sample = "#8102;PPV30;86cm;196cm;-30mm;NE;NE;145cm;Lijeva (SX);D CRNO RAL9005;L CRNO RAL9005;PV ARBOR;PU ARBOR;Bez ukrasnih letvi;Bez ukrasnih letvi;CILINDAR;LEPTIR K28 40-30;KVAKA - KVAKA;CRNO;CRNO;JEDNOSTRUKA;NE;NE;Bez zatvaraca;80cm - 91cm;185cm - 211 cm;PESA 01;PRIZEMLJE DESNO;AM;1;Da;215#";
  const extracted = extractCsv(`Referenca test | ${sample}`);
  assert(!!extracted, "Config string should be extracted from opombe.");
  assert(validateChecksum(extracted) === true, "Checksum should validate for the sample string.");
  assert(parseDimension("88cm") === 880, "parseDimension should convert cm to mm.");
  assert(parseDimension("0mm") === 0, "parseDimension should parse 0mm.");
  const range = parseRange("80cm - 91cm");
  assert(range && range.min === 800 && range.max === 910, "parseRange should convert cm range to mm bounds.");
  const parsedCsv = parseCsvToJson(extracted);
  assert(parsedCsv.CHECKSUM === "215", "CSV parser should keep checksum field.");
  assert(parsedCsv.WORK_ORDER === "AM", "CSV parser should map WORK_ORDER field.");

  process.stdout.write(JSON.stringify({
    ok: true,
    parsed_rns: parsed.normalized_rns,
    fetch_strategy: request.fetch_strategy,
    checksum_valid: validateChecksum(extracted),
    parsed_csv_sample: {
      model_code: parsedCsv.MODEL_CODE,
      width: parsedCsv.WIDTH,
      segment_width: parsedCsv.SEGMENT_SIRINE,
      work_order: parsedCsv.WORK_ORDER,
      checksum: parsedCsv.CHECKSUM
    }
  }, null, 2) + "\n");
}

main();
