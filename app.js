const {useState,useEffect,useRef,useMemo,useCallback} = React;

const ASSET_TYPES = ['현금','예금','적금','달러','미국주식','국내주식','ETF','코인','금','기타'];
const INVEST_TYPES = ['미국주식','국내주식','ETF','코인','금'];
const THEME_ORDER = ['default','dark','apple','glass'];
const THEME_ICONS = {default:'☀️',dark:'🌙',apple:'🪨',glass:'💧'};
// 테마 공통: 이미지 기준 슬레이트 블루 그라데이션 (진한 남색 → 연한 하늘빛 회색), ASSET_TYPES 순서: 현금→기타
const SLATE_GRADIENT = ['#1E293B','#334155','#475569','#64748B','#78829B','#94A3B8','#A8B3C4','#B9C2D0','#CBD5E1','#DCE3EC'];
const CHART_PALETTES = {
  default: SLATE_GRADIENT,
  dark:    SLATE_GRADIENT,
  apple:   SLATE_GRADIENT,
  glass:   SLATE_GRADIENT,
};
const getTypeColorMap = (theme) => {
  const palette = CHART_PALETTES[theme] || CHART_PALETTES.default;
  const m = {}; ASSET_TYPES.forEach((t,i)=>m[t]=palette[i%palette.length]); return m;
};
// 기본(라이트) 팔레트는 모듈 전역에서도 fallback 용도로 사용
const TYPE_COLOR = getTypeColorMap('default');
const uid = () => Math.random().toString(36).slice(2,10);
const fmtWon = (n) => (n<0?'-':'') + Math.round(Math.abs(n)).toLocaleString('ko-KR') + '원';
const fmtPct = (n) => (n>0?'+':'') + n.toFixed(1) + '%';
const monthKey = (d=new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const monthLabel = (k) => { const [y,m]=k.split('-'); return `${y}.${m}`; };
const addMonths = (date, n) => { const d=new Date(date); d.setMonth(d.getMonth()+n); return d; };

async function storageGet(key){ try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }catch(e){ return null; } }
async function storageSet(key,val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){ console.error('save fail',e); } }
function useDebouncedSave(key, value, ready){
  useEffect(()=>{ if(!ready) return; const t = setTimeout(()=>{ storageSet(key,value); }, 500); return ()=>clearTimeout(t); },[value, ready]);
}

/* ===== Google Drive 자동 저장 설정 =====
   1) https://console.cloud.google.com 에서 프로젝트 생성
   2) API 및 서비스 > 라이브러리 > "Google Drive API" 사용 설정
   3) API 및 서비스 > 사용자 인증 정보 > OAuth 클라이언트 ID 만들기 (웹 애플리케이션)
   4) "승인된 자바스크립트 원본"에 이 앱이 열리는 주소를 추가
      예) http://localhost:5500 또는 https://내계정.github.io
   5) 발급받은 클라이언트 ID를 아래에 붙여넣기
====================================== */

const GOOGLE_CLIENT_ID = "516093946835-qkq6q5tloe2f5p9dmucmafq07nrdbadp.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_FILE_NAME = "asset_manager_backup.json";
const DRIVE_FILE_ID_KEY = "asset_drive_file_id";
const DRIVE_CONNECTED_KEY = "asset_drive_connected";
const DRIVE_LAST_SYNC_KEY = "asset_drive_last_sync";

let googleAccessToken = null;
let googleTokenClient = null;
let googleManualConnect = false;
let driveSyncTimer = null;
let driveSyncInProgress = false;
let driveUIListener = null;   // App 컴포넌트가 등록하는 상태 업데이트 콜백
let getDrivePayload = null;   // App 컴포넌트가 등록하는 현재 데이터 조회 함수

function isDriveConnected(){
  return localStorage.getItem(DRIVE_CONNECTED_KEY) === "1";
}

function formatSyncTime(ts){
  const d = new Date(ts);
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${mo}월 ${day}일 ${hh}:${mm} 저장됨`;
}

function pushDriveUI(overrideText){
  if(!driveUIListener) return;
  const connected = isDriveConnected();
  let time;
  if(overrideText !== undefined){
    time = overrideText;
  }else if(!connected){
    time = "";
  }else{
    const last = localStorage.getItem(DRIVE_LAST_SYNC_KEY);
    time = last ? formatSyncTime(Number(last)) : "동기화 대기 중";
  }
  driveUIListener({ connected, label: connected ? "연결됨" : "연결하기", time });
}

function setDriveConnected(connected){
  if(connected){
    localStorage.setItem(DRIVE_CONNECTED_KEY, "1");
  }else{
    localStorage.removeItem(DRIVE_CONNECTED_KEY);
    localStorage.removeItem(DRIVE_FILE_ID_KEY);
    localStorage.removeItem(DRIVE_LAST_SYNC_KEY);
  }
  pushDriveUI();
}

function initGoogleAuth(){
  if(!window.google || !google.accounts || !google.accounts.oauth2) return;
  googleTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: (response) => {
      if(response && response.access_token){
        googleAccessToken = response.access_token;
        setDriveConnected(true);
        syncToDrive();
      }else{
        pushDriveUI();
      }
      googleManualConnect = false;
    }
  });
  if(isDriveConnected()){
    try{ googleTokenClient.requestAccessToken({ prompt: "" }); }
    catch(e){ /* 자동 로그인 실패시 조용히 무시 */ }
  }
}
window.onGisLoad = initGoogleAuth;
if(window.google && google.accounts && google.accounts.oauth2){ initGoogleAuth(); }

function connectGoogleDrive(){
  if(GOOGLE_CLIENT_ID.includes("YOUR_GOOGLE_CLIENT_ID")){
    alert("구글 드라이브 기능을 쓰려면 GOOGLE_CLIENT_ID를 먼저 설정해야 합니다.");
    return;
  }
  if(!googleTokenClient){
    alert("구글 로그인 준비 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }
  googleManualConnect = true;
  googleTokenClient.requestAccessToken({ prompt: "consent" });
}

function disconnectGoogleDrive(){
  if(googleAccessToken && window.google && google.accounts){
    google.accounts.oauth2.revoke(googleAccessToken, () => {});
  }
  googleAccessToken = null;
  setDriveConnected(false);
}

function scheduleDriveSync(){
  if(!isDriveConnected()) return;
  clearTimeout(driveSyncTimer);
  driveSyncTimer = setTimeout(syncToDrive, 2000);
}

async function ensureAccessToken(){
  if(googleAccessToken) return googleAccessToken;
  if(!googleTokenClient) return null;
  return new Promise((resolve) => {
    const originalCallback = googleTokenClient.callback;
    googleTokenClient.callback = (response) => {
      googleTokenClient.callback = originalCallback;
      if(response && response.access_token){
        googleAccessToken = response.access_token;
        resolve(response.access_token);
      }else{
        resolve(null);
      }
    };
    googleTokenClient.requestAccessToken({ prompt: "" });
  });
}

async function findDriveFileId(token){
  const cached = localStorage.getItem(DRIVE_FILE_ID_KEY);
  if(cached) return cached;
  const query = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if(!res.ok) return null;
  const data = await res.json();
  if(data.files && data.files.length > 0){
    localStorage.setItem(DRIVE_FILE_ID_KEY, data.files[0].id);
    return data.files[0].id;
  }
  return null;
}

async function uploadDriveFileAs(token, payload, name){
  const boundary = "asset_backup_boundary";
  const metadata = { name, mimeType: "application/json" };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${JSON.stringify(payload)}\r\n` +
    `--${boundary}--`;
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    }
  );
  if(!res.ok) throw new Error("업로드 실패");
  const data = await res.json();
  return data.id;
}

async function uploadNewDriveFile(token, payload){
  const id = await uploadDriveFileAs(token, payload, DRIVE_FILE_NAME);
  localStorage.setItem(DRIVE_FILE_ID_KEY, id);
}

async function updateDriveFile(token, fileId, payload){
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );
  if(res.status === 404){
    localStorage.removeItem(DRIVE_FILE_ID_KEY);
    throw new Error("파일 없음");
  }
  if(!res.ok) throw new Error("업데이트 실패");
}

async function syncToDrive(){
  if(!isDriveConnected() || driveSyncInProgress || !getDrivePayload) return;
  driveSyncInProgress = true;
  pushDriveUI("저장 중...");
  try{
    const token = await ensureAccessToken();
    if(!token){
      pushDriveUI("로그인 필요");
      driveSyncInProgress = false;
      return;
    }
    const payload = getDrivePayload();
    let fileId = await findDriveFileId(token);
    if(fileId){
      try{ await updateDriveFile(token, fileId, payload); }
      catch(e){ await uploadNewDriveFile(token, payload); }
    }else{
      await uploadNewDriveFile(token, payload);
    }
    localStorage.setItem(DRIVE_LAST_SYNC_KEY, String(Date.now()));
    pushDriveUI();
  }catch(e){
    pushDriveUI("저장 실패, 재시도 예정");
  }finally{
    driveSyncInProgress = false;
  }
}

const ICONS = {
  home: <svg viewBox="0 0 24 24"><path d="M4 11.5 12 4l8 7.5" /><path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9" /></svg>,
  assets: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none"/></svg>,
  analysis: <svg viewBox="0 0 24 24"><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M2.5 20.5h19"/></svg>,
  goal: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/></svg>,
  settings: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
};

function Modal({title,onClose,children}){
  return (
    <div className="modal" onClick={(e)=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div className="modalSheet">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
          <h3 style={{fontSize:19,fontWeight:700}}>{title}</h3>
          <button className="headerBtn" onClick={onClose} style={{width:36,height:36,fontSize:14}}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AssetForm({initial,onSave,onClose}){
  const [name,setName]=useState(initial?.name||'');
  const [type,setType]=useState(initial?.type||ASSET_TYPES[0]);
  const [amount,setAmount]=useState(initial?.amount??'');
  const [principal,setPrincipal]=useState(initial?.principal??'');
  const [memo,setMemo]=useState(initial?.memo||'');
  const [date,setDate]=useState(initial?.date||new Date().toISOString().slice(0,10));
  const isInvest = INVEST_TYPES.includes(type);
  const submit=()=>{ if(!name.trim()||amount==='') return;
    onSave({id:initial?.id||uid(),name:name.trim(),type,amount:Number(amount),
      principal:isInvest&&principal!==''?Number(principal):(initial?.principal??null), memo, date}); };
  return (
    <Modal title={initial?'자산 수정':'자산 추가'} onClose={onClose}>
      <div className="inputGroup"><label>자산 이름</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="예: 토스뱅크 통장"/></div>
      <div className="inputGroup"><label>자산 종류</label>
        <select value={type} onChange={e=>setType(e.target.value)}>{ASSET_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
      <div className="inputGroup"><label>보유 금액 {type==='달러'?'(USD)':'(원)'}</label><input type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0"/></div>
      {isInvest && <div className="inputGroup"><label>매입 원금 (원, 선택)</label><input type="number" value={principal} onChange={e=>setPrincipal(e.target.value)} placeholder="0"/></div>}
      <div className="inputGroup"><label>메모</label><textarea value={memo} onChange={e=>setMemo(e.target.value)} placeholder="선택 입력"/></div>
      <div className="inputGroup"><label>등록 날짜</label><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></div>
      <div className="modalButtons"><button className="secondaryButton" onClick={onClose}>취소</button><button className="primaryButton" onClick={submit}>저장</button></div>
    </Modal>
  );
}

function LedgerForm({onSave,onClose}){
  const [date,setDate]=useState(new Date().toISOString().slice(0,7));
  const [category,setCategory]=useState('월급');
  const [amount,setAmount]=useState('');
  const [note,setNote]=useState('');
  return (
    <Modal title="히스토리 내역 추가" onClose={onClose}>
      <div className="inputGroup"><label>월</label><input type="month" value={date} onChange={e=>setDate(e.target.value)}/></div>
      <div className="inputGroup"><label>항목</label><input value={category} onChange={e=>setCategory(e.target.value)} placeholder="예: 월급, 생활비, 투자"/></div>
      <div className="inputGroup"><label>금액 (증가 +, 감소 -)</label><input type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="예: -800000"/></div>
      <div className="inputGroup"><label>메모</label><input value={note} onChange={e=>setNote(e.target.value)}/></div>
      <div className="modalButtons"><button className="secondaryButton" onClick={onClose}>취소</button>
        <button className="primaryButton" onClick={()=>{ if(amount==='') return; onSave({id:uid(),date,category,amount:Number(amount),note}); }}>저장</button></div>
    </Modal>
  );
}

function Doughnut({data,cutout='45%',centerLine1,centerLine2,centerColor}){
  const ref=useRef(null); const chartRef=useRef(null);
  useEffect(()=>{
    const ctx=ref.current.getContext('2d');
    if(chartRef.current) chartRef.current.destroy();
    chartRef.current=new Chart(ctx,{type:'doughnut',data:{labels:data.map(d=>d.label),datasets:[{data:data.map(d=>d.value),backgroundColor:data.map(d=>d.color),borderWidth:0,borderColor:'transparent',hoverOffset:6}]},
      options:{plugins:{legend:{display:false}},cutout,maintainAspectRatio:false}});
    return ()=>chartRef.current && chartRef.current.destroy();
  },[JSON.stringify(data),cutout]);
  return (
    <div className="donut-wrap">
      <canvas ref={ref}></canvas>
      {centerLine1 && (
        <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',pointerEvents:'none'}}>
          <div style={{fontSize:12,color:'var(--sub)',fontWeight:600}}>{centerLine1}</div>
          {centerLine2 && <div style={{fontSize:15,fontWeight:800,color:centerColor||'var(--text)'}}>{centerLine2}</div>}
        </div>
      )}
    </div>
  );
}

function LineChartMulti({snapshots,series,subColor,typeColor}){
  const ref=useRef(null); const chartRef=useRef(null);
  const PX_PER_POINT=52; const MIN_POINTS_FOR_SCROLL=7;
  const needsScroll = snapshots.length>MIN_POINTS_FOR_SCROLL;
  const innerWidth = needsScroll ? (snapshots.length*PX_PER_POINT) : '100%';
  useEffect(()=>{
    const ctx=ref.current.getContext('2d');
    if(chartRef.current) chartRef.current.destroy();
    const labels=snapshots.map(s=>monthLabel(s.yearMonth));
    const tc = typeColor || TYPE_COLOR;
    const palette=Object.values(tc);
    const totalColor = getComputedStyle(document.documentElement).getPropertyValue('--blue').trim() || '#4F8CFF';
    const datasets=series.map((key,i)=>({label:key,data:snapshots.map(s=>key==='총자산'?s.total:(s.byType[key]||0)),
      borderColor: key==='총자산' ? totalColor : (tc[key]||palette[i%palette.length]),
      backgroundColor:'transparent',tension:.35,pointRadius:3,borderWidth:2.5}));
    chartRef.current=new Chart(ctx,{type:'line',data:{labels,datasets},options:{maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:true,labels:{color:subColor,boxWidth:10,font:{size:11}}}},
      scales:{x:{ticks:{color:subColor},grid:{display:false}},y:{ticks:{color:subColor,callback:(v)=>(v/10000).toLocaleString()+'만'},grid:{color:'rgba(128,128,128,.15)'}}}}});
    return ()=>chartRef.current && chartRef.current.destroy();
  },[JSON.stringify(snapshots),JSON.stringify(series),subColor,JSON.stringify(typeColor)]);
  return (
    <div>
      <div className="chart-scroll">
        <div className="chart-wrap" style={{width:innerWidth,minWidth:'100%'}}><canvas ref={ref}></canvas></div>
      </div>
      {needsScroll && <div className="chart-scroll-hint">← 옆으로 슬라이드하면 전체 기간을 볼 수 있어요 →</div>}
    </div>
  );
}

function App(){
  const [ready,setReady]=useState(false);
  const [theme,setTheme]=useState('default'); // default | dark | apple | glass
  const [metalLight,setMetalLight]=useState(false); // only relevant for apple theme
  const [tab,setTab]=useState('home');
  const [assets,setAssets]=useState([]);
  const [goal,setGoal]=useState({targetAmount:10000000,targetAllocation:{현금:20,예금:10,적금:10,달러:10,미국주식:15,국내주식:15,ETF:10,코인:5,금:5,기타:0}});
  const [snapshots,setSnapshots]=useState([]);
  const [ledger,setLedger]=useState([]);
  const [rates,setRates]=useState({USD:1380,JPY:9.1,EUR:1490,updated:null});
  const [showAssetForm,setShowAssetForm]=useState(false);
  const [editingAsset,setEditingAsset]=useState(null);
  const [showLedgerForm,setShowLedgerForm]=useState(false);
  const [simSavings,setSimSavings]=useState(300000);
  const [aiText,setAiText]=useState(''); const [aiLoading,setAiLoading]=useState(false);
  const [lineSeries,setLineSeries]=useState(['총자산']);
  const [assetFilter,setAssetFilter]=useState('전체');
  const [subColor,setSubColor]=useState('#6B7280');
  const typeColor = useMemo(()=>getTypeColorMap(theme==='apple'?'apple':theme), [theme]);

  const [driveInfo,setDriveInfo]=useState({connected:false,label:'연결하기',time:''});

  useEffect(()=>{
    (async ()=>{
      const saved = await storageGet('asset-os-state-v2');
      if(saved){
        setAssets(saved.assets||[]); setGoal(saved.goal||goal); setSnapshots(saved.snapshots||[]);
        setLedger(saved.ledger||[]); setTheme(saved.theme||'default'); setMetalLight(!!saved.metalLight);
        setSimSavings(saved.simSavings||300000);
      }
      setReady(true);
    })();
  },[]);

  useEffect(()=>{
    document.documentElement.className = theme + (theme==='apple' && metalLight ? ' metalLight' : '');
    setTimeout(()=> setSubColor(getComputedStyle(document.documentElement).getPropertyValue('--sub').trim() || '#6B7280'), 50);
  },[theme,metalLight]);

  useDebouncedSave('asset-os-state-v2', {assets,goal,snapshots,ledger,theme,metalLight,simSavings}, ready);

  // 구글 드라이브 자동 저장 연동 (index.html/app.js와 동일한 방식)
  useEffect(()=>{
    driveUIListener = (info)=> setDriveInfo(info);
    pushDriveUI();
    return ()=>{ driveUIListener = null; };
  },[]);

  useEffect(()=>{
    getDrivePayload = () => ({ assets, goal, snapshots, ledger, exportedAt: new Date().toISOString() });
  },[assets,goal,snapshots,ledger]);

  useEffect(()=>{
    if(!ready) return;
    scheduleDriveSync();
  },[assets,goal,snapshots,ledger,ready]);

  useEffect(()=>{
    fetch('https://open.er-api.com/v6/latest/USD').then(r=>r.json()).then(d=>{
      if(d && d.rates && d.rates.KRW) setRates({USD:d.rates.KRW,JPY:d.rates.KRW/d.rates.JPY,EUR:d.rates.KRW/d.rates.EUR,updated:d.time_last_update_utc});
    }).catch(()=>{});
  },[]);

  const krwValue = useCallback((a)=> a.type==='달러' ? a.amount*rates.USD : a.amount, [rates]);
  const totalAssets = useMemo(()=>assets.reduce((s,a)=>s+krwValue(a),0),[assets,krwValue]);
  const byType = useMemo(()=>{ const m={}; ASSET_TYPES.forEach(t=>m[t]=0); assets.forEach(a=>{m[a.type]=(m[a.type]||0)+krwValue(a);}); return m; },[assets,krwValue]);
  const targetSum = useMemo(()=>ASSET_TYPES.reduce((s,t)=>s+(goal.targetAllocation[t]||0),0),[goal.targetAllocation]);
  const sortedSnaps = useMemo(()=>[...snapshots].sort((a,b)=>a.yearMonth.localeCompare(b.yearMonth)),[snapshots]);
  const monthlyChanges = useMemo(()=>{ const arr=[]; for(let i=1;i<sortedSnaps.length;i++){ const prev=sortedSnaps[i-1].total,cur=sortedSnaps[i].total;
    arr.push({yearMonth:sortedSnaps[i].yearMonth,diff:cur-prev,rate:prev!==0?(cur-prev)/prev*100:0}); } return arr; },[sortedSnaps]);
  const avgMonthlyIncrease = useMemo(()=> monthlyChanges.length? monthlyChanges.reduce((s,m)=>s+m.diff,0)/monthlyChanges.length : null,[monthlyChanges]);
  const avgGrowthRate = useMemo(()=> monthlyChanges.length? monthlyChanges.reduce((s,m)=>s+m.rate,0)/monthlyChanges.length : null,[monthlyChanges]);
  const thisMonthChange = monthlyChanges.length? monthlyChanges[monthlyChanges.length-1] : null;
  const remaining = goal.targetAmount - totalAssets;
  const achieveRate = goal.targetAmount>0 ? totalAssets/goal.targetAmount*100 : 0;
  const expectedDate = useMemo(()=>{
    if(remaining<=0) return '달성 완료 🎉';
    if(!avgMonthlyIncrease||avgMonthlyIncrease<=0) return '데이터 부족';
    const months=Math.ceil(remaining/avgMonthlyIncrease); const d=addMonths(new Date(),months);
    return `${d.getFullYear()}년 ${d.getMonth()+1}월`;
  },[remaining,avgMonthlyIncrease]);
  const simDate = useMemo(()=>{
    if(remaining<=0) return '달성 완료 🎉';
    if(simSavings<=0) return '-';
    const months=Math.ceil(remaining/simSavings); const d=addMonths(new Date(),months);
    return `${d.getFullYear()}년 ${d.getMonth()+1}월 (약 ${months}개월 후)`;
  },[remaining,simSavings]);
  const cumulativeGrowth = useMemo(()=>{ if(sortedSnaps.length<2) return null; const first=sortedSnaps[0].total,last=sortedSnaps[sortedSnaps.length-1].total;
    return first!==0?(last-first)/first*100:null; },[sortedSnaps]);
  const stats = useMemo(()=>{
    if(monthlyChanges.length===0) return null;
    const best=monthlyChanges.reduce((a,b)=>b.diff>a.diff?b:a); const worst=monthlyChanges.reduce((a,b)=>b.diff<a.diff?b:a);
    const totals=sortedSnaps.map(s=>s.total);
    return {best,worst,avg:avgMonthlyIncrease,max:Math.max(...totals),min:Math.min(...totals),cumulative:cumulativeGrowth,count:sortedSnaps.length};
  },[monthlyChanges,sortedSnaps,avgMonthlyIncrease,cumulativeGrowth]);
  const currentMonthSnapshotted = sortedSnaps.some(s=>s.yearMonth===monthKey());

  const achievementDefs = [
    {id:'m100',label:'1000만원 달성',icon:'🌱',test:()=>totalAssets>=1000000},
    {id:'m500',label:'5000만원 달성',icon:'🌿',test:()=>totalAssets>=5000000},
    {id:'m1000',label:'1억 달성',icon:'🌳',test:()=>totalAssets>=10000000},
    {id:'streak3',label:'5억 달성',icon:'🔥',test:()=>sortedSnaps.length>=3},
    {id:'streak6',label:'10억 달성',icon:'🏆',test:()=>sortedSnaps.length>=6},
    {id:'goal',label:'목표 달성',icon:'🎯',test:()=>achieveRate>=100},
  ];

  const saveSnapshot = () => {
    const ym=monthKey(); const entry={id:uid(),yearMonth:ym,total:totalAssets,byType:{...byType}};
    setSnapshots(prev=>{ const others=prev.filter(s=>s.yearMonth!==ym); return [...others,entry]; });
  };
  const handleSaveAsset = (a) => {
    setAssets(prev=>{ const exists=prev.some(p=>p.id===a.id); return exists?prev.map(p=>p.id===a.id?a:p):[...prev,a]; });
    setShowAssetForm(false); setEditingAsset(null);
  };
  const deleteAsset = (id) => setAssets(prev=>prev.filter(p=>p.id!==id));

  const exportCSV = () => {
    const header='이름,종류,금액,메모,등록일\n';
    const rows=assets.map(a=>`${a.name},${a.type},${a.amount},${(a.memo||'').replace(/,/g,' ')},${a.date}`).join('\n');
    const blob=new Blob(['\uFEFF'+header+rows],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob); const link=document.createElement('a'); link.href=url; link.download='assets.csv'; link.click();
  };
  const exportXLSX = () => {
    const ws=XLSX.utils.json_to_sheet(assets.map(a=>({이름:a.name,종류:a.type,금액:a.amount,메모:a.memo,등록일:a.date})));
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'자산'); XLSX.writeFile(wb,'assets.xlsx');
  };
  const backupJSON = () => {
    const blob=new Blob([JSON.stringify({assets,goal,snapshots,ledger},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const link=document.createElement('a'); link.href=url; link.download='asset-os-backup.json'; link.click();
  };
  const restoreJSON = (e) => {
    const file=e.target.files[0]; if(!file) return; const reader=new FileReader();
    reader.onload=(ev)=>{ try{ const data=JSON.parse(ev.target.result);
      if(data.assets) setAssets(data.assets); if(data.goal) setGoal(data.goal);
      if(data.snapshots) setSnapshots(data.snapshots); if(data.ledger) setLedger(data.ledger);
    }catch(err){ alert('복원 실패: 올바른 백업 파일이 아닙니다.'); } };
    reader.readAsText(file);
  };
  const runAI = async () => {
    setAiLoading(true); setAiText('');
    const summary={ 총자산:Math.round(totalAssets), 목표금액:goal.targetAmount, 달성률:achieveRate.toFixed(1)+'%',
      이번달증감: thisMonthChange?Math.round(thisMonthChange.diff):null, 평균월증가액: avgMonthlyIncrease?Math.round(avgMonthlyIncrease):null,
      평균성장률: avgGrowthRate?avgGrowthRate.toFixed(1)+'%':null,
      현재비중: Object.fromEntries(ASSET_TYPES.map(t=>[t, totalAssets>0?+(byType[t]/totalAssets*100).toFixed(1):0])),
      목표비중: goal.targetAllocation, 기록된달수: sortedSnaps.length };
    try{
      const res = await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:500,
          messages:[{role:'user',content:`너는 개인 자산관리 앱의 AI 분석 엔진이다. 아래 사용자 재무 데이터를 바탕으로 한국어로 4~6개의 짧은 인사이트 문장을 bullet 없이 줄바꿈으로 구분해서 작성해줘. 톤은 담백하고 구체적인 수치 중심으로. 데이터: ${JSON.stringify(summary)}`}]})});
      const data = await res.json();
      const text=(data.content||[]).map(c=>c.text||'').join('\n').trim();
      setAiText(text||'분석 결과를 생성하지 못했습니다.');
    }catch(e){ setAiText('AI 분석 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.'); }
    setAiLoading(false);
  };

  if(!ready) return <div style={{padding:60,textAlign:'center',color:'var(--sub)'}}>불러오는 중…</div>;

  const p = Math.max(0, Math.min(100, achieveRate));
  const ringColor = 'var(--blue)';
  const conicStyle = { background: `conic-gradient(${ringColor} ${p*3.6}deg, var(--track-bg) 0deg)` };

  const cycleTheme = () => setTheme(prev => THEME_ORDER[(THEME_ORDER.indexOf(prev)+1)%THEME_ORDER.length]);

  const NAV = [['home','홈','home'],['assets','자산','assets'],['analysis','분석','analysis'],['goalTab','목표','goal'],['settings','설정','settings']];

  const filteredAssets = assetFilter==='전체' ? assets : assets.filter(a=>a.type===assetFilter);

  return (
  <div>
    <div className="header">
      <div className="logo">Asset<span>.</span></div>
      <button className="headerBtn" onClick={cycleTheme} title="테마 변경">{THEME_ICONS[theme]}</button>
    </div>

    <main>
      {/* HOME */}
      <section className={"page"+(tab==='home'?' active':'')}>
        <div className="heroCard glassCard">
          <div className="heroEyebrow">{new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric'})}</div>
          <h1>현재 자산은<br/>{fmtWon(totalAssets)} 입니다.</h1>
          <div className="progressWrapper">
            <div className="progressCircle" style={conicStyle}>
              <span>{p.toFixed(1)}%<small>목표 달성률</small></span>
            </div>
          </div>
          <div className="heroStats heroStats2">
            <div className="statCard"><h2>{fmtWon(goal.targetAmount).replace('원','')}</h2><p>목표(원)</p></div>
            <div className="statCard"><h2 className={remaining<=0?'pos':''}>{fmtWon(Math.max(remaining,0)).replace('원','')}</h2><p>남은 금액</p></div>
          </div>
        </div>

        <div className="grid2">
          <div className="miniCard glassCard"><div className="lbl">이번 달 증감액</div>
            <div className={"val "+(thisMonthChange?(thisMonthChange.diff>=0?'pos':'neg'):'')}>{thisMonthChange?fmtWon(thisMonthChange.diff):'기록 없음'}</div></div>
          <div className="miniCard glassCard"><div className="lbl">이번 달 성장률</div>
            <div className={"val "+(thisMonthChange?(thisMonthChange.rate>=0?'pos':'neg'):'')}>{thisMonthChange?fmtPct(thisMonthChange.rate):'—'}</div></div>
          <div className="miniCard glassCard"><div className="lbl">전체 평균 성장률</div><div className="val">{avgGrowthRate!=null?fmtPct(avgGrowthRate):'—'}</div></div>
          <div className="miniCard glassCard"><div className="lbl">USD 환율</div><div className="val">{rates.USD.toFixed(1)}원</div></div>
        </div>

        <div className="dateBar glassCard">
          <span className="dateBarLbl">예상 달성일</span>
          <span className="dateBarVal">{expectedDate}</span>
        </div>

        <div className="sectionCard glassCard">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
            <h3 style={{margin:0}}>자산 비중</h3>
            <div style={{fontWeight:800,fontSize:16}}>{fmtWon(totalAssets)}</div>
          </div>
          <Doughnut data={ASSET_TYPES.filter(t=>byType[t]>0).map(t=>({label:t,value:byType[t],color:typeColor[t]}))}
            centerLine1="총자산" />
        </div>
      </section>

      {/* ASSETS */}
      <section className={"page"+(tab==='assets'?' active':'')}>
        <div className="pillRow">
          {['전체',...ASSET_TYPES].map(t=>(
            <button key={t} className={"pill"+(assetFilter===t?' active':'')} onClick={()=>setAssetFilter(t)}>{t}</button>
          ))}
        </div>
        {filteredAssets.length===0 && <div className="empty">등록된 자산이 없습니다. 우측 하단 + 버튼으로 추가해보세요.</div>}
        {filteredAssets.map(a=>(
          <div className="itemCard glassCard" key={a.id}>
            <div className="itemHead">
              <div><span className="itemTitle">{a.name}</span><span className="tag">{a.type}</span>
                <div className="itemSub">{a.date}{a.memo?' · '+a.memo:''}</div></div>
              <div style={{textAlign:'right'}}>
                <div style={{fontWeight:700}}>{a.type==='달러'?`$${a.amount.toLocaleString()}`:fmtWon(a.amount)}</div>
                {a.type==='달러' && <div style={{fontSize:11,color:'var(--sub)'}}>≈ {fmtWon(a.amount*rates.USD)}</div>}
              </div>
            </div>
            <div className="itemActions">
              <button className="smallBtn" onClick={()=>{setEditingAsset(a); setShowAssetForm(true);}}>수정</button>
              <button className="smallBtn danger" onClick={()=>deleteAsset(a.id)}>삭제</button>
            </div>
          </div>
        ))}
      </section>

      {/* ANALYSIS (allocation + history + stats + invest) */}
      <section className={"page"+(tab==='analysis'?' active':'')}>
        <div className="sectionCard glassCard">
          <h3>자산 비중 비교</h3>
          <div className="desc">현재 비중과 목표 비중을 비교하고, 목표 비중을 직접 조정해보세요.</div>

          <div className="donut-row">
            <div className="donut-col">
              <Doughnut data={ASSET_TYPES.filter(t=>byType[t]>0).map(t=>({label:t,value:byType[t],color:typeColor[t]}))}
                centerLine1="현재" centerLine2={totalAssets>0?'100%':'—'} />
              <div className="donut-col-label">현재 비중</div>
            </div>
            <div className="donut-col">
              <Doughnut data={ASSET_TYPES.filter(t=>(goal.targetAllocation[t]||0)>0).map(t=>({label:t,value:goal.targetAllocation[t],color:typeColor[t]}))}
                centerLine1="목표" centerLine2={targetSum+'%'} centerColor={targetSum===100?'var(--green)':'var(--red)'} />
              <div className="donut-col-label">목표 비중</div>
            </div>
          </div>

          <div className="allocEditor">
            {ASSET_TYPES.map(t=>{
              const target = goal.targetAllocation[t]||0;
              return (
                <div className="allocRow" key={t}>
                  <div className="allocRowHead">
                    <span><span className="swatch" style={{background:typeColor[t]}}></span>{t}</span>
                    <span className="allocVal">{target}%</span>
                  </div>
                  <input className="slider" type="range" min="0" max="100" step="1" value={target}
                    onChange={e=>setGoal(g=>({...g,targetAllocation:{...g.targetAllocation,[t]:Number(e.target.value)}}))} />
                </div>
              );
            })}
            <div className={"allocSumRow"+(targetSum!==100?' warn':'')}>
              <span>목표 비중 합계</span><span>{targetSum}%{targetSum!==100?' · 100%로 맞춰주세요':' · 완성!'}</span>
            </div>
          </div>

          <div style={{marginTop:18,display:'flex',flexDirection:'column',gap:10}}>
            {ASSET_TYPES.filter(t=>(byType[t]>0)||(goal.targetAllocation[t]>0)).map(t=>{
              const cur = totalAssets>0 ? byType[t]/totalAssets*100 : 0; const target = goal.targetAllocation[t]||0; const diff = cur-target;
              const targetAmount = totalAssets*target/100; const amountDiff = byType[t]-targetAmount;
              return (
                <div className="itemCard" style={{background:'var(--surface-alt)',boxShadow:'none'}} key={t}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                    <div style={{fontWeight:700,display:'flex',alignItems:'center',whiteSpace:'nowrap',flexShrink:0,marginRight:10}}>
                      <span className="swatch" style={{display:'inline-block',width:10,height:10,borderRadius:'50%',background:typeColor[t],marginRight:8,flexShrink:0}}></span>{t}
                    </div>
                    <div style={{textAlign:'right',fontSize:13}}>
                      <div style={{whiteSpace:'nowrap'}}>현재 {cur.toFixed(1)}% / 목표 {target}%</div>
                      <div className={diff>=0?'pos':'neg'} style={{fontWeight:700,marginTop:2,whiteSpace:'nowrap'}}>{diff>=0?'▲':'▼'} {Math.abs(diff).toFixed(1)}%p</div>
                      <div style={{marginTop:4,color:'var(--sub)',fontSize:12}}>
                        {Math.abs(amountDiff)<1 ? '목표 금액과 일치' :
                          amountDiff>0 ? `목표보다 ${fmtWon(amountDiff)} 초과 보유` : `목표까지 ${fmtWon(Math.abs(amountDiff))} 부족`}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="sectionCard glassCard">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
            <h3 style={{marginBottom:0}}>자산 변화 그래프</h3>
            <button className="smallBtn" onClick={saveSnapshot}>{currentMonthSnapshotted?'이번달 갱신':'이번달 기록'}</button>
          </div>
          <div className="desc">매달 한 번 자산을 기록하면 추이가 쌓입니다.</div>
          {sortedSnaps.length===0 ? <div className="empty">아직 월별 기록이 없습니다.</div> : (
            <>
              <div className="pillRow">
                {['총자산',...ASSET_TYPES].map(k=>(
                  <button key={k} className={"pill"+(lineSeries.includes(k)?' active':'')}
                    onClick={()=>setLineSeries(prev=>prev.includes(k)?prev.filter(x=>x!==k):[...prev,k])}>{k}</button>
                ))}
              </div>
              <LineChartMulti snapshots={sortedSnaps} series={lineSeries.length?lineSeries:['총자산']} subColor={subColor} typeColor={typeColor} />
            </>
          )}
        </div>

        <div className="sectionCard glassCard">
          <h3>통계</h3>
          {!stats ? <div className="empty">월별 기록이 2개 이상 쌓이면 통계가 표시됩니다.</div> : (
            <div className="grid2">
              <div className="miniCard" style={{background:'var(--surface-alt)'}}><div className="lbl">최고 증가 달</div><div className="val pos">{monthLabel(stats.best.yearMonth)}</div></div>
              <div className="miniCard" style={{background:'var(--surface-alt)'}}><div className="lbl">최고 감소 달</div><div className={"val "+(stats.worst.diff<0?'neg':'pos')}>{monthLabel(stats.worst.yearMonth)}</div></div>
              <div className="miniCard" style={{background:'var(--surface-alt)'}}><div className="lbl">평균 월 증가액</div><div className="val">{fmtWon(stats.avg)}</div></div>
              <div className="miniCard" style={{background:'var(--surface-alt)'}}><div className="lbl">최고 자산</div><div className="val">{fmtWon(stats.max)}</div></div>
              <div className="miniCard" style={{background:'var(--surface-alt)'}}><div className="lbl">최저 자산</div><div className="val">{fmtWon(stats.min)}</div></div>
              <div className="miniCard" style={{background:'var(--surface-alt)'}}><div className="lbl">누적 성장률</div><div className="val">{stats.cumulative!=null?fmtPct(stats.cumulative):'—'}</div></div>
              <div className="miniCard" style={{background:'var(--surface-alt)'}}><div className="lbl">총 입력 횟수</div><div className="val">{stats.count}회</div></div>
            </div>
          )}
        </div>

        <div className="sectionCard glassCard">
          <h3>투자 수익 분석</h3>
          {assets.filter(a=>INVEST_TYPES.includes(a.type)&&a.principal!=null).length===0 && <div className="empty">투자 자산에 매입 원금을 입력하면 수익률이 표시됩니다.</div>}
          {assets.filter(a=>INVEST_TYPES.includes(a.type)&&a.principal!=null).map(a=>{
            const cur=krwValue(a); const profit=cur-a.principal; const rate=a.principal!==0?profit/a.principal*100:0;
            return (
              <div className="itemCard" style={{background:'var(--surface-alt)',boxShadow:'none'}} key={a.id}>
                <div style={{display:'flex',justifyContent:'space-between'}}>
                  <div><div style={{fontWeight:700}}>{a.name}<span className="tag">{a.type}</span></div>
                    <div className="itemSub">원금 {fmtWon(a.principal)} → 현재가치 {fmtWon(cur)}</div></div>
                  <div style={{textAlign:'right'}} className={profit>=0?'pos':'neg'}><div style={{fontWeight:700}}>{fmtWon(profit)}</div><div style={{fontSize:12}}>{fmtPct(rate)}</div></div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',margin:'4px 4px 10px'}}>
          <h3 style={{fontSize:17}}>히스토리 로그</h3>
          <button className="smallBtn" onClick={()=>setShowLedgerForm(true)}>+ 내역 추가</button>
        </div>
        {ledger.length===0 && <div className="empty">월급, 생활비, 투자 등 내역을 기록해보세요.</div>}
        {[...ledger].sort((a,b)=>b.date.localeCompare(a.date)).map(l=>(
          <div className="itemCard glassCard" key={l.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div><span className="tag">{l.date}</span><span style={{marginLeft:8,fontWeight:700}}>{l.category}</span>{l.note&&<span style={{color:'var(--sub)',fontSize:12}}> · {l.note}</span>}</div>
            <div className={l.amount>=0?'pos':'neg'} style={{fontWeight:700}}>{fmtWon(l.amount)}</div>
          </div>
        ))}
      </section>

      {/* GOAL (simulation + achievements + AI) */}
      <section className={"page"+(tab==='goalTab'?' active':'')}>
        <div className="sectionCard glassCard">
          <h3>목표 시뮬레이션</h3>
          <div className="desc">월 저축 금액을 바꿔보며 목표 달성일을 확인하세요.</div>
          <div className="val" style={{fontSize:26}}>{simSavings.toLocaleString()}원 / 월</div>
          <input className="slider" type="range" min="0" max="3000000" step="10000" value={simSavings} onChange={e=>setSimSavings(Number(e.target.value))}/>
          <div className="desc" style={{marginBottom:6}}>현재 추세 평균: {avgMonthlyIncrease?Math.round(avgMonthlyIncrease).toLocaleString()+'원/월':'데이터 부족'}</div>
          <div className="val" style={{fontSize:19}}>{simDate}</div>
        </div>

        <div className="sectionCard glassCard">
          <h3>목표 금액 설정</h3>
          <div className="inputGroup"><label>목표 자산 금액 (원)</label>
            <input type="number" value={goal.targetAmount} onChange={e=>setGoal(g=>({...g,targetAmount:Number(e.target.value)}))} /></div>
        </div>

        <div className="sectionCard glassCard">
          <h3>업적</h3>
          <div className="grid2" style={{gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))'}}>
            {achievementDefs.map(d=>{ const unlocked=d.test();
              return <div className={"badge"+(unlocked?'':' locked')} key={d.id}><div className="badge-icon">{d.icon}</div><div style={{fontSize:12,fontWeight:600}}>{d.label}</div></div>;
            })}
          </div>
        </div>

        <div className="sectionCard glassCard">
          <h3>AI 자산 분석</h3>
          <div className="desc">현재 데이터를 기반으로 Claude가 리포트를 생성합니다.</div>
          <button className="btn" onClick={runAI} disabled={aiLoading}>{aiLoading?'분석 중…':'AI 분석 생성'}</button>
          {aiText && <div style={{marginTop:16,fontSize:14,lineHeight:1.8,whiteSpace:'pre-line'}}>{aiText}</div>}
        </div>
      </section>

      {/* SETTINGS */}
      <section className={"page"+(tab==='settings'?' active':'')}>
        <div className="settingsList">
          <div className="settingItem themeSettingItem glassCard">
            <span>🎨 테마</span>
            <div className="themeOptions">
              <button className={"themeOption"+(theme==='default'?' active':'')} onClick={()=>setTheme('default')}><span className="themeSwatch themeSwatchDefault"></span>기본</button>
              <button className={"themeOption"+(theme==='dark'?' active':'')} onClick={()=>setTheme('dark')}><span className="themeSwatch themeSwatchDark"></span>다크</button>
              <button className={"themeOption"+(theme==='apple'?' active':'')} onClick={()=>setTheme('apple')}><span className="themeSwatch themeSwatchApple"></span>메탈</button>
              <button className={"themeOption"+(theme==='glass'?' active':'')} onClick={()=>setTheme('glass')}><span className="themeSwatch themeSwatchGlass"></span>글래스</button>
            </div>
          </div>

          {theme==='apple' && (
            <div className="settingItem glassCard">
              <span>⛓️ 메탈 다크 모드</span>
              <div className={"switchToggle"+(!metalLight?' on':'')} onClick={()=>setMetalLight(m=>!m)}><span className="switchKnob"></span></div>
            </div>
          )}

          <div
            className="settingItem glassCard"
            style={{cursor:'pointer'}}
            onClick={()=>{
              if(driveInfo.connected){
                if(confirm('구글 드라이브 자동 저장을 해제할까요?')) disconnectGoogleDrive();
              }else{
                connectGoogleDrive();
              }
            }}
          >
            <span>☁️ 구글 드라이브 자동 저장</span>
            <span className="driveStatusWrap">
              <span>{driveInfo.label}</span>
              <small className="driveTime">{driveInfo.time}</small>
            </span>
          </div>

          <div className="settingItem glassCard" onClick={exportCSV}><span>📄 CSV 내보내기</span><span>›</span></div>
          <div className="settingItem glassCard" onClick={exportXLSX}><span>📊 Excel 내보내기</span><span>›</span></div>
          <div className="settingItem glassCard" onClick={backupJSON}><span>💾 전체 백업 (JSON)</span><span>›</span></div>
          <label className="settingItem glassCard" style={{cursor:'pointer'}}>
            <span>♻️ 데이터 복원</span><span>›</span>
            <input type="file" accept=".json" onChange={restoreJSON} style={{display:'none'}} />
          </label>
          <div className="settingItem glassCard" onClick={()=>window.print()}><span>🖨️ PDF 리포트 인쇄</span><span>›</span></div>
        </div>

        <div className="footer-note">
          
        </div>
      </section>
    </main>

    {tab==='assets' && <button className="fab" onClick={()=>{setEditingAsset(null); setShowAssetForm(true);}}>+</button>}

    <nav className="bottomNav">
      {NAV.map(([key,label,icon])=>(
        <button key={key} className={"navBtn"+(tab===key?' active':'')} onClick={()=>setTab(key)}>
          <span className="navIcon">{ICONS[icon]}</span><small>{label}</small>
        </button>
      ))}
    </nav>

    {showAssetForm && <AssetForm initial={editingAsset} onSave={handleSaveAsset} onClose={()=>{setShowAssetForm(false); setEditingAsset(null);}} />}
    {showLedgerForm && <LedgerForm onSave={(l)=>{setLedger(prev=>[...prev,l]); setShowLedgerForm(false);}} onClose={()=>setShowLedgerForm(false)} />}
  </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
