"use strict";

function getRequestRoute(request) {
  if (request.fetch_mode === "sifradn_list") {
    return {
      kind: "dxf_manipulation_json"
    };
  }
  return {
    kind: "csv_bundle"
  };
}

module.exports = {
  getRequestRoute
};
