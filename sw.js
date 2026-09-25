// 新竹一日 — Service Worker
//
// 站台幾乎天天發布（見 publish.py），策略刻意保守：
//   - 頁面本體（導覽請求、./、./index.html）一律 network-first——本人一定要
//     看到最新版，快取只當「查不到網路時」的備援，絕不准變成 cache-first
//     讓本人卡在舊版。
//   - manifest／icons 這類幾乎不變的殼層資源才 cache-first（v6 起加上站內託管的
//     vendor/leaflet/，2026-09-25 棒 DM，見下面 v5→v6 那段）。
//   - OSM 圖磚（tile.openstreetmap.org 等）完全不經手，第一版不快取，
//     交給瀏覽器預設行為。
//
// ── 3 秒 timeout（2026-09-05 本人核定，2026-09-06 由多日遊站同規格移植）──────
// 上面那條「絕不准變成 cache-first」**沒有被推翻，一個字都沒有**。加的是一道
// 只在最壞情境才起作用的閘門：網路請求超過 3 秒還沒回來、而且快取裡有副本時，
// 先把副本丟出去讓畫面可用。
//
// 為什麼這不違反那條規矩的精神——三件事：
//   1. **有網而且正常時，行為一個位元組不變**：網路先到就回網路那一份，
//      快取那一份連查都不會查。3 秒是「慢到不正常」的門檻，不是常態路徑。
//   2. **網路請求不中止**：逾時只改變「先讓誰上畫面」，那一趟 fetch 照樣跑完、
//      照樣寫進快取（event.waitUntil 把 SW 留到它回來為止）。所以**下一次開站
//      拿到的就是這一次抓到的新版**——卡在舊版最多卡一次，而且是在網路半死的
//      那一次。cache-first 的問題是「永遠先給舊的」，這裡是「慢到不能用時才
//      先給舊的，而且同時在把新的抓回來」。
//   3. **它堵的是原本沒有出口的那一格**：fetch 沒有失敗、只是很久的時候，
//      舊寫法不會 fallback（catch 進不去），使用者就一直等。
//
// 改這支檔案時，如果動到「殼層資源要不要重新抓」的判斷（例如 icons 換了），
// 記得把 CACHE_VERSION 往前推一號，逼 activate 清掉舊快取；純粹調整
// network-first 的容錯邏輯不需要動版本號（它本來就每次都打網路）——**加這道
// timeout 也不需要，而且刻意不動**：bump 會讓 activate 清掉現有快取，等於把
// 這道閘門要倚靠的那份副本親手刪掉，下一次開站反而少一層保護。SW 自己的更新
// 靠瀏覽器對 sw.js 的位元組比對，跟版本號無關。

// v1 → v2（2026-09-06 棒 DINK，水墨改版）：**這一輪動到的殼層資源不只 icons**
// ——五顆 icon 全部換成水彩手帳新稿，`manifest.webmanifest` 的 theme_color 與
// background_color 也跟著新的 --accent／--bg 換值。兩種都在 SHELL_ASSETS 裡、
// 都走 cache-first，不推版號的話舊訪客會**一直**拿到舊 icon 配新配色的中間態
// （cache-first 的定義就是「有就不打網路」，它不會自己發現檔案變了）。
// 一次推到位、只推一號：這兩件是同一次發布，分兩號沒有意義。
// v2→v3：2026-09-06 站名統一「新竹出發一日遊」動了 manifest（cache-first 殼層資源），照檔頭規則推號。
// v3→v4：2026-09-06 og/icon 再更新一版（降低水彩數位飽和感，codex 0abad4fe），icons 是 cache-first 殼層資源，照規則推號。
// v4→v5：2026-09-06 增補規格 v2「紋理加強」把亮色 --bg 提到 #fdfbf6，manifest 的
// background_color 跟著走（既有邏輯＝manifest 底色就是站的亮色底）——manifest.webmanifest
// 走 cache-first，跟 v2→v3 完全同一種情形，照檔頭規則推號。
// v5（不推號）：2026-09-25 棒 DD（可用性總審第一節 #11，本人 2026-09-25 裁；照多日遊 2026-09-24
// 棒 AA／AB 同型修法移植）兩刀，都在導覽請求那條 network-first 路上：
//   (a) 頁面副本的快取鑰匙去掉查詢字串、並清掉累積的帶查詢字串副本（見 pageKey／prunePageCopies）；
//   (b) 導覽請求改帶 `cache: "no-cache"`（見 networkFirst）。
// **照上面那條紀律不推**：兩刀動的是 network-first 那條路的存取鑰匙、整理與取用方式，不是
// 「殼層資源要不要重新抓」——manifest／icons 一個位元組沒變。推號的代價正是檔頭講的那一件：
// activate 會把整份 v5 清掉，逾時閘門要倚靠的那份頁面副本一起消失，下一次開站在網路半死時就
// 沒有東西可退。舊副本改由 activate 與每次成功導覽時用 keys() 過濾清掉，效果相同、不賠掉備援。
// 新版 SW 本身靠 sw.js 位元組比對生效，不需要版本號。
// v5→v6：2026-09-25 棒 DM（效能 D4，本人裁；PERF 報告 §5 D4；照多日遊 2026-09-25 棒 AI 的 v6→v7
// 同一刀）把 Leaflet 1.9.4 從 unpkg 搬進站內 `vendor/leaflet/`（leaflet.js／leaflet.css＋CSS 引用的
// images/ 五張，逐位元組同多日遊那一份），並列進下面的 SHELL_ASSETS 走 cache-first——**殼層資源多了，
// 照檔頭那條規則推號**（任務書也明文要推）。推號的代價就是檔頭講的那一件：activate 清掉整份 v5，
// 逾時閘門倚靠的那份頁面副本要等下一次成功造訪才補回來；換到的是「install 那一刻就把地圖引擎放進
// 快取」——離線再訪時地圖殼（控制項、圖釘、路線）載得起來，只有跨源的 OSM 圖磚是空白（本來就不
// 快取）。改前 Leaflet 走 unpkg，跨源請求這支 SW 一律不經手，離線時連引擎都載不進來。
// 同一棒頁面那側加了「閒置預熱」（template.html 的 preheatMap）：SW 接管之後的造訪，預熱抓 Leaflet
// 那一趟由這裡的 cache-first 直接回，不上網路。
// **往後升 Leaflet 版本＝整組換檔＋改 template.html 的兩個路徑常數（LEAF_CSS_URL／LEAF_JS_URL）＋
// 再推一號**：cache-first 命中不 revalidate，不推號的話回訪者會永遠拿到舊版引擎（同 v1→v2 icons
// 那一次的病）。
// v6（不推號）：2026-09-25 棒 WT（效能 D2，本人裁；照多日遊 2026-09-10 棒 SPLIT 的 `data/` 路由）把頁內的
// 車程矩陣 `NEIGH_B64` 拆成 `data/neighbors.bin?v=<內容摘要>`，本檔新增 `data/` 這條路由（見下面
// isDataAsset／networkFirstData／pruneOldVersions，逐字照多日遊）。**照上面那條紀律不推**：動的是
// 「多一條 network-first 的資料路由」，不是「殼層資源要不要重新抓」——manifest／icons／vendor 一個
// 位元組沒變。推號的代價正是檔頭講的那一件：activate 清掉整份 v6，逾時閘門倚靠的頁面副本一起消失。
// 改前那份內嵌矩陣的整頁副本不必靠推號清：頁面副本存在不帶查詢字串的單一鑰匙（pageKey）底下，下一次
// 成功導覽就被新版蓋掉。**同一刀補一個洞**：prunePageCopies 原本只排除殼層資源，`data/…?v=` 也帶
// 查詢字串，不排除的話每次導覽都會把剛存的矩陣當成「帶查詢字串的頁面副本」清掉（離線就讀不到了）。
const CACHE_VERSION = "v6";
const CACHE_NAME = `hsinchu-day-trips-${CACHE_VERSION}`;

// 殼層資源：install 時預熱，之後 cache-first。都是同源、幾乎不變的檔案。
const SHELL_ASSETS = [
  "./",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
  // Leaflet 站內託管（v6，2026-09-25 棒 DM，效能 D4）。五張圖是 leaflet.css 的 `url(images/…)`
  // （layers／layers-2x／marker-icon）加上 Leaflet 預設圖示在 JS 裡會用到的另外兩張；站上的圖釘
  // 全是 `L.divIcon`，預設圖示目前用不到，但檔案跟著引擎走，預熱它們只多 3 KB（同多日遊 v7）。
  "./vendor/leaflet/leaflet.js",
  "./vendor/leaflet/leaflet.css",
  "./vendor/leaflet/images/layers.png",
  "./vendor/leaflet/images/layers-2x.png",
  "./vendor/leaflet/images/marker-icon.png",
  "./vendor/leaflet/images/marker-icon-2x.png",
  "./vendor/leaflet/images/marker-shadow.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // 個別 add 失敗（例如某個 icon 檔在本地測試環境還沒 ready）不該讓整個
      // install 失敗——逐一 try，缺的之後靠 fetch handler 補快取。
      await Promise.all(
        SHELL_ASSETS.map((url) => cache.add(url).catch(() => {}))
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("hsinchu-day-trips-") && n !== CACHE_NAME)
          .map((n) => caches.delete(n))
      );
      // 2026-09-25 棒 DD（#11 (a)）：改版前累積下來的帶查詢字串頁面副本，在新版 SW 接手的這一刻
      // 清一次（CACHE_VERSION 刻意沒推，舊快取不會被整個刪掉，所以要在這裡清；理由見檔頭 v5 那段）。
      // 失敗不擋 activate。
      try {
        await prunePageCopies(await caches.open(CACHE_NAME));
      } catch (e) {}
      await self.clients.claim();
    })()
  );
});

function isNavigationRequest(request) {
  if (request.mode === "navigate") return true;
  // 部分瀏覽器對 iframe/某些情境不標記 navigate，用副檔名輔助判斷。
  return (
    request.method === "GET" &&
    request.headers.get("accept") &&
    request.headers.get("accept").includes("text/html")
  );
}

function isShellAsset(url) {
  // manifest 與 icons：同源、路徑在 scope 底下的 manifest.webmanifest 或 icons/*
  // vendor/*：站內託管的第三方靜態資源（v6 起＝Leaflet，2026-09-25 棒 DM）。檔名不帶內容摘要，
  // 版本靠 CACHE_VERSION 推號換新（見檔頭 v5→v6 那段）。prunePageCopies 以這支排除殼層資源，
  // vendor 跟著被排除、不會被當成頁面副本清掉。
  return /\/manifest\.webmanifest$/.test(url.pathname) || /\/icons\//.test(url.pathname) ||
    /\/vendor\//.test(url.pathname);
}

// 拆出頁面外的資料檔（2026-09-25 棒 WT，效能 D2）：目前只有 `data/neighbors.bin`（車程矩陣）。
function isDataAsset(url) {
  return /\/data\//.test(url.pathname);
}

// 「慢到不正常」的門檻（見檔頭）。網路正常的一趟遠遠碰不到它。
const NET_TIMEOUT_MS = 3000;
// 用一個獨一無二的哨兵區分「網路回來了」與「時間到了」——`undefined`／`null`
// 都可能是 fetch 的合法結果，拿它們當哨兵會誤判。
const TIMED_OUT = Symbol("network-timeout");

function timeoutAfter(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms, TIMED_OUT));
}

// ── 頁面副本一律存在「不帶查詢字串」的鑰匙底下（2026-09-25 棒 DD，可用性總審第一節 #11 (a)）──
// 改前導覽請求原樣 `put(request)`，快取鑰匙含查詢字串：`?fbclid=…`、`utm_*`、測試用的
// `?nc=…` 每一種各存一份整頁，而且從來不清。這個站是單頁：查詢字串不改變頁面內容（狀態全在
// `#hash` 與 localStorage），所以同一個路徑只該有一份副本。另一個好處：平常從帶查詢字串的網址
// 進站的人，`./` 那份副本可能是很久以前的——鑰匙統一之後，每一次成功的導覽都在刷新同一份，
// 離線退到的就是最近一次看到的版本。（照多日遊 2026-09-24 棒 AA 的 pageKey 移植；移植當時本站
// 沒有 `data/` 那條路由，2026-09-25 棒 WT 起有了，下面的清理因此也避開它。）
function pageKey(request) {
  const u = new URL(request.url);
  u.search = "";
  u.hash = "";
  return u.href;
}

// 清掉同快取裡其他「帶查詢字串的頁面副本」。**只認頁面**：manifest／icons 是殼層資源（見
// isShellAsset，走 cache-first），就算哪天帶了查詢字串也不碰；`data/` 的 `?v=` 是它自己的版本
// 鑰匙（由 pruneOldVersions 管，2026-09-25 棒 WT 起），也不碰。
async function prunePageCopies(cache) {
  const keys = await cache.keys();
  await Promise.all(
    keys
      .filter((req) => {
        const u = new URL(req.url);
        return u.search !== "" && !isDataAsset(u) && !isShellAsset(u);
      })
      .map((req) => cache.delete(req))
  );
}

// 快取裡的備援副本：先找這個頁面自己的（不帶查詢字串那把鑰匙，棒 DD），再退到殼層那兩把鑰匙。
function cachedFallback(cache, request) {
  return cache
    .match(pageKey(request))
    .then((hit) => hit || cache.match("./"))
    .then((hit) => hit || cache.match("./index.html"));
}

function offlinePage() {
  return new Response(
    "<!doctype html><meta charset=utf-8><title>離線</title>" +
      "<body style='font-family:system-ui;padding:2em;color:#5c5449'>" +
      "<h1>目前離線</h1><p>連不上網路，也還沒有快取過這一頁。恢復網路後重新整理即可。</p>",
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

async function networkFirst(request, event) {
  // 先發車再開快取：`caches.open()` 不 await，fetch 就不必等它。
  const opening = caches.open(CACHE_NAME);
  // `cache: "no-cache"`（2026-09-25 棒 DD，可用性總審第一節 #11 (b)；照多日遊 2026-09-24 棒 AB）：
  // 每一趟都帶 ETag／Last-Modified 回伺服器驗證，沒有新版只回 304（瀏覽器用它 HTTP 快取裡那份，
  // 不重下整頁）。改前是預設的 `cache: "default"`——主機給 `max-age=600`，發布後十分鐘內 SW 這一趟
  // 「網路」其實是瀏覽器 HTTP 快取直接回的舊頁，network-first 在那十分鐘裡形同 cache-first。
  // **只動這一條（導覽請求）**：殼層資源是刻意的 cache-first，不碰。這個選項只改取用方式、不改
  // 存哪裡（鑰匙見 pageKey）。第二個參數會讓 fetch 內部重建 Request，`mode:"navigate"` 依規格轉成
  // `same-origin`——這裡本來就只處理同源（fetch handler 開頭擋掉跨源），行為不變。
  // CDN 那一層（邊緣節點自己的快取）這一刀管不到，本來就不在 SW 的權限裡。
  const network = fetch(request, { cache: "no-cache" }).then(async (fresh) => {
    // 只快取成功的同源回應；opaque/失敗回應不寫入快取。
    // **put 刻意不 await**（跟加 timeout 之前逐字相同）：等寫完才回應會替
    // 正常路徑平白加上一次寫入的時間。
    if (fresh && fresh.ok) {
      // 存進不帶查詢字串的鑰匙（棒 DD，見 pageKey）；舊的帶查詢字串副本順手清掉。
      // put 與清理照舊不 await（上面那條理由），清理的失敗吞掉——它是整理，不是正確性的一部分。
      const cache = await opening;
      cache.put(pageKey(request), fresh.clone()).then(() => prunePageCopies(cache)).catch(() => {});
    }
    return fresh;
  });
  // 逾時先回快取之後，瀏覽器可能在網路那一趟回來之前就把 SW 收掉——waitUntil
  // 把它留住，那一份新的才寫得進快取（下一次開站就是新的）。catch 的 noop 是
  // 為了不讓 fetch 失敗變成 unhandled rejection：真正的失敗處理在下面的 catch。
  if (event) event.waitUntil(network.catch(() => {}));
  else network.catch(() => {});

  try {
    const first = await Promise.race([network, timeoutAfter(NET_TIMEOUT_MS)]);
    // ── 網路先到：這一整條與加 timeout 之前完全相同（連快取都不查）
    if (first !== TIMED_OUT) return first;
    // ── 慢而不斷：有副本就先給副本，網路那一趟仍在跑、仍會寫快取
    const cached = await cachedFallback(await opening, request);
    if (cached) return cached;
    // ── 慢而且沒有副本可退：照舊等網路（它自己的失敗會落到下面的 catch）
    // **`return await network` 不是 `return network`**：後者的拒絕不會走本地
    // 的 catch，一個字之差就會讓離線 fallback 整條失效。
    return await network;
  } catch (err) {
    const cached = await cachedFallback(await opening, request);
    if (cached) return cached;
    return offlinePage();
  }
}

// `data/` 資料檔（2026-09-25 棒 WT，效能 D2；逐字照多日遊 sw.js 的 networkFirstData／pruneOldVersions）：
// **跟導覽請求同款的 network-first ＋ 快取後備**，兩個地方不同：
//
//   1. **後備只認自己那一份**。`cachedFallback` 會退到 `./`／`./index.html`——那對頁面是對的
//      （拿舊頁總比空白好），對 `.bin` 是災難：前端會拿一份 HTML 去灌 Uint16Array。查不到就讓它
//      失敗，前端有降級態接得住（行程腿標「約」、附近精選／順遊印「暫時載不到」）。
//   2. **同一份資料的舊版本要清掉**。URL 帶 `?v=<內容摘要>`（見 build.py），每改一次資料就是一把
//      新鑰匙，不清的話使用者手機上會一版一版疊著。清的時機是「新版已經抓到手」，所以不會出現
//      「舊的刪了新的沒到」的空窗。
//
// 逾時那道閘（NET_TIMEOUT_MS）照樣有：網路半死時先給快取那一份讓站可用，網路那一趟仍然跑完、
// 仍然寫進快取。**不帶 `cache: "no-cache"`**：內容變了網址就變，不需要每次回伺服器驗證。
async function pruneOldVersions(cache, url) {
  const keys = await cache.keys();
  await Promise.all(
    keys
      .filter((req) => {
        const u = new URL(req.url);
        return u.origin === url.origin && u.pathname === url.pathname && u.search !== url.search;
      })
      .map((req) => cache.delete(req))
  );
}

async function networkFirstData(request, event) {
  const url = new URL(request.url);
  const opening = caches.open(CACHE_NAME);
  const network = fetch(request).then(async (fresh) => {
    if (fresh && fresh.ok) {
      const cache = await opening;
      await cache.put(request, fresh.clone());
      await pruneOldVersions(cache, url);
    }
    return fresh;
  });
  if (event) event.waitUntil(network.catch(() => {}));
  else network.catch(() => {});

  try {
    const first = await Promise.race([network, timeoutAfter(NET_TIMEOUT_MS)]);
    if (first !== TIMED_OUT) return first;
    const cached = await (await opening).match(request);
    if (cached) return cached;
    return await network;
  } catch (err) {
    const cached = await (await opening).match(request);
    if (cached) return cached;
    throw err; // 前端的 fetch 因此 reject → 降級態＋一行 console 警告
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) {
    cache.put(request, fresh.clone());
  }
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // 只處理讀取，寫入類請求原樣放行

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 跨源（OSM 圖磚等）完全不經手

  if (isNavigationRequest(request)) {
    event.respondWith(networkFirst(request, event));
    return;
  }

  if (isShellAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isDataAsset(url)) {
    event.respondWith(networkFirstData(request, event));
    return;
  }

  // 其餘同源請求（例如未來新增的同源腳本/樣式）：不特別處理，走瀏覽器預設。
});
