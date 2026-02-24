const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");

function dbg(...a) { console.log("[EOJN][PW][DBG]", ...a); }
function inf(...a) { console.log("[EOJN][PW][INF]", ...a); }
function wrn(...a) { console.warn("[EOJN][PW][WRN]", ...a); }
function err(...a) { console.error("[EOJN][PW][ERR]", ...a); }

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith("--")) out[a.slice(2)] = "1";
  }
  return out;
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function todayLocalISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}_${mm}_${dd}`;
}

function parseTenderIds(args) {
  const ids = [];

  if (args.tender) ids.push(args.tender);
  if (args.tenders) ids.push(...String(args.tenders).split(/[;,\s]+/g));

  const unique = [];
  const seen = new Set();
  for (const x of ids) {
    const n = Number(String(x).trim());
    if (!Number.isFinite(n) || n <= 0) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    unique.push(n);
  }
  return unique;
}

function maskTokenInUrl(u) {
  try {
    const x = new URL(u);
    if (x.searchParams.has("userToken")) x.searchParams.set("userToken", "***");
    return x.toString();
  } catch {
    return String(u || "");
  }
}

async function ensureDir(p) { await fsp.mkdir(p, { recursive: true }); }
async function fileExists(p) { try { await fsp.access(p); return true; } catch { return false; } }

async function saveSnapshot(page, outDir, label) {
  const html = await page.content().catch(() => "");
  const p = path.join(outDir, `${label}.html`);
  await fsp.writeFile(p, `<!-- URL: ${page.url()} -->\n` + html, "utf8");
  inf("Saved snapshot:", p);
}

async function seedCookies(context) {
  const now = Date.now();
  const oneYear = Math.floor(now / 1000) + 3600 * 24 * 365;

  await context.addCookies([
    {
      name: "cookies-accepted",
      value: "true",
      domain: ".eojn.hr",
      path: "/",
      expires: oneYear,
      httpOnly: false,
      secure: true,
      sameSite: "Lax"
    },
    {
      name: "theme",
      value: "light",
      domain: "eojn.hr",
      path: "/",
      expires: oneYear,
      httpOnly: false,
      secure: true,
      sameSite: "Lax"
    }
  ]);

  dbg("Seeded cookies: cookies-accepted=true, theme=light");
}

async function detectLoginWall(page) {
  const hasPwd = (await page.locator('input[type="password"]:visible').count()) > 0;
  const hasLoginBtn = (await page.locator('#uiLoginLink:visible, a[href*="/login"]:visible, a[href*="/prijava"]:visible').count()) > 0;
  const isLoginUrl = /\/(login|prijava)(\?|$)/i.test(page.url());
  return { hasPwd, hasLoginBtn, isLoginUrl, looksLikeLogin: isLoginUrl || hasPwd || hasLoginBtn };
}

async function tryLogin(page, { user, pass, outDir, baseUrl }) {
  inf("Trying to reach login form...");

  const loginLink = await page.$("#uiLoginLink");
  if (loginLink) {
    inf("Clicking #uiLoginLink ...");
    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }),
      loginLink.click({ timeout: 8000 })
    ]);
  }

  if (!(await page.$('input[type="password"]:visible'))) {
    inf("No password field yet. Opening login page directly ...");
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  }

  const userSelectors = [
    'input[name*="username" i]:visible',
    'input[id*="username" i]:visible',
    'input[name*="user" i]:visible',
    'input[id*="user" i]:visible',
    'input[type="email"]:visible',
    'input[type="text"]:visible'
  ];
  const passSelectors = [
    'input[type="password"]:visible',
    'input[name*="pass" i]:visible',
    'input[id*="pass" i]:visible'
  ];

  let userEl = null;
  for (const s of userSelectors) {
    userEl = await page.$(s);
    if (userEl) { dbg("User input selector:", s); break; }
  }

  let passEl = null;
  for (const s of passSelectors) {
    passEl = await page.$(s);
    if (passEl) { dbg("Pass input selector:", s); break; }
  }

  if (!passEl) {
    err("Still no password field.");
    await saveSnapshot(page, outDir, "login_not_found");
    return false;
  }

  if (userEl) await userEl.fill(user, { timeout: 8000 });
  await passEl.fill(pass, { timeout: 8000 });

  const submitSelectors = [
    'button[type="submit"]:visible',
    'input[type="submit"]:visible',
    'button:has-text("Prijava")',
    'button:has-text("Prijavi")',
    'button:has-text("Login")',
    'button:has-text("Sign in")'
  ];

  let submitted = false;
  for (const s of submitSelectors) {
    const b = await page.$(s);
    if (!b) continue;

    inf("Submitting via:", s);
    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
      b.click({ timeout: 8000 })
    ]);
    submitted = true;
    break;
  }

  if (!submitted) {
    inf("No obvious submit button; submitting by Enter on password field.");
    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
      passEl.press("Enter")
    ]);
  }

  const st = await detectLoginWall(page);
  dbg("Post-login check:", st);
  if (st.looksLikeLogin) {
    await saveSnapshot(page, outDir, "login_failed_or_blocked");
    return false;
  }

  inf("Login seems OK.");
  return true;
}

async function openTenderEnsureAuth(page, { tenderId, baseUrl, user, pass, outDir }) {
  const tenderUrl = `${baseUrl}/tender-eo/${tenderId}`;
  inf("Opening:", tenderUrl);

  let resp = await page.goto(tenderUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  dbg("status:", resp ? `${resp.status()} ${resp.statusText()}` : "no-response");
  dbg("url after goto:", page.url());

  let st = await detectLoginWall(page);
  dbg("login wall check:", st);

  if (st.looksLikeLogin) {
    inf("Login required. Running automated login...");
    const ok = await tryLogin(page, { user, pass, outDir, baseUrl });
    if (!ok) return { ok: false, reason: "LOGIN_FAILED" };

    inf("Re-opening tender after login...");
    resp = await page.goto(tenderUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    dbg("status:", resp ? `${resp.status()} ${resp.statusText()}` : "no-response");
    dbg("url after goto:", page.url());

    st = await detectLoginWall(page);
    if (st.looksLikeLogin) return { ok: false, reason: "STILL_LOGIN_WALL" };
  }

  return { ok: true, tenderUrl };
}

function isBudgetCandidate({ href, text }) {
  const hay = `${text || ""} ${href || ""}`.toLowerCase();
  return hay.includes("troskovnik") || hay.includes("tro\u0161kovnik") || hay.includes(".xlsx") || hay.includes(".xls");
}

async function collectBudgetLinks(page) {
  const links = await page.$$eval('a[href*="GetDocument.ashx"]', (anchors) => {
    return anchors.map((a) => ({
      href: a.href || "",
      text: (a.textContent || "").trim()
    }));
  });

  const filtered = links.filter(isBudgetCandidate);
  const seen = new Set();
  const out = [];
  for (const l of filtered) {
    if (!l.href || seen.has(l.href)) continue;
    seen.add(l.href);
    out.push(l);
  }
  return out;
}

async function clickAndDownloadByHref(page, href, timeoutMs = 90000) {
  const downloadPromise = page.waitForEvent("download", { timeout: timeoutMs });

  const clicked = await page.evaluate((targetHref) => {
    const anchors = Array.from(document.querySelectorAll('a[href*="GetDocument.ashx"]'));
    const a = anchors.find((x) => {
      try {
        return new URL(x.href, window.location.href).href === targetHref;
      } catch {
        return false;
      }
    });
    if (!a) return false;
    a.click();
    return true;
  }, href);

  if (!clicked) throw new Error("Anchor for download not found in DOM.");

  return await downloadPromise;
}

async function main() {
  const args = parseArgs(process.argv);
  const headed = args.headed === "1";
  const fresh = args.fresh === "1";
  const configPath = args.config || process.env.EOJN_CONFIG_PATH || "";
  const tenderIds = parseTenderIds(args);

  if (!configPath) {
    err("Missing config path. Use --config=... or EOJN_CONFIG_PATH.");
    process.exit(2);
  }

  if (!tenderIds.length) {
    err("Missing tender IDs. Use --tender=<id> or --tenders=74455,74552,...");
    process.exit(2);
  }

  let cfg = {};
  try {
    cfg = readJsonFile(configPath);
    inf("Loaded config:", configPath);
  } catch (e) {
    err("Could not read config file:", configPath);
    err(e?.message || String(e));
    process.exit(2);
  }

  const user = cfg.eojnUser || process.env.EOJN_USER || "";
  const pass = cfg.eojnPass || process.env.EOJN_PASS || "";
  if (!user || !pass) {
    err("Missing credentials. Set EOJN_USER/EOJN_PASS or config eojnUser/eojnPass.");
    process.exit(2);
  }

  const baseUrl = String(cfg.baseUrl || "https://eojn.hr").replace(/\/+$/, "");
  const runDate = todayLocalISO();
  const outRoot = path.resolve(process.cwd(), "out", "eojn_v1", "_dev_budget_pw", runDate);
  await ensureDir(outRoot);

  const statePath = cfg.storageStatePath
    ? path.resolve(String(cfg.storageStatePath))
    : path.resolve(process.cwd(), "out", "eojn_v1", "_dev_budget_pw", "storageState.json");
  await ensureDir(path.dirname(statePath));

  inf("tenders:", tenderIds.join(", "));
  inf("headed:", headed ? "YES" : "NO");
  inf("fresh:", fresh ? "YES" : "NO");
  inf("outRoot:", outRoot);

  const browser = await chromium.launch({
    headless: !headed,
    args: ["--disable-blink-features=AutomationControlled"]
  });

  const contextOpts = { acceptDownloads: true };
  if (!fresh && await fileExists(statePath)) {
    inf("Loading storageState:", statePath);
    contextOpts.storageState = statePath;
  }

  const context = await browser.newContext(contextOpts);
  await seedCookies(context);
  const page = await context.newPage();

  const runReport = {
    startedAt: new Date().toISOString(),
    tenderIds,
    headed,
    fresh,
    outRoot,
    statePath,
    tenders: []
  };

  for (const tenderId of tenderIds) {
    const tenderDir = path.join(outRoot, `tender_${tenderId}`);
    await ensureDir(tenderDir);

    const item = {
      tenderId,
      startedAt: new Date().toISOString(),
      ok: false,
      linksFound: 0,
      filesSaved: [],
      errors: []
    };

    try {
      const auth = await openTenderEnsureAuth(page, { tenderId, baseUrl, user, pass, outDir: tenderDir });
      if (!auth.ok) {
        item.errors.push(auth.reason || "AUTH_FAILED");
        runReport.tenders.push(item);
        continue;
      }

      await context.storageState({ path: statePath });

      await page.waitForTimeout(800);
      const links = await collectBudgetLinks(page);
      item.linksFound = links.length;
      dbg(`Tender ${tenderId} budget candidates:`, links.length);

      if (!links.length) {
        await saveSnapshot(page, tenderDir, `tender_${tenderId}_no_budget_links`);
        item.errors.push("NO_BUDGET_LINKS");
        runReport.tenders.push(item);
        continue;
      }

      for (let i = 0; i < links.length; i++) {
        const l = links[i];
        inf(`Tender ${tenderId} downloading ${i + 1}/${links.length}:`, l.text || "(no text)");
        dbg("Href:", maskTokenInUrl(l.href));

        try {
          const download = await clickAndDownloadByHref(page, l.href, 90000);
          const suggested = download.suggestedFilename();
          const safeName = suggested || `tender_${tenderId}_budget_${i + 1}.bin`;
          const targetPath = path.join(tenderDir, safeName);
          await download.saveAs(targetPath);
          const st = await fsp.stat(targetPath);

          item.filesSaved.push({
            fileName: safeName,
            bytes: st.size,
            sourceHrefMasked: maskTokenInUrl(l.href)
          });
        } catch (e) {
          const msg = e?.message || String(e);
          wrn(`Tender ${tenderId} download failed:`, msg);
          item.errors.push(`DOWNLOAD_FAILED:${msg}`);
        }
      }

      item.ok = item.filesSaved.length > 0;
    } catch (e) {
      item.errors.push(e?.message || String(e));
    }

    item.endedAt = new Date().toISOString();
    runReport.tenders.push(item);
  }

  runReport.endedAt = new Date().toISOString();
  runReport.okCount = runReport.tenders.filter((t) => t.ok).length;
  runReport.failCount = runReport.tenders.length - runReport.okCount;

  const reportPath = path.join(outRoot, "batch_report.json");
  await fsp.writeFile(reportPath, JSON.stringify(runReport, null, 2), "utf8");

  await context.storageState({ path: statePath });
  await browser.close();

  inf("BATCH DONE", {
    ok: runReport.okCount,
    fail: runReport.failCount,
    reportPath
  });

  if (runReport.failCount > 0) process.exitCode = 1;
}

main().catch((e) => {
  err(e?.stack || e?.message || String(e));
  process.exit(1);
});
