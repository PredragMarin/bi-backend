'use strict';

const path = require('path');
const { layer1Fetch } = require('./layer1_fetch');
const { layer1Score } = require('./layer1_score');
const { writeManifest } = require('./publish');

function parseArg(name) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : null;
}

(async () => {
  // --date=YYYY-MM-DD (optional); default jučer Europe/Zagreb
  const dateYmd = parseArg('date') || process.env.EOJN_DATE_YMD || null;

  const moduleDir = __dirname;
  const repoRoot = path.resolve(moduleDir, '..', '..', '..');
  const outBase = path.join(repoRoot, 'out', 'eojn_v1');

  const fetchResult = await layer1Fetch({
    outBase,
    moduleDir,
    dateYmd
  });

  const scoreResult = await layer1Score({
    outDir: fetchResult.outDir,
    moduleDir,
    rows: fetchResult.rows
  });

  await writeManifest({
    outDir: fetchResult.outDir,
    meta: {
      dateYmd: fetchResult.dateYmd,
      fetchedAt: fetchResult.fetchedAt,
      source: fetchResult.source,
      rowCount: fetchResult.rowCount,
      scoredCount: scoreResult.scoredCount,
      shortlistCount: scoreResult.shortlistCount
    }
  });

  console.log('[EOJN] OK', {
    date: fetchResult.dateYmd,
    rows: fetchResult.rowCount,
    shortlist: scoreResult.shortlistCount,
    outDir: fetchResult.outDir
  });
})().catch(err => {
  console.error('[EOJN] ERROR:', err && err.stack ? err.stack : err);
  process.exit(2);
});
