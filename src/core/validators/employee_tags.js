// src/core/validators/employee_tags.js
function normalizeKey(s) {
  return String(s ?? "").trim().toUpperCase();
}
function normalizeVal(s) {
  return String(s ?? "").trim().toUpperCase();
}

function parseKeyValueTags(raw, legacyGroupsSet) {
  const src = String(raw ?? "").trim();
  if (!src) return { tags: {}, warnings: ["EMPTY_TAGS"] };

  const upper = src.toUpperCase();

  // legacy: "INOX" -> { GRP: "INOX" }
  if (!src.includes("=") && legacyGroupsSet.has(upper)) {
    return { tags: { GRP: upper }, warnings: ["LEGACY_GRP_ONLY"] };
  }

  const tags = {};
  const warnings = [];
  const parts = src.split(";").map(x => x.trim()).filter(Boolean);

  for (const part of parts) {
    const m = part.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!m) {
      warnings.push(`INVALID_PAIR:${part}`);
      continue;
    }
    const k = normalizeKey(m[1]);
    const v = normalizeVal(m[2]);
    tags[k] = v; // last-wins
  }

  return { tags, warnings };
}

/**
 * rows: ERP "osebe" rows (raw)
 * contract: loaded JSON contract
 * returns: { normalized, errors, warnings, facts }
 */
function validateEmployeeTags(rows, contract) {
  const warnings = [];
  const errors = [];
  const normalized = [];

  const legacyGroups = new Set((contract.legacy_group_values || []).map(normalizeVal));

  const allowedByKey = {};
  for (const [k, spec] of Object.entries(contract.keys || {})) {
    allowedByKey[normalizeKey(k)] = new Set((spec.allowed || []).map(normalizeVal));
  }

  const facts = {
    input_rows: Array.isArray(rows) ? rows.length : 0,
    out_rows: 0,
    warnings: 0,
    errors: 0,
    grp_counts: {},
    mode_counts: {}
  };

  for (const r of (Array.isArray(rows) ? rows : [])) {
    const raw = r?.[contract.source_field] ?? "";
    const { tags, warnings: w } = parseKeyValueTags(raw, legacyGroups);

    // Contract defaults
    const grp = normalizeVal(tags.GRP || "");
    const mode = normalizeVal(tags.MODE || contract.keys?.MODE?.default || "FULL");

    // Unknown keys
    for (const k of Object.keys(tags)) {
      if (!contract.keys?.[k]) warnings.push({ type: "UNKNOWN_KEY", key: k, osebid: r?.osebid, raw });
    }

    // Validate allowed values
    if (grp && allowedByKey.GRP && !allowedByKey.GRP.has(grp)) {
      warnings.push({ type: "UNKNOWN_GRP", osebid: r?.osebid, value: grp, raw });
    }
    if (mode && allowedByKey.MODE && !allowedByKey.MODE.has(mode)) {
      warnings.push({ type: "UNKNOWN_MODE", osebid: r?.osebid, value: mode, raw });
    }

    // Missing required
    if (!grp && contract.keys?.GRP?.required) {
      warnings.push({ type: "MISSING_GRP", osebid: r?.osebid, raw });
    }

    // normalized row (non-destructive: keep original columns + add structured fields)
    const out = {
      ...r,
      tags_raw: String(raw ?? ""),
      tags,
      group_code: grp,               // canonical
      mode: (mode && allowedByKey.MODE?.has(mode)) ? mode : (contract.keys?.MODE?.default || "FULL"),
      tags_warnings: [...w]
    };

    normalized.push(out);

    // facts
    if (out.group_code) facts.grp_counts[out.group_code] = (facts.grp_counts[out.group_code] || 0) + 1;
    facts.mode_counts[out.mode] = (facts.mode_counts[out.mode] || 0) + 1;
  }

  facts.out_rows = normalized.length;
  facts.warnings = warnings.length;
  facts.errors = errors.length;

  return { normalized, warnings, errors, facts };
}

module.exports = { validateEmployeeTags };
