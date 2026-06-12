// ===========================
// gcal.js - Googleカレンダー連携（自動再連携対応版）
// ===========================

const CLIENT_ID     = '432441205151-3vjl7v963me25blgfepmebt12ligpibh.apps.googleusercontent.com';
const SCOPES        = 'https://www.googleapis.com/auth/calendar.readonly';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
const STORAGE_KEY   = 'bio_gcal_autologin';  // 自動連携フラグのキー

let tokenClient;
let gapiInited = false;
let gisInited  = false;

// ---------- GAPI初期化 ----------
async function initGapi() {
  await new Promise(resolve => gapi.load('client', resolve));
  await gapi.client.init({ discoveryDocs: [DISCOVERY_DOC] });
  gapiInited = true;
  maybeEnableButton();
}

// ---------- GIS初期化 ----------
function initGis() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    // prompt:'': 同意画面をスキップ（自動再連携用）
    callback: async (resp) => {
      if (resp.error) {
        console.error('GIS error:', resp);
        // 自動連携失敗時はフラグを消してボタンをリセット
        if (resp.error === 'access_denied' || resp.error === 'interaction_required') {
          localStorage.removeItem(STORAGE_KEY);
          resetBtn();
        }
        return;
      }
      // 成功：自動連携フラグを保存
      localStorage.setItem(STORAGE_KEY, '1');
      await fetchCalendarEvents();
    },
  });
  gisInited = true;
  maybeEnableButton();
}

// ---------- 両方初期化完了 ----------
function maybeEnableButton() {
  if (!gapiInited || !gisInited) return;
  const btn = document.getElementById('gcal-btn');
  if (btn) btn.disabled = false;

  // 前回連携済みなら自動再連携
  if (localStorage.getItem(STORAGE_KEY) === '1') {
    console.log('自動再連携を試みます...');
    // prompt:'' で同意画面なしでトークン取得
    tokenClient.requestAccessToken({ prompt: '' });
  }
}

// ---------- 連携ボタンクリック（手動） ----------
function handleAuthClick() {
  if (gapi.client.getToken() === null) {
    // 初回：同意画面を表示
    tokenClient.requestAccessToken({ prompt: 'consent' });
  } else {
    // 再取得：同意画面スキップ
    tokenClient.requestAccessToken({ prompt: '' });
  }
}

// ---------- カレンダー予定を取得 ----------
async function fetchCalendarEvents() {
  try {
    const btn = document.getElementById('gcal-btn');
    if (btn) btn.textContent = '読み込み中...';

    const now   = new Date();
    // 過去1年〜未来1年を取得（maxResults: 2500）
    const start = new Date(now.getFullYear()-1, 0, 1).toISOString();
    const end   = new Date(now.getFullYear()+1, 11, 31, 23,59,59).toISOString();

    // 件数が多い場合はページネーションで全件取得
    let allEvents = [];
    let pageToken = undefined;

    do {
      const params = {
        calendarId:   'primary',
        timeMin:      start,
        timeMax:      end,
        singleEvents: true,
        orderBy:      'startTime',
        maxResults:   500,
      };
      if (pageToken) params.pageToken = pageToken;

      const resp    = await gapi.client.calendar.events.list(params);
      const items   = resp.result.items ?? [];
      allEvents     = allEvents.concat(items);
      pageToken     = resp.result.nextPageToken;

      console.log(`Gcal取得中: ${allEvents.length}件...`);
    } while (pageToken);

    console.log('Gcal取得完了:', allEvents.length, '件');

    if (typeof renderGcalEvents === 'function') {
      renderGcalEvents(allEvents);
    }

    // 祝日カレンダーも取得
    fetchHolidays();

  } catch (err) {
    console.error('Calendar API error:', err);

    // 401エラー（トークン期限切れ）は自動再取得
    if (err.status === 401) {
      console.log('トークン期限切れ。再取得します...');
      tokenClient.requestAccessToken({ prompt: '' });
      return;
    }

    // その他のエラー
    localStorage.removeItem(STORAGE_KEY);
    resetBtn();
    alert('カレンダーの取得に失敗しました。\n再度「Googleカレンダーと連携」をクリックしてください。');
  }
}

// ---------- 日本の祝日（2024〜2027年 静的データ） ----------
function fetchHolidays() {
  const HOLIDAYS = {
    // 2024年
    '2024-01-01':'元日','2024-01-08':'成人の日','2024-02-11':'建国記念の日',
    '2024-02-12':'振替休日','2024-02-23':'天皇誕生日','2024-03-20':'春分の日',
    '2024-04-29':'昭和の日','2024-05-03':'憲法記念日','2024-05-04':'みどりの日',
    '2024-05-05':'こどもの日','2024-05-06':'振替休日','2024-07-15':'海の日',
    '2024-08-11':'山の日','2024-08-12':'振替休日','2024-09-16':'敬老の日',
    '2024-09-22':'秋分の日','2024-09-23':'振替休日','2024-10-14':'スポーツの日',
    '2024-11-03':'文化の日','2024-11-04':'振替休日','2024-11-23':'勤労感謝の日',
    // 2025年
    '2025-01-01':'元日','2025-01-13':'成人の日','2025-02-11':'建国記念の日',
    '2025-02-23':'天皇誕生日','2025-02-24':'振替休日','2025-03-20':'春分の日',
    '2025-04-29':'昭和の日','2025-05-03':'憲法記念日','2025-05-04':'みどりの日',
    '2025-05-05':'こどもの日','2025-05-06':'振替休日','2025-07-21':'海の日',
    '2025-08-11':'山の日','2025-09-15':'敬老の日','2025-09-23':'秋分の日',
    '2025-10-13':'スポーツの日','2025-11-03':'文化の日','2025-11-23':'勤労感謝の日',
    '2025-11-24':'振替休日',
    // 2026年
    '2026-01-01':'元日','2026-01-12':'成人の日','2026-02-11':'建国記念の日',
    '2026-02-23':'天皇誕生日','2026-03-20':'春分の日','2026-04-29':'昭和の日',
    '2026-05-03':'憲法記念日','2026-05-04':'みどりの日','2026-05-05':'こどもの日',
    '2026-05-06':'憲法記念日 振替休日','2026-07-20':'海の日','2026-08-11':'山の日',
    '2026-09-21':'敬老の日','2026-09-22':'国民の休日','2026-09-23':'秋分の日',
    '2026-10-12':'スポーツの日','2026-11-03':'文化の日','2026-11-23':'勤労感謝の日',
    // 2027年
    '2027-01-01':'元日','2027-01-11':'成人の日','2027-02-11':'建国記念の日',
    '2027-02-23':'天皇誕生日','2027-03-21':'春分の日','2027-03-22':'振替休日',
    '2027-04-29':'昭和の日','2027-05-03':'憲法記念日','2027-05-04':'みどりの日',
    '2027-05-05':'こどもの日','2027-07-19':'海の日','2027-08-11':'山の日',
    '2027-09-20':'敬老の日','2027-09-23':'秋分の日','2027-10-11':'スポーツの日',
    '2027-11-03':'文化の日','2027-11-23':'勤労感謝の日',
  };
  console.log('祝日データセット:', Object.keys(HOLIDAYS).length, '件');
  if (typeof setHolidays === 'function') {
    setHolidays(HOLIDAYS);
  }
}

// ---------- 連携解除 ----------
function handleSignoutClick() {
  const token = gapi.client.getToken();
  if (token) {
    google.accounts.oauth2.revoke(token.access_token, () => {
      console.log('Token revoked');
    });
    gapi.client.setToken('');
  }
  // 自動連携フラグを削除
  localStorage.removeItem(STORAGE_KEY);

  if (typeof clearGcalEvents === 'function') {
    clearGcalEvents();
  }
}

// ---------- ボタンをリセット ----------
function resetBtn() {
  const btn = document.getElementById('gcal-btn');
  if (btn) {
    btn.textContent = 'Googleカレンダーと連携';
    btn.classList.remove('connected');
    btn.disabled = false;
  }
  const signout = document.getElementById('gcal-signout');
  if (signout) signout.style.display = 'none';
}

// ---------- 初期化（ライブラリ読み込み待ち） ----------
function waitForGapi(cb, retry=0) {
  if (typeof gapi !== 'undefined') { cb(); }
  else if (retry < 50) { setTimeout(() => waitForGapi(cb, retry+1), 100); }
  else { console.error('gapi load timeout'); }
}

function waitForGoogle(cb, retry=0) {
  if (typeof google !== 'undefined' && google.accounts) { cb(); }
  else if (retry < 50) { setTimeout(() => waitForGoogle(cb, retry+1), 100); }
  else { console.error('google accounts load timeout'); }
}

window.addEventListener('load', () => {
  // 祝日は連携不要で先行取得
  fetchHolidays();

  waitForGapi(() => {
    gapi.load('client', () => { initGapi(); });
  });
  waitForGoogle(() => { initGis(); });
});