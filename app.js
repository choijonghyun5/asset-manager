/**
 * 개인 자산 관리 앱 — 5단계 (PWA / 순수 JS)
 * 이번 단계 범위: Google Drive 백업/복원 (js/drive.js), 모든 금액 입력창 천단위 콤마 포맷
 * (1~3단계: 데이터 구조 + CRUD + 디자인 시스템 + 홈/분석 화면은 이미 반영되어 있습니다.
 *  4단계 목표 달성일 예측 기능은 분석 탭의 "목표" 서브탭에 반영되어 있습니다.)
 */

// ===== 전역 상태 =====
const state = {
  assets: [],
  records: [],
  settings: defaultSettings(),
  activeTab: "home",
  detailAssetId: null,
  confirmDelete: null, // assetId 또는 "__ALL__"
  saveError: false,

  // 환율 상태 (3단계)
  fx: { rate: null, source: "manual", updatedAt: null, loading: true },

  // 분석 탭 하위 상태 (3단계)
  analysisTab: "composition", // composition | trend | stats | goal
  compositionView: "current", // current | compare
  trendPeriod: "3m", // 1m | 3m | 6m | 1y | all
  trendAssetId: "__ALL__",

  // 모달 상태
  allocModal: null, // { values, error }
  baselineModal: null, // { amount, date, error }
  driveModal: null, // { loading, error, backups, confirmId, restoring } (5단계)

  // 5단계: Google Drive 연결/백업 UI 상태
  drive: { email: null, busy: false, statusMessage: "" },

  // 폼 임시 상태 (재렌더링 시에도 값 유지, 타이핑 중에는 재렌더링하지 않음)
  addForm: { name: "", typeKey: null, amount: "", date: todayStr(), error: "" },

  // 자산 탭: 조회 중인 월 (YYYY-MM), 좌우 스와이프로 변경
  assetsMonth: monthKey(todayStr()),
  detailForm: { editing: false, name: "", typeKey: null, newAmount: "", newDate: todayStr(), error: "" },
};

const appBody = document.getElementById("app-body");
const tabBar = document.getElementById("tab-bar");
const modalRoot = document.getElementById("modal-root");

// ===== 다크 모드 =====
// 화면이 그려지기 전에 저장된 테마 설정을 최대한 빨리 반영해 깜빡임을 줄인다.
(function applyEarlyTheme() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const mode = parsed && parsed.settings && parsed.settings.themeMode;
    if (mode === "dark" || mode === "light") {
      document.documentElement.setAttribute("data-theme", mode);
    }
  } catch (e) {
    // 실패해도 DOMContentLoaded 이후 applyTheme()이 다시 적용하므로 무시해도 됨
  }
})();

function isSystemDark() {
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

function isDarkActive() {
  const mode = state.settings.themeMode || "system";
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return isSystemDark();
}

function applyTheme() {
  const mode = state.settings.themeMode || "system";
  if (mode === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", mode);
  }
  const meta = document.getElementById("theme-color-meta");
  if (meta) meta.setAttribute("content", isDarkActive() ? "#0d0d0d" : "#ffffff");
}

if (window.matchMedia) {
  const darkMq = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemThemeChange = () => {
    if ((state.settings.themeMode || "system") === "system") applyTheme();
  };
  if (darkMq.addEventListener) darkMq.addEventListener("change", onSystemThemeChange);
  else if (darkMq.addListener) darkMq.addListener(onSystemThemeChange);
}

// ===== 초기화 =====
document.addEventListener("DOMContentLoaded", () => {
  const loaded = loadData();
  if (loaded) {
    state.assets = loaded.assets;
    state.records = loaded.records;
    state.settings = loaded.settings;
  }
  applyTheme();
  renderAll();
  registerServiceWorker();
  refreshExchangeRate();
});

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch((e) => {
      console.warn("서비스 워커 등록 실패:", e);
    });
  }
}

// ===== 환율 =====
async function refreshExchangeRate() {
  state.fx.loading = true;
  if (state.activeTab === "home" || state.activeTab === "settings") renderBody();
  const result = await fetchExchangeRate(state.settings.manualExchangeRate);
  state.fx = { rate: result.rate, source: result.source, updatedAt: result.updatedAt, loading: false };
  renderBody();
  if (state.activeTab === "add") bindAddScreenEvents();
  if (state.activeTab === "settings") bindSettingsEvents();
}

function getEffectiveRate() {
  if (state.fx && typeof state.fx.rate === "number" && state.fx.rate > 0) return state.fx.rate;
  return state.settings.manualExchangeRate || 1400;
}

function fxStatusText(fx) {
  if (!fx || fx.loading) return "환율 조회 중...";
  if (fx.source === "live") return `실시간 · ${relativeTimeKR(fx.updatedAt)} 업데이트`;
  if (fx.source === "cache") return `오프라인 · 마지막 환율 사용 (${relativeTimeKR(fx.updatedAt)})`;
  return "자동 조회 실패 · 수동 입력값 사용";
}

// ===== 저장 =====
function persist() {
  const ok = saveData({ assets: state.assets, records: state.records, settings: state.settings });
  state.saveError = !ok;
  scheduleAutoBackup();
}

function commit() {
  persist();
  renderAll();
}

// ===== 5단계: 금액 입력창 콤마 포맷 바인딩 =====
// input 이벤트마다 값에 천단위 콤마를 적용하고, 커서 위치를 자연스럽게 유지한다.
function bindAmountInput(el, onChange) {
  if (!el) return;
  el.addEventListener("input", () => {
    const prevValue = el.value;
    const prevCursor = el.selectionStart == null ? prevValue.length : el.selectionStart;
    const digitsBeforeCursor = prevValue.slice(0, prevCursor).replace(/[^\d]/g, "").length;

    const formatted = formatAmountInputValue(prevValue);
    el.value = formatted;

    let newCursor = formatted.length;
    if (digitsBeforeCursor === 0) {
      newCursor = 0;
    } else {
      let count = 0;
      for (let i = 0; i < formatted.length; i++) {
        if (/\d/.test(formatted[i])) {
          count++;
          if (count === digitsBeforeCursor) {
            newCursor = i + 1;
            break;
          }
        }
      }
    }
    try {
      el.setSelectionRange(newCursor, newCursor);
    } catch (e) {
      // 일부 브라우저/입력 상태에서 실패할 수 있으나 치명적이지 않음
    }

    onChange(formatted);
  });
}

// ===== 5단계: Google Drive 자동 백업 =====
let driveBackupDebounceTimer = null;

function buildBackupPayload() {
  return {
    app: "asset-tracker",
    version: 1,
    exportedAt: new Date().toISOString(),
    assets: state.assets,
    records: state.records,
    settings: state.settings,
  };
}

function scheduleAutoBackup() {
  if (!state.settings.driveAutoBackup || !isDriveConnected()) return;
  clearTimeout(driveBackupDebounceTimer);
  driveBackupDebounceTimer = setTimeout(() => {
    runBackupNow({ silent: true });
  }, 4000);
}

async function runBackupNow({ silent } = {}) {
  if (!isDriveConnected() || state.drive.busy) return;
  state.drive.busy = true;
  if (!silent) {
    state.drive.statusMessage = "백업 중...";
    if (state.activeTab === "settings") { renderBody(); bindSettingsEvents(); }
  }
  try {
    await uploadDriveBackup(buildBackupPayload());
    pruneOldDriveBackups();
    state.settings.driveLastBackupAt = new Date().toISOString();
    saveData({ assets: state.assets, records: state.records, settings: state.settings });
    state.drive.statusMessage = "";
  } catch (e) {
    state.drive.statusMessage = "백업 실패 · 잠시 후 다시 시도해주세요.";
  } finally {
    state.drive.busy = false;
    if (state.activeTab === "settings") { renderBody(); bindSettingsEvents(); }
  }
}

// ===== 파생 데이터: 기본 =====
function getRecordsByAsset(assetId) {
  return state.records
    .filter((r) => r.assetId === assetId)
    .sort((a, b) => (a.date < b.date ? 1 : -1)); // 최신순
}

function getCurrentValue(assetId) {
  const list = getRecordsByAsset(assetId);
  return list.length > 0 ? list[0].krwAmount : 0;
}

function getTotalAssets() {
  return state.assets.reduce((sum, a) => sum + getCurrentValue(a.id), 0);
}

// ===== 파생 데이터: 시점 기준 조회 (3단계) =====
function getAssetValueAsOf(assetId, dateStr) {
  const list = getRecordsByAsset(assetId).filter((r) => r.date <= dateStr);
  return list.length > 0 ? list[0].krwAmount : 0;
}

function getTotalAssetsAsOf(dateStr) {
  return state.assets.reduce((sum, a) => sum + getAssetValueAsOf(a.id, dateStr), 0);
}

function getFullTotalTimeline() {
  const dates = Array.from(new Set(state.records.map((r) => r.date))).sort();
  return dates.map((d) => ({ date: d, total: getTotalAssetsAsOf(d) }));
}

function computeMonthlyChange() {
  const total = getTotalAssets();
  const today = todayStr();
  const monthStart = startOfMonthStr(today);
  const beforeMonth = addDaysStr(monthStart, -1);
  const baseTotal = getTotalAssetsAsOf(beforeMonth);
  const changeAmt = total - baseTotal;
  const changePct = baseTotal > 0 ? (changeAmt / baseTotal) * 100 : null;
  return { total, baseTotal, changeAmt, changePct };
}

function getGrowthBaseline() {
  const gb = state.settings.growthBaseline;
  if (gb && typeof gb.amount === "number" && gb.amount > 0 && gb.date) {
    return { amount: gb.amount, date: gb.date, isCustom: true };
  }
  const timeline = getFullTotalTimeline();
  if (timeline.length > 0) {
    return { amount: timeline[0].total, date: timeline[0].date, isCustom: false };
  }
  return { amount: 0, date: null, isCustom: false };
}

function computeOverallGrowth() {
  const total = getTotalAssets();
  const baseline = getGrowthBaseline();
  const changeAmt = total - baseline.amount;
  const changePct = baseline.amount > 0 ? (changeAmt / baseline.amount) * 100 : null;
  return { total, baseline, changeAmt, changePct };
}

function getCurrentAllocation() {
  const byType = {};
  state.assets.forEach((a) => {
    const v = getCurrentValue(a.id);
    byType[a.typeKey] = (byType[a.typeKey] || 0) + v;
  });
  const total = Object.values(byType).reduce((s, v) => s + v, 0);
  const list = Object.keys(byType)
    .map((k) => ({ key: k, label: typeByKey(k).label, value: byType[k], pct: total > 0 ? (byType[k] / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
  return { total, list };
}

function hasTargetAllocation() {
  const t = state.settings.targetAllocation;
  return t && Object.values(t).some((v) => v > 0);
}

// ===== 렌더링 진입점 =====
function renderAll() {
  renderTabBar();
  renderBody();
  renderModal();
}

const TAB_ICONS = {
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9"/></svg>`,
  assets: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="5" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="5" cy="18" r="1.1" fill="currentColor" stroke="none"/><path d="M9 6h10M9 12h10M9 18h10"/></svg>`,
  analysis: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V10M10 19V5M16 19v-7M4 19h16"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v2.4M12 18.6V21M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M3 12h2.4M18.6 12H21M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/></svg>`,
};

const ADD_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;

function renderTabBar() {
  tabBar.innerHTML = TABS.map((t) => {
    if (t.key === "add") {
      return `
        <button class="tab-btn tab-btn-add" data-tab="add">
          <span class="add-circle">${ADD_ICON}</span>
          <span class="tab-label">${t.label}</span>
        </button>`;
    }
    return `
      <button class="tab-btn ${state.activeTab === t.key ? "active" : ""}" data-tab="${t.key}">
        ${TAB_ICONS[t.key]}
        <span>${t.label}</span>
      </button>`;
  }).join("");

  tabBar.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeTab = btn.dataset.tab;
      renderAll();
    });
  });
}

function renderBody() {
  switch (state.activeTab) {
    case "home":
      appBody.innerHTML = renderHome();
      bindHomeEvents();
      break;
    case "assets":
      appBody.innerHTML = renderAssetList();
      bindAssetListEvents();
      break;
    case "add":
      appBody.innerHTML = renderAddScreen();
      bindAddScreenEvents();
      break;
    case "analysis":
      appBody.innerHTML = renderAnalysis();
      bindAnalysisEvents();
      break;
    case "settings":
      appBody.innerHTML = renderSettings();
      bindSettingsEvents();
      break;
  }
  appBody.scrollTop = 0;
}

// ===== 홈 화면 (3단계) =====
function renderHome() {
  const total = getTotalAssets();
  const goal = state.settings.goalAmount || 0;
  const progress = goal > 0 ? (total / goal) * 100 : null;
  const mc = computeMonthlyChange();
  const growth = computeOverallGrowth();
  const fx = state.fx;

  if (state.assets.length === 0) {
    return `
      <div class="section-label">현재 자산</div>
      <div class="big-number">₩0</div>
      <div class="gap-32"></div>
      <div class="empty-state">
        <div class="empty-title">아직 등록된 자산이 없습니다</div>
        <div class="sub-text">첫 번째 자산을 추가해보세요</div>
      </div>
    `;
  }

  return `
    <div class="section-label">현재 자산</div>
    <div class="big-number">${formatKRW(total)}</div>

    <div class="gap-24"></div>
    ${
      goal > 0
        ? `
      <div class="goal-progress-card">
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <span class="sub-text">목표 ${formatKRW(goal)}</span>
          <span style="font-weight:700;font-size:15px;">${formatPercent(Math.min(progress, 999))}</span>
        </div>
        <div class="gap-8"></div>
        <div class="progress-track"><div class="progress-fill" style="width:${Math.min(Math.max(progress, 0), 100)}%"></div></div>
      </div>`
        : `<div class="placeholder-card">아직 목표 자산이 설정되지 않았습니다. 설정 탭에서 목표를 등록해보세요.</div>`
    }

    <div class="gap-24"></div>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">이번 달</div>
        <div class="stat-value ${mc.changeAmt < 0 ? "delta-negative" : ""}">${formatSignedKRW(mc.changeAmt)}</div>
        <div class="sub-text">${mc.changePct === null ? "이번 달 신규 기록" : formatSignedPercent(mc.changePct)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">전체 성장</div>
        <div class="stat-value ${growth.changePct !== null && growth.changePct < 0 ? "delta-negative" : ""}">${
    growth.changePct === null ? "-" : formatSignedPercent(growth.changePct)
  }</div>
        <div class="sub-text">${formatSignedKRW(growth.changeAmt)}</div>
      </div>
    </div>

    <div class="gap-24"></div>
    <div class="section-label">환율</div>
    <div class="fx-row">
      <div>
        <div class="fx-rate">USD/KRW ${fx && fx.rate ? formatRate(fx.rate) : "-"}</div>
        <div class="fx-meta">${fxStatusText(fx)}</div>
      </div>
      <button id="fx-refresh" class="btn btn-secondary" style="flex:none;padding:10px 14px;font-size:12.5px;">새로고침</button>
    </div>
  `;
}

function bindHomeEvents() {
  const btn = document.getElementById("fx-refresh");
  if (btn) btn.addEventListener("click", () => refreshExchangeRate());
}

// ===== 자산 목록 =====
const MONTH_ADD_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;

// 선택된 월(YYYY-MM)의 1일 / 말일 날짜 문자열
function assetsMonthFirstDay() {
  return `${state.assetsMonth}-01`;
}
function assetsMonthLastDay() {
  return addDaysStr(addMonthsStr(assetsMonthFirstDay(), 1), -1);
}
function isAssetsMonthCurrent() {
  return state.assetsMonth === monthKey(todayStr());
}

function renderAssetsMonthNav() {
  const firstDay = assetsMonthFirstDay();
  const isCurrent = isAssetsMonthCurrent();
  return `
    <div class="month-nav">
      <button type="button" id="month-prev" class="month-nav-btn" aria-label="이전 달">‹</button>
      <div class="month-nav-label">${monthLabelKR(firstDay)}${isCurrent ? "" : `<span class="month-nav-badge">기록 시점</span>`}</div>
      <button type="button" id="month-next" class="month-nav-btn" aria-label="다음 달" ${isCurrent ? "disabled" : ""}>›</button>
      <button type="button" id="month-add" class="month-add-btn" aria-label="이 달로 자산 추가">${MONTH_ADD_ICON}</button>
    </div>`;
}

function renderAssetList() {
  const monthNav = renderAssetsMonthNav();

  if (state.assets.length === 0) {
    return `
      ${monthNav}
      <div class="empty-state">
        <div class="empty-title">아직 등록된 자산이 없습니다</div>
        <div class="sub-text">첫 번째 자산을 추가해보세요</div>
      </div>`;
  }

  const lastDay = assetsMonthLastDay();
  const isCurrent = isAssetsMonthCurrent();
  const total = getTotalAssetsAsOf(lastDay);
  const rows = state.assets
    .map((a) => {
      const hasRecord = getRecordsByAsset(a.id).some((r) => r.date <= lastDay);
      const value = hasRecord ? getAssetValueAsOf(a.id, lastDay) : 0;
      const pct = total > 0 ? (value / total) * 100 : 0;
      const type = typeByKey(a.typeKey);
      return `
        <button class="asset-row" data-asset-id="${a.id}">
          <div>
            <div class="asset-name">${escapeHtml(a.name)}</div>
            <div class="asset-type">${type.label}</div>
          </div>
          <div>
            <div class="asset-value">${hasRecord ? formatKRW(value) : "기록 없음"}</div>
            ${hasRecord ? `<div class="asset-pct">${pct.toFixed(1)}%</div>` : ""}
          </div>
        </button>`;
    })
    .join("");

  return `
    ${monthNav}
    <div class="gap-16"></div>
    <div class="section-label">${isCurrent ? "자산 목록" : `${monthLabelKR(assetsMonthFirstDay())} 기준 자산`}</div>
    <div class="gap-12"></div>
    <div class="list-panel" id="assets-swipe-area">${rows}</div>
  `;
}

let assetsTouchStartX = null;
let assetsTouchStartY = null;

function handleAssetsTouchStart(e) {
  const t = e.changedTouches[0];
  assetsTouchStartX = t.clientX;
  assetsTouchStartY = t.clientY;
}

function handleAssetsTouchEnd(e) {
  if (assetsTouchStartX === null) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - assetsTouchStartX;
  const dy = t.clientY - assetsTouchStartY;
  assetsTouchStartX = null;
  assetsTouchStartY = null;
  if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
  // 왼쪽으로 스와이프 → 다음 달, 오른쪽으로 스와이프 → 이전 달
  changeAssetsMonth(dx < 0 ? 1 : -1);
}

function changeAssetsMonth(delta) {
  const nextKey = monthKey(addMonthsStr(assetsMonthFirstDay(), delta));
  if (nextKey > monthKey(todayStr())) return; // 미래 달로는 이동하지 않음
  state.assetsMonth = nextKey;
  renderBody();
  bindAssetListEvents();
}

function bindAssetListEvents() {
  appBody.querySelectorAll("[data-asset-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.detailAssetId = btn.dataset.assetId;
      state.detailForm = {
        editing: false,
        name: "",
        typeKey: null,
        newAmount: "",
        newDate: todayStr(),
        error: "",
      };
      renderModal();
    });
  });

  const prevBtn = document.getElementById("month-prev");
  if (prevBtn) prevBtn.addEventListener("click", () => changeAssetsMonth(-1));
  const nextBtn = document.getElementById("month-next");
  if (nextBtn && !nextBtn.disabled) nextBtn.addEventListener("click", () => changeAssetsMonth(1));
  const addBtn = document.getElementById("month-add");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      state.addForm.date = assetsMonthFirstDay();
      state.activeTab = "add";
      renderAll();
    });
  }

  const swipeArea = document.getElementById("assets-swipe-area");
  if (swipeArea) {
    swipeArea.addEventListener("touchstart", handleAssetsTouchStart, { passive: true });
    swipeArea.addEventListener("touchend", handleAssetsTouchEnd, { passive: true });
  }
}

// ===== 자산 추가 화면 =====
function renderTypeGrid(selectedKey, groupClass) {
  return `
    <div class="type-grid" data-group="${groupClass}">
      ${ASSET_TYPES.map(
        (t) => `
        <button type="button" class="type-chip ${selectedKey === t.key ? "selected" : ""}" data-type-key="${t.key}">
          ${t.label}
        </button>`
      ).join("")}
    </div>`;
}

function renderAddScreen() {
  const f = state.addForm;
  const type = f.typeKey ? typeByKey(f.typeKey) : null;

  return `
    <div class="section-label">자산 종류</div>
    ${renderTypeGrid(f.typeKey, "add")}

    <div class="gap-24"></div>
    <div class="section-label">자산 이름</div>
    <input id="add-name" class="input" placeholder="예: 주거래 통장" value="${escapeHtml(f.name)}" />

    <div class="gap-20"></div>
    <div class="section-label">금액${type ? ` (${type.currency === "USD" ? "달러" : "원화"})` : ""}</div>
    <input id="add-amount" class="input" type="text" inputmode="decimal"
      placeholder="${type && type.currency === "USD" ? "예: 10,000" : "예: 5,000,000"}"
      value="${escapeHtml(f.amount)}" />
    ${type && type.currency === "USD" ? `<div class="helper-text" id="add-usd-preview"></div>` : ""}

    <div class="gap-20"></div>
    <div class="section-label">입력 날짜</div>
    <input id="add-date" class="input" type="date" value="${f.date}" />
    <div class="helper-text">자산 탭에서 좌우로 스와이프해 다른 달로 이동한 뒤 +를 누르면, 해당 월 1일로 날짜가 자동 입력돼요.</div>

    ${f.error ? `<div class="error-text">${escapeHtml(f.error)}</div>` : ""}

    <div class="gap-24"></div>
    <button id="add-submit" class="btn btn-primary">자산 추가</button>
  `;
}

function updateAddUsdPreview() {
  const el = document.getElementById("add-usd-preview");
  if (!el) return;
  const type = state.addForm.typeKey ? typeByKey(state.addForm.typeKey) : null;
  if (!type || type.currency !== "USD") return;
  const amt = parseAmountInputValue(state.addForm.amount);
  const rate = getEffectiveRate();
  if (!amt || isNaN(amt) || amt <= 0) {
    el.textContent = `현재 환율 ${formatRate(rate)}원이 적용됩니다`;
    return;
  }
  el.textContent = `원화 환산 약 ${formatKRW(amt * rate)} (환율 ${formatRate(rate)})`;
}

function bindAddScreenEvents() {
  const nameInput = document.getElementById("add-name");
  const amountInput = document.getElementById("add-amount");
  const dateInput = document.getElementById("add-date");

  // 타이핑 중에는 상태만 갱신하고 재렌더링하지 않음 (커서 위치 유지)
  nameInput.addEventListener("input", (e) => (state.addForm.name = e.target.value));
  bindAmountInput(amountInput, (formatted) => {
    state.addForm.amount = formatted;
    updateAddUsdPreview();
  });
  dateInput.addEventListener("change", (e) => (state.addForm.date = e.target.value));

  appBody.querySelector('[data-group="add"]').querySelectorAll("[data-type-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.addForm.typeKey = btn.dataset.typeKey;
      renderBody();
      bindAddScreenEvents();
    });
  });

  document.getElementById("add-submit").addEventListener("click", handleAddAssetSubmit);
  updateAddUsdPreview();
}

function handleAddAssetSubmit() {
  const f = state.addForm;
  if (!f.name.trim()) {
    f.error = "자산 이름을 입력해주세요.";
    renderBody();
    bindAddScreenEvents();
    return;
  }
  if (!f.typeKey) {
    f.error = "자산 종류를 선택해주세요.";
    renderBody();
    bindAddScreenEvents();
    return;
  }
  const numAmount = parseAmountInputValue(f.amount);
  if (!f.amount || isNaN(numAmount) || numAmount <= 0) {
    f.error = "금액을 올바르게 입력해주세요.";
    renderBody();
    bindAddScreenEvents();
    return;
  }

  const type = typeByKey(f.typeKey);
  const rate = type.currency === "USD" ? getEffectiveRate() : 1;
  const krwAmount = type.currency === "USD" ? numAmount * rate : numAmount;

  const asset = {
    id: uid(),
    name: f.name.trim(),
    typeKey: f.typeKey,
    currency: type.currency,
    createdAt: f.date,
  };
  const record = {
    id: uid(),
    assetId: asset.id,
    date: f.date,
    amount: numAmount,
    exchangeRate: rate,
    krwAmount,
  };

  state.assets.push(asset);
  state.records.push(record);

  // 새 자산을 추가한 월을 자산 탭에서 바로 확인할 수 있도록 조회 월을 맞춰준다.
  state.assetsMonth = monthKey(f.date);
  state.addForm = { name: "", typeKey: null, amount: "", date: todayStr(), error: "" };
  state.activeTab = "assets";
  commit();
}

// ===== 분석 화면 (3단계) =====
function renderAnalysis() {
  return `
    <div class="segmented" id="analysis-seg">
      <button data-atab="composition" class="${state.analysisTab === "composition" ? "active" : ""}">비중</button>
      <button data-atab="trend" class="${state.analysisTab === "trend" ? "active" : ""}">추이</button>
      <button data-atab="stats" class="${state.analysisTab === "stats" ? "active" : ""}">통계</button>
      <button data-atab="goal" class="${state.analysisTab === "goal" ? "active" : ""}">목표</button>
    </div>
    <div class="gap-20"></div>
    <div id="analysis-content">${renderAnalysisContent()}</div>
  `;
}

function renderAnalysisContent() {
  switch (state.analysisTab) {
    case "composition":
      return renderComposition();
    case "trend":
      return renderTrend();
    case "stats":
      return renderStats();
    case "goal":
      return renderGoalPrediction();
    default:
      return "";
  }
}

function bindAnalysisEvents() {
  document.querySelectorAll("#analysis-seg [data-atab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.analysisTab = btn.dataset.atab;
      renderBody();
      bindAnalysisEvents();
    });
  });

  switch (state.analysisTab) {
    case "composition":
      bindCompositionEvents();
      break;
    case "trend":
      bindTrendEvents();
      break;
    case "stats":
      bindStatsEvents();
      break;
    case "goal":
      bindGoalPredictionEvents();
      break;
  }
}

// ----- 3-1. 비중 -----
function renderComposition() {
  const alloc = getCurrentAllocation();
  if (alloc.list.length === 0) {
    return `<div class="empty-state"><div class="empty-title">표시할 자산이 없습니다</div><div class="sub-text">자산을 추가하면 비중을 확인할 수 있어요</div></div>`;
  }

  const hasTarget = hasTargetAllocation();
  if (state.compositionView === "compare" && hasTarget) {
    return renderCompositionCompare(alloc);
  }

  const segments = alloc.list.map((item, i) => ({ value: item.value, color: greyAt(i, alloc.list.length) }));
  const donut = buildDonutSVG(segments, { size: 156, stroke: 22 });
  const legend = alloc.list
    .map(
      (item, i) => `
      <div class="legend-row">
        <span class="legend-swatch" style="background:${greyAt(i, alloc.list.length)}"></span>
        <span class="legend-label">${escapeHtml(item.label)}</span>
        <span class="legend-pct">${item.pct.toFixed(1)}%</span>
      </div>`
    )
    .join("");

  return `
    <div class="donut-wrap">
      ${donut}
      <div class="gap-20"></div>
      <div class="donut-legend">${legend}</div>
    </div>
    <div class="gap-24"></div>
    <button id="comp-goto-target" class="btn btn-secondary" style="width:100%;">
      ${hasTarget ? "목표 비중과 비교하기" : "목표 비중 설정하기"}
    </button>
  `;
}

function renderCompositionCompare(alloc) {
  const target = state.settings.targetAllocation || {};
  const targetList = Object.keys(target)
    .filter((k) => target[k] > 0)
    .map((k) => ({ key: k, label: typeByKey(k).label, value: target[k] }))
    .sort((a, b) => b.value - a.value);

  const curSegs = alloc.list.map((item, i) => ({ value: item.value, color: greyAt(i, alloc.list.length) }));
  const tgtSegs = targetList.map((item, i) => ({ value: item.value, color: greyAt(i, targetList.length) }));

  const curDonut = buildDonutSVG(curSegs, { size: 128, stroke: 18 });
  const tgtDonut = buildDonutSVG(tgtSegs, { size: 128, stroke: 18 });

  const curMap = {};
  alloc.list.forEach((x) => (curMap[x.key] = x.pct));

  const allKeys = Array.from(new Set([...alloc.list.map((x) => x.key), ...targetList.map((x) => x.key)]));
  const rows = allKeys
    .sort((a, b) => (target[b] || curMap[b] || 0) - (target[a] || curMap[a] || 0))
    .map((k) => {
      const cur = curMap[k] || 0;
      const tgt = target[k] || 0;
      return `<div class="compare-row">
        <span class="asset-type" style="flex:1;">${typeByKey(k).label}</span>
        <span class="sub-text" style="flex:none;">${cur.toFixed(1)}% → ${tgt.toFixed(1)}%</span>
      </div>`;
    })
    .join("");

  return `
    <div style="display:flex;gap:14px;justify-content:center;">
      <div style="text-align:center;">${curDonut}<div class="sub-text" style="margin-top:8px;">현재 비중</div></div>
      <div style="text-align:center;">${tgtDonut}<div class="sub-text" style="margin-top:8px;">목표 비중</div></div>
    </div>
    <div class="gap-24"></div>
    <div class="section-label">항목별 비교</div>
    <div class="gap-8"></div>
    <div class="list-panel">${rows}</div>
    <div class="gap-20"></div>
    <div class="btn-row">
      <button id="comp-back" class="btn btn-secondary">현재 비중만 보기</button>
      <button id="comp-edit-target" class="btn btn-secondary">목표 비중 수정</button>
    </div>
  `;
}

function bindCompositionEvents() {
  const gotoBtn = document.getElementById("comp-goto-target");
  if (gotoBtn) {
    gotoBtn.addEventListener("click", () => {
      if (hasTargetAllocation()) {
        state.compositionView = "compare";
        renderBody();
        bindAnalysisEvents();
      } else {
        openAllocModal();
      }
    });
  }
  const backBtn = document.getElementById("comp-back");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      state.compositionView = "current";
      renderBody();
      bindAnalysisEvents();
    });
  }
  const editBtn = document.getElementById("comp-edit-target");
  if (editBtn) editBtn.addEventListener("click", openAllocModal);
}

// ----- 3-2. 추이 -----
const TREND_PERIODS = [
  { key: "1m", label: "1개월", months: 1 },
  { key: "3m", label: "3개월", months: 3 },
  { key: "6m", label: "6개월", months: 6 },
  { key: "1y", label: "1년", months: 12 },
  { key: "all", label: "전체", months: null },
];

function getSeriesForAsset(assetId) {
  if (assetId === "__ALL__") {
    return getFullTotalTimeline().map((p) => ({ date: p.date, value: p.total }));
  }
  return getRecordsByAsset(assetId)
    .slice()
    .reverse()
    .map((r) => ({ date: r.date, value: r.krwAmount }));
}

function appendTodayPoint(series) {
  if (series.length === 0) return series;
  const today = todayStr();
  const last = series[series.length - 1];
  if (last.date < today) return [...series, { date: today, value: last.value }];
  return series;
}

function applyPeriodFilter(series, periodKey) {
  if (series.length === 0) return series;
  if (periodKey === "all") return appendTodayPoint(series);
  const period = TREND_PERIODS.find((p) => p.key === periodKey);
  const cutoff = addMonthsStr(todayStr(), -period.months);
  let anchor = null;
  const filtered = [];
  series.forEach((p) => {
    if (p.date < cutoff) anchor = p;
    else filtered.push(p);
  });
  const result = [];
  if (anchor) result.push({ date: cutoff, value: anchor.value });
  result.push(...filtered);
  if (result.length === 0) return appendTodayPoint(series);
  return appendTodayPoint(result);
}

function renderTrend() {
  if (state.assets.length === 0) {
    return `<div class="empty-state"><div class="empty-title">표시할 데이터가 없습니다</div><div class="sub-text">자산을 추가하면 변화 그래프를 볼 수 있어요</div></div>`;
  }

  const periodTabs = TREND_PERIODS.map(
    (p) => `<button data-period="${p.key}" class="${state.trendPeriod === p.key ? "active" : ""}">${p.label}</button>`
  ).join("");

  const assetOptions = [{ id: "__ALL__", label: "전체 자산" }, ...state.assets.map((a) => ({ id: a.id, label: a.name }))];
  const assetChips = assetOptions
    .map(
      (o) => `<button data-asset="${o.id}" class="${state.trendAssetId === o.id ? "active" : ""}">${escapeHtml(o.label)}</button>`
    )
    .join("");

  const rawSeries = getSeriesForAsset(state.trendAssetId);
  if (rawSeries.length === 0) {
    return `
      <div class="period-tabs">${periodTabs}</div>
      <div class="gap-12"></div>
      <div class="asset-select-row period-tabs">${assetChips}</div>
      <div class="gap-20"></div>
      <div class="empty-state"><div class="sub-text">기록이 없습니다</div></div>
    `;
  }

  const series = applyPeriodFilter(rawSeries, state.trendPeriod);
  const chart = buildLineChartSVG(series, {});

  const changeAmt = series.length >= 2 ? series[series.length - 1].value - series[0].value : 0;
  const changePct = series.length >= 2 && series[0].value > 0 ? (changeAmt / series[0].value) * 100 : null;

  return `
    <div class="period-tabs" id="trend-period-tabs">${periodTabs}</div>
    <div class="gap-12"></div>
    <div class="asset-select-row period-tabs" id="trend-asset-tabs">${assetChips}</div>
    <div class="gap-20"></div>
    <div class="chart-box">${chart}</div>
    <div class="gap-16"></div>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">선택 기간 변화</div>
        <div class="stat-value ${changeAmt < 0 ? "delta-negative" : ""}">${formatSignedKRW(changeAmt)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">변화율</div>
        <div class="stat-value ${changePct !== null && changePct < 0 ? "delta-negative" : ""}">${
    changePct === null ? "-" : formatSignedPercent(changePct)
  }</div>
      </div>
    </div>
  `;
}

function bindTrendEvents() {
  const periodBox = document.getElementById("trend-period-tabs");
  if (periodBox) {
    periodBox.querySelectorAll("[data-period]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.trendPeriod = btn.dataset.period;
        renderBody();
        bindAnalysisEvents();
      });
    });
  }
  const assetBox = document.getElementById("trend-asset-tabs");
  if (assetBox) {
    assetBox.querySelectorAll("[data-asset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.trendAssetId = btn.dataset.asset;
        renderBody();
        bindAnalysisEvents();
      });
    });
  }
}

// ----- 3-3. 통계 -----
function buildMonthlySeries() {
  const timeline = getFullTotalTimeline();
  if (timeline.length === 0) return [];
  const firstDate = timeline[0].date;
  const today = todayStr();
  const nowMonthKey = monthKey(today);
  let cursor = startOfMonthStr(firstDate);
  const buckets = [];
  let guard = 0;
  while (monthKey(cursor) <= nowMonthKey && guard < 1200) {
    guard++;
    const nextMonthStart = addMonthsStr(cursor, 1);
    const lastDayOfMonth = addDaysStr(nextMonthStart, -1);
    const asOfDate = lastDayOfMonth < today ? lastDayOfMonth : today;
    buckets.push({ month: monthKey(cursor), total: getTotalAssetsAsOf(asOfDate) });
    cursor = nextMonthStart;
  }
  return buckets;
}

function renderStats() {
  const timeline = getFullTotalTimeline();
  if (timeline.length === 0) {
    return `<div class="empty-state"><div class="empty-title">통계를 표시할 데이터가 없습니다</div><div class="sub-text">자산 기록이 쌓이면 통계가 계산됩니다</div></div>`;
  }

  const monthly = buildMonthlySeries();
  const changes = [];
  for (let i = 1; i < monthly.length; i++) {
    changes.push({ month: monthly[i].month, amt: monthly[i].total - monthly[i - 1].total });
  }
  let best = null;
  let worst = null;
  changes.forEach((c) => {
    if (!best || c.amt > best.amt) best = c;
    if (!worst || c.amt < worst.amt) worst = c;
  });
  const avgChange = changes.length ? changes.reduce((s, c) => s + c.amt, 0) / changes.length : 0;

  const maxTotal = Math.max(...timeline.map((p) => p.total));
  const minTotal = Math.min(...timeline.map((p) => p.total));

  const growth = computeOverallGrowth();

  return `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">최고 총자산</div>
        <div class="stat-value">${formatKRW(maxTotal)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">최저 총자산</div>
        <div class="stat-value">${formatKRW(minTotal)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">평균 월 증가액</div>
        <div class="stat-value ${avgChange < 0 ? "delta-negative" : ""}">${changes.length ? formatSignedKRW(avgChange) : "-"}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">누적 성장률</div>
        <div class="stat-value ${growth.changePct !== null && growth.changePct < 0 ? "delta-negative" : ""}">${
    growth.changePct === null ? "-" : formatSignedPercent(growth.changePct)
  }</div>
      </div>
    </div>

    <div class="gap-20"></div>
    <div class="list-panel">
      <div class="compare-row"><span class="sub-text">가장 많이 증가한 달</span><span class="asset-value">${
        best ? `${monthLabelKR(best.month + "-01")} ${formatSignedKRW(best.amt)}` : "-"
      }</span></div>
      <div class="compare-row"><span class="sub-text">가장 많이 감소한 달</span><span class="asset-value">${
        worst ? `${monthLabelKR(worst.month + "-01")} ${formatSignedKRW(worst.amt)}` : "-"
      }</span></div>
    </div>

    <div class="gap-24"></div>
    <div class="section-label">누적 성장률 기준값</div>
    <div class="fx-row">
      <div>
        <div class="fx-rate">${formatKRW(growth.baseline.amount)}</div>
        <div class="fx-meta">${growth.baseline.date ? formatDateKR(growth.baseline.date) : ""} ${
    growth.baseline.isCustom ? "· 직접 설정" : "· 최초 기록 기준"
  }</div>
      </div>
      <button id="baseline-edit" class="btn btn-secondary" style="flex:none;padding:10px 14px;font-size:12.5px;">기준 변경</button>
    </div>
    <div class="helper-text">이 통계는 지금까지 입력된 데이터를 기반으로 계산된 값입니다.</div>
  `;
}

function bindStatsEvents() {
  const btn = document.getElementById("baseline-edit");
  if (btn) btn.addEventListener("click", openBaselineModal);
}

// ----- 3-4. 목표 달성일 예측 (4단계) -----

// 지금까지의 월별 총자산 데이터를 바탕으로 한 평균 월 성장률(비율, 0.01 = 1%).
// 데이터가 부족하면(성장률을 계산할 수 있는 구간이 2개월 미만) null을 반환한다.
function computeAverageMonthlyGrowthRate() {
  const monthly = buildMonthlySeries();
  const rates = [];
  for (let i = 1; i < monthly.length; i++) {
    const prev = monthly[i - 1].total;
    const cur = monthly[i].total;
    if (prev > 0) rates.push((cur - prev) / prev);
  }
  if (rates.length < 2) return null;
  return rates.reduce((s, r) => s + r, 0) / rates.length;
}

// 매달 monthlyRate만큼 복리로 성장하고 monthlySavings만큼 추가 저축한다고 가정할 때
// current가 goal에 도달하기까지 걸리는 개월 수를 시뮬레이션한다.
// { reached: true, months, finalBalance } 또는 도달 불가능하면 { reached: false }
function simulateGoalReach(current, goal, monthlyRate, monthlySavings, maxMonths = 600) {
  if (goal <= 0) return { reached: false };
  if (current >= goal) return { reached: true, months: 0, finalBalance: current };

  let balance = current;
  for (let m = 1; m <= maxMonths; m++) {
    const next = balance * (1 + monthlyRate) + monthlySavings;
    // 잔액이 더 이상 늘지 않는다면(성장률 0 이하 + 추가 저축 0 이하) 영원히 도달 불가능
    if (next <= balance) return { reached: false };
    balance = next;
    if (balance >= goal) return { reached: true, months: m, finalBalance: balance };
  }
  return { reached: false };
}

// monthlyRate로 복리 성장 + monthlySavings 추가 저축을 months개월 진행했을 때의 잔액.
function projectBalance(current, monthlyRate, monthlySavings, months) {
  let balance = current;
  for (let i = 0; i < months; i++) {
    balance = balance * (1 + monthlyRate) + monthlySavings;
  }
  return balance;
}

function getEffectiveGrowthRateInfo() {
  const mode = state.settings.growthRateMode || "auto";
  const manualPercent = state.settings.manualGrowthRatePercent || 0;
  const autoRate = computeAverageMonthlyGrowthRate();

  if (mode === "zero") {
    return { rate: 0, note: "월 성장률 0% 기준으로 계산했어요.", usedFallback: false };
  }
  if (mode === "manual") {
    return {
      rate: manualPercent / 100,
      note: `직접 입력한 월 ${formatSignedPercent(manualPercent)} 성장률 기준으로 계산했어요.`,
      usedFallback: false,
    };
  }
  // auto
  if (autoRate === null) {
    return {
      rate: 0,
      note: "아직 자산 기록이 충분하지 않아 성장률을 계산하기 어려워요. 우선 0% 성장 기준으로 계산했어요 — 데이터가 더 쌓이거나, 직접 성장률을 입력하면 더 정확해져요.",
      usedFallback: true,
    };
  }
  return {
    rate: autoRate,
    note: `최근 자산 기록을 바탕으로 계산한 평균 월 ${formatSignedPercent(autoRate * 100)} 성장률 기준이에요.`,
    usedFallback: false,
  };
}

function renderGoalPrediction() {
  const goal = state.settings.goalAmount || 0;
  const total = getTotalAssets();

  if (goal <= 0) {
    return `
      <div class="placeholder-card">목표 자산을 먼저 설정하면 예상 달성일을 계산할 수 있어요.</div>
      <div class="gap-12"></div>
      <button id="goal-pred-go-settings" class="btn btn-secondary" style="width:100%;">설정에서 목표 자산 설정하기</button>
    `;
  }

  const monthlySavings = state.settings.monthlySavings || 0;
  const mode = state.settings.growthRateMode || "auto";
  const manualPercent = state.settings.manualGrowthRatePercent || 0;
  const rateInfo = getEffectiveGrowthRateInfo();

  const sim = simulateGoalReach(total, goal, rateInfo.rate, monthlySavings);
  const oneYearProjection = projectBalance(total, rateInfo.rate, monthlySavings, 12);

  let resultHtml = "";
  if (sim.reached && sim.months === 0) {
    resultHtml = `
      <div class="goal-progress-card">
        <div class="section-label">목표 달성 여부</div>
        <div class="big-number">이미 달성했어요</div>
        <div class="gap-8"></div>
        <div class="sub-text">현재 자산이 목표 금액 이상이에요.</div>
      </div>
    `;
  } else if (sim.reached) {
    const achieveDate = addMonthsStr(todayStr(), sim.months);
    resultHtml = `
      <div class="goal-progress-card">
        <div class="section-label">예상 목표 달성일</div>
        <div class="big-number">${formatYearMonthKR(achieveDate)}</div>
        <div class="gap-16"></div>
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-label">남은 기간</div>
            <div class="stat-value">${formatMonthsAsYM(sim.months)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">1년 후 예상 자산</div>
            <div class="stat-value">${formatKRW(oneYearProjection)}</div>
          </div>
        </div>
      </div>
    `;
  } else {
    resultHtml = `
      <div class="placeholder-card">현재 조건(성장률·월 저축액)으로는 50년 안에 목표를 달성하기 어려워요. 월 저축액을 늘리거나 성장률을 조정해보세요.</div>
      <div class="gap-16"></div>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">1년 후 예상 자산</div>
          <div class="stat-value">${formatKRW(oneYearProjection)}</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="section-label">목표 자산 대비 예측</div>
    <div class="list-panel">
      <div class="compare-row"><span class="sub-text">현재 자산</span><span class="asset-value">${formatKRW(total)}</span></div>
      <div class="compare-row"><span class="sub-text">목표 자산</span><span class="asset-value">${formatKRW(goal)}</span></div>
    </div>

    <div class="gap-24"></div>
    <div class="section-label">매월 저축(예정) 금액</div>
    <input id="goal-pred-savings" class="input" type="text" inputmode="decimal"
      placeholder="예: 500,000"
      value="${monthlySavings ? formatAmountInputValue(String(monthlySavings)) : ""}" />

    <div class="gap-20"></div>
    <div class="section-label">적용할 월 성장률</div>
    <div class="segmented" id="goal-pred-mode">
      <button data-mode="auto" class="${mode === "auto" ? "active" : ""}">자동 계산</button>
      <button data-mode="manual" class="${mode === "manual" ? "active" : ""}">직접 입력</button>
      <button data-mode="zero" class="${mode === "zero" ? "active" : ""}">0% 기준</button>
    </div>
    ${
      mode === "manual"
        ? `<div class="gap-12"></div>
           <input id="goal-pred-manual-rate" class="input" type="number" inputmode="decimal" step="0.1"
             placeholder="예: 0.5 (월 0.5%)" value="${manualPercent || ""}" />`
        : ""
    }
    <div class="helper-text">${escapeHtml(rateInfo.note)}</div>

    <div class="gap-24"></div>
    ${resultHtml}

    <div class="gap-16"></div>
    <div class="helper-text">이 예측은 지금까지 입력한 데이터를 바탕으로 계산한 예상값이며, 미래의 실제 자산을 보장하지 않아요.</div>
  `;
}

function bindGoalPredictionEvents() {
  const goSettingsBtn = document.getElementById("goal-pred-go-settings");
  if (goSettingsBtn) {
    goSettingsBtn.addEventListener("click", () => {
      state.activeTab = "settings";
      renderAll();
    });
    return;
  }

  bindAmountInput(document.getElementById("goal-pred-savings"), (formatted) => {
    const val = parseAmountInputValue(formatted);
    state.settings.monthlySavings = isNaN(val) || val < 0 ? 0 : val;
    persist(); // 재렌더링 없이 조용히 저장 (입력 포커스 유지)
  });

  document.querySelectorAll("#goal-pred-mode [data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.settings.growthRateMode = btn.dataset.mode;
      persist();
      renderBody();
      bindAnalysisEvents();
    });
  });

  const manualRateInput = document.getElementById("goal-pred-manual-rate");
  if (manualRateInput) {
    manualRateInput.addEventListener("input", (e) => {
      const val = Number(e.target.value);
      state.settings.manualGrowthRatePercent = isNaN(val) ? 0 : val;
      persist();
    });
    manualRateInput.addEventListener("change", () => {
      renderBody();
      bindAnalysisEvents();
    });
  }
}

// ===== 설정 화면 =====
function renderSettings() {
  const fx = state.fx;
  const themeMode = state.settings.themeMode || "system";
  return `
    <div class="section-label">화면 테마</div>
    <div class="segmented" id="theme-seg">
      <button data-theme-mode="system" class="${themeMode === "system" ? "active" : ""}">시스템 설정</button>
      <button data-theme-mode="light" class="${themeMode === "light" ? "active" : ""}">라이트</button>
      <button data-theme-mode="dark" class="${themeMode === "dark" ? "active" : ""}">다크</button>
    </div>
    <div class="helper-text">기기 설정을 따르거나, 라이트/다크 중 하나를 직접 고정할 수 있어요.</div>

    <div class="gap-32"></div>
    <div class="section-label">목표 자산</div>
    <input id="goal-input" class="input" type="text" inputmode="decimal"
      placeholder="예: 100,000,000"
      value="${state.settings.goalAmount ? formatAmountInputValue(String(state.settings.goalAmount)) : ""}" />
    <div class="helper-text">홈 화면 진행률 계산에 사용됩니다.</div>

    <div class="gap-32"></div>
    <div class="section-label">환율</div>
    <div class="fx-row">
      <div>
        <div class="fx-rate">USD/KRW ${fx && fx.rate ? formatRate(fx.rate) : "-"}</div>
        <div class="fx-meta">${fxStatusText(fx)}</div>
      </div>
      <button id="settings-fx-refresh" class="btn btn-secondary" style="flex:none;padding:10px 14px;font-size:12.5px;">새로고침</button>
    </div>
    <div class="gap-12"></div>
    <div class="section-label">수동 환율 (자동 조회 실패 시 사용)</div>
    <input id="rate-input" class="input" type="number" inputmode="decimal"
      value="${state.settings.manualExchangeRate}" />

    <div class="gap-32"></div>
    <div class="section-label">Google Drive 백업</div>
    ${renderDriveSection()}

    <div class="gap-32"></div>
    <div class="section-label">데이터</div>
    <button id="reset-btn" class="btn btn-danger" style="width:100%;">전체 데이터 초기화</button>

    ${state.saveError ? `<div class="error-text">저장 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.</div>` : ""}
  `;
}

// ----- 5단계: Google Drive 백업 UI -----
function renderDriveSection() {
  const connected = isDriveConnected();
  const d = state.drive;

  if (!connected) {
    return `
      <div class="placeholder-card">Google Drive에 연결하면 자산 데이터를 자동으로 백업하고, 다른 기기에서도 불러올 수 있어요.</div>
      <div class="gap-12"></div>
      <button id="drive-connect" class="btn btn-primary" ${d.busy ? "disabled" : ""}>${
    d.busy ? "연결 중..." : "Google 계정으로 연결"
  }</button>
      ${d.statusMessage ? `<div class="error-text">${escapeHtml(d.statusMessage)}</div>` : ""}
    `;
  }

  return `
    <div class="fx-row">
      <div>
        <div class="fx-rate">${d.email ? escapeHtml(d.email) : "연결됨"}</div>
        <div class="fx-meta">${
          state.settings.driveLastBackupAt
            ? `마지막 백업 ${relativeTimeKR(state.settings.driveLastBackupAt)}`
            : "아직 백업한 적이 없습니다"
        }</div>
      </div>
      <button id="drive-disconnect" class="btn btn-secondary" style="flex:none;padding:10px 14px;font-size:12.5px;">연결 해제</button>
    </div>
    <div class="gap-12"></div>
    <div class="fx-row">
      <span class="sub-text">자동 백업</span>
      <button id="drive-autobackup-toggle" class="btn ${
        state.settings.driveAutoBackup ? "btn-primary" : "btn-secondary"
      }" style="flex:none;padding:9px 16px;font-size:13px;">${state.settings.driveAutoBackup ? "켜짐" : "꺼짐"}</button>
    </div>
    <div class="gap-12"></div>
    <div class="btn-row">
      <button id="drive-backup-now" class="btn btn-secondary" ${d.busy ? "disabled" : ""}>${
    d.busy ? "백업 중..." : "지금 백업"
  }</button>
      <button id="drive-restore-open" class="btn btn-secondary">백업 불러오기</button>
    </div>
    ${d.statusMessage ? `<div class="helper-text">${escapeHtml(d.statusMessage)}</div>` : ""}
    <div class="helper-text">백업은 내 Drive의 앱 전용 저장공간에만 저장되며, 다른 파일에는 접근하지 않습니다.</div>
  `;
}

function bindSettingsEvents() {
  document.querySelectorAll('#theme-seg [data-theme-mode]').forEach((btn) => {
    btn.addEventListener("click", () => {
      state.settings.themeMode = btn.dataset.themeMode;
      applyTheme();
      persist();
      renderBody();
      bindSettingsEvents();
    });
  });

  bindAmountInput(document.getElementById("goal-input"), (formatted) => {
    const val = parseAmountInputValue(formatted);
    state.settings.goalAmount = isNaN(val) || val < 0 ? 0 : val;
    persist();
  });

  document.getElementById("rate-input").addEventListener("input", (e) => {
    const val = Number(e.target.value);
    state.settings.manualExchangeRate = isNaN(val) ? 0 : val;
    persist(); // 재렌더링 없이 조용히 저장 (입력 포커스 유지)
  });

  const fxBtn = document.getElementById("settings-fx-refresh");
  if (fxBtn) fxBtn.addEventListener("click", () => refreshExchangeRate());

  document.getElementById("reset-btn").addEventListener("click", () => {
    state.confirmDelete = "__ALL__";
    renderModal();
  });

  // ----- 5단계: Google Drive -----
  const connectBtn = document.getElementById("drive-connect");
  if (connectBtn) connectBtn.addEventListener("click", handleDriveConnect);

  const disconnectBtn = document.getElementById("drive-disconnect");
  if (disconnectBtn) disconnectBtn.addEventListener("click", handleDriveDisconnect);

  const toggleBtn = document.getElementById("drive-autobackup-toggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      state.settings.driveAutoBackup = !state.settings.driveAutoBackup;
      persist();
      renderBody();
      bindSettingsEvents();
      if (state.settings.driveAutoBackup) runBackupNow({ silent: true });
    });
  }

  const backupNowBtn = document.getElementById("drive-backup-now");
  if (backupNowBtn) backupNowBtn.addEventListener("click", () => runBackupNow({ silent: false }));

  const restoreOpenBtn = document.getElementById("drive-restore-open");
  if (restoreOpenBtn) restoreOpenBtn.addEventListener("click", openDriveRestoreModal);
}

async function handleDriveConnect() {
  state.drive.busy = true;
  state.drive.statusMessage = "";
  renderBody();
  bindSettingsEvents();

  const result = await connectGoogleDrive();
  state.drive.busy = false;
  if (result.ok) {
    state.drive.email = result.email;
    state.drive.statusMessage = "";
    renderBody();
    bindSettingsEvents();
    runBackupNow({ silent: true });
  } else {
    state.drive.statusMessage = result.error || "연결에 실패했습니다.";
    renderBody();
    bindSettingsEvents();
  }
}

function handleDriveDisconnect() {
  disconnectGoogleDrive();
  state.drive.email = null;
  state.drive.statusMessage = "";
  renderBody();
  bindSettingsEvents();
}

// ===== 모달 (자산 상세 / 목표 비중 / 성장률 기준값 / 삭제 확인) =====
function renderModal() {
  if (state.confirmDelete) {
    modalRoot.innerHTML = renderConfirmModal();
    bindConfirmModalEvents();
    return;
  }
  if (state.allocModal) {
    modalRoot.innerHTML = renderAllocModal();
    bindAllocModalEvents();
    return;
  }
  if (state.baselineModal) {
    modalRoot.innerHTML = renderBaselineModal();
    bindBaselineModalEvents();
    return;
  }
  if (state.driveModal) {
    modalRoot.innerHTML = renderDriveModal();
    bindDriveModalEvents();
    return;
  }
  if (state.detailAssetId) {
    modalRoot.innerHTML = renderDetailModal();
    bindDetailModalEvents();
    return;
  }
  modalRoot.innerHTML = "";
}

function renderConfirmModal() {
  const message =
    state.confirmDelete === "__ALL__"
      ? "모든 자산과 기록이 삭제됩니다. 계속할까요?"
      : "이 자산과 관련된 모든 기록이 삭제됩니다. 계속할까요?";
  return `
    <div class="modal-overlay" id="confirm-overlay">
      <div class="confirm-sheet">
        <div class="sheet-handle"></div>
        <div class="confirm-text">${message}</div>
        <div class="gap-20"></div>
        <div class="btn-row">
          <button id="confirm-cancel" class="btn btn-secondary">취소</button>
          <button id="confirm-ok" class="btn btn-danger">삭제</button>
        </div>
      </div>
    </div>
  `;
}

function bindConfirmModalEvents() {
  document.getElementById("confirm-overlay").addEventListener("click", (e) => {
    if (e.target.id === "confirm-overlay") {
      state.confirmDelete = null;
      renderModal();
    }
  });
  document.getElementById("confirm-cancel").addEventListener("click", () => {
    state.confirmDelete = null;
    renderModal();
  });
  document.getElementById("confirm-ok").addEventListener("click", () => {
    if (state.confirmDelete === "__ALL__") {
      state.assets = [];
      state.records = [];
      state.settings = defaultSettings();
    } else {
      const assetId = state.confirmDelete;
      state.assets = state.assets.filter((a) => a.id !== assetId);
      state.records = state.records.filter((r) => r.assetId !== assetId);
      state.detailAssetId = null;
    }
    state.confirmDelete = null;
    commit();
  });
}

// ----- 목표 비중 설정 모달 -----
function openAllocModal() {
  const existing = state.settings.targetAllocation || {};
  const values = {};
  ASSET_TYPES.forEach((t) => (values[t.key] = existing[t.key] || ""));
  state.allocModal = { values, error: "" };
  renderModal();
}

function closeAllocModal() {
  state.allocModal = null;
  renderModal();
}

function renderAllocModal() {
  const f = state.allocModal;
  const rows = ASSET_TYPES.map(
    (t) => `
    <div class="alloc-row">
      <span>${t.label}</span>
      <div style="display:flex;align-items:center;gap:4px;">
        <input class="alloc-input input" data-alloc-key="${t.key}" type="number" inputmode="decimal" min="0" max="100"
          style="width:74px;padding:9px 10px;text-align:right;"
          value="${f.values[t.key] === "" ? "" : f.values[t.key]}" placeholder="0" />
        <span class="sub-text">%</span>
      </div>
    </div>`
  ).join("");

  return `
    <div class="modal-overlay" id="alloc-overlay">
      <div class="modal-sheet">
        <div class="sheet-handle"></div>
        <div class="modal-header">
          <div class="modal-title">목표 자산 비중</div>
          <button id="alloc-close" class="close-btn">닫기</button>
        </div>
        <div class="sub-text">합계가 100%가 되도록 설정해주세요.</div>
        <div class="gap-16"></div>
        <div class="list-panel">${rows}</div>
        <div class="gap-16"></div>
        <div id="alloc-sum-banner" class="alloc-sum-banner"></div>
        ${f.error ? `<div class="error-text">${escapeHtml(f.error)}</div>` : ""}
        <div class="gap-20"></div>
        <button id="alloc-save" class="btn btn-primary">저장</button>
      </div>
    </div>`;
}

function bindAllocModalEvents() {
  document.getElementById("alloc-overlay").addEventListener("click", (e) => {
    if (e.target.id === "alloc-overlay") closeAllocModal();
  });
  document.getElementById("alloc-close").addEventListener("click", closeAllocModal);

  const inputs = Array.from(modalRoot.querySelectorAll(".alloc-input"));
  const updateBanner = () => {
    let sum = 0;
    inputs.forEach((inp) => {
      const v = parseFloat(inp.value);
      if (!isNaN(v)) sum += v;
    });
    const banner = document.getElementById("alloc-sum-banner");
    const ok = Math.abs(sum - 100) < 0.5;
    banner.textContent = `합계 ${sum.toFixed(1)}%${ok ? " · 저장 가능" : " · 100%로 맞춰주세요"}`;
    banner.className = "alloc-sum-banner " + (ok ? "alloc-sum-ok" : "alloc-sum-bad");
  };
  inputs.forEach((inp) => inp.addEventListener("input", updateBanner));
  updateBanner();

  document.getElementById("alloc-save").addEventListener("click", () => {
    let sum = 0;
    const values = {};
    inputs.forEach((inp) => {
      const key = inp.dataset.allocKey;
      const v = parseFloat(inp.value);
      const val = isNaN(v) ? 0 : v;
      values[key] = val;
      sum += val;
    });
    if (Math.abs(sum - 100) >= 0.5) {
      state.allocModal.values = values;
      state.allocModal.error = `합계가 100%가 아닙니다 (현재 ${sum.toFixed(1)}%).`;
      renderModal();
      return;
    }
    const cleaned = {};
    Object.keys(values).forEach((k) => {
      if (values[k] > 0) cleaned[k] = values[k];
    });
    state.settings.targetAllocation = cleaned;
    state.allocModal = null;
    state.compositionView = "compare";
    persist();
    renderAll();
    if (state.activeTab === "analysis") bindAnalysisEvents();
  });
}

// ----- 누적 성장률 기준값 모달 -----
function openBaselineModal() {
  const gb = state.settings.growthBaseline || { amount: null, date: null };
  state.baselineModal = {
    amount: gb.amount ? formatAmountInputValue(String(gb.amount)) : "",
    date: gb.date || todayStr(),
    error: "",
  };
  renderModal();
}

function closeBaselineModal() {
  state.baselineModal = null;
  renderModal();
}

function renderBaselineModal() {
  const f = state.baselineModal;
  return `
    <div class="modal-overlay" id="baseline-overlay">
      <div class="modal-sheet">
        <div class="sheet-handle"></div>
        <div class="modal-header">
          <div class="modal-title">누적 성장률 기준값</div>
          <button id="baseline-close" class="close-btn">닫기</button>
        </div>
        <div class="sub-text">기준 자산과 날짜를 직접 설정하면 이 시점 대비 성장률을 계산합니다.</div>
        <div class="gap-16"></div>
        <div class="section-label">기준 금액 (원화)</div>
        <input id="baseline-amount" class="input" type="text" inputmode="decimal" value="${escapeHtml(f.amount)}" placeholder="예: 10,000,000" />
        <div class="gap-12"></div>
        <div class="section-label">기준 날짜</div>
        <input id="baseline-date" class="input" type="date" value="${f.date}" />
        ${f.error ? `<div class="error-text">${escapeHtml(f.error)}</div>` : ""}
        <div class="gap-20"></div>
        <div class="btn-row">
          <button id="baseline-reset" class="btn btn-secondary">자동으로</button>
          <button id="baseline-save" class="btn btn-primary" style="flex:1;">저장</button>
        </div>
      </div>
    </div>
  `;
}

function bindBaselineModalEvents() {
  document.getElementById("baseline-overlay").addEventListener("click", (e) => {
    if (e.target.id === "baseline-overlay") closeBaselineModal();
  });
  document.getElementById("baseline-close").addEventListener("click", closeBaselineModal);
  bindAmountInput(document.getElementById("baseline-amount"), (formatted) => {
    state.baselineModal.amount = formatted;
  });
  document.getElementById("baseline-date").addEventListener("change", (e) => {
    state.baselineModal.date = e.target.value;
  });
  document.getElementById("baseline-reset").addEventListener("click", () => {
    state.settings.growthBaseline = { amount: null, date: null };
    state.baselineModal = null;
    commit();
  });
  document.getElementById("baseline-save").addEventListener("click", () => {
    const amt = parseAmountInputValue(state.baselineModal.amount);
    if (!state.baselineModal.amount || isNaN(amt) || amt <= 0 || !state.baselineModal.date) {
      state.baselineModal.error = "금액과 날짜를 올바르게 입력해주세요.";
      renderModal();
      return;
    }
    state.settings.growthBaseline = { amount: amt, date: state.baselineModal.date };
    state.baselineModal = null;
    commit();
  });
}

// ----- 5단계: Google Drive 백업 불러오기(복원) 모달 -----
async function openDriveRestoreModal() {
  state.driveModal = { loading: true, error: "", backups: [], confirmId: null, restoring: false };
  renderModal();
  try {
    const backups = await listDriveBackups();
    state.driveModal.backups = backups;
    state.driveModal.loading = false;
  } catch (e) {
    state.driveModal.loading = false;
    state.driveModal.error = (e && e.message) || "목록을 불러오지 못했습니다.";
  }
  renderModal();
}

function closeDriveModal() {
  state.driveModal = null;
  renderModal();
}

function formatBackupLabel(b) {
  const d = new Date(b.createdTime);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}.${mm}.${dd} ${hh}:${mi}`;
}

function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!n) return "";
  if (n < 1024) return `${n}B`;
  return `${(n / 1024).toFixed(1)}KB`;
}

function renderDriveModal() {
  const m = state.driveModal;

  if (m.confirmId) {
    const target = m.backups.find((b) => b.id === m.confirmId);
    return `
      <div class="modal-overlay" id="drive-overlay">
        <div class="confirm-sheet">
          <div class="sheet-handle"></div>
          <div class="confirm-text">${
            target ? escapeHtml(formatBackupLabel(target)) : ""
          } 시점으로 복원할까요?<br/><span class="sub-text">현재 기기의 데이터가 이 백업 내용으로 대체됩니다.</span></div>
          ${m.error ? `<div class="error-text">${escapeHtml(m.error)}</div>` : ""}
          <div class="gap-20"></div>
          <div class="btn-row">
            <button id="drive-confirm-cancel" class="btn btn-secondary" ${m.restoring ? "disabled" : ""}>취소</button>
            <button id="drive-confirm-ok" class="btn btn-danger" ${m.restoring ? "disabled" : ""}>${
      m.restoring ? "복원 중..." : "복원"
    }</button>
          </div>
        </div>
      </div>`;
  }

  let listHtml;
  if (m.loading) {
    listHtml = `<div class="sub-text" style="padding:30px 0;text-align:center;">불러오는 중...</div>`;
  } else if (m.error) {
    listHtml = `<div class="error-text">${escapeHtml(m.error)}</div>`;
  } else if (m.backups.length === 0) {
    listHtml = `<div class="sub-text" style="padding:30px 0;text-align:center;">저장된 백업이 없습니다.</div>`;
  } else {
    listHtml = `<div class="list-panel">${m.backups
      .map(
        (b) => `
      <button class="asset-row" data-backup-id="${b.id}">
        <div>
          <div class="asset-name">${escapeHtml(formatBackupLabel(b))}</div>
          <div class="asset-type">${escapeHtml(formatFileSize(b.size))}</div>
        </div>
        <span class="sub-text">불러오기</span>
      </button>`
      )
      .join("")}</div>`;
  }

  return `
    <div class="modal-overlay" id="drive-overlay">
      <div class="modal-sheet">
        <div class="sheet-handle"></div>
        <div class="modal-header">
          <div class="modal-title">백업 불러오기</div>
          <button id="drive-modal-close" class="close-btn">닫기</button>
        </div>
        <div class="sub-text">복원할 백업 시점을 선택해주세요.</div>
        <div class="gap-16"></div>
        ${listHtml}
      </div>
    </div>`;
}

function bindDriveModalEvents() {
  document.getElementById("drive-overlay").addEventListener("click", (e) => {
    if (e.target.id === "drive-overlay" && !state.driveModal.restoring) closeDriveModal();
  });
  const closeBtn = document.getElementById("drive-modal-close");
  if (closeBtn) closeBtn.addEventListener("click", closeDriveModal);

  if (state.driveModal.confirmId) {
    const cancelBtn = document.getElementById("drive-confirm-cancel");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        state.driveModal.confirmId = null;
        state.driveModal.error = "";
        renderModal();
      });
    }
    document.getElementById("drive-confirm-ok").addEventListener("click", async () => {
      state.driveModal.restoring = true;
      renderModal();
      try {
        const data = await downloadDriveBackup(state.driveModal.confirmId);
        state.assets = Array.isArray(data.assets) ? data.assets : [];
        state.records = Array.isArray(data.records) ? data.records : [];
        state.settings = mergeSettings(data.settings);
        state.driveModal = null;
        commit();
      } catch (e) {
        state.driveModal.restoring = false;
        state.driveModal.error = (e && e.message) || "복원에 실패했습니다.";
        renderModal();
      }
    });
    return;
  }

  modalRoot.querySelectorAll("[data-backup-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.driveModal.confirmId = btn.dataset.backupId;
      state.driveModal.error = "";
      renderModal();
    });
  });
}

// ----- 자산 상세 모달 -----
function renderDetailModal() {
  const asset = state.assets.find((a) => a.id === state.detailAssetId);
  if (!asset) return "";
  const type = typeByKey(asset.typeKey);
  const f = state.detailForm;
  const records = getRecordsByAsset(asset.id);

  if (f.editing) {
    return `
      <div class="modal-overlay" id="detail-overlay">
        <div class="modal-sheet">
          <div class="sheet-handle"></div>
          <div class="modal-header">
            <div class="modal-title">자산 수정</div>
            <button id="detail-close" class="close-btn">닫기</button>
          </div>

          <div class="section-label">자산 이름</div>
          <input id="edit-name" class="input" value="${escapeHtml(f.name)}" />

          <div class="gap-16"></div>
          <div class="section-label">자산 종류</div>
          ${renderTypeGrid(f.typeKey, "edit")}

          <div class="gap-20"></div>
          <div class="btn-row">
            <button id="edit-cancel" class="btn btn-secondary">취소</button>
            <button id="edit-save" class="btn btn-primary" style="flex:1;">저장</button>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="modal-overlay" id="detail-overlay">
      <div class="modal-sheet">
          <div class="sheet-handle"></div>
        <div class="modal-header">
          <div class="modal-title">${escapeHtml(asset.name)}</div>
          <button id="detail-close" class="close-btn">닫기</button>
        </div>
        <div class="sub-text">${type.label}</div>

        <div class="gap-16"></div>
        <div class="section-label">기록 추가</div>
        <input id="new-amount" class="input" type="text" inputmode="decimal"
          placeholder="${type.currency === "USD" ? "달러 금액" : "원화 금액"}"
          value="${escapeHtml(f.newAmount)}" />
        ${type.currency === "USD" ? `<div class="helper-text" id="new-amount-preview"></div>` : ""}
        <div class="gap-8"></div>
        <input id="new-date" class="input" type="date" value="${f.newDate}" />
        <div class="helper-text">날짜를 지난달로 바꾸면 지난달 금액으로도 기록을 남길 수 있어요.</div>
        ${f.error ? `<div class="error-text">${escapeHtml(f.error)}</div>` : ""}
        <div class="gap-12"></div>
        <button id="add-record-btn" class="btn btn-primary">기록 추가</button>

        <div class="gap-24"></div>
        <div class="section-label">기록 내역</div>
        <div class="gap-8"></div>
        ${
          records.length === 0
            ? `<div class="sub-text">기록이 없습니다.</div>`
            : `<div class="list-panel">${records
                .map(
                  (r) => `
              <div class="record-row">
                <span class="sub-text">${formatDateKR(r.date)}</span>
                <span class="asset-value">
                  ${formatKRW(r.krwAmount)}
                  ${type.currency === "USD" ? `<span class="sub-text"> (${formatUSD(r.amount)})</span>` : ""}
                </span>
              </div>`
                )
                .join("")}</div>`
        }

        <div class="gap-24"></div>
        <div class="btn-row">
          <button id="edit-open" class="btn btn-secondary">이름/종류 수정</button>
          <button id="delete-open" class="btn btn-danger">삭제</button>
        </div>
      </div>
    </div>
  `;
}

function updateDetailUsdPreview(asset) {
  const el = document.getElementById("new-amount-preview");
  if (!el) return;
  const rate = getEffectiveRate();
  const amt = parseAmountInputValue(state.detailForm.newAmount);
  if (!amt || isNaN(amt) || amt <= 0) {
    el.textContent = `현재 환율 ${formatRate(rate)}원이 적용됩니다`;
    return;
  }
  el.textContent = `원화 환산 약 ${formatKRW(amt * rate)} (환율 ${formatRate(rate)})`;
}

function bindDetailModalEvents() {
  const asset = state.assets.find((a) => a.id === state.detailAssetId);
  if (!asset) return;

  document.getElementById("detail-overlay").addEventListener("click", (e) => {
    if (e.target.id === "detail-overlay") closeDetailModal();
  });
  document.getElementById("detail-close").addEventListener("click", closeDetailModal);

  if (state.detailForm.editing) {
    document.getElementById("edit-name").addEventListener("input", (e) => {
      state.detailForm.name = e.target.value;
    });
    modalRoot.querySelector('[data-group="edit"]').querySelectorAll("[data-type-key]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.detailForm.typeKey = btn.dataset.typeKey;
        renderModal();
      });
    });
    document.getElementById("edit-cancel").addEventListener("click", () => {
      state.detailForm.editing = false;
      renderModal();
    });
    document.getElementById("edit-save").addEventListener("click", () => {
      if (!state.detailForm.name.trim() || !state.detailForm.typeKey) return;
      asset.name = state.detailForm.name.trim();
      asset.typeKey = state.detailForm.typeKey;
      asset.currency = typeByKey(asset.typeKey).currency;
      state.detailForm.editing = false;
      commit();
    });
    return;
  }

  bindAmountInput(document.getElementById("new-amount"), (formatted) => {
    state.detailForm.newAmount = formatted;
    updateDetailUsdPreview(asset);
  });
  document.getElementById("new-date").addEventListener("change", (e) => {
    state.detailForm.newDate = e.target.value;
  });
  document.getElementById("add-record-btn").addEventListener("click", () => {
    const num = parseAmountInputValue(state.detailForm.newAmount);
    if (!state.detailForm.newAmount || isNaN(num) || num <= 0) {
      state.detailForm.error = "금액을 올바르게 입력해주세요.";
      renderModal();
      return;
    }
    const type = typeByKey(asset.typeKey);
    const rate = type.currency === "USD" ? getEffectiveRate() : 1;
    const krwAmount = type.currency === "USD" ? num * rate : num;

    state.records.push({
      id: uid(),
      assetId: asset.id,
      date: state.detailForm.newDate,
      amount: num,
      exchangeRate: rate,
      krwAmount,
    });
    state.detailForm.newAmount = "";
    state.detailForm.newDate = todayStr();
    state.detailForm.error = "";
    commit();
  });
  updateDetailUsdPreview(asset);

  document.getElementById("edit-open").addEventListener("click", () => {
    state.detailForm.editing = true;
    state.detailForm.name = asset.name;
    state.detailForm.typeKey = asset.typeKey;
    renderModal();
  });

  document.getElementById("delete-open").addEventListener("click", () => {
    state.confirmDelete = asset.id;
    renderModal();
  });
}

function closeDetailModal() {
  state.detailAssetId = null;
  state.detailForm = {
    editing: false,
    name: "",
    typeKey: null,
    newAmount: "",
    newDate: todayStr(),
    error: "",
  };
  renderModal();
}
