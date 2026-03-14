"use strict";

const TZ = "Europe/Zagreb";

function ymdInTZ(date, timeZone = TZ) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function isoStartOfDay(ymd) {
  return `${ymd}T00:00:00`;
}

function shiftYmd(ymd, deltaDays) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid YMD: ${ymd}`);
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return ymdInTZ(new Date(utc + Number(deltaDays || 0) * 24 * 60 * 60 * 1000));
}

function encodeFilter(filterExpr) {
  return encodeURIComponent(JSON.stringify(filterExpr));
}

function extractUserToken(html) {
  const m = String(html || "").match(/id="uiUserToken"[^>]*value="([^"]+)"/i);
  return m ? m[1] : null;
}

function getSetCookies(res) {
  if (res.headers && typeof res.headers.getSetCookie === "function") {
    return res.headers.getSetCookie();
  }
  const single = res.headers ? res.headers.get("set-cookie") : null;
  return single ? [single] : [];
}

function buildCookieHeader(setCookies) {
  const pairs = [];
  for (const c of setCookies) {
    const first = String(c).split(";")[0].trim();
    if (first) pairs.push(first);
  }
  const map = new Map();
  for (const p of pairs) {
    const eq = p.indexOf("=");
    if (eq > 0) map.set(p.slice(0, eq), p);
  }
  return Array.from(map.values()).join("; ");
}

async function bootstrapSession(pageUrl) {
  const pageRes = await fetch(pageUrl, {
    method: "GET",
    headers: { accept: "text/html,*/*" }
  });

  if (!pageRes.ok) {
    throw new Error(`Bootstrap page failed: HTTP ${pageRes.status}`);
  }

  const html = await pageRes.text();
  const userToken = extractUserToken(html);
  if (!userToken) {
    throw new Error("Missing uiUserToken in bootstrap HTML.");
  }

  const setCookies = getSetCookies(pageRes);
  const cookieHeader = buildCookieHeader(setCookies);
  return { userToken, cookieHeader };
}

async function fetchGridJson({ pageUrl, apiUrl }) {
  const bootstrap = await bootstrapSession(pageUrl);
  const apiRes = await fetch(apiUrl, {
    method: "GET",
    headers: {
      accept: "application/json,*/*",
      usertoken: bootstrap.userToken,
      cookie: bootstrap.cookieHeader
    }
  });

  if (!apiRes.ok) {
    const body = await apiRes.text().catch(() => "");
    throw new Error(`EOJN API failed: HTTP ${apiRes.status} ${apiRes.statusText} ${body.slice(0, 300)}`);
  }

  const bodyText = await apiRes.text();
  let parsed = JSON.parse(bodyText);
  if (!Array.isArray(parsed) && parsed && Array.isArray(parsed.data)) parsed = parsed.data;
  if (!Array.isArray(parsed)) {
    throw new Error("Unexpected EOJN API format: expected [] or {data:[]}");
  }

  return {
    rows: parsed,
    source: {
      page_url: pageUrl,
      api_url: apiUrl
    }
  };
}

module.exports = {
  TZ,
  ymdInTZ,
  isoStartOfDay,
  shiftYmd,
  encodeFilter,
  fetchGridJson
};
