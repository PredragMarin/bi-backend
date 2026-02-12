'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

async function sha256File(filePath) {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function writeManifest({ outDir, meta }) {
  const fileNames = ['raw.json', 'scored.json', 'shortlist.json', 'layer2_queue.json'];
  const hashes = {};

  for (const name of fileNames) {
    const p = path.join(outDir, name);
    try {
      hashes[name] = await sha256File(p);
    } catch (_) {
      // ignore missing
    }
  }

  const manifest = {
    module: 'eojn_v1',
    createdAt: new Date().toISOString(),
    meta,
    hashes
  };

  await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

module.exports = { writeManifest };

