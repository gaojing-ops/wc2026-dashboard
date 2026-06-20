(function () {
  const raw = document.getElementById("dashboard-data");
  if (!raw) return;

  const payload = JSON.parse(raw.textContent);
  const matches = payload.matches || [];
  const splitLabels = payload.splitLabels || {};
  const stageLabels = payload.stageLabels || {};
  const translations = payload.translations || {};
  const DEFAULT_DEEPSEEK_QUESTION =
    "参考当前作战台数据，直接给北京时间今天、明天和未来30小时临近场次的下注结论：主推、小注、冷门小博、串关、波胆、回避。临近场次每场必须给方向，不要因为没进主攻候选就写暂无或待观察；不要复述闸门放行/不放行；后台状态只作为仓位和临场条件依据。只列已更新赛果后仍未开赛的场次；不要周六日，除非我明确问周末；全部用中文，不要表格、图标、英文队名或英文代码词。";

  const competitionFilter = document.getElementById("competition-filter");
  const keywordFilter = document.getElementById("keyword-filter");
  const splitFilter = document.getElementById("split-filter");
  const stageFilter = document.getElementById("stage-filter");
  const featureFilter = document.getElementById("feature-filter");
  const resultFilter = document.getElementById("result-filter");
  const tableBody = document.getElementById("match-table-body");
  const detailRoot = document.getElementById("match-detail-root");
  const matchCount = document.getElementById("match-count");
  const updateButton = document.getElementById("dashboard-update-button");
  const updateStatus = document.getElementById("dashboard-update-status");
  const deepseekStatus = document.getElementById("deepseek-status");
  const deepseekQuestion = document.getElementById("deepseek-question");
  const deepseekAskButton = document.getElementById("deepseek-ask-button");
  const deepseekResult = document.getElementById("deepseek-result");
  const manualExecutionModal = document.getElementById("manual-execution-modal");
  const manualExecutionForm = document.getElementById("manual-execution-form");
  const manualExecutionMatchId = document.getElementById("manual-execution-match-id");
  const manualExecutionMatch = document.getElementById("manual-execution-match");
  const manualExecutionSide = document.getElementById("manual-execution-side");
  const manualExecutionPlatform = document.getElementById("manual-execution-platform");
  const manualExecutionOdds = document.getElementById("manual-execution-odds");
  const manualExecutionStake = document.getElementById("manual-execution-stake");
  const manualExecutionTime = document.getElementById("manual-execution-time");
  const manualExecutionNotes = document.getElementById("manual-execution-notes");
  const manualExecutionAllowDuplicate = document.getElementById("manual-execution-allow-duplicate");
  const manualExecutionSubmit = document.getElementById("manual-execution-submit");
  const manualExecutionStatus = document.getElementById("manual-execution-status");
  const manualExecutionClose = document.getElementById("manual-execution-close");
  const manualExecutionCancel = document.getElementById("manual-execution-cancel");
  const recommendationCalendar = document.querySelector(".recommendation-calendar");
  const recommendationFilterBar = document.querySelector(".recommendation-filter-bar");
  const recommendationScheduleBody = document.getElementById("recommendation-schedule-body");
  const recommendationClearFilter = document.getElementById("recommendation-clear-filter");
  const matchBrowserControls = [
    keywordFilter,
    competitionFilter,
    splitFilter,
    stageFilter,
    featureFilter,
    resultFilter,
  ];
  const hasMatchBrowser = Boolean(
    tableBody &&
      detailRoot &&
      matchCount &&
      matchBrowserControls.every(Boolean),
  );

  let selectedMatchId = matches.length ? matches[0].match_id : null;
  let recommendationDateFilter = "";
  let recommendationBucketFilter =
    recommendationFilterBar?.querySelector(".recommendation-filter-button.is-active")?.dataset
      .recommendationFilter || "all";
  let openRecommendationDetailId = "";
  let dashboardApiReady = false;
  let deepseekAutoAsked = false;

  function applyGamblingCopy() {
    document.title = "WC2026 推荐单";
    const hero = document.querySelector(".hero");
    if (!hero) return;
    const eyebrow = hero.querySelector(".eyebrow");
    const title = hero.querySelector("h1");
    const copy = hero.querySelector(".hero-copy");
    if (eyebrow) eyebrow.textContent = "WC2026 推荐单";
    if (title) title.textContent = "下一轮怎么下";
    if (copy) {
      copy.textContent = "红色先不下，绿色可下注，黄色只观察；所有内容按当前数据生成，不等于已经下注。";
    }
  }

  applyGamblingCopy();

  function setupGroupStandingsTabs() {
    const tabs = Array.from(document.querySelectorAll(".group-standings-tab"));
    const panels = Array.from(document.querySelectorAll(".group-standings-table-panel"));
    if (!tabs.length || !panels.length) return;
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const group = tab.dataset.standingsGroup || "";
        tabs.forEach((item) => {
          item.classList.toggle("is-active", item === tab);
          item.setAttribute("aria-selected", item === tab ? "true" : "false");
        });
        panels.forEach((panel) => {
          panel.hidden = panel.dataset.standingsPanel !== group;
        });
      });
    });
  }

  setupGroupStandingsTabs();

  function translate(text) {
    if (!text) return text;
    return translations[text] || text;
  }

  function localizeMatchup(text) {
    if (!text) return text;
    if (!text.includes(" vs ")) return translate(text);
    const [home, away] = text.split(" vs ");
    return `${translate(home)} 对 ${translate(away)}`;
  }

  function localizeStage(text) {
    if (!text) return text;
    const mapping = {
      "Group Stage": "小组赛",
      "Round of 16": "16 强淘汰赛",
      "Quarter-finals": "四分之一决赛",
      "Semi-finals": "半决赛",
      Final: "决赛",
    };
    if (mapping[text]) return mapping[text];
    const upper = text.toUpperCase();
    if (upper.includes("GROUP")) return "小组赛";
    if (upper.includes("ROUND OF 16")) return "16 强淘汰赛";
    if (upper.includes("QUARTER")) return "四分之一决赛";
    if (upper.includes("SEMI")) return "半决赛";
    if (upper.includes("FINAL")) return "决赛";
    return text;
  }

  function badgeClass(split) {
    return `badge badge-${split || "excluded"}`;
  }

  function prettyValue(value) {
    if (typeof value === "number") {
      if (Number.isInteger(value)) return String(value);
      return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    }
    if (value === null || value === undefined || value === "") return "-";
    return String(value);
  }

  function matchesKeyword(row, keyword) {
    if (!keyword) return true;
    const haystack = [
      row.home_team,
      row.away_team,
      row.competition,
      row.stage,
      row.venue,
      translate(row.home_team),
      translate(row.away_team),
      translate(row.competition),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(keyword.toLowerCase());
  }

  function filteredMatches() {
    if (!hasMatchBrowser) return [];
    return matches.filter((row) => {
      if (!matchesKeyword(row, keywordFilter.value.trim())) return false;
      if (competitionFilter.value && row.competition !== competitionFilter.value) return false;
      if (splitFilter.value && row.split !== splitFilter.value) return false;
      if (stageFilter.value && row.stage_bucket !== stageFilter.value) return false;
      if (featureFilter.value === "with" && !row.has_features) return false;
      if (featureFilter.value === "without" && row.has_features) return false;
      if (resultFilter.value === "unsettled" && row.result) return false;
      if (resultFilter.value && resultFilter.value !== "unsettled" && row.result !== resultFilter.value) return false;
      return true;
    });
  }

  function renderDetail(row) {
    if (!hasMatchBrowser) return;
    if (!row) {
      detailRoot.innerHTML = '<div class="detail-empty">当前没有可展示的比赛。</div>';
      return;
    }

    selectedMatchId = row.match_id;
    const highlights = row.feature_highlights || {};
    const featureRows = row.feature_rows || [];
    const featureTable = featureRows.length
      ? `
        <div class="feature-table-wrap">
          <table>
            <thead>
              <tr><th>特征</th><th>值</th></tr>
            </thead>
            <tbody>
              ${featureRows
                .map(
                  (feature) => `
                <tr>
                  <td>${feature.label}</td>
                  <td class="feature-value">${prettyValue(feature.value)}</td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `
      : '<div class="detail-empty" style="margin-top:16px">这场比赛当前没有对应的特征快照。</div>';

    detailRoot.innerHTML = `
      <div class="detail-head">
        <div>
          <h3>${translate(row.home_team)} 对 ${translate(row.away_team)}</h3>
          <div class="detail-meta">
            <span class="${badgeClass(row.split)}">${row.split_label}</span>
            <span class="badge">${row.result_label}</span>
            <span class="badge">${stageLabels[row.stage_bucket] || "其他阶段"}</span>
            <span class="badge">${row.status || "未知状态"}</span>
          </div>
        </div>
        <div class="cell-right">
          <div class="summary-note">比分</div>
          <div class="detail-score">${row.score}</div>
        </div>
      </div>
      <div class="detail-summary">
        <div class="summary-card">
          <span>赛事 / 阶段</span>
          <strong>${translate(row.competition) || "-"}</strong>
          <div class="summary-note">${localizeStage(row.stage) || "-"}</div>
        </div>
        <div class="summary-card">
          <span>比赛时间</span>
          <strong>${row.match_date || "-"}</strong>
          <div class="summary-note">${row.kickoff_time || "-"}</div>
        </div>
        <div class="summary-card">
          <span>ELO 差值</span>
          <strong>${prettyValue(highlights.elo_diff)}</strong>
          <div class="summary-note">主队 - 客队</div>
        </div>
        <div class="summary-card">
          <span>特征快照</span>
          <strong>${row.feature_count || 0} 项</strong>
          <div class="summary-note">${row.cutoff_time || "无 cutoff_time"}</div>
        </div>
        <div class="summary-card">
          <span>主队近 5 场积分</span>
          <strong>${prettyValue(highlights.home_points_per_match_5)}</strong>
          <div class="summary-note">距上场 ${prettyValue(highlights.home_days_since_last_match)} 天</div>
        </div>
        <div class="summary-card">
          <span>客队近 5 场积分</span>
          <strong>${prettyValue(highlights.away_points_per_match_5)}</strong>
          <div class="summary-note">距上场 ${prettyValue(highlights.away_days_since_last_match)} 天</div>
        </div>
      </div>
      ${featureTable}
    `;

    tableBody.querySelectorAll(".match-row").forEach((node) => {
      node.classList.toggle("is-active", node.dataset.matchId === row.match_id);
    });
  }

  function renderTable() {
    if (!hasMatchBrowser) return;
    const rows = filteredMatches();
    matchCount.textContent = `共 ${rows.length} 场`;

    if (!rows.length) {
      tableBody.innerHTML =
        '<tr><td colspan="5" class="empty-cell">没有匹配结果，请换一个筛选条件。</td></tr>';
      detailRoot.innerHTML = '<div class="detail-empty">当前筛选结果为空，先放宽条件再看单场详情。</div>';
      return;
    }

    if (!rows.some((row) => row.match_id === selectedMatchId)) {
      selectedMatchId = rows[0].match_id;
    }

    tableBody.innerHTML = rows
      .map(
        (row) => `
      <tr class="match-row ${row.match_id === selectedMatchId ? "is-active" : ""}" data-match-id="${row.match_id}">
        <td>${row.match_date}</td>
        <td>
          <strong>${translate(row.home_team)}</strong>
          <div class="summary-note">${translate(row.away_team)}</div>
        </td>
        <td>
          <div>${translate(row.competition) || "-"}</div>
          <div class="summary-note">${localizeStage(row.stage) || "-"}</div>
        </td>
        <td>
          <strong>${row.score}</strong>
          <div class="summary-note">${row.result_label}</div>
        </td>
        <td><span class="${badgeClass(row.split)}">${splitLabels[row.split] || "未纳入"}</span></td>
      </tr>
    `,
      )
      .join("");

    renderDetail(rows.find((row) => row.match_id === selectedMatchId) || rows[0]);
  }

  function setUpdateStatus(message, tone) {
    if (!updateStatus) return;
    updateStatus.textContent = message;
    updateStatus.dataset.tone = tone || "idle";
  }

  function recommendationMatchesBucket(row) {
    if (recommendationBucketFilter === "all") return true;
    if (recommendationBucketFilter === "bet") return row.dataset.hasBet === "true";
    if (recommendationBucketFilter === "recordable") return row.dataset.actionState === "recordable";
    if (recommendationBucketFilter === "candidate_watch") {
      return ["priority_watch", "standard_watch"].includes(row.dataset.triageBucket);
    }
    return row.dataset.triageBucket === recommendationBucketFilter;
  }

  function parseKickoffMs(value) {
    const text = String(value || "").trim();
    if (!text) return NaN;
    const normalized = /(?:z|[+-]\d\d:\d\d)$/i.test(text) ? text : `${text}Z`;
    return Date.parse(normalized);
  }

  function recommendationPrematchClosed(row) {
    if (!row || row.dataset.closed === "true") return true;
    const kickoffMs = parseKickoffMs(row.dataset.kickoffUtc);
    return Number.isFinite(kickoffMs) && kickoffMs <= Date.now();
  }

  function recommendationColumnCount() {
    return recommendationScheduleBody?.closest("table")?.querySelectorAll("thead th").length || 6;
  }

  function activeRecommendationFilterLabel() {
    if (!recommendationFilterBar || recommendationBucketFilter === "all") return "";
    const button = recommendationFilterBar.querySelector(
      `.recommendation-filter-button[data-recommendation-filter="${recommendationBucketFilter}"]`,
    );
    return button ? button.childNodes[0].textContent.trim() : recommendationBucketFilter;
  }

  function syncRecommendationControls() {
    if (recommendationCalendar) {
      recommendationCalendar.querySelectorAll(".recommendation-day").forEach((card) => {
        const isSelected = card.dataset.recommendationDate === recommendationDateFilter;
        card.classList.toggle("recommendation-day--selected", isSelected);
        card.setAttribute("aria-pressed", String(isSelected));
      });
    }

    if (recommendationFilterBar) {
      recommendationFilterBar.querySelectorAll(".recommendation-filter-button").forEach((button) => {
        const isActive = button.dataset.recommendationFilter === recommendationBucketFilter;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      });
    }

    if (recommendationClearFilter) {
      recommendationClearFilter.hidden = !recommendationDateFilter && recommendationBucketFilter === "all";
    }
  }

  function applyRecommendationFilters(options = {}) {
    if (!recommendationScheduleBody) return;

    recommendationScheduleBody.querySelectorAll(".calendar-empty-row").forEach((row) => row.remove());

    const itemRows = Array.from(
      recommendationScheduleBody.querySelectorAll(".recommendation-row[data-role='item']"),
    );
    const detailRows = Array.from(recommendationScheduleBody.querySelectorAll(".recommendation-detail-row"));
    const dayRows = Array.from(recommendationScheduleBody.querySelectorAll(".match-day-row[data-role='day']"));
    const visibleByDate = new Map();
    const visibleByDetailId = new Map();
    let visibleRows = 0;

    itemRows.forEach((row) => {
      const isPrematchClosed = recommendationPrematchClosed(row);
      if (isPrematchClosed) {
        row.dataset.closed = "true";
        row.hidden = true;
        visibleByDetailId.set(row.dataset.detailId, false);
        return;
      }
      const matchesDate = !recommendationDateFilter || row.dataset.matchDate === recommendationDateFilter;
      const isVisible = matchesDate && recommendationMatchesBucket(row);
      row.hidden = !isVisible;
      visibleByDetailId.set(row.dataset.detailId, isVisible);
      if (isVisible) {
        visibleRows += 1;
        const current = visibleByDate.get(row.dataset.matchDate) || { count: 0, stake: 0 };
        current.count += 1;
        current.stake += Number(row.dataset.stake || 0);
        visibleByDate.set(row.dataset.matchDate, current);
      }
    });

    if (openRecommendationDetailId && !visibleByDetailId.get(openRecommendationDetailId)) {
      openRecommendationDetailId = "";
    }

    itemRows.forEach((row) => {
      const isExpanded = Boolean(openRecommendationDetailId && row.dataset.detailId === openRecommendationDetailId);
      row.setAttribute("aria-expanded", String(isExpanded));
    });

    detailRows.forEach((row) => {
      const isOpen = row.dataset.detailId === openRecommendationDetailId && visibleByDetailId.get(row.dataset.detailId);
      row.hidden = !isOpen;
    });

    dayRows.forEach((row) => {
      const visibleSummary = visibleByDate.get(row.dataset.matchDate);
      row.hidden = !visibleSummary;
      const cell = row.querySelector("td");
      if (!cell) return;
      if (!recommendationDateFilter && recommendationBucketFilter === "all") {
        cell.textContent = row.dataset.defaultText || cell.textContent;
        return;
      }
      const stakeText = visibleSummary && visibleSummary.stake > 0 ? ` · 显示投入 ${Math.round(visibleSummary.stake)} 元` : "";
      cell.textContent = `${row.dataset.dayLabel || row.dataset.matchDate} · 当前筛选 ${visibleSummary ? visibleSummary.count : 0} 项${stakeText}`;
    });

    if (visibleRows === 0) {
      const filters = [];
      if (recommendationDateFilter) filters.push(recommendationDateFilter);
      const bucketLabel = activeRecommendationFilterLabel();
      if (bucketLabel) filters.push(bucketLabel);
      const prefix = filters.length ? `${filters.join(" · ")}：` : "";
      recommendationScheduleBody.insertAdjacentHTML(
        "beforeend",
        `<tr class="calendar-empty-row"><td colspan="${recommendationColumnCount()}" class="empty-cell">${prefix}没有匹配的比赛或下注建议。</td></tr>`,
      );
    }

    syncRecommendationControls();

    if (options.scroll) {
      const tableWrap = recommendationScheduleBody.closest(".table-wrap");
      if (tableWrap) tableWrap.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function clearRecommendationDayFilter() {
    recommendationDateFilter = "";
    recommendationBucketFilter = "all";
    openRecommendationDetailId = "";
    applyRecommendationFilters();
  }

  function setRecommendationDayFilter(selectedDate) {
    if (!recommendationCalendar || !recommendationScheduleBody || !selectedDate) return;

    recommendationDateFilter = selectedDate;
    openRecommendationDetailId = "";
    applyRecommendationFilters({ scroll: true });
  }

  function setRecommendationBucketFilter(filterValue) {
    recommendationBucketFilter = filterValue || "all";
    openRecommendationDetailId = "";
    applyRecommendationFilters({ scroll: true });
  }

  function initRecommendationCalendar() {
    if (recommendationClearFilter) {
      recommendationClearFilter.addEventListener("click", clearRecommendationDayFilter);
    }

    if (!recommendationCalendar || !recommendationScheduleBody) return;

    const defaultCard =
      recommendationCalendar.querySelector(".recommendation-day--today[data-recommendation-date]") ||
      recommendationCalendar.querySelector(".recommendation-day[data-recommendation-date]");
    recommendationDateFilter = defaultCard?.dataset.recommendationDate || "";

    recommendationCalendar.addEventListener("click", (event) => {
      const card = event.target.closest(".recommendation-day[data-recommendation-date]");
      if (!card) return;
      setRecommendationDayFilter(card.dataset.recommendationDate);
    });

    recommendationCalendar.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const card = event.target.closest(".recommendation-day[data-recommendation-date]");
      if (!card) return;
      event.preventDefault();
      setRecommendationDayFilter(card.dataset.recommendationDate);
    });
  }

  function initRecommendationFilterBar() {
    if (!recommendationFilterBar || !recommendationScheduleBody) return;

    recommendationFilterBar.addEventListener("click", (event) => {
      const button = event.target.closest(".recommendation-filter-button[data-recommendation-filter]");
      if (!button) return;
      setRecommendationBucketFilter(button.dataset.recommendationFilter);
    });
  }

  function toggleRecommendationDetail(row) {
    if (!row || row.hidden || !row.dataset.detailId) return;
    openRecommendationDetailId = openRecommendationDetailId === row.dataset.detailId ? "" : row.dataset.detailId;
    applyRecommendationFilters();
    if (openRecommendationDetailId) {
      window.setTimeout(() => {
        const detail = recommendationScheduleBody.querySelector(
          `.recommendation-detail-row[data-detail-id="${openRecommendationDetailId}"]`,
        );
        if (detail && !detail.hidden) detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 0);
    }
  }

  function initRecommendationRows() {
    if (!recommendationScheduleBody) return;

    recommendationScheduleBody.addEventListener("click", (event) => {
      if (event.target.closest("button, a, input, select, textarea")) return;
      const row = event.target.closest(".recommendation-row[data-detail-id]");
      if (!row || !recommendationScheduleBody.contains(row)) return;
      toggleRecommendationDetail(row);
    });

    recommendationScheduleBody.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const row = event.target.closest(".recommendation-row[data-detail-id]");
      if (!row || !recommendationScheduleBody.contains(row)) return;
      event.preventDefault();
      toggleRecommendationDetail(row);
    });

    applyRecommendationFilters();
  }

  function isLocalHttpMode() {
    return (
      (window.location.protocol === "http:" || window.location.protocol === "https:") &&
      ["127.0.0.1", "localhost"].includes(window.location.hostname)
    );
  }

  async function detectDashboardApi() {
    if (!isLocalHttpMode()) return false;
    try {
      const response = await fetch("/api/status", {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return false;
      const data = await response.json();
      return data && data.status === "ok" && data.service === "wc2026-dashboard";
    } catch (error) {
      return false;
    }
  }

  function staticUpdateMessage() {
    const serveCommand = ".\\.venv\\Scripts\\python.exe main.py dashboard serve --feature-version 0.1.2 --port 8765 --open";
    return `当前是静态浏览模式，不能从网页直接更新。请双击“打开WC2026仪表盘.cmd”，或运行 ${serveCommand}。`;
  }

  function staticDeepSeekMessage() {
    return "决策助手需要作战台服务模式。请用服务模式打开页面后再问。";
  }

  async function initUpdateAvailability() {
    if (!updateButton) return;
    updateButton.hidden = true;
    updateButton.disabled = true;
    dashboardApiReady = await detectDashboardApi();
    if (!dashboardApiReady) {
      setUpdateStatus(staticUpdateMessage(), "idle");
      return;
    }
    updateButton.hidden = false;
    updateButton.disabled = false;
    setUpdateStatus("服务模式已连接，可以直接扫描更新。", "success");
  }

  function summarizeUpdate(data) {
    const report = data.report || {};
    const bits = [];
    if (report.recommendations) bits.push(`主攻 ${report.recommendations.count} 注 / ${report.recommendations.stake} 元`);
    if (report.bankroll) bits.push(`本金 ${report.bankroll.current} 元`);
    if (report.pendingReviews !== undefined) bits.push(`待审核 ${report.pendingReviews}`);
    if (report.xgboostBackend) bits.push(`模型 ${report.xgboostBackend}`);
    return bits.length ? bits.join(" · ") : "更新完成";
  }

  async function runDashboardUpdate() {
    if (!updateButton) return;

    if (!dashboardApiReady) {
      dashboardApiReady = await detectDashboardApi();
    }
    if (!dashboardApiReady) {
      updateButton.hidden = true;
      setUpdateStatus(staticUpdateMessage(), "error");
      return;
    }

    updateButton.disabled = true;
    setUpdateStatus("正在扫描更新，可能需要 1-3 分钟。请保持服务运行。", "running");

    try {
      const response = await fetch("/api/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature_version: payload.featureVersion || "0.1.2" }),
      });

      const text = await response.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (error) {
        data = { error: "" };
      }

      if (!response.ok || data.status === "failed") {
        throw new Error(data.error || data.message || `更新接口返回 ${response.status}`);
      }

      setUpdateStatus(`${summarizeUpdate(data)}。页面即将刷新。`, "success");
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      setUpdateStatus(
        `网页更新失败：${error.message || "请确认服务仍在运行"}。`,
        "error",
      );
      updateButton.disabled = false;
    }
  }

  function setDeepSeekStatus(message, tone) {
    if (!deepseekStatus) return;
    deepseekStatus.textContent = message;
    deepseekStatus.dataset.tone = tone || "idle";
  }

  function showDeepSeekResult(answer, meta) {
    if (!deepseekResult) return;
    deepseekResult.hidden = false;
    deepseekResult.innerHTML = "";

    const answerNode = document.createElement("pre");
    answerNode.className = "deepseek-answer";
    answerNode.textContent = answer || "决策助手没有返回内容。";
    deepseekResult.appendChild(answerNode);

    if (meta) {
      const metaNode = document.createElement("div");
      metaNode.className = "deepseek-meta";
      const bits = [];
      if (meta.main_attack_count !== undefined) bits.push(`主攻：${meta.main_attack_count} 注`);
      if (meta.gate_summary) {
        bits.push(`放行 ${meta.gate_summary.go || 0} / 观察 ${meta.gate_summary.watch || 0} / 复核 ${meta.gate_summary.review || 0}`);
      }
      if (meta.run_record && meta.run_record.latest_file) {
        bits.push("后台已记录");
      }
      metaNode.textContent = bits.join(" · ");
      deepseekResult.appendChild(metaNode);
    }
  }

  function ensureDefaultDeepSeekQuestion() {
    if (!deepseekQuestion) return;
    if (!deepseekQuestion.value.trim()) {
      deepseekQuestion.value = DEFAULT_DEEPSEEK_QUESTION;
    }
  }

  async function fetchDeepSeekJson(url, options) {
    const response = await fetch(url, options);
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (error) {
      data = { error: text || error.message };
    }
    if (!response.ok) {
      throw new Error(data.error || data.message || `决策助手接口返回 ${response.status}`);
    }
    return data;
  }

  async function initDeepSeekAdvisor() {
    if (!deepseekAskButton || !deepseekQuestion || !deepseekStatus) return;
    ensureDefaultDeepSeekQuestion();
    deepseekAskButton.disabled = true;

    const apiReady = await detectDashboardApi();
    if (!apiReady) {
      setDeepSeekStatus(staticDeepSeekMessage(), "idle");
      return;
    }

    try {
      const data = await fetchDeepSeekJson("/api/deepseek/status", {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!data.configured) {
        setDeepSeekStatus("未配置决策助手密钥。", "error");
        return;
      }
      deepseekAskButton.disabled = false;
      setDeepSeekStatus("决策助手已连接。", "success");
      runDeepSeekAdvisor({ auto: true });
    } catch (error) {
      setDeepSeekStatus(`决策助手检测失败：${error.message}`, "error");
    }
  }

  async function runDeepSeekAdvisor(options = {}) {
    if (!deepseekAskButton || !deepseekQuestion) return;
    ensureDefaultDeepSeekQuestion();
    if (options.auto) {
      if (deepseekAutoAsked) return;
      deepseekAutoAsked = true;
    }
    const question = deepseekQuestion.value.trim();
    if (!question) {
      setDeepSeekStatus("先写一个问题。", "error");
      return;
    }

    deepseekAskButton.disabled = true;
    setDeepSeekStatus("决策助手正在生成执行单...", "running");

    try {
      const data = await fetchDeepSeekJson("/api/deepseek/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          feature_version: payload.featureVersion || "0.1.2",
        }),
      });
      showDeepSeekResult(data.answer, data.context);
      setDeepSeekStatus("执行单已生成并记录。", "success");
    } catch (error) {
      showDeepSeekResult(`调用失败：${error.message}`);
      setDeepSeekStatus(`决策助手调用失败：${error.message}`, "error");
    } finally {
      deepseekAskButton.disabled = false;
    }
  }

  function normalizeSideValue(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (["home", "h", "1", "主", "主胜"].includes(normalized)) return "home";
    if (["draw", "d", "x", "平", "平局"].includes(normalized)) return "draw";
    if (["away", "a", "2", "客", "客胜"].includes(normalized)) return "away";
    return "";
  }

  function sideLabel(side) {
    return { home: "主胜", draw: "平局", away: "客胜" }[side] || "";
  }

  function localDatetimeValue(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function datetimeLocalToIso(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString();
  }

  function setManualExecutionStatus(message, tone) {
    if (!manualExecutionStatus) return;
    manualExecutionStatus.textContent = message;
    manualExecutionStatus.dataset.tone = tone || "idle";
  }

  function closeManualExecutionModal() {
    if (!manualExecutionModal) return;
    manualExecutionModal.hidden = true;
    setManualExecutionStatus("");
  }

  function openManualExecutionModal(button) {
    if (!manualExecutionModal || !manualExecutionForm || !manualExecutionMatchId) return;
    const matchId = button.dataset.matchId || "";
    const matchName = button.dataset.match || "这场比赛";
    const pick = button.dataset.pick || "";
    const side = normalizeSideValue(button.dataset.side || "");
    const defaultPlatform = window.localStorage.getItem("wc2026ManualBetPlatform") || "manual";

    manualExecutionForm.reset();
    manualExecutionMatchId.value = matchId;
    if (manualExecutionMatch) {
      manualExecutionMatch.textContent = pick ? `${matchName} · 默认 ${pick}` : matchName;
    }
    if (manualExecutionSide) manualExecutionSide.value = side;
    if (manualExecutionPlatform) manualExecutionPlatform.value = defaultPlatform;
    if (manualExecutionOdds) manualExecutionOdds.value = button.dataset.odds || "";
    if (manualExecutionStake) manualExecutionStake.value = button.dataset.stake || "";
    if (manualExecutionTime) manualExecutionTime.value = localDatetimeValue();
    if (manualExecutionAllowDuplicate) manualExecutionAllowDuplicate.checked = false;
    if (manualExecutionNotes) {
      const gate = button.dataset.gateStatus || "";
      const state = button.dataset.actionState || "";
      manualExecutionNotes.value = `作战台手动登记；系统状态=${gate || "-"} / ${state || "-"}。`;
    }
    if (manualExecutionSubmit) manualExecutionSubmit.disabled = false;
    setManualExecutionStatus("");
    manualExecutionModal.hidden = false;
    window.setTimeout(() => {
      if (side && manualExecutionOdds?.value) {
        manualExecutionStake?.focus();
      } else if (!side) {
        manualExecutionSide?.focus();
      } else {
        manualExecutionOdds?.focus();
      }
    }, 0);
  }

  async function submitManualExecution(event) {
    event.preventDefault();
    if (!manualExecutionForm || !manualExecutionSubmit) return;

    const matchId = manualExecutionMatchId?.value || "";
    const side = normalizeSideValue(manualExecutionSide?.value || "");
    const odds = Number(manualExecutionOdds?.value || "");
    const stake = Number(manualExecutionStake?.value || "");
    const platform = (manualExecutionPlatform?.value || "manual").trim() || "manual";
    const notes = (manualExecutionNotes?.value || "").trim();

    if (!matchId) {
      setManualExecutionStatus("缺少比赛 ID，不能登记。", "error");
      return;
    }
    if (!side) {
      setManualExecutionStatus("先选择下注方向。", "error");
      return;
    }
    if (!Number.isFinite(odds) || odds <= 1) {
      setManualExecutionStatus("赔率必须大于 1。", "error");
      return;
    }
    if (!Number.isFinite(stake) || stake <= 0) {
      setManualExecutionStatus("金额必须大于 0。", "error");
      return;
    }

    manualExecutionSubmit.disabled = true;
    setManualExecutionStatus("正在写入真实账本...", "running");

    try {
      window.localStorage.setItem("wc2026ManualBetPlatform", platform);
      const response = await fetch("/api/execution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          match_id: matchId,
          side,
          odds,
          stake,
          platform,
          actor: "user",
          notes: `${notes}${notes ? "\n" : ""}手动确认已在外部下注：${sideLabel(side)} @ ${odds.toFixed(2)} / ${stake.toFixed(0)} 元。`,
          executed_at: datetimeLocalToIso(manualExecutionTime?.value || ""),
          allow_duplicate: Boolean(manualExecutionAllowDuplicate?.checked),
          manual_confirmed: true,
          feature_version: payload.featureVersion || "0.1.2",
        }),
      });

      const text = await response.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (error) {
        data = { error: text || error.message };
      }

      if (!response.ok || data.status === "failed" || data.status === "duplicate") {
        throw new Error(data.message || data.error || `执行接口返回 ${response.status}`);
      }

      setManualExecutionStatus(
        data.refresh_status === "failed"
          ? "已写入账本，但资金日报/页面刷新失败；稍后手动点“立即扫描更新”。"
          : "已写入账本，页面即将刷新。",
        data.refresh_status === "failed" ? "error" : "success",
      );
      setUpdateStatus("实单已登记到账本，正在刷新页面。", "success");
      window.setTimeout(() => window.location.reload(), 1000);
    } catch (error) {
      setManualExecutionStatus(`登记失败：${error.message}`, "error");
      setUpdateStatus(`实单登记失败：${error.message}`, "error");
      manualExecutionSubmit.disabled = false;
    }
  }

  if (hasMatchBrowser) {
    (payload.competitions || []).forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = translate(name);
      competitionFilter.appendChild(option);
    });

    matchBrowserControls.forEach((node) => {
      node.addEventListener("input", renderTable);
      node.addEventListener("change", renderTable);
    });

    tableBody.addEventListener("click", (event) => {
      const row = event.target.closest(".match-row");
      if (!row) return;
      const current = filteredMatches().find((item) => item.match_id === row.dataset.matchId);
      if (current) renderDetail(current);
    });
  }

  if (updateButton) {
    updateButton.addEventListener("click", runDashboardUpdate);
    initUpdateAvailability();
  }

  if (deepseekAskButton) {
    deepseekAskButton.addEventListener("click", runDeepSeekAdvisor);
    initDeepSeekAdvisor();
  }

  if (manualExecutionForm) {
    manualExecutionForm.addEventListener("submit", submitManualExecution);
  }

  [manualExecutionClose, manualExecutionCancel].forEach((button) => {
    if (button) button.addEventListener("click", closeManualExecutionModal);
  });

  if (manualExecutionModal) {
    manualExecutionModal.addEventListener("click", (event) => {
      if (event.target === manualExecutionModal) closeManualExecutionModal();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && manualExecutionModal && !manualExecutionModal.hidden) {
      closeManualExecutionModal();
    }
  });

  initRecommendationCalendar();
  initRecommendationFilterBar();
  initRecommendationRows();

  document.addEventListener("click", (event) => {
    const button = event.target.closest(".manual-execute-button");
    if (!button) return;
    openManualExecutionModal(button);
  });

  if (hasMatchBrowser) renderTable();
})();
