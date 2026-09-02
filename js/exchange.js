/**
 * USD/KRW 환율 조회 모듈
 * - 실시간 API 조회를 시도하고, 실패하면 마지막으로 성공한 캐시값을 사용
 * - 캐시조차 없으면 설정의 수동 환율(기본 1400원)로 폴백
 * - 네트워크가 없어도 앱이 절대 죽지 않도록 항상 try/catch로 감쌈
 */
const FX_CACHE_KEY = "asset-tracker-fx-cache";
const FX_API_URL = "https://open.er-api.com/v6/latest/USD";
const FX_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 12; // 12시간 이내 캐시는 재조회 없이 사용 가능

function loadFxCache() {
  try {
    const raw = localStorage.getItem(FX_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.rate !== "number") return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function saveFxCache(rate) {
  try {
    localStorage.setItem(
      FX_CACHE_KEY,
      JSON.stringify({ rate, updatedAt: new Date().toISOString() })
    );
  } catch (e) {
    // 저장 실패해도 앱 동작에는 지장 없음
  }
}

/**
 * @returns {Promise<{rate:number|null, source:"live"|"cache"|"manual", updatedAt:string|null}>}
 */
async function fetchExchangeRate(manualRate) {
  try {
    if (!navigator.onLine) throw new Error("offline");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(FX_API_URL, { cache: "no-store", signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error("bad response");
    const data = await res.json();
    const rate = data && data.rates && data.rates.KRW;
    if (!rate || isNaN(rate)) throw new Error("no rate in response");
    saveFxCache(rate);
    return { rate, source: "live", updatedAt: new Date().toISOString() };
  } catch (e) {
    const cached = loadFxCache();
    if (cached && typeof cached.rate === "number") {
      return { rate: cached.rate, source: "cache", updatedAt: cached.updatedAt };
    }
    return { rate: manualRate || 1400, source: "manual", updatedAt: null };
  }
}
