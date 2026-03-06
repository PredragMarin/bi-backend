"use strict";

const { computeEprOutputs } = require("./domain/compute");

function runCompute({ manifest, period, period_label, datasets, validation }) {
  return computeEprOutputs({
    manifest,
    period,
    period_label,
    datasets,
    validation
  });
}

module.exports = {
  use_case: "epr_attendance_v1",
  current_pointer_use_case: "use_case_EPR",
  runCompute
};
