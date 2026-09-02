// 자산 데이터는 기기의 localStorage에 저장됩니다.
// (5단계에서 Google Drive 자동 백업이 이 위에 추가될 예정입니다.)
const STORAGE_KEY = "asset-tracker-data";

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      assets: parsed.assets || [],
      records: parsed.records || [],
      settings: mergeSettings(parsed.settings),
    };
  } catch (e) {
    console.error("데이터 불러오기 실패:", e);
    return null;
  }
}

function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    // 저장공간 부족(QuotaExceededError) 등 - 앱이 죽지 않도록 방어
    console.error("데이터 저장 실패:", e);
    return false;
  }
}
