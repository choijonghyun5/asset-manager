/**
 * Google Drive 백업/복원 모듈 (5단계)
 *
 * - Google Identity Services(GIS)의 "토큰 클라이언트"로 액세스 토큰만 발급받는 방식이라
 *   Client Secret이 전혀 필요 없다. (Secret은 서버가 있는 OAuth 방식에서만 필요함)
 * - 백업 파일은 사용자 Drive의 숨겨진 앱 전용 폴더(appDataFolder)에만 저장된다.
 *   즉 사용자의 일반 파일에는 전혀 접근하지 않는다.
 * - 액세스 토큰은 메모리에만 보관하고 어디에도 저장하지 않는다.
 *   새로고침하면 다시 로그인이 필요하다 (보안을 위한 의도적인 설계).
 *
 * 사용 전 준비물:
 *   Google Cloud Console → OAuth 동의 화면/사용자 인증 정보에서
 *   이 앱을 서비스하는 도메인(예: https://your-app.vercel.app, 로컬 테스트 시 http://localhost:8080)을
 *   "승인된 자바스크립트 원본(Authorized JavaScript origins)"에 등록해야
 *   로그인 팝업이 정상 동작한다.
 */

const GOOGLE_CLIENT_ID = "516093946835-qkq6q5tloe2f5p9dmucmafq07nrdbadp.apps.googleusercontent.com";
const GOOGLE_SCOPES =
  "https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email";
const DRIVE_BACKUP_NAME_PREFIX = "asset-tracker-backup-";
const DRIVE_BACKUP_KEEP = 15; // 중복/무한 누적 방지: 최신 N개만 남기고 오래된 백업은 정리

const driveAuth = {
  tokenClient: null,
  accessToken: null,
  tokenExpiresAt: 0,
  email: null,
};

function isDriveConnected() {
  return !!driveAuth.accessToken;
}

function getDriveEmail() {
  return driveAuth.email;
}

function waitForGoogleIdentity(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        reject(new Error("Google 로그인 모듈을 불러오지 못했습니다. 인터넷 연결을 확인해주세요."));
      } else {
        setTimeout(check, 150);
      }
    })();
  });
}

function ensureTokenClient() {
  return waitForGoogleIdentity().then(() => {
    if (!driveAuth.tokenClient) {
      driveAuth.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPES,
        callback: () => {}, // requestAccessToken 호출 시마다 아래에서 재지정
      });
    }
    return driveAuth.tokenClient;
  });
}

function requestAccessToken(interactive) {
  return ensureTokenClient().then(
    (client) =>
      new Promise((resolve, reject) => {
        client.callback = (resp) => {
          if (resp && resp.access_token) {
            driveAuth.accessToken = resp.access_token;
            driveAuth.tokenExpiresAt = Date.now() + (Number(resp.expires_in) || 3500) * 1000;
            resolve(resp.access_token);
          } else {
            reject(new Error((resp && resp.error) || "로그인에 실패했습니다."));
          }
        };
        client.error_callback = (err) => {
          reject(new Error((err && err.type) || "로그인에 실패했습니다."));
        };
        try {
          client.requestAccessToken({ prompt: interactive ? "consent" : "" });
        } catch (e) {
          reject(e);
        }
      })
  );
}

async function getValidAccessToken(interactive) {
  if (driveAuth.accessToken && Date.now() < driveAuth.tokenExpiresAt - 30000) {
    return driveAuth.accessToken;
  }
  return requestAccessToken(interactive);
}

async function fetchGoogleEmail(token) {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.email || null;
  } catch (e) {
    return null;
  }
}

async function connectGoogleDrive() {
  try {
    const token = await requestAccessToken(true);
    driveAuth.email = await fetchGoogleEmail(token);
    return { ok: true, email: driveAuth.email };
  } catch (e) {
    return { ok: false, error: (e && e.message) || "연결에 실패했습니다." };
  }
}

function disconnectGoogleDrive() {
  const token = driveAuth.accessToken;
  driveAuth.accessToken = null;
  driveAuth.tokenExpiresAt = 0;
  driveAuth.email = null;
  try {
    if (token && window.google && google.accounts && google.accounts.oauth2) {
      google.accounts.oauth2.revoke(token, () => {});
    }
  } catch (e) {
    // 토큰 폐기 실패는 무시해도 앱 동작에 지장 없음
  }
}

// ===== Drive REST 호출 =====
async function driveApiFetch(url, options = {}) {
  const token = await getValidAccessToken(false);
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    // 토큰이 만료되었을 수 있으니 한 번 더 시도
    driveAuth.accessToken = null;
    const retryToken = await getValidAccessToken(false);
    return fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${retryToken}` },
    });
  }
  return res;
}

async function listDriveBackups() {
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    q: `name contains '${DRIVE_BACKUP_NAME_PREFIX}' and trashed = false`,
    fields: "files(id,name,createdTime,size)",
    orderBy: "createdTime desc",
    pageSize: "50",
  });
  const res = await driveApiFetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
  if (!res.ok) throw new Error("백업 목록을 불러오지 못했습니다.");
  const data = await res.json();
  return (data.files || []).slice().sort((a, b) => (a.createdTime < b.createdTime ? 1 : -1));
}

async function uploadDriveBackup(payload) {
  const name = `${DRIVE_BACKUP_NAME_PREFIX}${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const metadata = { name, parents: ["appDataFolder"], mimeType: "application/json" };
  const boundary = "asset_tracker_" + uid();
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${JSON.stringify(payload)}\r\n` +
    `--${boundary}--`;

  const res = await driveApiFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error("백업 업로드에 실패했습니다.");
  return res.json();
}

async function deleteDriveFile(fileId) {
  await driveApiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: "DELETE" });
}

async function pruneOldDriveBackups(keep = DRIVE_BACKUP_KEEP) {
  try {
    const files = await listDriveBackups();
    const extra = files.slice(keep);
    for (const f of extra) {
      await deleteDriveFile(f.id);
    }
  } catch (e) {
    // 정리 실패는 치명적이지 않으므로 조용히 무시
  }
}

async function downloadDriveBackup(fileId) {
  const res = await driveApiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  if (!res.ok) throw new Error("백업 파일을 불러오지 못했습니다.");
  return res.json();
}
