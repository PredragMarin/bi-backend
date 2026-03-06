// src/core/epr/recap.js
function sumPeriod(period_summary, key) {
  return period_summary.reduce((acc, p) => acc + (p[key] || 0), 0);
}

function topNBy(period_summary, key, top_n) {
  return period_summary
    .filter(p => (p[key] || 0) > 0)
    .slice()
    .sort((a, b) => (b[key] - a[key]) || (a.osebid - b.osebid))
    .slice(0, top_n);
}

function buildRecapLines({ run_facts, daily_summary, period_summary, config }) {
  const lines = [];
  const top_n = config.top_n || 5;

  // 1)
  lines.push({
    severity: "INFO",
    text: `Period ${run_facts.period_label}: ${run_facts.workdays_count} radnih dana, ${run_facts.holiday_days_count} praznika, ${run_facts.collective_leave_days_count} kolektivnih GO dana, ${run_facts.expected_presence_days_count} obračunskih dana.`,
    metrics_hint: { metric: "workdays_count", value: run_facts.workdays_count }
  });

  // 2)
  lines.push({
    severity: "INFO",
    text: `Očekivano efektivno prisustvo: ${run_facts.expected_effective_presence_minutes} min; ostvareno: ${run_facts.effective_presence_minutes} min.`,
    metrics_hint: { metric: "effective_presence_minutes", value: run_facts.effective_presence_minutes }
  });

  // 3)
  lines.push({
    severity: "INFO",
    text: `Sati po statusima: Kolektivni GO ${run_facts.collective_leave_minutes} min; Državni praznici ${run_facts.holiday_minutes} min.`
  });

  // Anomalije
  const missingDays = sumPeriod(period_summary, "missing_attendance_days_count");
  if (missingDays > 0) {
    lines.push({
      severity: "ACTION",
      text: `Neobjašnjeni izostanci: ${missingDays} radnih dana bez evidencije (potrebna akcija voditelja: standardizirani unos Bolovanje/Odobreni GO).`,
      metrics_hint: { metric: "missing_attendance_days", value: missingDays }
    });

    const topMissing = topNBy(period_summary, "missing_attendance_days_count", top_n);
    if (topMissing.length > 0) {
      const list = topMissing.map(p => `${p.osebid}(${p.missing_attendance_days_count}d)`).join(", ");
      lines.push({
        severity: "ACTION",
        text: `Radnici s neobjašnjenim izostankom (top ${top_n}): ${list}`
      });
    }
  }

  const openIntervals = sumPeriod(period_summary, "open_intervals_count");
  if (openIntervals > 0) {
    lines.push({
      severity: "WARN",
      text: `Otvoreni intervali: ${openIntervals} (provjeriti nedostajući timeizhod).`,
      metrics_hint: { metric: "open_intervals_count", value: openIntervals }
    });
  }

  const needsReview = sumPeriod(period_summary, "needs_review_count");
  if (needsReview > 0) {
    lines.push({
      severity: "WARN",
      text: `Zapisi za provjeru (needs_review): ${needsReview}.`,
      metrics_hint: { metric: "needs_review_count", value: needsReview }
    });
  }

  const lateNormTotal = period_summary.reduce((acc, p) => acc + (p.total_late_minutes_normalized || 0), 0);
  const earlyLeaveTotal = period_summary.reduce((acc, p) => acc + (p.total_early_leave_minutes_raw || 0), 0);

  lines.push({
    severity: "INFO",
    text: `Ukupno kašnjenja (normalizirano): ${lateNormTotal} min; raniji odlasci: ${earlyLeaveTotal} min.`,
    metrics_hint: { metric: "late_minutes_normalized_total", value: lateNormTotal }
  });

  const overtimeTotal = sumPeriod(period_summary, "total_overtime_work_minutes");
  lines.push({
    severity: "INFO",
    text: `Ukupno prekovremenih sati: ${overtimeTotal} min (zbroj dnevnih overtime minuta).`,
    metrics_hint: { metric: "overtime_minutes_total", value: overtimeTotal }
  });

  return lines.map(x => ({
    text: x.text,
    severity: x.severity,
    metrics_hint: x.metrics_hint
  }));
}

module.exports = { buildRecapLines };
