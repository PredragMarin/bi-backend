"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");
const { resolveEojnConfigPath } = require("./eojn_config_service");

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

function maskTokenInUrl(value) {
  try {
    const url = new URL(value);
    if (url.searchParams.has("userToken")) url.searchParams.set("userToken", "***");
    return url.toString();
  } catch {
    return String(value || "");
  }
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function saveSnapshot(page, outDir, label) {
  const html = await page.content().catch(() => "");
  const filePath = path.join(outDir, `${label}.html`);
  await fsp.writeFile(filePath, `<!-- URL: ${page.url()} -->\n${html}`, "utf8");
  return filePath;
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
}

async function detectLoginWall(page) {
  const hasPwd = (await page.locator('input[type="password"]:visible').count()) > 0;
  const hasLoginBtn = (await page.locator('#uiLoginLink:visible, a[href*="/login"]:visible, a[href*="/prijava"]:visible').count()) > 0;
  const isLoginUrl = /\/(login|prijava)(\?|$)/i.test(page.url());
  return {
    hasPwd,
    hasLoginBtn,
    isLoginUrl,
    looksLikeLogin: isLoginUrl || hasPwd || hasLoginBtn
  };
}

async function tryLogin(page, { user, pass, outDir, baseUrl }) {
  const loginLink = await page.$("#uiLoginLink");
  if (loginLink) {
    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }),
      loginLink.click({ timeout: 8000 })
    ]);
  }

  if (!(await page.$('input[type="password"]:visible'))) {
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
  for (const selector of userSelectors) {
    userEl = await page.$(selector);
    if (userEl) break;
  }

  let passEl = null;
  for (const selector of passSelectors) {
    passEl = await page.$(selector);
    if (passEl) break;
  }

  if (!passEl) {
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
  for (const selector of submitSelectors) {
    const button = await page.$(selector);
    if (!button) continue;
    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
      button.click({ timeout: 8000 })
    ]);
    submitted = true;
    break;
  }

  if (!submitted) {
    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
      passEl.press("Enter")
    ]);
  }

  const state = await detectLoginWall(page);
  if (state.looksLikeLogin) {
    await saveSnapshot(page, outDir, "login_failed_or_blocked");
    return false;
  }
  return true;
}

async function openTenderEnsureAuth(page, { tenderId, baseUrl, user, pass, outDir }) {
  const tenderUrl = `${baseUrl}/tender-eo/${tenderId}`;
  await page.goto(tenderUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  let state = await detectLoginWall(page);
  if (state.looksLikeLogin) {
    const ok = await tryLogin(page, { user, pass, outDir, baseUrl });
    if (!ok) return { ok: false, reason: "LOGIN_FAILED" };
    await page.goto(tenderUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    state = await detectLoginWall(page);
    if (state.looksLikeLogin) return { ok: false, reason: "STILL_LOGIN_WALL" };
  }
  return { ok: true, tenderUrl };
}

function isBudgetCandidate({ href, text }) {
  const hay = `${text || ""} ${href || ""}`.toLowerCase();
  return hay.includes("troskovnik") || hay.includes("troškovnik");
}

async function collectBudgetLinks(page) {
  const links = await page.$$eval('a[href*="GetDocument.ashx"]', (anchors) => {
    function normalizeText(value) {
      return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    function shortText(value) {
      return String(value || "").replace(/\s+/g, " ").trim().slice(0, 160);
    }

    function candidateHeadingText(node) {
      if (!node) return "";
      const own = shortText(node.textContent || "");
      const ownNorm = normalizeText(own);
      const cls = normalizeText(node.className || "");
      if (ownNorm === "troskovnik" || ownNorm === "tehnicke specifikacije" || ownNorm === "prijedlog ugovora") {
        return own;
      }
      if (cls.includes("title") || cls.includes("heading") || cls.includes("header")) {
        return own;
      }
      return "";
    }

    function findSectionHeading(anchor) {
      let current = anchor.parentElement;
      let depth = 0;
      while (current && depth < 8) {
        let prev = current.previousElementSibling;
        while (prev) {
          const heading = candidateHeadingText(prev);
          if (heading) return heading;
          const nested = Array.from(prev.querySelectorAll("*"))
            .map((node) => candidateHeadingText(node))
            .find(Boolean);
          if (nested) return nested;
          prev = prev.previousElementSibling;
        }

        const selfHeading = candidateHeadingText(current);
        if (selfHeading) return selfHeading;
        current = current.parentElement;
        depth += 1;
      }
      return "";
    }

    return anchors.map((anchor) => {
      const text = shortText(anchor.textContent || "");
      const sectionHeading = shortText(findSectionHeading(anchor));
      const contextHay = normalizeText(sectionHeading);
      let contextHint = "";
      if (contextHay === "troskovnik") contextHint = "TROSKOVNIK";
      else if (contextHay === "tehnicke specifikacije") contextHint = "TEHN_SPEC";
      else if (contextHay === "prijedlog ugovora") contextHint = "UGOVOR";

      return {
        href: anchor.href || "",
        text,
        context_hint: contextHint,
        context_text: sectionHeading
      };
    });
  });

  const seen = new Set();
  return links.filter((item) => String(item.context_hint || "").toUpperCase() === "TROSKOVNIK")
    .filter((item) => {
    if (!item.href || seen.has(item.href)) return false;
    seen.add(item.href);
    return true;
  });
}

async function clickAndDownloadByHref(page, href, timeoutMs = 90000) {
  const downloadPromise = page.waitForEvent("download", { timeout: timeoutMs });
  const clicked = await page.evaluate((targetHref) => {
    const anchors = Array.from(document.querySelectorAll('a[href*="GetDocument.ashx"]'));
    const anchor = anchors.find((entry) => {
      try {
        return new URL(entry.href, window.location.href).href === targetHref;
      } catch {
        return false;
      }
    });
    if (!anchor) return false;
    anchor.click();
    return true;
  }, href);

  if (!clicked) throw new Error("Anchor for download not found in DOM.");
  return downloadPromise;
}

async function downloadBudgetFilesForTenders({
  tenderIds,
  configPath,
  outRoot,
  headed = false,
  fresh = false,
  statePath,
  onProgress
} = {}) {
  const ids = Array.isArray(tenderIds)
    ? tenderIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
    : [];
  if (!ids.length) {
    throw new Error("Missing tender IDs.");
  }

  const resolvedConfigPath = resolveEojnConfigPath({ configPathOverride: configPath || "" });
  const cfg = readJsonFile(resolvedConfigPath);
  const user = cfg.eojnUser || process.env.EOJN_USER || "";
  const pass = cfg.eojnPass || process.env.EOJN_PASS || "";
  if (!user || !pass) {
    throw new Error("Missing credentials. Set EOJN_USER/EOJN_PASS or config eojnUser/eojnPass.");
  }

  const baseUrl = String(cfg.baseUrl || "https://eojn.hr").replace(/\/+$/, "");
  const runOutRoot = outRoot
    ? path.resolve(String(outRoot))
    : path.resolve(process.cwd(), "out", "eojn_v1", "_dev_budget_pw", todayLocalISO());
  await ensureDir(runOutRoot);

  const storageStatePath = statePath
    ? path.resolve(String(statePath))
    : cfg.storageStatePath
      ? path.resolve(String(cfg.storageStatePath))
      : path.resolve(process.cwd(), "out", "eojn_v1", "_dev_budget_pw", "storageState.json");
  await ensureDir(path.dirname(storageStatePath));

  const browser = await chromium.launch({
    headless: !headed,
    args: ["--disable-blink-features=AutomationControlled"]
  });

  const contextOptions = { acceptDownloads: true };
  if (!fresh && await fileExists(storageStatePath)) {
    contextOptions.storageState = storageStatePath;
  }

  const context = await browser.newContext(contextOptions);
  await seedCookies(context);
  const page = await context.newPage();

  const report = {
    startedAt: new Date().toISOString(),
    tenderIds: ids,
    headed: Boolean(headed),
    fresh: Boolean(fresh),
    outRoot: runOutRoot,
    statePath: storageStatePath,
    tenders: []
  };

  try {
    for (const tenderId of ids) {
      const tenderDir = path.join(runOutRoot, `tender_${tenderId}`);
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
        onProgress && await onProgress({ tenderId, stage: "contacting_eojn", message: `Opening tender ${tenderId}` });
        const auth = await openTenderEnsureAuth(page, { tenderId, baseUrl, user, pass, outDir: tenderDir });
        if (!auth.ok) {
          item.errors.push(auth.reason || "AUTH_FAILED");
          report.tenders.push(item);
          continue;
        }

        await context.storageState({ path: storageStatePath });
        await page.waitForTimeout(800);

        const links = await collectBudgetLinks(page);
        item.linksFound = links.length;
        onProgress && await onProgress({ tenderId, stage: "budget_links_found", message: `Budget links discovered for tender ${tenderId}: ${links.length}` });

        if (!links.length) {
          await saveSnapshot(page, tenderDir, `tender_${tenderId}_no_budget_links`);
          item.errors.push("NO_BUDGET_LINKS");
          report.tenders.push(item);
          continue;
        }

        for (let index = 0; index < links.length; index += 1) {
          const link = links[index];
          onProgress && await onProgress({
            tenderId,
            stage: "downloading_budget",
            message: `Tender ${tenderId} downloading ${index + 1}/${links.length}: ${link.text || "(no text)"}`
          });

          try {
            const download = await clickAndDownloadByHref(page, link.href, 90000);
            const suggested = download.suggestedFilename();
            const safeName = suggested || `tender_${tenderId}_budget_${index + 1}.bin`;
            const targetPath = path.join(tenderDir, safeName);
            await download.saveAs(targetPath);
            const stat = await fsp.stat(targetPath);

            item.filesSaved.push({
              fileName: safeName,
              bytes: stat.size,
              sourceHrefMasked: maskTokenInUrl(link.href)
            });
          } catch (err) {
            item.errors.push(`DOWNLOAD_FAILED:${err && err.message ? err.message : String(err)}`);
          }
        }

        item.ok = item.filesSaved.length > 0;
      } catch (err) {
        item.errors.push(err && err.message ? err.message : String(err));
      }

      item.endedAt = new Date().toISOString();
      report.tenders.push(item);
    }
  } finally {
    report.endedAt = new Date().toISOString();
    report.okCount = report.tenders.filter((item) => item.ok).length;
    report.failCount = report.tenders.length - report.okCount;
    const reportPath = path.join(runOutRoot, "batch_report.json");
    await fsp.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
    report.reportPath = reportPath;

    try {
      await context.storageState({ path: storageStatePath });
    } catch (_) {
      // ignore storage state persist failure during cleanup
    }
    await browser.close();
  }

  return report;
}

async function downloadBudgetFilesForTender(options = {}) {
  const report = await downloadBudgetFilesForTenders({
    ...options,
    tenderIds: [Number(options && options.tenderId)]
  });
  return {
    report,
    tender: Array.isArray(report.tenders) ? report.tenders[0] || null : null
  };
}

module.exports = {
  downloadBudgetFilesForTender,
  downloadBudgetFilesForTenders
};
