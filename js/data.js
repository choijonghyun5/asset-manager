// ===== 자산 종류 정의 =====
const ASSET_TYPES = [
  { key: "cash", label: "현금", currency: "KRW" },
  { key: "deposit", label: "예금", currency: "KRW" },
  { key: "savings", label: "적금", currency: "KRW" },
  { key: "usd", label: "달러", currency: "USD" },
  { key: "us_stock", label: "미국 주식", currency: "USD" },
  { key: "kr_stock", label: "국내 주식", currency: "KRW" },
  { key: "us_etf", label: "미국 ETF", currency: "USD" },
  { key: "kr_etf", label: "국내 ETF", currency: "KRW" },
  { key: "kr_bond", label: "국내 채권", currency: "KRW" },
  { key: "us_bond", label: "미국 채권", currency: "USD" },
  { key: "coin", label: "코인", currency: "KRW" },
  { key: "gold", label: "금", currency: "KRW" },
  { key: "silver", label: "은", currency: "KRW" },
  { key: "etc", label: "기타", currency: "KRW" },
];

function typeByKey(key) {
  return ASSET_TYPES.find((t) => t.key === key);
}

const TABS = [
  { key: "home", label: "홈" },
  { key: "assets", label: "자산" },
  { key: "add", label: "추가" },
  { key: "analysis", label: "분석" },
  { key: "settings", label: "설정" },
];

// ===== 유틸리티 =====
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function todayStr() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function formatKRW(n) {
  if (n === null || n === undefined || isNaN(n)) return "₩0";
  return "₩" + Math.round(n).toLocaleString("ko-KR");
}

function formatUSD(n) {
  if (n === null || n === undefined || isNaN(n)) return "$0";
  return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatDateKR(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${y}.${m}.${d}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ===== 3단계: 기본 설정값 =====
function defaultSettings() {
  return {
    manualExchangeRate: 1400,
    goalAmount: 0,
    targetAllocation: {}, // { typeKey: percent }
    growthBaseline: { amount: null, date: null }, // 누적 성장률 기준값
    driveAutoBackup: false, // 5단계: Google Drive 자동 백업 on/off
    driveLastBackupAt: null, // 5단계: 마지막 백업 시각 (ISO 문자열)
    monthlySavings: 0, // 4단계: 목표 달성일 예측 - 매월 저축(예정) 금액
    growthRateMode: "auto", // 4단계: "auto" | "manual" | "zero" - 예측에 사용할 월 성장률 산출 방식
    manualGrowthRatePercent: 0, // 4단계: growthRateMode가 "manual"일 때 사용할 월 성장률(%)
  };
}

// 저장된 데이터에 새 필드가 없을 경우 기본값으로 채워줌 (이전 버전 호환)
function mergeSettings(saved) {
  const base = defaultSettings();
  if (!saved || typeof saved !== "object") return base;
  return {
    manualExchangeRate:
      typeof saved.manualExchangeRate === "number" ? saved.manualExchangeRate : base.manualExchangeRate,
    goalAmount: typeof saved.goalAmount === "number" ? saved.goalAmount : base.goalAmount,
    targetAllocation:
      saved.targetAllocation && typeof saved.targetAllocation === "object"
        ? saved.targetAllocation
        : base.targetAllocation,
    growthBaseline:
      saved.growthBaseline && typeof saved.growthBaseline === "object"
        ? { amount: saved.growthBaseline.amount ?? null, date: saved.growthBaseline.date ?? null }
        : base.growthBaseline,
    driveAutoBackup: typeof saved.driveAutoBackup === "boolean" ? saved.driveAutoBackup : base.driveAutoBackup,
    driveLastBackupAt:
      typeof saved.driveLastBackupAt === "string" ? saved.driveLastBackupAt : base.driveLastBackupAt,
    monthlySavings: typeof saved.monthlySavings === "number" ? saved.monthlySavings : base.monthlySavings,
    growthRateMode:
      saved.growthRateMode === "auto" || saved.growthRateMode === "manual" || saved.growthRateMode === "zero"
        ? saved.growthRateMode
        : base.growthRateMode,
    manualGrowthRatePercent:
      typeof saved.manualGrowthRatePercent === "number" ? saved.manualGrowthRatePercent : base.manualGrowthRatePercent,
  };
}

// ===== 무채색 그라데이션 팔레트 (어두운 순 → 밝은 순) =====
const GREY_PALETTE = [
  "#141416",
  "#2c2c2e",
  "#48484a",
  "#636366",
  "#7d7d82",
  "#98989d",
  "#aeaeb2",
  "#c3c3c8",
  "#d8d8dc",
  "#e5e5ea",
];

function greyAt(index, total) {
  if (total <= 1) return GREY_PALETTE[0];
  const span = GREY_PALETTE.length - 1;
  const pos = Math.round((index / Math.max(total - 1, 1)) * span);
  return GREY_PALETTE[Math.min(pos, span)];
}

// ===== 날짜 유틸 =====
function toDateStr(d) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function parseDateStr(dateStr) {
  return new Date(dateStr + "T00:00:00");
}

function addDaysStr(dateStr, days) {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

function addMonthsStr(dateStr, months) {
  const d = parseDateStr(dateStr);
  d.setMonth(d.getMonth() + months);
  return toDateStr(d);
}

function startOfMonthStr(dateStr) {
  const d = parseDateStr(dateStr);
  return toDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
}

function monthKey(dateStr) {
  return dateStr.slice(0, 7); // YYYY-MM
}

function monthLabelKR(dateStr) {
  const [y, m] = dateStr.split("-");
  return `${y}.${m}`;
}

// "2032-08-01" -> "2032년 8월" (4단계: 목표 달성일 예측 결과 표시용)
function formatYearMonthKR(dateStr) {
  const [y, m] = dateStr.split("-");
  return `${parseInt(y, 10)}년 ${parseInt(m, 10)}월`;
}

// 총 개월 수 -> "5년 11개월" / "8개월" / "3년" (4단계: 목표까지 남은 기간 표시용)
function formatMonthsAsYM(totalMonths) {
  const m = Math.max(0, Math.round(totalMonths));
  const years = Math.floor(m / 12);
  const months = m % 12;
  if (years <= 0) return `${months}개월`;
  if (months <= 0) return `${years}년`;
  return `${years}년 ${months}개월`;
}

function monthsBetween(aStr, bStr) {
  const a = parseDateStr(aStr);
  const b = parseDateStr(bStr);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

// ===== 표시 포맷 유틸 =====
function formatSignedKRW(n) {
  if (n === null || n === undefined || isNaN(n)) return "₩0";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return sign + "₩" + Math.round(Math.abs(n)).toLocaleString("ko-KR");
}

function formatSignedPercent(n, digits = 1) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return sign + Math.abs(n).toFixed(digits) + "%";
}

function formatPercent(n, digits = 1) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return n.toFixed(digits) + "%";
}

function formatRate(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return "₩" + Number(n).toLocaleString("ko-KR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

// ===== 5단계: 금액 입력창 천단위 콤마 포맷 유틸 =====
// 입력창에 표시되는 문자열(콤마 포함)과 실제 계산에 쓰는 숫자를 서로 변환한다.
function stripCommas(str) {
  return String(str === null || str === undefined ? "" : str).replace(/,/g, "");
}

// 사용자가 입력 중인 원본 문자열을 "1,234,567.89" 형태로 정리한다.
// 숫자, 소수점 1개, 맨 앞의 마이너스 부호만 허용한다.
function formatAmountInputValue(raw) {
  let str = stripCommas(raw);
  if (str === "") return "";

  const negative = str.trim().startsWith("-");
  if (negative) str = str.replace("-", "");

  const dotIndex = str.indexOf(".");
  let intPart = dotIndex === -1 ? str : str.slice(0, dotIndex);
  let decPart = dotIndex === -1 ? "" : str.slice(dotIndex + 1);

  intPart = intPart.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
  decPart = decPart.replace(/[^\d]/g, "");

  intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  let result = intPart;
  if (dotIndex !== -1) result += "." + decPart;
  return (negative && (intPart || decPart) ? "-" : "") + result;
}

// 포맷된(콤마 포함) 문자열을 실제 숫자로 변환한다. 비어있거나 불완전하면 NaN.
function parseAmountInputValue(raw) {
  const cleaned = stripCommas(raw).trim();
  if (cleaned === "" || cleaned === "-" || cleaned === "." || cleaned === "-.") return NaN;
  const n = Number(cleaned);
  return n;
}

function relativeTimeKR(isoOrNull) {
  if (!isoOrNull) return "";
  const then = new Date(isoOrNull).getTime();
  const now = Date.now();
  const diffMin = Math.floor((now - then) / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}일 전`;
}
