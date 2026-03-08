"use strict";

const {
  ymdInTZ,
  encodeFilter,
  fetchGridJson
} = require("./public_feed_common");

const BASE_URL = "https://eojn.hr";
const PAGE_PATH = "/notices-all";
const GRID_NAME = "TenderNotices";

function buildUrls(filterExpr) {
  const filter = encodeFilter(filterExpr);
  return {
    pageUrl: `${BASE_URL}${PAGE_PATH}?initFilter=${filter}`,
    apiUrl: `${BASE_URL}/api/searchgrid/${GRID_NAME}/get?filter=${filter}&format=json`
  };
}

async function fetchNoticesPublic({ watermarkYmd, runDateYmd }) {
  const fromYmd = watermarkYmd || runDateYmd || ymdInTZ(new Date());
  const filterExpr = ["PublishDate", ">=", fromYmd];
  const urls = buildUrls(filterExpr);
  const fetched = await fetchGridJson(urls);

  return {
    feed: "notices",
    mode: "incremental_publish_date",
    filter_expr: filterExpr,
    rows: fetched.rows,
    source: fetched.source
  };
}

module.exports = {
  fetchNoticesPublic
};
