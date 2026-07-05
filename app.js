/* =======================================================
   Bucket App v0.2
   app.js - Part 1
======================================================= */

const STORAGE_KEY = "bucket_v02";
const CUSTOM_QUOTE_KEY = "bucket_custom_quotes";

const toastContainer =
document.getElementById("toastContainer");

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
const DRIVE_FILE_NAME = "bucket_app_backup.json";
const DRIVE_FILE_ID_KEY = "bucket_drive_file_id";
const DRIVE_CONNECTED_KEY = "bucket_drive_connected";
const DRIVE_LAST_SYNC_KEY = "bucket_drive_last_sync";
const PHOTO_DB_NAME = "bucket_photos_v2";
const PHOTO_STORE = "photos";
const PHOTO_MAX_SIZE = 1200;
const PHOTO_QUALITY = 0.75;
const PHOTO_LIMIT = 20;
const BACKUP_VERSION = 3;

let buckets = [];
let editingId = null;
let currentCategory = "전체";
let sortMode = "latest";
let completingBucketId = null;
let pendingPhotos = [];
let viewingPhotoId = null;
let celebrateMode = "complete";

let googleAccessToken = null;
let googleTokenClient = null;
let googleManualConnect = false;
let driveSyncTimer = null;
let driveSyncInProgress = false;

const quotes = [
    "오늘의 작은 한 걸음이 내일의 큰 변화를 만듭니다.",
    "꿈은 적는 순간 목표가 됩니다.",
    "시작이 가장 어려운 법입니다.",
    "포기하지 않는 사람이 결국 이깁니다.",
    "지금이 가장 젊은 순간입니다.",
    "하고 싶은 일은 미루지 마세요.",
    "매일 1%씩 성장하면 충분합니다.",
    "오늘을 후회 없이 살아보세요."
];

/* ============================= */

const pages = document.querySelectorAll(".page");

const navButtons = document.querySelectorAll(".navButton");

const bucketList = document.getElementById("bucketList");

const searchInput = document.getElementById("searchInput");

const categoryButtons =
document.querySelectorAll(".category");

const addButton =
document.getElementById("addButton");

const bucketModal =
document.getElementById("bucketModal");

const saveButton =
document.getElementById("saveButton");

const cancelButton =
document.getElementById("cancelButton");

const titleInput =
document.getElementById("titleInput");

const memoInput =
document.getElementById("memoInput");

const categoryInput =
document.getElementById("categoryInput");

const dateInput =
document.getElementById("dateInput");

const starInput =
document.getElementById("starInput");

const progressCircle =
document.getElementById("progressCircle");

const progressPercent =
document.getElementById("progressPercent");

const totalCount =
document.getElementById("totalCount");

const doneCount =
document.getElementById("doneCount");

const remainCount =
document.getElementById("remainCount");

const todayDate =
document.getElementById("todayDate");

const todayQuote =
document.getElementById("todayQuote");

const addQuoteButton =
document.getElementById("addQuoteButton");

const quoteModal =
document.getElementById("quoteModal");

const quoteTextInput =
document.getElementById("quoteTextInput");

const quoteAddSaveButton =
document.getElementById("quoteAddSaveButton");

const quoteCloseButton =
document.getElementById("quoteCloseButton");

const myQuoteList =
document.getElementById("myQuoteList");

const googleDriveButton =
document.getElementById("googleDriveButton");

const googleDriveStatus =
document.getElementById("googleDriveStatus");

const googleDriveTime =
document.getElementById("googleDriveTime");

const recentBuckets =
document.getElementById("recentBuckets");

const themeButton =
document.getElementById("themeButton");

const themeOptionButtons =
document.querySelectorAll(".themeOption");

const metalDarkSettingItem =
document.getElementById("metalDarkSettingItem");

const metalDarkToggle =
document.getElementById("metalDarkToggle");

const exportButton =
document.getElementById("exportButton");

const importButton =
document.getElementById("importButton");

const importFile =
document.getElementById("importFile");


const celebrateModal =
document.getElementById("celebrateModal");

const welcomeModal =
document.getElementById("welcomeModal");

const welcomeCloseButton =
document.getElementById("welcomeCloseButton");

const celebrateTitle =
document.getElementById("celebrateTitle");

const photoInput =
document.getElementById("photoInput");

const photoPreview =
document.getElementById("photoPreview");

const photoPlaceholder =
document.getElementById("photoPlaceholder");

const celebrateSaveButton =
document.getElementById("celebrateSaveButton");

const celebrateSkipButton =
document.getElementById("celebrateSkipButton");

const photoViewModal =
document.getElementById("photoViewModal");

const photoViewImage =
document.getElementById("photoViewImage");

const photoViewTitle =
document.getElementById("photoViewTitle");

const closePhotoView =
document.getElementById("closePhotoView");

const photoPreviewGrid =
document.getElementById("photoPreviewGrid");

const photoLimitHint =
document.getElementById("photoLimitHint");

const photoInputLabel =
document.getElementById("photoInputLabel");

const replacePhotoButton =
document.getElementById("replacePhotoButton");

const deletePhotoButton =
document.getElementById("deletePhotoButton");

const replacePhotoInput =
document.getElementById("replacePhotoInput");

const photoViewBucket =
document.getElementById("photoViewBucket");

const galleryGrid =
document.getElementById("galleryGrid");

const galleryCount =
document.getElementById("galleryCount");


/* ============================= */

function getPhotoLimit(){

    return PHOTO_LIMIT;

}

function ensurePhotoIds(bucket){

    if(!Array.isArray(bucket.photoIds)){

        bucket.photoIds=[];

    }

}

function openPhotoDB(){

    return new Promise((resolve, reject)=>{

        const request=
        indexedDB.open(PHOTO_DB_NAME, 1);

        request.onupgradeneeded=()=>{

            const db=request.result;

            if(!db.objectStoreNames.contains(PHOTO_STORE)){

                db.createObjectStore(PHOTO_STORE);

            }

        };

        request.onsuccess=()=>resolve(request.result);

        request.onerror=()=>reject(request.error);

    });

}

async function savePhotoRecord(photoId, record){

    const db=await openPhotoDB();

    return new Promise((resolve, reject)=>{

        const tx=db.transaction(PHOTO_STORE, "readwrite");

        tx.objectStore(PHOTO_STORE).put(record, photoId);

        tx.oncomplete=()=>{

            db.close();

            resolve();

        };

        tx.onerror=()=>reject(tx.error);

    });

}

async function getPhotoRecord(photoId){

    const db=await openPhotoDB();

    return new Promise((resolve, reject)=>{

        const tx=db.transaction(PHOTO_STORE, "readonly");

        const request=
        tx.objectStore(PHOTO_STORE).get(photoId);

        request.onsuccess=()=>{

            db.close();

            resolve(request.result || null);

        };

        request.onerror=()=>reject(request.error);

    });

}

async function deletePhotoRecord(photoId){

    const db=await openPhotoDB();

    return new Promise((resolve, reject)=>{

        const tx=db.transaction(PHOTO_STORE, "readwrite");

        tx.objectStore(PHOTO_STORE).delete(photoId);

        tx.oncomplete=()=>{

            db.close();

            resolve();

        };

        tx.onerror=()=>reject(tx.error);

    });

}

async function getAllPhotoRecords(){

    const db=await openPhotoDB();

    return new Promise((resolve, reject)=>{

        const tx=db.transaction(PHOTO_STORE, "readonly");

        const request=
        tx.objectStore(PHOTO_STORE).getAll();

        request.onsuccess=()=>{

            db.close();

            resolve(request.result || []);

        };

        request.onerror=()=>reject(request.error);

    });

}

async function getAllPhotoKeys(){

    const db=await openPhotoDB();

    return new Promise((resolve, reject)=>{

        const tx=db.transaction(PHOTO_STORE, "readonly");

        const request=
        tx.objectStore(PHOTO_STORE).getAllKeys();

        request.onsuccess=()=>{

            db.close();

            resolve(request.result || []);

        };

        request.onerror=()=>reject(request.error);

    });

}

async function clearAllPhotoRecords(){

    const db=await openPhotoDB();

    return new Promise((resolve, reject)=>{

        const tx=db.transaction(PHOTO_STORE, "readwrite");

        tx.objectStore(PHOTO_STORE).clear();

        tx.oncomplete=()=>{

            db.close();

            resolve();

        };

        tx.onerror=()=>reject(tx.error);

    });

}

async function migrateLegacyPhotos(){

    const legacyDbName="bucket_photos_v1";

    return new Promise(resolve=>{

        const request=indexedDB.open(legacyDbName, 1);

        request.onsuccess=async()=>{

            const db=request.result;

            if(!db.objectStoreNames.contains("photos")){

                db.close();

                resolve();

                return;

            }

            const tx=db.transaction("photos", "readonly");

            const getAll=tx.objectStore("photos").getAll();

            const getKeys=tx.objectStore("photos").getAllKeys();

            Promise.all([
                new Promise(r=>{
                    getAll.onsuccess=()=>r(getAll.result || []);
                }),
                new Promise(r=>{
                    getKeys.onsuccess=()=>r(getKeys.result || []);
                })
            ]).then(async([values, keys])=>{

                for(let i=0; i<keys.length; i++){

                    const bucketId=Number(keys[i]);

                    const dataUrl=values[i];

                    if(!dataUrl || typeof dataUrl!=="string") continue;

                    const bucket=
                    buckets.find(b=>b.id===bucketId);

                    if(!bucket) continue;

                    ensurePhotoIds(bucket);

                    if(bucket.photoIds.length>0) continue;

                    const photoId=Date.now()+i;

                    await savePhotoRecord(photoId, {
                        bucketId,
                        dataUrl,
                        createdAt:Date.now()
                    });

                    bucket.photoIds.push(photoId);

                }

                db.close();

                indexedDB.deleteDatabase(legacyDbName);

                saveStorage();

                resolve();

            });

        };

        request.onerror=()=>resolve();

    });

}

function normalizeBuckets(){

    buckets.forEach(bucket=>{

        ensurePhotoIds(bucket);

        if(bucket.hasPhoto && bucket.photoIds.length===0){

            delete bucket.hasPhoto;

        }

    });

}

function getBucketPhotoCount(bucket){

    ensurePhotoIds(bucket);

    return bucket.photoIds.length;

}

function canAddMorePhotos(bucket, extraCount=1){

    return getBucketPhotoCount(bucket)+extraCount<=getPhotoLimit();

}

async function addPhotoToBucket(bucket, dataUrl){

    ensurePhotoIds(bucket);

    if(!canAddMorePhotos(bucket)){

        alert(`버킷당 최대 ${PHOTO_LIMIT}장까지 저장할 수 있습니다.`);

        return null;

    }

    const photoId=Date.now()+Math.floor(Math.random()*1000);

    await savePhotoRecord(photoId, {
        bucketId:bucket.id,
        dataUrl,
        createdAt:Date.now()
    });

    bucket.photoIds.push(photoId);

    saveStorage();

    return photoId;

}

async function removePhotoFromBucket(bucket, photoId){

    ensurePhotoIds(bucket);

    bucket.photoIds=
    bucket.photoIds.filter(
        id=>Number(id)!==Number(photoId)
    );

    await deletePhotoRecord(photoId);

    saveStorage();

}

async function replacePhotoRecord(photoId, dataUrl){

    const record=await getPhotoRecord(photoId);

    if(!record) return false;

    record.dataUrl=dataUrl;

    await savePhotoRecord(photoId, record);

    return true;

}

async function deleteAllBucketPhotos(bucket){

    ensurePhotoIds(bucket);

    for(const photoId of [...bucket.photoIds]){

        await deletePhotoRecord(photoId);

    }

    bucket.photoIds=[];

}

async function getAllPhotosWithMeta(){

    const keys=await getAllPhotoKeys();

    const photos=[];

    for(const photoId of keys){

        const record=await getPhotoRecord(photoId);

        if(!record) continue;

        const bucket=
        buckets.find(b=>b.id===record.bucketId);

        photos.push({
            photoId:Number(photoId),
            bucketId:record.bucketId,
            dataUrl:record.dataUrl,
            createdAt:record.createdAt || 0,
            bucketTitle:bucket?.title || "삭제된 버킷"
        });

    }

    return photos.sort((a,b)=>b.createdAt-a.createdAt);

}

async function buildPhotosExport(){

    const keys=await getAllPhotoKeys();

    const photos=[];

    for(const photoId of keys){

        const record=await getPhotoRecord(photoId);

        if(!record) continue;

        photos.push({
            id:Number(photoId),
            bucketId:record.bucketId,
            dataUrl:record.dataUrl,
            createdAt:record.createdAt || Date.now()
        });

    }

    return photos;

}

async function restorePhotosExport(photos, replace=false){

    if(replace){

        await clearAllPhotoRecords();

        buckets.forEach(bucket=>{

            bucket.photoIds=[];

        });

    }

    for(const photo of photos){

        if(!photo?.dataUrl || !photo?.bucketId) continue;

        const bucket=
        buckets.find(b=>b.id===photo.bucketId);

        if(!bucket) continue;

        ensurePhotoIds(bucket);

        const photoId=photo.id || Date.now()+Math.floor(Math.random()*1000);

        if(bucket.photoIds.includes(photoId)) continue;

        await savePhotoRecord(photoId, {
            bucketId:photo.bucketId,
            dataUrl:photo.dataUrl,
            createdAt:photo.createdAt || Date.now()
        });

        bucket.photoIds.push(photoId);

    }

    saveStorage();

}

function downloadJson(data, filename){

    const blob=
    new Blob(
        [JSON.stringify(data, null, 2)],
        { type:"application/json" }
    );

    const url=URL.createObjectURL(blob);

    const a=document.createElement("a");

    a.href=url;

    a.download=filename;

    a.click();

    URL.revokeObjectURL(url);

}

function compressImage(file){

    return new Promise((resolve, reject)=>{

        const reader=new FileReader();

        reader.onload=()=>{

            const img=new Image();

            img.onload=()=>{

                const scale=
                Math.min(
                    1,
                    PHOTO_MAX_SIZE /
                    Math.max(img.width, img.height)
                );

                const canvas=
                document.createElement("canvas");

                canvas.width=
                Math.round(img.width * scale);

                canvas.height=
                Math.round(img.height * scale);

                const ctx=
                canvas.getContext("2d");

                ctx.drawImage(
                    img,
                    0,
                    0,
                    canvas.width,
                    canvas.height
                );

                resolve(
                    canvas.toDataURL(
                        "image/jpeg",
                        PHOTO_QUALITY
                    )
                );

            };

            img.onerror=reject;

            img.src=reader.result;

        };

        reader.onerror=reject;

        reader.readAsDataURL(file);

    });

}

function resetCelebrateForm(){

    pendingPhotos=[];

    photoInput.value="";

    photoPreview.src="";

    photoPreview.classList.add("hidden");

    photoPlaceholder.classList.remove("hidden");

    photoPreviewGrid.innerHTML="";

    photoPreviewGrid.classList.add("hidden");

    updateCelebrateHint();

}

function updateCelebrateHint(){

    const bucket=
    buckets.find(b=>b.id===completingBucketId);

    const existingCount=
    bucket ? getBucketPhotoCount(bucket) : 0;

    const remaining=
    getPhotoLimit()-existingCount-pendingPhotos.length;

    photoLimitHint.textContent=
    `버킷당 최대 ${PHOTO_LIMIT}장 · 추가 가능 ${Math.max(remaining,0)}장`;

    photoInput.multiple=true;

    photoInputLabel.textContent=
    "기념 사진 (여러 장 선택 가능)";

}

function renderPendingPreviews(){

    photoPreviewGrid.innerHTML="";

    if(pendingPhotos.length===0){

        photoPreviewGrid.classList.add("hidden");

        if(!photoPreview.src){

            photoPreview.classList.add("hidden");

            photoPlaceholder.classList.remove("hidden");

        }

        return;

    }

    photoPreviewGrid.classList.remove("hidden");

    photoPreview.classList.add("hidden");

    photoPlaceholder.classList.add("hidden");

    pendingPhotos.forEach((dataUrl, index)=>{

        const item=document.createElement("div");

        item.className="previewItem";

        item.innerHTML=`

            <img src="${dataUrl}" alt="미리보기">

            <button
                type="button"
                class="previewRemove"
                data-index="${index}">

                ✕

            </button>

        `;

        item.querySelector(".previewRemove").onclick=e=>{

            e.preventDefault();

            e.stopPropagation();

            pendingPhotos.splice(index, 1);

            renderPendingPreviews();

            updateCelebrateHint();

        };

        photoPreviewGrid.appendChild(item);

    });

}

function openCelebrateModal(item, mode="complete"){

    completingBucketId=item.id;

    celebrateMode=mode;

    celebrateTitle.textContent=
    mode==="complete"
    ? `"${item.title}" 달성!`
    : `"${item.title}" 사진 추가`;

    celebrateSkipButton.textContent=
    mode==="complete"
    ? "사진 없이 완료"
    : "닫기";

    celebrateSaveButton.textContent=
    mode==="complete"
    ? "완료 저장"
    : "사진 저장";

    resetCelebrateForm();

    celebrateModal.classList.add("show");

}

function closeCelebrateModal(){

    celebrateModal.classList.remove("show");

    completingBucketId=null;

    celebrateMode="complete";

    resetCelebrateForm();

}

function openPhotoView(photo){

    viewingPhotoId=photo.photoId;

    photoViewTitle.textContent=photo.bucketTitle;

    photoViewBucket.textContent=
    new Date(photo.createdAt).toLocaleDateString("ko-KR")+
    " · 탭하여 관리";

    photoViewImage.src=photo.dataUrl;

    photoViewModal.classList.add("show");

}

function closePhotoViewModal(){

    photoViewModal.classList.remove("show");

    photoViewImage.src="";

    viewingPhotoId=null;

}

async function finishCompletion(withPhoto){

    const item=
    buckets.find(
        b=>b.id===completingBucketId
    );

    if(!item) return;

    if(celebrateMode==="complete"){

        item.completed=true;

    }

    if(withPhoto && pendingPhotos.length>0){

        for(const dataUrl of pendingPhotos){

            if(!canAddMorePhotos(item)) break;

            await addPhotoToBucket(item, dataUrl);

        }

    }

    saveStorage();

    closeCelebrateModal();

    render();

    if(document.getElementById("galleryPage").classList.contains("active")){

        renderGallery();

    }

}

async function renderBucketPhotos(item, container){

    ensurePhotoIds(item);

    if(!item.completed || item.photoIds.length===0) return;

    const photos=[];

    for(const photoId of item.photoIds){

        const record=await getPhotoRecord(photoId);

        if(!record){

            await removePhotoFromBucket(item, photoId);

            continue;

        }

        photos.push({
            photoId,
            bucketId:item.id,
            dataUrl:record.dataUrl,
            createdAt:record.createdAt || 0,
            bucketTitle:item.title
        });

    }

    if(photos.length===0) return;

    const wrap=document.createElement("div");

    wrap.className="bucketPhotoGrid";

    if(photos.length>1){

        const count=document.createElement("div");

        count.className="bucketPhotoCount";

        count.textContent=
        `📷 기념 사진 ${photos.length}장`;

        wrap.appendChild(count);

    }

    photos.slice(0, 3).forEach(photo=>{

        const photoWrap=document.createElement("div");

        photoWrap.className="bucketPhoto";

        photoWrap.innerHTML=`<img src="${photo.dataUrl}" alt="기념 사진">`;

        photoWrap.onclick=()=>openPhotoView(photo);

        wrap.appendChild(photoWrap);

    });

    container.insertBefore(
        wrap,
        container.querySelector(".bucketButtons")
    );

}

photoInput.onchange=async e=>{

    const files=[...e.target.files];

    if(files.length===0) return;

    const bucket=
    buckets.find(b=>b.id===completingBucketId);

    for(const file of files){

        if(!file.type.startsWith("image/")) continue;

        if(!canAddMorePhotos(
            bucket || { photoIds:[] },
            pendingPhotos.length+1
        )){

            alert(`버킷당 최대 ${PHOTO_LIMIT}장까지 저장할 수 있습니다.`);

            break;

        }

        try{

            const dataUrl=await compressImage(file);

            pendingPhotos.push(dataUrl);

        }catch{

            alert("사진을 불러오지 못했습니다.");

        }

    }

    renderPendingPreviews();

    updateCelebrateHint();

    photoInput.value="";

};

celebrateSaveButton.onclick=()=>{

    finishCompletion(pendingPhotos.length>0 || !!photoPreview.src);

};

celebrateSkipButton.onclick=()=>{

    if(celebrateMode==="complete"){

        finishCompletion(false);

    }else{

        closeCelebrateModal();

    }

};

celebrateModal.onclick=e=>{

    if(e.target===celebrateModal){

        closeCelebrateModal();

    }

};

photoViewModal.onclick=e=>{

    if(e.target===photoViewModal){

        closePhotoViewModal();

    }

};

closePhotoView.onclick=closePhotoViewModal;

replacePhotoButton.onclick=()=>{

    replacePhotoInput.click();

};

replacePhotoInput.onchange=async e=>{

    const file=e.target.files[0];

    if(!file || !viewingPhotoId) return;

    if(!file.type.startsWith("image/")){

        alert("이미지 파일만 업로드할 수 있습니다.");

        return;

    }

    try{

        const dataUrl=await compressImage(file);

        await replacePhotoRecord(viewingPhotoId, dataUrl);

        photoViewImage.src=dataUrl;

        render();

        renderGallery();

        alert("사진이 교체되었습니다.");

    }catch{

        alert("사진을 교체하지 못했습니다.");

    }

    replacePhotoInput.value="";

};

deletePhotoButton.onclick=async()=>{

    if(!viewingPhotoId) return;

    if(!confirm("이 사진을 삭제하시겠습니까?")) return;

    const record=await getPhotoRecord(viewingPhotoId);

    if(record){

        const bucket=
        buckets.find(b=>b.id===record.bucketId);

        if(bucket){

            await removePhotoFromBucket(
                bucket,
                viewingPhotoId
            );

        }else{

            await deletePhotoRecord(viewingPhotoId);

        }

    }

    closePhotoViewModal();

    render();

    renderGallery();

};

async function renderGallery(){

    if(!galleryGrid) return;

    galleryGrid.innerHTML="";

    const photos=await getAllPhotosWithMeta();

    galleryCount.textContent=`${photos.length}장`;

    if(photos.length===0){

        galleryGrid.innerHTML=`

            <div class="galleryEmpty">

                아직 기념 사진이 없습니다.<br>

                버킷을 완료하고 사진을 남겨보세요.

            </div>

        `;

        return;

    }

    photos.forEach(photo=>{

        const item=document.createElement("div");

        item.className="galleryItem";

        item.innerHTML=`

            <img src="${photo.dataUrl}" alt="${photo.bucketTitle}">

            <div class="galleryOverlay">

                <div class="galleryTitle">

                    ${photo.bucketTitle}

                </div>

                <div class="galleryMeta">

                    ${new Date(photo.createdAt).toLocaleDateString("ko-KR")}

                </div>

            </div>

        `;

        item.onclick=()=>openPhotoView(photo);

        galleryGrid.appendChild(item);

    });

}


/* ============================= */

function todayString(){

    const now=new Date();

    const week=["일","월","화","수","목","금","토"];

    return `${now.getFullYear()}년 ${now.getMonth()+1}월 ${now.getDate()}일 (${week[now.getDay()]})`;

}

todayDate.textContent=todayString();

/* ===== 사용자 정의 오늘의 문구 ===== */

function loadCustomQuotes(){

    try{

        return JSON.parse(
            localStorage.getItem(CUSTOM_QUOTE_KEY)
        ) || [];

    }catch{

        return [];

    }

}

function saveCustomQuotes(list){

    localStorage.setItem(
        CUSTOM_QUOTE_KEY,
        JSON.stringify(list)
    );

    scheduleDriveSync();

}

function getAllQuotes(){

    return quotes.concat(loadCustomQuotes());

}

function showRandomQuote(){

    const pool = getAllQuotes();

    todayQuote.textContent =
    pool[
        Math.floor(
            Math.random() * pool.length
        )
    ];

}

function renderMyQuoteList(){

    const custom = loadCustomQuotes();

    if(custom.length === 0){

        myQuoteList.innerHTML =
        `<p class="myQuoteEmpty">아직 추가한 문구가 없습니다.</p>`;

        return;

    }

    myQuoteList.innerHTML = custom.map((q, i) => `
        <div class="myQuoteItem">
            <p>${escapeHtml(q)}</p>
            <button class="myQuoteDelete" data-index="${i}">✕</button>
        </div>
    `).join("");

}

function escapeHtml(str){

    const div = document.createElement("div");

    div.textContent = str;

    return div.innerHTML;

}

showRandomQuote();

addQuoteButton.addEventListener("click", () => {

    quoteTextInput.value = "";

    renderMyQuoteList();

    quoteModal.classList.add("show");

});

quoteCloseButton.addEventListener("click", () => {

    quoteModal.classList.remove("show");

});

quoteModal.addEventListener("click", (e) => {

    if(e.target === quoteModal){

        quoteModal.classList.remove("show");

    }

});

quoteAddSaveButton.addEventListener("click", () => {

    const text = quoteTextInput.value.trim();

    if(!text){

        alert("문구를 입력해주세요.");

        return;

    }

    const custom = loadCustomQuotes();

    custom.push(text);

    saveCustomQuotes(custom);

    quoteTextInput.value = "";

    renderMyQuoteList();

    showRandomQuote();

});

myQuoteList.addEventListener("click", (e) => {

    const btn = e.target.closest(".myQuoteDelete");

    if(!btn) return;

    const index = Number(btn.dataset.index);

    const custom = loadCustomQuotes();

    custom.splice(index, 1);

    saveCustomQuotes(custom);

    renderMyQuoteList();

    showRandomQuote();

});

/* ============================= */

function saveStorage(){

    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(buckets)
    );

    scheduleDriveSync();

}

function loadStorage(){

    const data=
    localStorage.getItem(STORAGE_KEY);

    if(!data) return;

    try{

        const parsed=JSON.parse(data);

        if(Array.isArray(parsed)){

            buckets=parsed;

        }else{

            throw new Error("저장된 데이터 형식이 배열이 아닙니다.");

        }

    }catch(err){

        console.error("버킷 데이터를 불러오는 중 오류가 발생했습니다. 손상된 데이터를 백업하고 초기화합니다.", err);

        try{

            localStorage.setItem(STORAGE_KEY+"_corrupted_backup", data);

        }catch(backupErr){

            console.error("손상된 데이터 백업 실패:", backupErr);

        }

        buckets=[];

    }

}

/* ============================= */

function openModal(){

    bucketModal.classList.add("show");

}

function closeModal(){

    bucketModal.classList.remove("show");

}

addButton.onclick=()=>{

    editingId=null;

    titleInput.value="";

    memoInput.value="";

    categoryInput.value="여행";

    dateInput.value="";

    starInput.value="false";

    document.getElementById("modalTitle").textContent=
    "새 버킷리스트";

    openModal();

};

cancelButton.onclick=closeModal;

bucketModal.onclick=e=>{

    if(e.target===bucketModal){

        closeModal();

    }

};

/* ============================= */

saveButton.onclick=()=>{

    const title=
    titleInput.value.trim();

    if(title===""){

        alert("제목을 입력해주세요.");

        return;

    }

    const bucket={

        id:
        editingId ??
        Date.now(),

        title,

        memo:
        memoInput.value.trim(),

        category:
        categoryInput.value,

        date:
        dateInput.value,

        star:
        starInput.value==="true",

        completed:false,

        created:
        Date.now(),

        photoIds:[]

    };

    if(editingId){

        const index=
        buckets.findIndex(
        b=>b.id===editingId
        );

        bucket.completed=
        buckets[index].completed;

        bucket.created=
        buckets[index].created;

        bucket.photoIds=
        [...(buckets[index].photoIds || [])];

        buckets[index]=bucket;

    }else{

        buckets.push(bucket);

    }

    saveStorage();

    closeModal();

    render();

};

/* =======================================================
   app.js - Part 2
======================================================= */

function getDday(date){

    if(!date) return "날짜 없음";

    const today = new Date();
    today.setHours(0,0,0,0);

    const target = new Date(date);

    const diff =
    Math.ceil(
    (target-today)/(1000*60*60*24)
    );

    if(diff>0) return `D-${diff}`;

    if(diff===0) return "D-Day";

    return `D+${Math.abs(diff)}`;

}

/* ============================= */

function updateStats(){

    const total=buckets.length;

    const done=
    buckets.filter(
    b=>b.completed
    ).length;

    const remain=
    total-done;

    totalCount.textContent=total;

    doneCount.textContent=done;

    remainCount.textContent=remain;

    const percent=
    total===0
    ?0
    :Math.round(done/total*100);

    progressPercent.textContent=
    percent+"%";

    progressCircle.style.background=
    `conic-gradient(
        var(--blue)
        ${percent*3.6}deg,
        var(--track-bg)
        0deg
    )`;

}

/* ============================= */

function renderRecent(){

    recentBuckets.innerHTML="";

    const latest=[...buckets]

    .sort((a,b)=>b.created-a.created)

    .slice(0,3);

    if(latest.length===0){

        recentBuckets.innerHTML=

        `<p style="color:var(--sub);">

        아직 목표가 없습니다.

        </p>`;

        return;

    }

    latest.forEach(item=>{

        const div=
        document.createElement("div");

        div.className="recentItem";

        div.innerHTML=`

            <div>

                <div class="recentTitle">

                    ${item.title}

                </div>

                <div class="recentDate">

                    ${getDday(item.date)}

                </div>

            </div>

            <div>

                ${item.star?"⭐":""}

            </div>

        `;

        recentBuckets.appendChild(div);

    });

}

/* ============================= */

function render(){

    let list=[...buckets];

    const keyword=
    searchInput.value
    .trim()
    .toLowerCase();

    if(currentCategory!=="전체"){

        list=list.filter(

        b=>b.category===currentCategory

        );

    }

    if(keyword){

        list=list.filter(b=>

        b.title
        .toLowerCase()
        .includes(keyword)

        ||

        b.memo
        .toLowerCase()
        .includes(keyword)

        );

    }

    if(sortMode==="latest"){

        list.sort(

        (a,b)=>

        b.created-a.created

        );

    }

    if(sortMode==="star"){

        list.sort(

        (a,b)=>

        Number(b.star)-Number(a.star)

        );

    }

    bucketList.innerHTML="";

    if(list.length===0){

        bucketList.innerHTML=

        `<div class="empty">

        버킷리스트가 없습니다.

        </div>`;

        updateStats();

        renderRecent();

        return;

    }

    list.forEach(item=>{

        const card=

        document.createElement("div");

        card.className=

        `bucketCard
        ${item.completed?"completed":""}`;

        const photoButton=
        item.completed && canAddMorePhotos(item)
        ? `<button class="photoButton">${
            getBucketPhotoCount(item)>0 ? "📷 추가" : "📷 사진"
        }</button>`
        : "";

        card.innerHTML=`

<div class="bucketHeader">

<div class="bucketTitle">

${item.title}

</div>

<div class="bucketStar">

${item.star?"⭐":"☆"}

</div>

</div>

<div class="bucketTags">

<div class="tag">

${item.category}

</div>

<div class="tag">

${getDday(item.date)}

</div>

</div>

<div class="bucketMemo">

${item.memo||"메모 없음"}

</div>

<div class="bucketButtons">

<button
class="completeButton">

${item.completed?"취소":"완료"}

</button>

${photoButton}

<button
class="editButton">

수정

</button>

<button
class="deleteButton">

삭제

</button>

</div>

`;

        bucketList.appendChild(card);

        renderBucketPhotos(item, card);

        /* 완료 */

        card
        .querySelector(".completeButton")
        .onclick=async()=>{

            if(!item.completed){

                openCelebrateModal(item);

                return;

            }

            item.completed=false;

            saveStorage();

            render();

        };

        const photoBtn=
        card.querySelector(".photoButton");

        if(photoBtn){

            photoBtn.onclick=()=>{

                openCelebrateModal(item, "add");

            };

        }

        /* 삭제 */

        card
        .querySelector(".deleteButton")
        .onclick=async()=>{

            if(confirm("삭제하시겠습니까?")){

                await deleteAllBucketPhotos(item);

                buckets=

                buckets.filter(

                b=>b.id!==item.id

                );

                saveStorage();

                render();

            }

        };

        /* 수정 */

        card
        .querySelector(".editButton")
        .onclick=()=>{

            editingId=item.id;

            titleInput.value=item.title;

            memoInput.value=item.memo;

            categoryInput.value=item.category;

            dateInput.value=item.date;

            starInput.value=item.star;

            document.getElementById("modalTitle").textContent=

            "버킷 수정";

            openModal();

        };

    });

    updateStats();

    renderRecent();

}

/* =======================================================
   app.js - Part 3
======================================================= */

/* ============================= */
/* 페이지 전환 */
/* ============================= */

function showPage(pageId){

    pages.forEach(page=>{

        page.classList.remove("active");

    });

    document
    .getElementById(pageId)
    .classList
    .add("active");

    navButtons.forEach(btn=>{

        btn.classList.remove("active");

        if(btn.dataset.page===pageId){

            btn.classList.add("active");

        }

    });

}

navButtons.forEach(button=>{

    button.onclick=()=>{

        showPage(button.dataset.page);

        if(button.dataset.page==="statsPage"){

            renderStats();

        }

        if(button.dataset.page==="galleryPage"){

            renderGallery();

        }

    };

});

/* ============================= */
/* 검색 */
/* ============================= */

searchInput.addEventListener(

    "input",

    render

);

/* ============================= */
/* 카테고리 */
/* ============================= */

categoryButtons.forEach(button=>{

    button.onclick=()=>{

        categoryButtons.forEach(btn=>

            btn.classList.remove("active")

        );

        button.classList.add("active");

        currentCategory=

        button.dataset.category;

        render();

    };

});

/* ============================= */
/* 정렬 */
/* ============================= */

document
.getElementById("sortButton")
.onclick=()=>{

    if(sortMode==="latest"){

        sortMode="star";

        alert("⭐ 중요도순 정렬");

    }else{

        sortMode="latest";

        alert("🕒 최신순 정렬");

    }

    render();

};

/* ============================= */
/* 토스트 / 안내문구 */
/* ============================= */

function showToast(message, options={}){

    if(!toastContainer) return;

    const {
        icon = "💡",
        duration = 6000
    } = options;

    const toast = document.createElement("div");

    toast.className = "toast";

    toast.innerHTML = `
        <span class="toastIcon">${icon}</span>
        <span class="toastBody">${message}</span>
        <button class="toastClose" aria-label="닫기">✕</button>
    `;

    const removeToast = () => {

        toast.classList.add("toastOut");

        setTimeout(() => toast.remove(), 280);

    };

    toast.querySelector(".toastClose").onclick = removeToast;

    toastContainer.appendChild(toast);

    if(duration > 0){

        setTimeout(removeToast, duration);

    }

}

/* ============================= */
/* 최초 방문 안내 (홈 화면에 추가) */
/* ============================= */

const WELCOME_KEY = "bucket_welcome_shown";

function isStandaloneApp(){

    return (
        window.navigator.standalone === true ||
        (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
    );

}

function isIOSDevice(){

    const ua = navigator.userAgent || "";

    const isIOSUA = /iPad|iPhone|iPod/.test(ua);

    const isIPadOS =
        navigator.platform === "MacIntel" &&
        navigator.maxTouchPoints > 1;

    return isIOSUA || isIPadOS;

}

function maybeShowWelcomeGuide(){

    if(!welcomeModal) return;

    // 세션 저장소 사용: 브라우저/앱을 나갔다가 다시 들어오면 새 세션으로
    // 인식되어 안내가 다시 표시됩니다.
    if(sessionStorage.getItem(WELCOME_KEY)) return;

    if(isStandaloneApp()){

        sessionStorage.setItem(WELCOME_KEY, "true");

        return;

    }

    if(!isIOSDevice()) return;

    welcomeModal.classList.add("show");

}

function closeWelcomeGuide(){

    if(welcomeModal){

        welcomeModal.classList.remove("show");

    }

    sessionStorage.setItem(WELCOME_KEY, "true");

}

if(welcomeCloseButton){

    welcomeCloseButton.onclick = closeWelcomeGuide;

}

/* ============================= */
/* 테마 (기본 / 다크 / 애플 / 글래스) */
/* ============================= */

const THEME_KEY = "bucket_theme";
const THEMES = ["default", "dark", "apple", "glass"];

const THEME_ICONS = {
    default: "☀️",
    dark: "🌙",
    apple: "🪨",
    glass: "💧"
};

const THEME_META_COLORS = {
    default: "#F5F7FB",
    dark: "#0F172A",
    apple: "#F5F5F7",
    glass: "#DBE6FF"
};

function getStoredTheme(){

    const saved = localStorage.getItem(THEME_KEY);

    // 이전 버전과의 호환 (light -> default)
    if(saved === "light" || !THEMES.includes(saved)){

        return "default";

    }

    return saved;

}

const METAL_DARK_KEY = "bucket_metal_dark";

function getMetalDark(){

    const saved = localStorage.getItem(METAL_DARK_KEY);

    return saved === null ? true : saved === "true";

}

function setMetalDark(on){

    localStorage.setItem(METAL_DARK_KEY, on);

    document.body.classList.toggle("metalLight", !on);

    if(metalDarkToggle){

        metalDarkToggle.classList.toggle("on", on);

        metalDarkToggle.setAttribute("aria-checked", on);

    }

}

function setTheme(mode){

    if(!THEMES.includes(mode)) mode = "default";

    document.body.classList.remove("dark", "apple", "glass");

    if(mode !== "default"){

        document.body.classList.add(mode);

    }

    localStorage.setItem(THEME_KEY, mode);

    if(themeButton){

        themeButton.textContent = THEME_ICONS[mode];

    }

    const metaTheme = document.querySelector('meta[name="theme-color"]');

    if(metaTheme){

        metaTheme.setAttribute("content", THEME_META_COLORS[mode]);

    }

    themeOptionButtons.forEach(btn=>{

        btn.classList.toggle(
            "active",
            btn.dataset.theme === mode
        );

    });

    if(metalDarkSettingItem){

        metalDarkSettingItem.classList.toggle("show", mode === "apple");

    }

    if(mode === "apple"){

        setMetalDark(getMetalDark());

    } else {

        document.body.classList.remove("metalLight");

    }

}

function applyTheme(){

    setTheme(getStoredTheme());

}

if(metalDarkToggle){

    metalDarkToggle.onclick = () => {

        setMetalDark(!getMetalDark());

    };

}

themeOptionButtons.forEach(btn=>{

    btn.onclick = () => setTheme(btn.dataset.theme);

});

themeButton.onclick = () => {

    const current = getStoredTheme();

    const nextIndex = (THEMES.indexOf(current) + 1) % THEMES.length;

    setTheme(THEMES[nextIndex]);

};

/* ============================= */
/* 구글 드라이브 자동 저장 */
/* ============================= */

function buildBackupPayload(){

    return buildPhotosExport().then(photos => ({
        version: BACKUP_VERSION,
        type: "full",
        exportedAt: Date.now(),
        buckets,
        customQuotes: loadCustomQuotes(),
        photos
    }));

}

function isDriveConnected(){

    return localStorage.getItem(DRIVE_CONNECTED_KEY) === "1";

}

function setDriveConnected(connected){

    if(connected){

        localStorage.setItem(DRIVE_CONNECTED_KEY, "1");

    }else{

        localStorage.removeItem(DRIVE_CONNECTED_KEY);

        localStorage.removeItem(DRIVE_FILE_ID_KEY);

        localStorage.removeItem(DRIVE_LAST_SYNC_KEY);

    }

    updateDriveUI();

}

function formatSyncTime(ts){

    const d = new Date(ts);

    const mo = d.getMonth() + 1;

    const day = d.getDate();

    const hh = String(d.getHours()).padStart(2, "0");

    const mm = String(d.getMinutes()).padStart(2, "0");

    return `${mo}월 ${day}일 ${hh}:${mm} 저장됨`;

}

function updateDriveUI(syncOverride){

    if(!googleDriveStatus) return;

    googleDriveStatus.textContent =
    isDriveConnected() ? "연결됨" : "연결하기";

    if(!googleDriveTime) return;

    if(syncOverride !== undefined){

        googleDriveTime.textContent = syncOverride;

        return;

    }

    if(!isDriveConnected()){

        googleDriveTime.textContent = "";

        return;

    }

    const last = localStorage.getItem(DRIVE_LAST_SYNC_KEY);

    googleDriveTime.textContent =
    last ? formatSyncTime(Number(last)) : "동기화 대기 중";

}

function initGoogleAuth(){

    if(!window.google || !google.accounts || !google.accounts.oauth2){

        return;

    }

    googleTokenClient = google.accounts.oauth2.initTokenClient({

        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,

        callback: async (response) => {

            if(response && response.access_token){

                googleAccessToken = response.access_token;

                setDriveConnected(true);

                const manualConnect = googleManualConnect;

                const backupOk = await syncToDrive();

                if(manualConnect){

                    if(backupOk){

                        showToast(
                            "구글 드라이브 연결 및 백업이 완료됐어요. 목표와 사진이 안전하게 저장돼요.",
                            { icon: "☁️" }
                        );

                    }else{

                        showToast(
                            "구글 드라이브에 연결됐지만 백업 저장에는 실패했어요. 잠시 후 다시 시도해주세요.",
                            { icon: "⚠️" }
                        );

                    }

                }

            }else{

                updateDriveUI();

            }

            googleManualConnect = false;

        }

    });

    if(isDriveConnected()){

        try{

            googleTokenClient.requestAccessToken({ prompt: "" });

        }catch{

            /* 자동 로그인 실패시 조용히 무시 */

        }

    }

}

window.onGisLoad = initGoogleAuth;

if(window.google && google.accounts && google.accounts.oauth2){

    initGoogleAuth();

}

function connectGoogleDrive(){

    if(GOOGLE_CLIENT_ID.includes("YOUR_GOOGLE_CLIENT_ID")){

        alert("구글 드라이브 기능을 쓰려면 app.js의 GOOGLE_CLIENT_ID를 먼저 설정해야 합니다.");

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

googleDriveButton.onclick = () => {

    if(isDriveConnected()){

        if(confirm("구글 드라이브 자동 저장을 해제할까요?")){

            disconnectGoogleDrive();

        }

    }else{

        connectGoogleDrive();

    }

};

function scheduleDriveSync(){

    if(!isDriveConnected()) return;

    clearTimeout(driveSyncTimer);

    driveSyncTimer = setTimeout(syncToDrive, 2000);

}

/* 가져오기(import)처럼 그 직후 앱이 바로 닫힐 수 있는 경우를 위한
   즉시 동기화 함수. 2초 디바운스를 기다리지 않고 바로 업로드하고,
   완료(또는 실패)될 때까지 await로 기다린다. */
async function syncToDriveNow(){

    if(!isDriveConnected()) return;

    clearTimeout(driveSyncTimer);

    await syncToDrive();

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

    const query =
    encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`);

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

    const boundary = "bucket_backup_boundary";

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

function formatSnapshotTimestamp(date){

    const pad = n => String(n).padStart(2, "0");

    return (
        date.getFullYear() +
        pad(date.getMonth()+1) +
        pad(date.getDate()) + "_" +
        pad(date.getHours()) +
        pad(date.getMinutes()) +
        pad(date.getSeconds())
    );

}

/* 전체 삭제처럼 되돌릴 수 없는 작업을 하기 직전에,
   현재 상태를 별도의 날짜별 파일로 드라이브에 저장해 둔다.
   기존 자동저장 파일(bucket_app_backup.json)은 건드리지 않으므로
   삭제 후 자동저장이 그 파일을 빈 상태로 덮어써도 이 스냅샷은 남는다. */
async function backupSnapshotToDrive(reason){

    if(!isDriveConnected()) return false;

    try{

        updateDriveUI("삭제 전 백업 저장 중...");

        const token = await ensureAccessToken();

        if(!token){

            updateDriveUI("로그인 필요");

            return false;

        }

        const payload = await buildBackupPayload();

        payload.type = reason || "snapshot";

        const name =
        `bucket_app_backup_삭제전_${formatSnapshotTimestamp(new Date())}.json`;

        await uploadDriveFileAs(token, payload, name);

        updateDriveUI();

        return true;

    }catch{

        updateDriveUI("스냅샷 저장 실패");

        return false;

    }

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

    if(!isDriveConnected() || driveSyncInProgress) return false;

    driveSyncInProgress = true;

    updateDriveUI("저장 중...");

    try{

        const token = await ensureAccessToken();

        if(!token){

            updateDriveUI("로그인 필요");

            driveSyncInProgress = false;

            return false;

        }

        const payload = await buildBackupPayload();

        let fileId = await findDriveFileId(token);

        if(fileId){

            try{

                await updateDriveFile(token, fileId, payload);

            }catch{

                await uploadNewDriveFile(token, payload);

            }

        }else{

            await uploadNewDriveFile(token, payload);

        }

        const now = Date.now();

        localStorage.setItem(DRIVE_LAST_SYNC_KEY, String(now));

        updateDriveUI();

        return true;

    }catch{

        updateDriveUI("저장 실패, 재시도 예정");

        return false;

    }finally{

        driveSyncInProgress = false;

    }

}

updateDriveUI();

/* ============================= */
/* JSON 백업 */
/* ============================= */

exportButton.onclick=async()=>{

    const photos=await buildPhotosExport();

    downloadJson({
        version:BACKUP_VERSION,
        type:"full",
        exportedAt:Date.now(),
        buckets,
        photos
    }, "bucket-full-backup.json");

};

/* ============================= */
/* JSON 가져오기 */
/* ============================= */

importButton.onclick=()=>{

    importFile.click();

};

importFile.onchange=e=>{

    const file=

    e.target.files[0];

    if(!file) return;

    const reader=

    new FileReader();

    reader.onload=async()=>{

        try{

            const data=JSON.parse(reader.result);

            if(Array.isArray(data)){

                buckets=data;

                normalizeBuckets();

                saveStorage();

                render();

                await syncToDriveNow();

                alert("가져오기 완료");

                importFile.value="";

                return;

            }

            if(data.buckets){

                buckets=data.buckets;

                normalizeBuckets();

                if(Array.isArray(data.photos)){

                    await restorePhotosExport(
                        data.photos,
                        true
                    );

                }

                saveStorage();

                render();

                renderGallery();

                await syncToDriveNow();

                alert("전체 백업 가져오기 완료");

            }else{

                alert("올바른 JSON 파일이 아닙니다.");

            }

        }

        catch{

            alert("올바른 JSON 파일이 아닙니다.");

        }

        importFile.value="";

    };

    reader.readAsText(file);

};


/* ============================= */
/* 통계 */
/* ============================= */

function renderStats(){

    const container=

    document.getElementById(

    "statsContainer"

    );

    container.innerHTML="";

    const total=buckets.length;

    const done=

    buckets.filter(

    b=>b.completed

    ).length;

    const percent=

    total===0

    ?0

    :Math.round(

    done/total*100

    );

    const card=

    document.createElement("div");

    card.className="statsCard";

    card.innerHTML=`

<h3>

전체 달성률

</h3>

<div class="chartBar">

<div
class="chartFill"
style="width:${percent}%">

</div>

</div>

<p
style="margin-top:16px;">

${percent}% 완료

</p>

`;

    container.appendChild(card);

        /* ============================= */
    /* 카테고리 통계 */
    /* ============================= */

    const categories = {};

    buckets.forEach(bucket => {

        categories[bucket.category] =
            (categories[bucket.category] || 0) + 1;

    });

    Object.keys(categories).forEach(category => {

        const percent =
            total === 0
            ? 0
            : Math.round(categories[category] / total * 100);

        const card = document.createElement("div");

        card.className = "statsCard";

        card.innerHTML = `

            <h3>${category}</h3>

            <div class="chartBar">

                <div
                    class="chartFill"
                    style="width:${percent}%">
                </div>

            </div>

            <p style="margin-top:14px;">

                ${categories[category]}개 (${percent}%)

            </p>

        `;

        container.appendChild(card);

    });

}

/* ============================= */
/* 최초 실행 */
/* ============================= */

async function init(){

    try{

        loadStorage();

        normalizeBuckets();

    }catch(err){

        console.error("초기 데이터 로딩 중 오류:", err);

        buckets=[];

    }

    try{

        await migrateLegacyPhotos();

    }catch(err){

        console.error("사진 데이터 마이그레이션 중 오류:", err);

    }

    try{

        applyTheme();

    }catch(err){

        console.error("테마 초기화 중 오류:", err);

    }

    render();

    try{

        maybeShowWelcomeGuide();

    }catch(err){

        console.error("설치 안내 표시 중 오류:", err);

    }

}

init();

/* ============================= */
/* ESC 키 */
/* ============================= */

window.addEventListener(

    "keydown",

    e=>{

        if(e.key==="Escape"){

            closeModal();

            closeCelebrateModal();

            closePhotoViewModal();

        }

    }

);

/* ============================= */
/* 모바일에서 모달 바깥 클릭 */
/* ============================= */

bucketModal.addEventListener(

    "click",

    e=>{

        if(e.target===bucketModal){

            closeModal();

        }

    }

);

/* ============================= */
/* iOS Safari 화면 높이 보정 */
/* ============================= */

function setViewportHeight(){

    document.documentElement.style.setProperty(

        "--vh",

        `${window.innerHeight*0.01}px`

    );

}

window.addEventListener(

    "resize",

    setViewportHeight

);

setViewportHeight();

/* ============================= */
/* V0.3 END */
/* ============================= */