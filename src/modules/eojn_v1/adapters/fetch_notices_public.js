"use strict";

const {
  ymdInTZ,
  shiftYmd,
  encodeFilter,
  fetchGridJson
} = require("./public_feed_common");

const BASE_URL = "https://eojn.hr";
const PAGE_PATH = "/notices-all";
const GRID_NAME = "TenderNotices";
const SAFETY_OVERLAP_DAYS = 2;

function buildUrls(filterExpr) {
  const filter = encodeFilter(filterExpr);
  return {
    pageUrl: `${BASE_URL}${PAGE_PATH}?initFilter=${filter}`,
    apiUrl: `${BASE_URL}/api/searchgrid/${GRID_NAME}/get?filter=${filter}&format=json`
  };
}

async function fetchNoticesPublic({ watermarkYmd, runDateYmd }) {
  const fromYmd = watermarkYmd || runDateYmd || ymdInTZ(new Date());
  const overlapFromYmd = shiftYmd(fromYmd, -SAFETY_OVERLAP_DAYS);
  const filterExpr = ["PublishDate", ">=", overlapFromYmd];
  const urls = buildUrls(filterExpr);
  const fetched = await fetchGridJson(urls);

  return {
    feed: "notices",
    mode: "incremental_publish_date",
    safety_overlap_days: SAFETY_OVERLAP_DAYS,
    effective_from_ymd: overlapFromYmd,
    filter_expr: filterExpr,
    rows: fetched.rows,
    source: fetched.source
  };
}

module.exports = {
  fetchNoticesPublic
};
