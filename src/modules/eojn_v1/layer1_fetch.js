'use strict';

const fs = require('fs/promises');
const path = require('path');

const TZ = 'Europe/Zagreb';

function ymdInTZ(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const get = (t) => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function yesterdayYmd() {
  const now = new Date();
  return ymdInTZ(new Date(now.getTime() - 24 * 60 * 60 * 1000), TZ);
}

function extractUserToken(html) {
  const m = html.match(/id="uiUserToken"[^>]*value="([^"]+)"/i);
  return m ? m[1] : null;
}

function buildInitFilter(ymd) {
  // /procurements-all?initFilter=["NoticePublishDate",">=","YYYY-MM-DD"]
  return encodeURIComponent(JSON.stringify(["NoticePublishDate", ">=", ymd]));
}

function buildApiFilter(ymd) {
  // API filter koristi ISO s T00:00:00 (kao u vašem cURL-u)
  return encodeURIComponent(JSON.stringify(["NoticePublishDate", ">=", `${ymd}T00:00:00`]));
}

function outDirForDate(outBase, ymd) {
  const d = ymd.replace(/-/g, '_');
  return path.join(outBase, d);
}

function getSetCookies(res) {
  // Node 24 (undici) ima headers.getSetCookie()
  if (res.headers && typeof res.headers.getSetCookie === 'function') {
    return res.headers.getSetCookie();
  }
  const single = res.headers ? res.headers.get('set-cookie') : null;
  return single ? [single] : [];
}

function buildCookieHeader(setCookies) {
  // pretvori "A=B; Path=/; HttpOnly" u "A=B"
  const pairs = [];
  for (const c of setCookies) {
    const first = String(c).split(';')[0].trim();
    if (first) pairs.push(first);
  }
  // de-dupe po imenu kolačića
  const map = new Map();
  for (const p of pairs) {
    const eq = p.indexOf('=');
    if (eq > 0) map.set(p.slice(0, eq), p);
  }
  return Array.from(map.values()).join('; ');
}

async function layer1Fetch({ outBase, moduleDir, dateYmd }) {
  const ymd = dateYmd || yesterdayYmd();
  const outDir = outDirForDate(outBase, ymd);
  await fs.mkdir(outDir, { recursive: true });

  const fetchedAt = new Date().toISOString();

  // 1) Bootstrap page (dobij session cookie + uiUserToken)
  const pageUrl = `https://eojn.hr/procurements-all?initFilter=${buildInitFilter(ymd)}`;

  const pageRes = await fetch(pageUrl, {
    method: 'GET',
    headers: { accept: 'text/html,*/*' }
  });

  if (!pageRes.ok) throw new Error(`Bootstrap page failed: HTTP ${pageRes.status}`);
  const html = await pageRes.text();

  const userToken = extractUserToken(html);
  if (!userToken) {
    await fs.writeFile(path.join(outDir, 'debug_page.html'), html, 'utf8');
    throw new Error('uiUserToken nije pronađen u HTML-u (spremio sam debug_page.html).');
  }

  // Uhvati session cookies iz bootstrap responsea
  const setCookies = getSetCookies(pageRes);
  const cookieHeader = buildCookieHeader(setCookies);

  // 2) API fetch
  const apiUrl = `https://eojn.hr/api/searchgrid/TendersAll/get?filter=${buildApiFilter(ymd)}&format=json`;

  const apiRes = await fetch(apiUrl, {
    method: 'GET',
    headers: {
      accept: 'application/json,*/*',
      usertoken: userToken,
      // isto što browser radi: cookie + token
      cookie: cookieHeader
    }
  });

  if (!apiRes.ok) {
    const t = await apiRes.text().catch(() => '');
    throw new Error(`API failed: HTTP ${apiRes.status} ${apiRes.statusText}\n${t.slice(0, 400)}`);
  }

  const bodyText = await apiRes.text();

  // 3) Parse (može biti array ili wrapper)
  let parsed = JSON.parse(bodyText);
  if (!Array.isArray(parsed) && parsed && Array.isArray(parsed.data)) parsed = parsed.data;
  if (!Array.isArray(parsed)) {
    await fs.writeFile(path.join(outDir, 'debug_api_response.json'), bodyText, 'utf8');
    throw new Error('Neočekivan API format: nije array niti {data:[...]} (spremio debug_api_response.json).');
  }

  // 4) Save raw
  await fs.writeFile(path.join(outDir, 'raw.json'), JSON.stringify(parsed, null, 2), 'utf8');

  return {
    dateYmd: ymd,
    outDir,
    fetchedAt,
    source: { pageUrl, apiUrl, userToken },
    rows: parsed,
    rowCount: parsed.length
  };
}

module.exports = { layer1Fetch };
