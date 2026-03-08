"use strict";

const {
  ymdInTZ,
  isoStartOfDay,
  encodeFilter,
  fetchGridJson
} = require("./public_feed_common");

const BASE_URL = "https://eojn.hr";
const PAGE_PATH = "/procurements-all";
const GRID_NAME = "TendersAll";

function buildUrls(filterExpr) {
  const filter = encodeFilter(filterExpr);
  return {
    pageUrl: `${BASE_URL}${PAGE_PATH}?initFilter=${filter}`,
    apiUrl: `${BASE_URL}/api/searchgrid/${GRID_NAME}/get?filter=${filter}&format=json`
  };
}

async function fetchProcurementsPublic({ mode, watermarkYmd, runDateYmd }) {
  const todayYmd = runDateYmd || ymdInTZ(new Date());
  const isFullMode = mode === "bootstrap" || mode === "safety_full";

  const filterExpr = isFullMode
    ? ["SubmissionDeadline", ">", isoStartOfDay(todayYmd)]
    : ["NoticePublishDate", ">=", isoStartOfDay(watermarkYmd || todayYmd)];

  const urls = buildUrls(filterExpr);
  const fetched = await fetchGridJson(urls);

  return {
    feed: "procurements",
    mode: isFullMode ? "full_active" : "incremental_notice_publish",
    filter_expr: filterExpr,
    rows: fetched.rows,
    source: fetched.source
  };
}

module.exports = {
  fetchProcurementsPublic
};
