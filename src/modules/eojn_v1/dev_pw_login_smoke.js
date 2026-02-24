const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");

function log(...a) { console.log("[EOJN][LOGIN_SMOKE]", ...a); }
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
async function ensureDir(p) { await fsp.mkdir(p, { recursive: true }); }
async function fileExists(p) { try { await fsp.access(p); return true; } catch { return false; } }
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
}

async function detectAuthState(page) {
  const hasPwd = (await page.locator('input[type="password"]:visible').count()) > 0;
  const hasLoginLink = (await page.locator('#uiLoginLink:visible, a[href*="/login"]:visible, a[href*="/prijava"]:visible').count()) > 0;
  const hasLogout = (await page.locator('text=Odjava, a[href*="logout"], a[href*="odjava"]').count()) > 0;
  const isLoginUrl = /\/(login|prijava)(\?|$)/i.test(page.url());
  return {
    url: page.url(),
    hasPwd,
    hasLoginLink,
    hasLogout,
    isLoginUrl,
    looksLoggedIn: !isLoginUrl && !hasPwd && !hasLoginLink,
    looksLoginWall: isLoginUrl || hasPwd || hasLoginLink
  };
}

async function safeFillLogin(page, user, pass) {
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
    const el = await page.$(s);
    if (el) {
      const t = (await el.getAttribute("type")) || "";
      if (t.toLowerCase() !== "hidden") { userEl = el; break; }
    }
  }

  let passEl = null;
  for (const s of passSelectors) {
    const el = await page.$(s);
    if (el) { passEl = el; break; }
  }

  if (!passEl) return { ok: false, reason: "password_field_not_found" };

  if (userEl) await userEl.fill(user, { timeout: 8000 });
  await passEl.fill(pass, { timeout: 8000 });

  const submitSelectors = [
    'button[type="submit"]:visible',
    'input[type="submit"]:visible',
    'button:has-text("Prijava")',
    'button:has-text("Login")'
  ];

  for (const s of submitSelectors) {
    const b = await page.$(s);
    if (b) {
      await Promise.allSettled([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
        b.click({ timeout: 8000 })
      ]);
      return { ok: true, reason: `submitted_with:${s}` };
    }
  }

  await Promise.allSettled([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
    passEl.press("Enter")
  ]);
  return { ok: true, reason: "submitted_with:enter" };
}

(async () => {
  const args = parseArgs(process.argv);
  const tenderId = Number(args.tender || 74182);
  const headed = args.headed === "1";
  const fresh = args.fresh === "1";
  const cfgPath = args.config || process.env.EOJN_CONFIG_PATH || "";

  if (!cfgPath) throw new Error("Missing config path. Use --config=... or EOJN_CONFIG_PATH.");
  const cfg = readJsonFile(cfgPath);
  const user = cfg.eojnUser || process.env.EOJN_USER;
  const pass = cfg.eojnPass || process.env.EOJN_PASS;
  if (!user || !pass) throw new Error("Missing eojnUser/eojnPass.");

  const baseUrl = String(cfg.baseUrl || "https://eojn.hr").replace(/\/+$/, "");
  const statePath = cfg.storageStatePath
    ? path.resolve(String(cfg.storageStatePath))
    : path.resolve(process.cwd(), "out", "eojn_v1", "_dev_budget_pw", "storageState.json");

  const outDir = path.resolve(process.cwd(), "out", "eojn_v1", "_dev_budget_pw", todayLocalISO());
  await ensureDir(outDir);
  await ensureDir(path.dirname(statePath));

  const report = {
    startedAt: new Date().toISOString(),
    tenderId,
    headed,
    fresh,
    cfgPath,
    statePath,
    requests: [],
    steps: [],
    cookiesByStep: []
  };

  const browser = await chromium.launch({ headless: !headed });
  const contextOpts = { acceptDownloads: false };
  if (!fresh && await fileExists(statePath)) contextOpts.storageState = statePath;
  const context = await browser.newContext(contextOpts);
  await seedCookies(context);

  context.on("response", async (res) => {
    const u = res.url();
    if (!u.includes("eojn.hr")) return;
    if (!(u.includes("/login") || u.includes("/prijava") || u.includes("/konzola") || u.includes(`/tender-eo/${tenderId}`))) return;

    const h = res.headers();
    const setCookie = h["set-cookie"] || "";
    const setCookieNames = setCookie
      ? setCookie.split(",").map(x => x.trim().split("=")[0]).filter(Boolean)
      : [];

    report.requests.push({
      url: u,
      status: res.status(),
      location: h["location"] || "",
      setCookieNames
    });
  });

  const page = await context.newPage();
  const tenderUrl = `${baseUrl}/tender-eo/${tenderId}`;

  await page.goto(tenderUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  const s1 = await detectAuthState(page);
  report.steps.push({ step: "open_tender", state: s1 });
  report.cookiesByStep.push({
    step: "open_tender",
    cookieNames: (await context.cookies(baseUrl)).map(c => c.name)
  });

  if (!s1.looksLoggedIn) {
    const loginLink = await page.$("#uiLoginLink");
    if (loginLink) {
      await Promise.allSettled([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }),
        loginLink.click({ timeout: 8000 })
      ]);
      report.steps.push({ step: "click_uiLoginLink", url: page.url() });
    } else {
      await page.goto(`${baseUrl}/login?returnUrl=/tender-eo/${tenderId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      report.steps.push({ step: "goto_login_returnUrl", url: page.url() });
    }

    const sub = await safeFillLogin(page, user, pass);
    report.steps.push({ step: "submit_login", result: sub, url: page.url() });
    report.cookiesByStep.push({
      step: "submit_login",
      cookieNames: (await context.cookies(baseUrl)).map(c => c.name)
    });

    await page.goto(tenderUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    const s2 = await detectAuthState(page);
    report.steps.push({ step: "reopen_tender", state: s2 });
    report.cookiesByStep.push({
      step: "reopen_tender",
      cookieNames: (await context.cookies(baseUrl)).map(c => c.name)
    });
  }

  const finalState = await detectAuthState(page);
  report.finalState = finalState;
  report.verdict = finalState.looksLoggedIn ? "PASS" : "FAIL";

  await context.storageState({ path: statePath });
  report.endedAt = new Date().toISOString();

  const reportPath = path.join(outDir, `login_smoke_${tenderId}.json`);
  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  log("VERDICT:", report.verdict);
  log("REPORT:", reportPath);
  if (report.verdict !== "PASS") process.exitCode = 1;

  await browser.close();
})().catch((e) => {
  console.error("[EOJN][LOGIN_SMOKE][ERR]", e?.stack || e?.message || String(e));
  process.exit(1);
});
