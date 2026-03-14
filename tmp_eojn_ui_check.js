
    const out = document.getElementById("out");
    const mode = document.getElementById("mode");
    const dry = document.getElementById("dry");
    const btnStatus = document.getElementById("btnStatus");
    const btnRun = document.getElementById("btnRun");
    const btnRefreshWorklist = document.getElementById("btnRefreshWorklist");
    const activeCycleLine = document.getElementById("activeCycleLine");
    const topSummaryOut = document.getElementById("topSummaryOut");
    const statLastIngest = document.getElementById("statLastIngest");
    const statLastIngestSub = document.getElementById("statLastIngestSub");
    const statWatermarks = document.getElementById("statWatermarks");
    const statWatermarksSub = document.getElementById("statWatermarksSub");
    const statUnresolved = document.getElementById("statUnresolved");
    const statUnresolvedSub = document.getElementById("statUnresolvedSub");
    const btnL2Start = document.getElementById("btnL2Start");
    const btnL2Refresh = document.getElementById("btnL2Refresh");
    const l2RunDate = document.getElementById("l2RunDate");
    const maxItems = document.getElementById("maxItems");
    const retryCount = document.getElementById("retryCount");
    const timeoutMs = document.getElementById("timeoutMs");
    const jitterMinMs = document.getElementById("jitterMinMs");
    const jitterMaxMs = document.getElementById("jitterMaxMs");
    const delayMs = document.getElementById("delayMs");
    const enableDownload = document.getElementById("enableDownload");
    const l2Progress = document.getElementById("l2Progress");
    const l2StatusLine = document.getElementById("l2StatusLine");
    const btnL2ViewRefresh = document.getElementById("btnL2ViewRefresh");
    const btnL1ViewRefresh = document.getElementById("btnL1ViewRefresh");
    const btnL1Recompute = document.getElementById("btnL1Recompute");
    const l1RunDate = document.getElementById("l1RunDate");
    const l1ViewSet = document.getElementById("l1ViewSet");
    const l1SummaryOut = document.getElementById("l1SummaryOut");
    const l1QueueTableBody = document.getElementById("l1QueueTableBody");
    const btnL2RerunSelected = document.getElementById("btnL2RerunSelected");
    const tenderTableBody = document.getElementById("tenderTableBody");
    const noticeTableBody = document.getElementById("noticeTableBody");
    const showInactiveRows = document.getElementById("showInactiveRows");
    const filterDecision = document.getElementById("filterDecision");
    const filterLayer2 = document.getElementById("filterLayer2");
    const filterText = document.getElementById("filterText");
    const reviewDecision = document.getElementById("reviewDecision");
    const reviewReason = document.getElementById("reviewReason");
    const reviewNote = document.getElementById("reviewNote");
    const reviewSummaryOut = document.getElementById("reviewSummaryOut");
    const btnReviewSave = document.getElementById("btnReviewSave");
    const btnReviewLoad = document.getElementById("btnReviewLoad");
    const reviewTenderLine = document.getElementById("reviewTenderLine");
    const reviewSavedLine = document.getElementById("reviewSavedLine");
    let l2Timer = null;
    let l2ExpectedRunId = "";
    let l2ViewRows = [];
    let selectedTenderId = 0;
    let currentRunDateYmd = "";

    function escapeHtml(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;");
    }

    function show(data) { out.textContent = JSON.stringify(data, null, 2); }

    async function fetchJson(url, opts) {
      const res = await fetch(url, { ...(opts || {}), cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || ("HTTP " + res.status));
      return json;
    }

    function formatDecisionPill(decision) {
      const d = String(decision || "").trim();
      if (!d) return '<span class="pill pending">PENDING</span>';
      const cls = d === "WATCH" ? "watch" : (d === "REJECT" ? "reject" : "hold");
      return `<span class="pill ${cls}">${escapeHtml(d)}</span>`;
    }

    function formatLayer2Cell(row) {
      const status = String(row.layer2_status || "PENDING");
      const inc = row.layer2_incidence === null || row.layer2_incidence === undefined ? "-" : Number(row.layer2_incidence).toFixed(4);
      const label = String(row.layer2_label || "-");
      return `${escapeHtml(status)} / ${escapeHtml(label)} / ${inc}`;
    }

    function renderTopSummary(summary) {
      const ingest = summary && summary.last_successful_ingest ? summary.last_successful_ingest : null;
      const watermarks = summary && summary.current_watermarks ? summary.current_watermarks : {};
      const unresolved = Number(summary && summary.unresolved_decision_count || 0);
      statLastIngest.textContent = ingest && ingest.run_date_ymd ? String(ingest.run_date_ymd) : "-";
      statLastIngestSub.textContent = ingest && ingest.completed_at ? `${String(ingest.mode || "")}, ${String(ingest.completed_at || "")}` : "No successful ingest yet";
      statWatermarks.textContent = `${String(watermarks.procurements_notice_publish_date || "-")} / ${String(watermarks.notices_publish_date || "-")}`;
      statWatermarksSub.textContent = "procurements / notices";
      statUnresolved.textContent = String(unresolved);
      statUnresolvedSub.textContent = `${String(summary && summary.unresolved_oldest_publish_date || "-")} -> ${String(summary && summary.unresolved_newest_publish_date || "-")}`;
      topSummaryOut.textContent = JSON.stringify(summary || {}, null, 2);
    }

    btnStatus.onclick = async () => {
      try {
        const s = await fetchJson("/api/eojn/v1/status");
        renderTopSummary(s && s.summary ? s.summary : {});
        show(s);
        const ac = s && s.active_cycle ? s.active_cycle : null;
        activeCycleLine.textContent = ac && ac.run_date_ymd ? `Active cycle: ${ac.run_date_ymd} (${ac.updated_at || ""})` : "Active cycle: n/a";
      } catch (e) {
        topSummaryOut.textContent = JSON.stringify({ error: String(e) }, null, 2);
        show({ error: String(e) });
      }
    };

    btnRun.onclick = async () => {
      try {
        show(await fetchJson("/api/eojn/v1/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: mode.value, dry_run: dry.checked })
        }));
        await btnStatus.onclick();
        await refreshLayer1View();
        await refreshLayer2View();
      } catch (e) {
        show({ error: String(e) });
      }
    };

    function paintLayer2Status(s) {
      const pct = Number(s && s.progress_pct || 0);
      l2Progress.style.width = Math.max(0, Math.min(100, pct)) + "%";
      const phase = String(s && s.phase || "IDLE");
      const subphase = String(s && s.subphase || "").trim();
      const msg = String(s && s.message || "Idle");
      const done = Number(s && s.done || 0);
      const skipped = Number(s && s.skipped || 0);
      const reviewed = Number(s && s.reviewed || 0);
      const total = Number(s && s.total || 0);
      const phaseLabel = subphase ? `${phase}/${subphase}` : phase;
      l2StatusLine.textContent = `${phaseLabel} | done=${done}, skipped=${skipped}, reviewed=${reviewed}, total=${total} | ${pct}% | ${msg}`;
    }
    function renderLayer1Queue(rows) {
      l1QueueTableBody.innerHTML = "";
      for (const r of rows || []) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><a class="tender-link" href="https://eojn.hr/tender-eo/${Number(r.Id || 0)}" target="_blank" rel="noopener noreferrer">${Number(r.Id || 0)}</a></td>
          <td>${escapeHtml(r.NoticePublishDate || "")}</td>
          <td>${escapeHtml(r.ReferenceNumber || "")}</td>
          <td>${escapeHtml(r.Name || "")}</td>
          <td>${escapeHtml(r.topProgram || "")}</td>
          <td>${Number(r.topScore || 0).toFixed(3)}</td>
          <td>${escapeHtml(Array.isArray(r.reasons) ? r.reasons.join(", ") : "")}</td>
        `;
        l1QueueTableBody.appendChild(tr);
      }
    }

    async function refreshLayer1View() {
      try {
        const runDate = String(l1RunDate.value || "").trim();
        const url = runDate ? `/api/eojn/v1/layer1/view?run_date_ymd=${encodeURIComponent(runDate)}&_ts=${Date.now()}` : `/api/eojn/v1/layer1/view?_ts=${Date.now()}`;
        const data = await fetchJson(url);
        l1SummaryOut.textContent = JSON.stringify({
          run_date_ymd: data.run_date_ymd,
          out_dir: data.out_dir,
          view_set: String(l1ViewSet.value || "layer2_queue"),
          counts: data.counts,
          manifest_counts: data.manifest && data.manifest.run ? data.manifest.run.counts : null
        }, null, 2);
        const rows = String(l1ViewSet.value || "layer2_queue") === "shortlist" ? (Array.isArray(data.shortlist_rows) ? data.shortlist_rows : []) : (Array.isArray(data.layer2_queue_rows) ? data.layer2_queue_rows : []);
        renderLayer1Queue(rows);
      } catch (e) {
        l1SummaryOut.textContent = JSON.stringify({ error: String(e) }, null, 2);
        l1QueueTableBody.innerHTML = "";
      }
    }

    btnL1Recompute.onclick = async () => {
      try {
        const runDate = String(l1RunDate.value || "").trim();
        if (!runDate) {
          l1SummaryOut.textContent = JSON.stringify({ error: "Select Layer 1 run date first." }, null, 2);
          return;
        }
        const result = await fetchJson("/api/eojn/v1/layer1/recompute", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ run_date_ymd: runDate })
        });
        show(result);
        await refreshLayer1View();
      } catch (e) {
        show({ error: String(e) });
      }
    };

    async function refreshLayer2Status() {
      try {
        const s = await fetchJson(`/api/eojn/v1/layer2/status?_ts=${Date.now()}`);
        paintLayer2Status(s);
        const runMatches = !l2ExpectedRunId || String(s.run_id || "") === l2ExpectedRunId;
        if (s.active || !runMatches) {
          if (!l2Timer) l2Timer = setTimeout(loopLayer2, 2000);
        } else if (l2Timer) {
          clearTimeout(l2Timer);
          l2Timer = null;
        }
      } catch (e) {
        l2StatusLine.textContent = "ERROR | " + String(e);
      }
    }

    async function loopLayer2() {
      if (l2Timer) {
        clearTimeout(l2Timer);
        l2Timer = null;
      }
      await refreshLayer2Status();
    }

    btnL2Refresh.onclick = refreshLayer2Status;

    btnL2Start.onclick = async () => {
      try {
        const start = await fetchJson("/api/eojn/v1/layer2/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            run_date_ymd: String(l2RunDate.value || "").trim() || undefined,
            max_items: Number(maxItems.value || 15),
            retry_count: Number(retryCount.value || 1),
            item_timeout_ms: Number(timeoutMs.value || 300000),
            human_delay_min_ms: Number(jitterMinMs.value || 10000),
            human_delay_max_ms: Number(jitterMaxMs.value || 15000),
            simulated_step_delay_ms: Number(delayMs.value || 800),
            enable_download: Boolean(enableDownload.checked),
            force_reprocess: false
          })
        });
        l2ExpectedRunId = String(start.run_id || "");
        show(start);
        if (l2Timer) {
          clearTimeout(l2Timer);
          l2Timer = null;
        }
        await loopLayer2();
      } catch (e) {
        show({ error: String(e) });
      }
    };

    function renderNoticesForTender(tenderId) {
      noticeTableBody.innerHTML = "";
      const row = l2ViewRows.find((x) => Number(x.tender_id) === Number(tenderId));
      const notices = row && Array.isArray(row.notices) ? row.notices : [];
      for (const n of notices) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><a class="tender-link" href="https://eojn.hr/tender-eo/${Number(n.tender_id || 0)}" target="_blank" rel="noopener noreferrer">${Number(n.tender_id || 0)}</a></td>
          <td>${escapeHtml(n.publish_date || "")}</td>
          <td>${escapeHtml(String(n.doc_short || "") + " " + String(n.doc_name || ""))}</td>
          <td>${escapeHtml(n.notice_number || "")}</td>
          <td>${escapeHtml(String(n.modification_description || "").replace(/\n/g, " "))}</td>
        `;
        noticeTableBody.appendChild(tr);
      }
    }

    function renderReviewPanel() {
      const row = l2ViewRows.find((x) => Number(x.tender_id) === Number(selectedTenderId));
      if (!row) {
        reviewTenderLine.textContent = "No tender selected.";
        reviewSavedLine.textContent = "";
        reviewDecision.value = "HOLD";
        reviewNote.value = "";
        return;
      }
      reviewTenderLine.textContent = `${Number(row.tender_id || 0)} | ${String(row.reference_number || "")} | ${String(row.name || "")}`;
      reviewSavedLine.textContent = row.review_updated_at ? `Saved: ${String(row.review_decision || "")} / ${String(row.review_reason_code || "")} @ ${String(row.review_updated_at || "")}` : "No saved review yet.";
      reviewDecision.value = String(row.review_decision || "HOLD");
      if (row.review_reason_code) reviewReason.value = String(row.review_reason_code);
      reviewNote.value = String(row.review_reason_note || "");
    }
    function renderReviewSummary() {
      const decisionCounts = {};
      const reasonCounts = {};
      let reviewed = 0;
      let pending = 0;
      for (const row of l2ViewRows) {
        const decision = String(row.review_decision || "").trim();
        const reason = String(row.review_reason_code || "").trim();
        if (decision) { reviewed += 1; decisionCounts[decision] = (decisionCounts[decision] || 0) + 1; }
        else { pending += 1; }
        if (reason) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      }
      const topReasons = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([code, count]) => ({ code, count }));
      reviewSummaryOut.textContent = JSON.stringify({ run_date_ymd: currentRunDateYmd || null, queue_total: l2ViewRows.length, reviewed, pending, decisions: decisionCounts, top_reason_codes: topReasons }, null, 2);
    }

    async function loadReviewCatalog() {
      const data = await fetchJson("/api/eojn/v1/layer2/review/catalog");
      const rows = Array.isArray(data && data.reason_catalog) ? data.reason_catalog : [];
      reviewReason.innerHTML = "";
      for (const r of rows) {
        const opt = document.createElement("option");
        opt.value = String(r.code || "");
        opt.textContent = `${String(r.code || "")} | ${String(r.label || "")}`;
        reviewReason.appendChild(opt);
      }
      if (!reviewReason.value && rows.length) reviewReason.value = String(rows[0].code || "OTHER");
    }

    async function loadSelectedReview() {
      if (!selectedTenderId) return;
      try {
        const data = await fetchJson(`/api/eojn/v1/layer2/review?run_date_ymd=${encodeURIComponent(currentRunDateYmd)}&tender_id=${encodeURIComponent(selectedTenderId)}&_ts=${Date.now()}`);
        const decision = data && data.decision ? data.decision : null;
        if (decision) {
          reviewDecision.value = String(decision.decision_code || "HOLD");
          reviewReason.value = String(decision.reason_code || reviewReason.value || "OTHER");
          reviewNote.value = String(decision.reason_note || "");
          reviewSavedLine.textContent = `Saved: ${String(decision.decision_code || "")} / ${String(decision.reason_code || "")} @ ${String(decision.updated_at || "")}`;
        } else {
          reviewSavedLine.textContent = "No saved review yet.";
        }
      } catch (e) { show({ error: String(e) }); }
    }

    function filteredWorklistRows() {
      const decisionFilter = String(filterDecision.value || "all");
      const layer2Filter = String(filterLayer2.value || "all");
      const q = String(filterText.value || "").trim().toLowerCase();
      const visibleRows = l2ViewRows.filter((r) => {
        const inactive = String(r.watchlist_gate || "") === "CLOSED_NO_ACTION" || String(r.layer2_status || "") === "NEMA_TROSKOVNIK";
        if (!showInactiveRows.checked && inactive) return false;
        const decision = String(r.review_decision || "").trim();
        if (decisionFilter === "unresolved" && decision) return false;
        if (decisionFilter !== "all" && decisionFilter !== "unresolved" && decision !== decisionFilter) return false;
        const l2 = String(r.layer2_status || "PENDING");
        if (layer2Filter !== "all" && l2 !== layer2Filter) return false;
        if (q) {
          const hay = [r.tender_id, r.reference_number, r.name, r.review_reason_code, r.watchlist_gate, r.layer2_label].map((x) => String(x || "").toLowerCase()).join(" ");
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      return [...visibleRows].sort((a, b) => {
        const ad = String(a.review_decision || "").trim() ? 1 : 0;
        const bd = String(b.review_decision || "").trim() ? 1 : 0;
        if (ad !== bd) return ad - bd;
        const ai = a.layer2_incidence === null || a.layer2_incidence === undefined ? -1 : Number(a.layer2_incidence);
        const bi = b.layer2_incidence === null || b.layer2_incidence === undefined ? -1 : Number(b.layer2_incidence);
        if (bi !== ai) return bi - ai;
        return Number(b.top_score || 0) - Number(a.top_score || 0);
      });
    }

    function renderTenderTable() {
      tenderTableBody.innerHTML = "";
      const sorted = filteredWorklistRows();
      for (const r of sorted) {
        const tr = document.createElement("tr");
        const inactive = String(r.watchlist_gate || "") === "CLOSED_NO_ACTION" || String(r.layer2_status || "") === "NEMA_TROSKOVNIK";
        if (Number(r.tender_id) === Number(selectedTenderId)) tr.className = "pick";
        if (inactive) tr.className = `${tr.className ? tr.className + " " : ""}inactive`;
        const latestPublish = String(r.lifecycle && r.lifecycle.latest_publish_date || (r.notices && r.notices[0] && r.notices[0].publish_date) || "");
        tr.innerHTML = `
          <td><a class="tender-link" href="https://eojn.hr/tender-eo/${Number(r.tender_id || 0)}" target="_blank" rel="noopener noreferrer">${Number(r.tender_id || 0)}</a></td>
          <td>${escapeHtml(latestPublish)}</td>
          <td>${escapeHtml(r.reference_number || "")}</td>
          <td>${escapeHtml(r.name || "")}</td>
          <td>${Number(r.top_score || 0).toFixed(3)}</td>
          <td>${formatLayer2Cell(r)}</td>
          <td>${formatDecisionPill(r.review_decision)} ${escapeHtml(r.review_reason_code || "")}</td>
          <td>${escapeHtml(String(r.watchlist_gate || ""))}</td>
        `;
        tr.onclick = () => {
          selectedTenderId = Number(r.tender_id || 0);
          renderTenderTable();
          renderNoticesForTender(selectedTenderId);
          renderReviewPanel();
        };
        tenderTableBody.appendChild(tr);
      }
      if (!selectedTenderId && sorted.length) {
        selectedTenderId = Number(sorted[0].tender_id || 0);
        renderTenderTable();
        renderNoticesForTender(selectedTenderId);
        renderReviewPanel();
      }
    }

    async function refreshLayer2View() {
      try {
        const runDate = String(l2RunDate.value || "").trim();
        const url = runDate ? `/api/eojn/v1/layer2/view?run_date_ymd=${encodeURIComponent(runDate)}&_ts=${Date.now()}` : `/api/eojn/v1/layer2/view?_ts=${Date.now()}`;
        const data = await fetchJson(url);
        currentRunDateYmd = String(data && data.run_date_ymd ? data.run_date_ymd : runDate || "");
        l2ViewRows = Array.isArray(data && data.rows) ? data.rows : [];
        if (!l2ViewRows.some((x) => Number(x.tender_id) === Number(selectedTenderId))) selectedTenderId = 0;
        renderTenderTable();
        renderReviewPanel();
        renderReviewSummary();
      } catch (e) { show({ error: String(e) }); }
    }

    btnL2ViewRefresh.onclick = refreshLayer2View;
    btnRefreshWorklist.onclick = refreshLayer2View;
    btnL1ViewRefresh.onclick = refreshLayer1View;
    l1ViewSet.onchange = refreshLayer1View;
    showInactiveRows.onchange = renderTenderTable;
    filterDecision.onchange = renderTenderTable;
    filterLayer2.onchange = renderTenderTable;
    filterText.oninput = renderTenderTable;
    btnReviewLoad.onclick = loadSelectedReview;

    btnL2RerunSelected.onclick = async () => {
      if (!selectedTenderId) { show({ error: "No tender selected" }); return; }
      try {
        const start = await fetchJson("/api/eojn/v1/layer2/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            run_date_ymd: String(currentRunDateYmd || "").trim() || undefined,
            max_items: 1,
            tender_ids: [Number(selectedTenderId)],
            retry_count: Number(retryCount.value || 1),
            item_timeout_ms: Number(timeoutMs.value || 300000),
            human_delay_min_ms: Number(jitterMinMs.value || 10000),
            human_delay_max_ms: Number(jitterMaxMs.value || 15000),
            simulated_step_delay_ms: Number(delayMs.value || 800),
            enable_download: Boolean(enableDownload.checked),
            force_reprocess: true
          })
        });
        l2ExpectedRunId = String(start.run_id || "");
        show(start);
        if (l2Timer) { clearTimeout(l2Timer); l2Timer = null; }
        await loopLayer2();
      } catch (e) { show({ error: String(e) }); }
    };

    btnReviewSave.onclick = async () => {
      if (!selectedTenderId) { show({ error: "No tender selected" }); return; }
      try {
        const data = await fetchJson("/api/eojn/v1/layer2/review", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ run_date_ymd: currentRunDateYmd, tender_id: Number(selectedTenderId), decision_code: String(reviewDecision.value || "HOLD"), reason_code: String(reviewReason.value || "OTHER"), reason_note: String(reviewNote.value || "") })
        });
        show(data);
        await refreshLayer2View();
      } catch (e) { show({ error: String(e) }); }
    };

    loadReviewCatalog();
    btnStatus.click();
    refreshLayer1View();
    refreshLayer2Status();
    refreshLayer2View();
  