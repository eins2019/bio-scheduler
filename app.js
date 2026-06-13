// ===========================
// app.js - Bioスケジューラ本体（バグ修正版）
// ===========================

const APP_VER = '1.9';  // sw.jsのCACHE_NAMEと合わせて更新すること

const TODAY = new Date(); TODAY.setHours(0,0,0,0);
const DOW = ['日','月','火','水','木','金','土'];

// HTMLエスケープ（イベントタイトル等をinnerHTMLへ入れる前に必ず通す）
function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// 祝日かどうかを返す
function getHoliday(d) {
  const k = typeof d === 'string' ? d : dkey(d);
  return holidays[k] ?? null;
}
function isHoliday(d) { return !!getHoliday(d); }

// 週開始曜日を考慮したDOW並び順を返す
function weekDow() {
  return weekStart0 === 1
    ? ['月','火','水','木','金','土','日']
    : ['日','月','火','水','木','金','土'];
}
// 週開始曜日を考慮した曜日インデックス（0始まり）
function dowIndex(d) {
  return weekStart0 === 1
    ? (d.getDay() + 6) % 7   // 月始まり：月=0,火=1,...日=6
    : d.getDay();             // 日始まり：日=0,月=1,...土=6
}
// 週の開始日（月曜 or 日曜）を取得
function getWeekStart(d) {
  const day = new Date(d);
  day.setHours(0,0,0,0);
  day.setDate(day.getDate() - dowIndex(day));
  return day;
}

// ローカル予定の永続化
const EVENTS_KEY = 'bio_events';
function loadEvents() {
  try { return JSON.parse(localStorage.getItem(EVENTS_KEY)) ?? {}; }
  catch { return {}; }
}
function saveEvents() {
  localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
}

// Googleカレンダー予定のキャッシュ（リロード直後でも表示を維持するため）
const GCAL_CACHE_KEY = 'bio_gcal_cache';
function loadGcalCache() {
  try { return JSON.parse(localStorage.getItem(GCAL_CACHE_KEY)) ?? {}; }
  catch { return {}; }
}

let bday       = new Date(1975,3,1);
let view       = 'month';
let yr, mo, wkStart;
let selDay     = null;
let selWkStart = null;
let events     = loadEvents();
let gcalEvents = loadGcalCache();
let holidays   = {};   // 祝日 { 'YYYY-MM-DD': '祝日名' }
let bioChart   = null;
let clickedHour = null;
let weekStart0 = parseInt(localStorage.getItem('bio_week_start') ?? '0'); // 0=日, 1=月
let showIntuition = localStorage.getItem('bio_show_intuition') === '1';  // 第4波（直感・38日）を表示するか

// ---------- バイオリズム計算 ----------
function bio(d) {
  const days = Math.floor((d - bday) / 86400000);
  return {
    p: Math.sin(2 * Math.PI * days / 23),
    e: Math.sin(2 * Math.PI * days / 28),
    i: Math.sin(2 * Math.PI * days / 33),
    n: Math.sin(2 * Math.PI * days / 38)   // 直感（第4波・38日）
  };
}

// バイオリズム各波のメタ情報（ユング心理機能の対応つき）
const RHYTHM_META = [
  { key:'p', label:'身体', full:'身体P', color:'#378ADD', period:23, jung:'感覚（Sensation）', note:'五感・身体を通して「今ここ」の現実をとらえる働き' },
  { key:'e', label:'感情', full:'感情S', color:'#D85A30', period:28, jung:'感情（Feeling）', note:'物事の価値や好き嫌いを判断する働き' },
  { key:'i', label:'知性', full:'知性I', color:'#1D9E75', period:33, jung:'思考（Thinking）', note:'論理・分析で物事を理解する働き' },
  { key:'n', label:'直感', full:'直感N', color:'#8E5BD9', period:38, jung:'直観（Intuition）', note:'可能性やひらめきを無意識からとらえる働き' },
];
// 表示対象の波（直感トグルOFFなら標準3波のみ）
function activeRhythms() { return showIntuition ? RHYTHM_META : RHYTHM_META.slice(0, 3); }
function isCrit(b) { return Math.abs(b.p)<0.15 || Math.abs(b.e)<0.15 || Math.abs(b.i)<0.15 || (showIntuition && Math.abs(b.n)<0.15); }

// クリティカルデイ判定：波が0をクロスするリズム名の配列を返す
// （前後の日と符号を比較し、クロスは0に近い方の日に1日だけ割り当てる）
function critCrossList(d) {
  const prev = new Date(d); prev.setDate(prev.getDate()-1);
  const next = new Date(d); next.setDate(next.getDate()+1);
  const bp = bio(prev), b0 = bio(d), bn = bio(next);
  const out = [];
  activeRhythms().map(m => [m.key, m.label]).forEach(([k,label]) => {
    const v = b0[k];
    const crossPrev = (bp[k] < 0) !== (v < 0) && Math.abs(v) <= Math.abs(bp[k]);
    const crossNext = (v < 0) !== (bn[k] < 0) && Math.abs(v) <  Math.abs(bn[k]);
    if (v === 0 || crossPrev || crossNext) out.push(label);
  });
  return out;
}
// 好調日＝全リズムが高調期（>0）。バイオリズムの慣習に準拠
function isGood(b) { return b.p>0 && b.e>0 && b.i>0 && (!showIntuition || b.n>0); }

// カレンダー用の状態アイコン：要注意=⚠️（ゼロクロス）/ 好調=😊 / それ以外=なし
function dayStatusIcon(d, crit) {
  const list = crit ?? critCrossList(d);
  if (list.length) return { icon:'⚠️', title:'クリティカルデイ：'+list.join('・')+'の切替' };
  const b = bio(d);
  // 全リズム高調期（>0）かつ0近傍の要注意がない日を好調日とする
  if (isGood(b) && !isCrit(b)) return { icon:'😊', title:'好調日：全リズムが高調期' };
  return { icon:'', title:'' };
}
function pct(v)    { return Math.round((v+1)/2*100); }
function dkey(d) {
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const dd=String(d.getDate()).padStart(2,'0');
  return y+'-'+m+'-'+dd;
}
function wdays(s, len=7)  {
  return Array.from({length:len}, (_,i) => {
    const d = new Date(s); d.setDate(d.getDate()+i); return d;
  });
}
// 週表示用：wkStartを週開始曜日に合わせて調整
function adjustWkStart(d) {
  return getWeekStart(d);
}

// ---------- 天気予報（Open-Meteo・APIキー不要・16日先まで） ----------
let weather = {};   // { 'YYYY-MM-DD': WMO天気コード }
const WEATHER_CACHE_KEY = 'bio_weather_cache';

function wmoIcon(code) {
  if (code === 0)  return '☀️';
  if (code <= 2)   return '⛅';
  if (code === 3)  return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 67)   return '🌧️';
  if (code >= 71 && code <= 77)   return '🌨️';
  if (code >= 80 && code <= 82)   return '🌧️';
  if (code === 85 || code === 86) return '🌨️';
  if (code >= 95)  return '⛈️';
  return '';
}
function weatherIcon(d) {
  const c = weather[dkey(d)];
  return c === undefined ? '' : wmoIcon(c);
}

async function fetchWeather(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&daily=weather_code&timezone=auto&forecast_days=16`;
    const resp = await fetch(url);
    const data = await resp.json();
    weather = {};
    (data.daily?.time ?? []).forEach((t, i) => { weather[t] = data.daily.weather_code[i]; });
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ at: Date.now(), weather }));
    render();
  } catch (e) { console.warn('天気取得失敗', e); }
}

function initWeather() {
  // 3時間以内に取得済みならキャッシュを使う
  try {
    const c = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY));
    if (c && Date.now() - c.at < 3*3600*1000) { weather = c.weather; render(); return; }
  } catch {}
  const loc = getWeatherLoc();
  if (loc.mode === 'fixed') { fetchWeather(loc.lat, loc.lon); return; }
  if (!navigator.geolocation) { fetchWeather(35.68, 139.76); return; }
  navigator.geolocation.getCurrentPosition(
    pos => fetchWeather(pos.coords.latitude, pos.coords.longitude),
    ()  => fetchWeather(35.68, 139.76),   // 位置情報が使えないときは東京
    { maximumAge: 3600000, timeout: 10000 }
  );
}

// ---------- 天気の地域指定 ----------
const WLOC_KEY = 'bio_weather_loc';  // {mode:'geo'} か {mode:'fixed', name, lat, lon}
const WEATHER_CITIES = {
  '札幌':[43.06,141.35], '仙台':[38.27,140.87], '東京':[35.68,139.76],
  '横浜':[35.44,139.64], '新潟':[37.90,139.02], '金沢':[36.59,136.63],
  '名古屋':[35.18,136.91], '大阪':[34.69,135.50], '広島':[34.39,132.46],
  '高松':[34.34,134.05], '福岡':[33.59,130.40], '鹿児島':[31.56,130.56],
  '那覇':[26.21,127.68],
};

function getWeatherLoc() {
  try { return JSON.parse(localStorage.getItem(WLOC_KEY)) ?? { mode:'geo' }; }
  catch { return { mode:'geo' }; }
}

function setWeatherLoc(val) {
  if (val === '__custom__') return;  // すでに選択中の任意都市
  if (val === 'custom') {
    const name = (prompt('都市名を入力してください（例：京都、軽井沢、ニューヨーク）') ?? '').trim();
    if (!name) { applyWeatherLocToSelect(); return; }
    geocodeAndFetch(name);
    return;
  }
  if (val === 'geo') {
    localStorage.setItem(WLOC_KEY, JSON.stringify({ mode:'geo' }));
  } else {
    const c = WEATHER_CITIES[val];
    if (!c) return;
    localStorage.setItem(WLOC_KEY, JSON.stringify({ mode:'fixed', name:val, lat:c[0], lon:c[1] }));
  }
  localStorage.removeItem(WEATHER_CACHE_KEY);
  initWeather();
}

async function geocodeAndFetch(name) {
  try {
    const search = async q => {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=ja`);
      const j = await r.json();
      return j.results ?? [];
    };
    // 「横浜」→青森の横浜町、「京都」→ヒットなし等の対策：
    // 「市」付きでも検索して候補を合わせ、人口最大の地点を採用する
    let results = await search(name);
    if (!/[市町村区]$/.test(name)) results = results.concat(await search(name + '市'));
    if (!results.length) { alert('「'+name+'」が見つかりませんでした'); applyWeatherLocToSelect(); return; }
    const hit = results.reduce((a, b) => ((b.population ?? 0) > (a.population ?? 0) ? b : a));
    localStorage.setItem(WLOC_KEY, JSON.stringify({ mode:'fixed', name: hit.name, lat: hit.latitude, lon: hit.longitude }));
    localStorage.removeItem(WEATHER_CACHE_KEY);
    applyWeatherLocToSelect();
    initWeather();
  } catch (e) {
    alert('都市の検索に失敗しました。通信状態を確認してください。');
    applyWeatherLocToSelect();
  }
}

// 保存済みの地域設定をセレクトボックスに反映
function applyWeatherLocToSelect() {
  const sel = document.getElementById('weather-loc');
  if (!sel) return;
  const loc = getWeatherLoc();
  if (loc.mode === 'geo')          { sel.value = 'geo'; return; }
  if (WEATHER_CITIES[loc.name])    { sel.value = loc.name; return; }
  // 任意入力の都市：専用optionを作って選択状態にする
  let opt = document.getElementById('weather-loc-custom-opt');
  if (!opt) {
    opt = document.createElement('option');
    opt.id = 'weather-loc-custom-opt';
    opt.value = '__custom__';
    sel.insertBefore(opt, sel.querySelector('option[value="custom"]'));
  }
  opt.textContent = loc.name;
  sel.value = '__custom__';
}

// ---------- 全予定を統合 ----------
function allEvents(key) {
  const loc  = events[key]     || [];
  const gcal = gcalEvents[key] || [];
  return [...loc, ...gcal];
}

// イベントの開始時間を取得（hour互換）
function evStart(ev) { return ev.hourStart ?? ev.hour ?? null; }
function evEnd(ev)   { return ev.hourEnd ?? ev.hour ?? null; }
function evIsAllday(ev) { return evStart(ev) === null; }
// 週表示用：1日の時間指定イベントを表示範囲にクランプし、重なりにはレーンを割り当てる
function layoutDayEvents(evs, gridStart, gridEnd) {
  const items = evs
    .map(ev => ({ ev, s: evStart(ev), e: evEnd(ev) }))
    .filter(x => x.s !== null)
    .map(x => ({ ev: x.ev, s: x.s, e: (x.e === null || x.e <= x.s) ? x.s + 1 : x.e }))
    .filter(x => x.e > gridStart && x.s < gridEnd)
    .map(x => ({ ev: x.ev, s: Math.max(x.s, gridStart), e: Math.min(x.e, gridEnd) }));
  items.sort((a, b) => a.s - b.s || b.e - a.e);
  const laneEnd = [];
  items.forEach(it => {
    let lane = laneEnd.findIndex(end => end <= it.s);
    if (lane === -1) { lane = laneEnd.length; laneEnd.push(0); }
    laneEnd[lane] = it.e;
    it.lane = lane;
  });
  const nLanes = Math.max(1, laneEnd.length);
  items.forEach(it => it.nLanes = nLanes);
  return items;
}
// 時間ラベル
function evTimeLabel(ev) {
  const s = evStart(ev), e = evEnd(ev);
  if (s === null) return '';
  const sl = String(s).padStart(2,'0')+':00';
  if (e === null || e === s) return ' '+sl;
  const el = String(e).padStart(2,'0')+':00';
  return ' '+sl+'~'+el;
}

// ---------- ビュー切替 ----------
function setView(v) {
  view = v;
  document.getElementById('tab-m').className = 'tab' + (v==='month'?' active':'');
  document.getElementById('tab-w').className = 'tab' + (v==='week' ?' active':'');
  const t2w = document.getElementById('tab-2w');
  if(t2w) t2w.className = 'tab' + (v==='2week' ?' active':'');
  selDay = null;
  render();
}

function navPrev() {
  if (view==='month') { mo--; if(mo<0){mo=11;yr--;} }
  else if (view==='2week') { wkStart=new Date(wkStart); wkStart.setDate(wkStart.getDate()-14); }
  else { wkStart=new Date(wkStart); wkStart.setDate(wkStart.getDate()-7); }
  selDay = null; render();
}
function navNext() {
  if (view==='month') { mo++; if(mo>11){mo=0;yr++;} }
  else if (view==='2week') { wkStart=new Date(wkStart); wkStart.setDate(wkStart.getDate()+14); }
  else { wkStart=new Date(wkStart); wkStart.setDate(wkStart.getDate()+7); }
  selDay = null; render();
}

function render() {
  if (view==='month') renderMonth(); else renderWeek();
  renderBio();
  renderDetail();
}

// ---------- 月表示（幅崩れ修正） ----------
function renderMonth() {
  document.getElementById('nlabel').textContent = yr+'年 '+(mo+1)+'月';
  const total = new Date(yr,mo+1,0).getDate();

  // table使用で幅を固定（gridだと内容で崩れる）
  const wdow = weekDow();
  let html = '<table style="width:100%;table-layout:fixed;border-collapse:separate;border-spacing:2px">';

  // 曜日ヘッダー
  html += '<thead><tr>';
  wdow.forEach((d,i) => {
    // 日始まり：日=赤,土=青 / 月始まり：土=青,日=赤（最後）
    let c = '#999';
    if (weekStart0 === 0) { if(i===0)c='#E24B4A'; else if(i===6)c='#185FA5'; }
    else                  { if(i===5)c='#185FA5'; else if(i===6)c='#E24B4A'; }
    html += `<th style="text-align:center;font-size:10px;color:${c};padding:2px 0;font-weight:normal;width:14.28%">${d}</th>`;
  });
  html += '</tr></thead><tbody>';

  const fdow2 = dowIndex(new Date(yr,mo,1));
  let dn = 1 - fdow2;
  while (dn <= total) {
    const ws = new Date(yr,mo,dn); ws.setHours(0,0,0,0);
    const isSel = selWkStart && selWkStart.getTime()===ws.getTime();
    html += `<tr style="cursor:pointer" onclick="selWeek(${ws.getTime()})">`;
    for (let i=0; i<7; i++) {
      const dd = dn+i;
      if (dd<1||dd>total) {
        html += '<td style="height:52px"></td>';
        continue;
      }
      const d   = new Date(yr,mo,dd);
      const b   = bio(d);
      const k   = dkey(d);
      const evs = allEvents(k);
      const crit= critCrossList(d);   // 波が0をクロスするリズム名（クリティカルデイ）
      const isT = d.getTime()===TODAY.getTime();
      const isHol  = isHoliday(d);
      const dow2   = d.getDay();
      const holName= getHoliday(d);

      // 文字色：日・祝=赤、土=緑、今日=青、それ以外=黒
      let dnColor = '#222';
      if      (isT)               dnColor = '#0C447C';
      else if (dow2===0 || isHol) dnColor = '#C0392B';
      else if (dow2===6)          dnColor = '#0F6E56';

      // セル背景：日・祝=薄赤、土=薄緑、今日=薄青、選択=薄紫
      let bg = '#fff';
      if      (isSel)              bg = '#EEEDFE';
      else if (isT)                bg = '#E6F1FB';
      else if (dow2===0 || isHol)  bg = '#FFECEC';
      else if (dow2===6)           bg = '#EDFAF3';

      const border = isSel?'1.5px solid #534AB7': isT?'1.5px solid #1F5C99':'0.5px solid #ddd';

      // 状態アイコン（要注意=⚠️ / 好調=😊）を日付の横に表示
      const stat = dayStatusIcon(d, crit);

      html += `<td style="border:${border};border-radius:5px;height:52px;padding:3px;
        background:${bg};vertical-align:top;overflow:hidden;width:14.28%"
        onclick="event.stopPropagation();clickDay(${d.getTime()})">`;

      // 日付＋状態アイコン横並び
      html += `<div style="display:flex;align-items:center;margin-bottom:1px">
        <span style="font-size:11px;font-weight:600;color:${dnColor}">${dd}</span>
        ${stat.icon?`<span title="${stat.title}" style="font-size:10px;margin-left:2px">${stat.icon}</span>`:''}
        ${weatherIcon(d)?`<span style="font-size:9px;margin-left:auto">${weatherIcon(d)}</span>`:''}
      </div>`;
      if (holName) {
        html += `<div style="font-size:8px;color:#C0392B;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:1px">${holName}</div>`;
      }

      // 予定チップ（最大2件、幅100%固定）
      evs.slice(0,2).forEach(ev => {
        const bg2 = isCrit(b)?'#FCEBEB': ev.source==='gcal'?'#E1F5EE':'#E6F1FB';
        const fg2 = isCrit(b)?'#791F1F': ev.source==='gcal'?'#085041':'#0C447C';
        html += `<div style="font-size:9px;padding:1px 3px;border-radius:2px;margin-top:1px;
          background:${bg2};color:${fg2};
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
          display:block;width:100%;box-sizing:border-box">${esc(ev.title)}</div>`;
      });
      if (evs.length>2) {
        html += `<div style="font-size:9px;color:#378ADD;margin-top:1px;cursor:pointer;padding:1px 2px"
          onclick="event.stopPropagation();clickDay(${d.getTime()})">+${evs.length-2}件</div>`;
      }
      html += '</td>';
    }
    html += '</tr>';
    dn += 7;
  }
  html += '</tbody></table>';
  document.getElementById('main-area').innerHTML = html;
}

function selWeek(ts) {
  selWkStart = new Date(ts); selDay = null;
  renderMonth(); renderBio(); renderDetail();
}

// ---------- 予定ポップアップ ----------
let evPopupReg = [];   // 週表示の描画ごとに作り直すイベント参照表
function showEvPopup(i) {
  const item = evPopupReg[i];
  if (!item) return;
  closeEvPopup();
  const d  = new Date(item.d);
  const ev = item.ev;
  const time = evTimeLabel(ev).trim() || '終日';
  const ov = document.createElement('div');
  ov.id = 'ev-popup-ov';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:100;display:flex;align-items:center;justify-content:center';
  ov.addEventListener('click', e => { if (e.target === ov) closeEvPopup(); });
  ov.innerHTML = `<div style="background:#fff;border-radius:10px;padding:16px 18px;max-width:80%;min-width:230px;box-shadow:0 8px 30px rgba(0,0,0,.25)">
    <div style="font-size:12px;color:#888;margin-bottom:4px">${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}（${DOW[d.getDay()]}）　${time}</div>
    <div style="font-size:14px;font-weight:600;color:#222;margin-bottom:6px;word-break:break-word">${esc(ev.title)}</div>
    <div style="font-size:10px;color:#999">${ev.source==='gcal'?'Googleカレンダー':'ローカル予定'}</div>
    <div style="text-align:right;margin-top:10px">
      <button onclick="closeEvPopup()" style="font-size:12px;padding:4px 14px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer">閉じる</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
}
function closeEvPopup() {
  const ov = document.getElementById('ev-popup-ov');
  if (ov) ov.remove();
}

// ---------- 週表示（終日イベント表示修正） ----------
function renderWeek() {
  evPopupReg = [];
  const daysLen = (view === '2week') ? 14 : 7;
  const days = wdays(wkStart, daysLen);
  const e    = days[days.length-1];
  document.getElementById('nlabel').textContent =
    wkStart.getFullYear()+'/'+(wkStart.getMonth()+1)+'/'+wkStart.getDate()+
    ' — '+(e.getMonth()+1)+'/'+e.getDate();

  // 時間軸は基本8時〜20時台、範囲外の予定があればそこまで自動拡張
  let hStart = 8, hEnd = 21;
  days.forEach(d => {
    allEvents(dkey(d)).forEach(ev => {
      const s = evStart(ev);
      if (s === null) return;
      let e = evEnd(ev);
      e = (e === null || e <= s) ? s + 1 : e;
      if (s < hStart) hStart = s;
      if (e > hEnd)   hEnd = e;
    });
  });
  const hours = Array.from({length: hEnd - hStart}, (_, i) => hStart + i);
  const wdow2 = weekDow();

  // 終日イベント行（予定の有無に関わらず常に表示・最大2件＋+N件制限）
  const MAX_ALLDAY = 2;
  let allDayHtml = '<tr><td style="font-size:9px;color:#aaa;text-align:right;padding-right:4px;background:#fafafa;border:0.5px solid #ddd;white-space:nowrap;vertical-align:top;padding-top:4px">終日</td>';
  days.forEach(d => {
    const k    = dkey(d);
    const evs  = allEvents(k).filter(ev => evIsAllday(ev));
    const b    = bio(d);
    const show = evs.slice(0, MAX_ALLDAY);
    const over = evs.length - MAX_ALLDAY;
    allDayHtml += '<td style="border:0.5px solid #ddd;padding:2px;vertical-align:top;background:#fff;min-height:20px">';
    show.forEach(ev => {
      const bg = isCrit(b)?'#F5C4B3': ev.source==='gcal'?'#9FE1CB':'#B5D4F4';
      const fg = isCrit(b)?'#4A1B0C': ev.source==='gcal'?'#04342C':'#042C53';
      const pid = evPopupReg.push({ d: d.getTime(), ev }) - 1;
      allDayHtml += `<span style="font-size:9px;padding:1px 3px;border-radius:2px;
        background:${bg};color:${fg};display:block;margin:1px 0;cursor:pointer;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
        onclick="event.stopPropagation();showEvPopup(${pid})">${esc(ev.title)}</span>`;
    });
    if (over > 0) {
      allDayHtml += `<span style="font-size:9px;color:#888;cursor:pointer;display:block;margin:1px 0;padding:1px 3px"
        onclick="clickDay(${d.getTime()})">+${over}件</span>`;
    }
    allDayHtml += '</td>';
  });
  allDayHtml += '</tr>';

  let html = `<table style="width:100%;border-collapse:collapse;table-layout:fixed">
    <thead><tr>
      <th style="width:36px;border:0.5px solid #ddd"></th>`;

  days.forEach((d,i) => {
    const b       = bio(d);
    const isT     = d.getTime()===TODAY.getTime();
    const dow     = d.getDay();
    const isHol2  = isHoliday(d);
    const holName2= getHoliday(d);
    const crit2   = critCrossList(d);   // クリティカルデイ（波が0をクロスするリズム）

    // 背景色：日・祝=薄赤、土=薄緑、今日=薄青、それ以外=白
    let bgH = '#fff';
    if      (isT)              bgH = '#E6F1FB';  // 今日：薄青
    else if (dow===0 || isHol2) bgH = '#FFECEC'; // 日・祝：薄赤
    else if (dow===6)           bgH = '#EDFAF3'; // 土：薄緑

    // 文字色：日・祝=赤、土=緑、今日=青、それ以外=黒
    let fgH = '#222';
    if      (isT)               fgH = '#0C447C';
    else if (dow===0 || isHol2) fgH = '#C0392B';
    else if (dow===6)           fgH = '#0F6E56';

    // 状態アイコン（要注意=⚠️ / 好調=😊）を日付の横に表示
    const stat = dayStatusIcon(d, crit2);

    html += `<th style="font-size:11px;font-weight:500;text-align:center;padding:3px 2px;
      border:0.5px solid #ddd;background:${bgH};color:${fgH};cursor:pointer;width:${(100/daysLen).toFixed(2)}%"
      onclick="clickDay(${d.getTime()})">
      <div style="font-size:15px;font-weight:600;line-height:1.2">${d.getDate()}${stat.icon?`<span title="${stat.title}" style="font-size:11px;margin-left:1px">${stat.icon}</span>`:''}</div>
      <div style="font-size:11px;line-height:1.2">${DOW[d.getDay()]}</div>
      ${weatherIcon(d)?`<div style="font-size:11px;line-height:1.3">${weatherIcon(d)}</div>`:''}
      ${holName2?`<div style="font-size:8px;font-weight:normal;line-height:1.2">${holName2}</div>`:''}
    </th>`;
  });
  html += `</tr></thead><tbody>${allDayHtml}`;

  // 各日のイベントを開始時間ごとに1本のバーとして配置（重なりは横並び）
  const gridStart = hours[0], gridEnd = hours[hours.length-1] + 1;
  const dayLayouts = days.map(d => layoutDayEvents(allEvents(dkey(d)), gridStart, gridEnd));

  hours.forEach(h => {
    html += `<tr><td style="font-size:9px;color:#aaa;text-align:right;padding-right:4px;
      background:#fafafa;height:26px;border:0.5px solid #ddd;white-space:nowrap">${h}:00</td>`;
    days.forEach((d, di) => {
      const b = bio(d);
      html += `<td style="border:0.5px solid #ddd;padding:0;vertical-align:top;
        height:26px;cursor:pointer;background:#fff;position:relative"
        onclick="clickSlot(${d.getTime()},${h})">`;
      // この時間に開始するイベントだけ描画し、高さで終了時間まで伸ばす
      dayLayouts[di].filter(it => it.s === h).forEach(it => {
        const ev   = it.ev;
        const rows = it.e - it.s;
        const bg = isCrit(b)?'#F5C4B3': ev.source==='gcal'?'#9FE1CB':'#B5D4F4';
        const fg = isCrit(b)?'#4A1B0C': ev.source==='gcal'?'#04342C':'#042C53';
        const left  = (it.lane / it.nLanes * 100).toFixed(1);
        const width = (100 / it.nLanes).toFixed(1);
        const pid = evPopupReg.push({ d: d.getTime(), ev }) - 1;
        html += `<div style="position:absolute;top:1px;left:calc(${left}% + 1px);
          width:calc(${width}% - 2px);height:${(rows*26.5-4).toFixed(1)}px;
          background:${bg};color:${fg};font-size:9px;padding:1px 3px;border-radius:3px;
          z-index:1;overflow:hidden;box-sizing:border-box;cursor:pointer"
          onclick="event.stopPropagation();showEvPopup(${pid})">
          <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(ev.title)}</div>
          ${rows>=2?`<div style="font-size:8px;opacity:.75">${evTimeLabel(ev).trim()}</div>`:''}
        </div>`;
      });
      html += '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('main-area').innerHTML = html;
}

function clickDay(ts) { selDay=new Date(ts); clickedHour=null; renderBio(); renderDetail(); }
function clickSlot(ts,h) {
  selDay = new Date(ts);
  clickedHour = h;
  renderBio(); renderDetail();
  setTimeout(() => {
    const inp = document.getElementById('ev-input');
    if (inp) inp.focus();
  }, 30);
}

// ---------- バイオリズムグラフ ----------
function getBioWeekDays() {
  if (view==='week') return wdays(wkStart, 7);
  if (view==='2week') return wdays(wkStart, 14);
  if (selWkStart)    return wdays(selWkStart, 7);
  const d = new Date(TODAY); d.setDate(d.getDate()-d.getDay());
  return wdays(d, 7);
}

function renderBio() {
  const days = getBioWeekDays();
  const d0=days[0], d_last=days[days.length-1];
  const title = (d0.getMonth()+1)+'/'+d0.getDate()+' — '+(d_last.getMonth()+1)+'/'+d_last.getDate()+' のバイオリズム';

  const metas = activeRhythms();
  // 凡例マーカー（身体=■ 感情=● 知性=▲ 直感=○中空丸）
  const legMarker = m =>
    m.key==='p' ? `<rect x="7" y="2" width="8" height="8" fill="${m.color}"/>` :
    m.key==='e' ? `<circle cx="11" cy="6" r="4" fill="${m.color}"/>` :
    m.key==='i' ? `<polygon points="11,1 16,11 6,11" fill="${m.color}"/>` :
                  `<circle cx="11" cy="6" r="3.5" fill="#fff" stroke="${m.color}" stroke-width="2"/>`;
  // 直感の凡例線は点線
  const legLine = m => m.key==='n'
    ? `<line x1="0" y1="6" x2="22" y2="6" stroke="${m.color}" stroke-width="2" stroke-dasharray="3,2"/>`
    : `<line x1="0" y1="6" x2="22" y2="6" stroke="${m.color}" stroke-width="2"/>`;
  const legendHtml = metas.map(m => `
    <div class="bleg" title="ユング：${m.jung}／${m.note}">
      <svg width="22" height="12" style="vertical-align:middle">
        ${legLine(m)}
        ${legMarker(m)}
      </svg>${m.full}
    </div>`).join('');
  // ユング心理機能の注釈（折りたたみ）
  const noteHtml = `
    <details style="margin-top:6px">
      <summary style="font-size:10px;color:#888;cursor:pointer">ⓘ 各波の意味（ユング心理機能との対応）</summary>
      <div style="font-size:10px;color:#666;line-height:1.7;margin-top:4px">
        ${metas.map(m => `<div><span style="color:${m.color};font-weight:600">${m.full}</span>（${m.period}日）― ユング「${m.jung}」：${m.note}。</div>`).join('')}
        <div style="color:#aaa;margin-top:3px;font-size:9px">※バイオリズムの4波を、C.G.ユングの4つの心理機能になぞらえた参考解釈です。</div>
      </div>
    </details>`;

  document.getElementById('bio-area').innerHTML = `
    <div class="bio-box">
      <div class="bio-box-hdr">
        <div class="bio-box-title">${title}</div>
        <div class="bio-legend">${legendHtml}</div>
      </div>
      <div style="position:relative;height:160px">
        <canvas id="bioChart" role="img" aria-label="週のバイオリズムグラフ"></canvas>
      </div>
      <div id="day-score-row" style="display:grid;grid-template-columns:36px repeat(${days.length},1fr);gap:1px;margin-top:4px"></div>
      ${noteHtml}
    </div>`;

  requestAnimationFrame(() => {
    if (bioChart) { bioChart.destroy(); bioChart=null; }
    const canvas = document.getElementById('bioChart');
    if (!canvas) return;

    const labels=[];
    const series = {}; metas.forEach(m => series[m.key] = []);
    days.forEach(d => {
      labels.push((d.getMonth()+1)+'/'+d.getDate()+'\n'+DOW[d.getDay()]);
      const b = bio(d);
      metas.forEach(m => series[m.key].push(parseFloat(b[m.key].toFixed(3))));
    });

    const mk = (label,data,color,marker) => ({
      label,data,borderColor:color,borderWidth:2,backgroundColor:color,
      pointStyle:marker,pointRadius:6,pointHoverRadius:8,fill:false,tension:0.4
    });
    // Chart.jsのpointStyle（直感=中空の丸）
    const CHART_MARKER = { p:'rect', e:'circle', i:'triangle', n:'circle' };
    const datasets = metas.map(m => {
      const ds = mk(m.full, series[m.key], m.color, CHART_MARKER[m.key]);
      if (m.key === 'n') {              // 直感：点線＋中空（白抜き）の丸
        ds.borderDash = [5, 4];
        ds.pointBackgroundColor = '#fff';
        ds.pointBorderColor = m.color;
        ds.pointBorderWidth = 2;
      }
      return ds;
    });

    bioChart = new Chart(canvas, {
      type:'line',
      data:{ labels, datasets },
      options:{
        responsive:true, maintainAspectRatio:false, animation:{duration:300},
        plugins:{ legend:{display:false},
          tooltip:{ callbacks:{ label:ctx=>`${ctx.dataset.label}: ${(ctx.raw*100).toFixed(0)}` }}
        },
        scales:{
          x:{ ticks:{font:{size:10},maxRotation:0}, grid:{color:'rgba(128,128,128,0.1)'} },
          y:{ min:-1.2,max:1.2,
            ticks:{ callback:v=>v===1?'高調期':v===0?'±0':v===-1?'低調期':'', font:{size:9} },
            grid:{ color:ctx=>ctx.tick.value===0?'rgba(0,0,0,0.3)':'rgba(128,128,128,0.1)',
              lineWidth:ctx=>ctx.tick.value===0?1.5:0.5 }
          }
        }
      }
    });

    const row = document.getElementById('day-score-row');
    row.innerHTML = '<div></div>' + days.map(d => {
      const b=bio(d);
      const isSel = selDay && selDay.getTime()===d.getTime();
      const bg = isSel?'background:#f0f0f0;border-radius:4px':'';
      return `<div style="text-align:center;padding:2px 0;${bg}">
        ${metas.map(m => `<div style="height:3px;background:${m.color};width:${pct(b[m.key])}%;max-width:100%;margin:0 auto 1px"></div>`).join('')}
        <div style="font-size:8px;color:#aaa">${DOW[d.getDay()]}</div>
      </div>`;
    }).join('');
  });
}

// ---------- 詳細パネル ----------
function renderDetail() {
  if (!selDay) { document.getElementById('detail-area').innerHTML=''; return; }
  const b   = bio(selDay);
  const k   = dkey(selDay);
  const evs = allEvents(k);
  const pp=pct(b.p), pe=pct(b.e), pi=pct(b.i), pn=pct(b.n);

  let adv='',acls='';
  const cross = critCrossList(selDay);
  if (cross.length)          { adv='⚠️ クリティカルデイ：'+cross.join('・')+'リズムが切り替わる日です。重要な予定は慎重に。'; acls='danger'; }
  else if (isCrit(b))        { adv='要注意日：リズムの切り替わり付近です。重要な予定は慎重に。'; acls='danger'; }
  else if (isGood(b))        { adv='好調日：'+(showIntuition?'4':'3')+'リズムすべてが高調期。重要な予定に最適です。';    acls='good'; }
  else if (b.p<-0.3||b.e<-0.3) { adv='やや低調：無理のないスケジュールをお勧めします。';   acls='caution'; }
  else                       { adv='通常日：バランスよく活動できます。';                      acls='good'; }

  let evHtml = '';
  if (evs.length) {
    evHtml = '<div class="ev-items">' +
      evs.map((ev,i) => {
        const dot = isCrit(b)?'#E24B4A': ev.source==='gcal'?'#1D9E75':'#378ADD';
        const src = ev.source==='gcal'?'GCal':'ローカル';
        const del = ev.source==='gcal'?''
          :`<div class="ev-del" onclick="delEv('${k}',${i})">✕</div>`;
        return `<div class="ev-row">
          <div class="ev-dot" style="background:${dot}"></div>
          <div class="ev-t">${esc(ev.title)}${evTimeLabel(ev)}</div>
          <div class="ev-src">${src}</div>${del}
        </div>`;
      }).join('') + '</div>';
  }

  document.getElementById('detail-area').innerHTML = `
    <div class="detail">
      <div class="detail-date">${selDay.getFullYear()}/${selDay.getMonth()+1}/${selDay.getDate()}（${DOW[selDay.getDay()]}）</div>
      <div class="scores3" style="grid-template-columns:repeat(${showIntuition?4:3},1fr)">
        <div class="s3"><div class="s3-l">身体P</div><div class="s3-v" style="color:#185FA5">${pp}%</div></div>
        <div class="s3"><div class="s3-l">感情S</div><div class="s3-v" style="color:#993C1D">${pe}%</div></div>
        <div class="s3"><div class="s3-l">知性I</div><div class="s3-v" style="color:#0F6E56">${pi}%</div></div>
        ${showIntuition?`<div class="s3"><div class="s3-l">直感N</div><div class="s3-v" style="color:#7A3FB8">${pn}%</div></div>`:''}
      </div>
      <div class="adv ${acls}">${adv}</div>
      ${evHtml}
      <div style="font-size:11px;color:#888;margin-bottom:4px">予定を追加（ローカル）</div>
      <div class="add-row">
        <input type="text" id="ev-input" placeholder="予定のタイトル">
        <select id="ev-hour-start" style="font-size:12px;padding:4px 6px;border:1px solid #ccc;border-radius:6px;background:#fff;min-width:70px" onchange="onStartChange()">
          <option value="">終日</option>
          ${Array.from({length:24},(_,i)=>`<option value="${i}"${clickedHour===i?' selected':''}>${String(i).padStart(2,'0')}:00</option>`).join('')}
        </select>
        <span id="ev-hour-end-wrap" style="display:${clickedHour!==null?'inline':'none'}">
          <span style="font-size:11px;color:#888">～</span>
          <select id="ev-hour-end" style="font-size:12px;padding:4px 6px;border:1px solid #ccc;border-radius:6px;background:#fff;min-width:70px">
            ${Array.from({length:24},(_,i)=>`<option value="${i}"${clickedHour!==null&&i===(clickedHour+1)%24?' selected':''}>${String(i).padStart(2,'0')}:00</option>`).join('')}
          </select>
        </span>
        <button onclick="addEv('${k}')">追加</button>
      </div>
    </div>`;

  const inp = document.getElementById('ev-input');
  if (!inp) return;
  let isComposing = false;
  inp.addEventListener('compositionstart', () => { isComposing=true; });
  inp.addEventListener('compositionend',   () => { isComposing=false; });
  inp.addEventListener('keydown', e => { if(e.key==='Enter'&&!isComposing) addEv(k); });
}

// ---------- 予定追加・削除 ----------
function onStartChange() {
  const ssel = document.getElementById('ev-hour-start');
  const wrap = document.getElementById('ev-hour-end-wrap');
  const esel = document.getElementById('ev-hour-end');
  if (ssel.value === '') {
    wrap.style.display = 'none';
  } else {
    wrap.style.display = 'inline';
    const sv = parseInt(ssel.value);
    // デフォルトで+1時間を選択
    if (esel) esel.value = String((sv+1)%24);
  }
}
function addEv(k) {
  const inp  = document.getElementById('ev-input');
  const ssel = document.getElementById('ev-hour-start');
  const esel = document.getElementById('ev-hour-end');
  const t    = inp.value.trim();
  if (!t) return;
  let hs = null, he = null;
  if (ssel && ssel.value !== '') {
    hs = parseInt(ssel.value);
    he = (esel && esel.value !== '') ? parseInt(esel.value) : hs;
  }
  if (!events[k]) events[k] = [];
  events[k].push({ title:t, hourStart:hs, hourEnd:he, source:'local' });
  saveEvents();
  inp.value=''; clickedHour = null;
  render();
}
function delEv(k,i) {
  events[k].splice(i,1);
  if (!events[k].length) delete events[k];
  saveEvents();
  render();
}

// ---------- ローカル予定のバックアップ（書き出し／読み込み） ----------
// ローカル予定はこの端末のlocalStorage(bio_events)のみに保存されるため、
// JSONファイルとして書き出し・読み込みできるようにする。
function exportEvents() {
  if (!Object.keys(events).length) { alert('書き出すローカル予定がありません。'); return; }
  const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const n = new Date(), p = x => String(x).padStart(2,'0');
  const a = document.createElement('a');
  a.href = url;
  a.download = `bio-events-${n.getFullYear()}${p(n.getMonth()+1)}${p(n.getDate())}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// 読み込み：既存の予定に「マージ（重複は追加しない）」する
function importEvents(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('ファイルの形式が不正です');
      const norm = e => JSON.stringify([e.title, e.hourStart ?? e.hour ?? null, e.hourEnd ?? null]);
      let added = 0;
      Object.keys(data).forEach(k => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !Array.isArray(data[k])) return;
        if (!events[k]) events[k] = [];
        data[k].forEach(ev => {
          if (!ev || typeof ev.title !== 'string') return;
          if (events[k].some(e => norm(e) === norm(ev))) return;   // 重複はスキップ
          events[k].push({ title: ev.title, hourStart: ev.hourStart ?? ev.hour ?? null, hourEnd: ev.hourEnd ?? null, source: 'local' });
          added++;
        });
        if (!events[k].length) delete events[k];
      });
      saveEvents();
      render();
      alert(`読み込み完了：${added}件を追加しました。`);
    } catch (e) {
      alert('読み込みに失敗しました：' + e.message);
    }
  };
  reader.readAsText(file);
}

// ---------- Googleカレンダー予定反映 ----------
function renderGcalEvents(evList) {
  Object.keys(gcalEvents).forEach(k => delete gcalEvents[k]);
  evList.forEach(ev => {

    if (ev.start.date) {
      // 終日イベント（単日 or 複数日）
      // Googleカレンダーの end.date は最終日+1日のため -1日して処理
      const startD = new Date(ev.start.date);  // UTC基準だがdate文字列なので正確
      const endD   = new Date(ev.end.date);
      endD.setDate(endD.getDate() - 1);        // 終了日を実際の最終日に補正

      // 開始日〜終了日の各日に予定を追加
      const cur = new Date(startD);
      while (cur <= endD) {
        const y = cur.getUTCFullYear();
        const m = String(cur.getUTCMonth()+1).padStart(2,'0');
        const d = String(cur.getUTCDate()).padStart(2,'0');
        const k = y+'-'+m+'-'+d;
        if (!gcalEvents[k]) gcalEvents[k] = [];
        gcalEvents[k].push({
          title:  ev.summary ?? '（タイトルなし）',
          hour:   null,
          source: 'gcal'
        });
        cur.setUTCDate(cur.getUTCDate() + 1);
      }

    } else if (ev.start.dateTime) {
      // 時間指定イベント：ローカル時間で日付・時刻を取得
      const dt = new Date(ev.start.dateTime);
      const y  = dt.getFullYear();
      const m  = String(dt.getMonth()+1).padStart(2,'0');
      const d  = String(dt.getDate()).padStart(2,'0');
      const k  = y+'-'+m+'-'+d;
      const hs = dt.getHours();
      // 終了時刻も取り込む（分が端数なら切り上げ、日またぎはその日の終わりまで）
      let he = hs;
      if (ev.end && ev.end.dateTime) {
        const de = new Date(ev.end.dateTime);
        he = dkey(de) === k
          ? de.getHours() + (de.getMinutes() > 0 ? 1 : 0)
          : 24;
      }
      if (!gcalEvents[k]) gcalEvents[k] = [];
      gcalEvents[k].push({
        title:     ev.summary ?? '（タイトルなし）',
        hourStart: hs,
        hourEnd:   he,
        source:    'gcal'
      });
    }
  });
  localStorage.setItem(GCAL_CACHE_KEY, JSON.stringify(gcalEvents));
  render();
  const btn = document.getElementById('gcal-btn');
  btn.textContent = '連携済み ✓';
  btn.classList.add('connected');
  btn.title = 'クリックで連携解除';
}

function clearGcalEvents() {
  Object.keys(gcalEvents).forEach(k => delete gcalEvents[k]);
  localStorage.removeItem(GCAL_CACHE_KEY);
  const btn = document.getElementById('gcal-btn');
  btn.textContent = 'Googleカレンダーと連携';
  btn.classList.remove('connected');
  btn.title = 'クリックで連携／連携解除';
  render();
}

// ---------- 初期化 ----------
const BDAY_KEY = 'bio_bday';

// 生年月日を反映（表示位置はそのまま再計算）
function applyBday() {
  const v = document.getElementById('bday').value;
  if (!v) return;
  localStorage.setItem(BDAY_KEY, v);
  const [y,m,d] = v.split('-').map(Number);
  bday = new Date(y,m-1,d); bday.setHours(0,0,0,0);
  if (bioChart) { bioChart.destroy(); bioChart=null; }
  render();
}

// 今日へ移動（現在のビュー種別は維持）
function goToday() {
  yr=TODAY.getFullYear(); mo=TODAY.getMonth();
  wkStart=getWeekStart(TODAY);
  selDay=null; selWkStart=null;
  render();
}

// 起動時の初期化：生年月日を反映し今日を表示
function init() {
  applyBday();
  goToday();
}

yr=TODAY.getFullYear(); mo=TODAY.getMonth();
wkStart=getWeekStart(TODAY);
{
  const verEl = document.getElementById('app-ver');
  if (verEl) verEl.textContent = 'v' + APP_VER;
}
// 保存済みの生年月日があれば入力欄に復元してから初期化
{
  const savedBday = localStorage.getItem(BDAY_KEY);
  if (savedBday) {
    const el = document.getElementById('bday');
    if (el) el.value = savedBday;
  }
}
init();
applyWeatherLocToSelect();
initWeather();

// ---------- スワイプで前後移動（タッチ端末） ----------
(function() {
  const area = document.getElementById('main-area');
  if (!area) return;
  let sx = 0, sy = 0;
  area.addEventListener('touchstart', e => {
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
  }, { passive: true });
  area.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    // 縦スクロールと区別：横移動50px以上かつ縦より明確に大きいときだけ
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) navNext(); else navPrev();
  }, { passive: true });
})();

// ---------- 第4波（直感）の表示切替 ----------
function setShowIntuition(on) {
  showIntuition = !!on;
  localStorage.setItem('bio_show_intuition', showIntuition ? '1' : '0');
  if (bioChart) { bioChart.destroy(); bioChart = null; }
  render();
}

// ---------- 週開始曜日の切替 ----------
function setWeekStart(val) {
  weekStart0 = parseInt(val);
  localStorage.setItem('bio_week_start', val);
  wkStart = getWeekStart(TODAY);
  selDay = null; selWkStart = null;
  updateWeekStartBtn();
  render();
}
// 週開始曜日トグル（日曜 ⇄ 月曜）
function toggleWeekStart() {
  setWeekStart(weekStart0 === 1 ? 0 : 1);
}
// ボタンのラベルを現在の週開始曜日に合わせる
function updateWeekStartBtn() {
  const b = document.getElementById('week-start-btn');
  if (b) b.textContent = weekStart0 === 1 ? '月曜始' : '日曜始';
}

// ---------- 今日の日付・時刻（1秒ごとに更新） ----------
function tickClock() {
  const el = document.getElementById('clock-bar');
  if (!el) return;
  const n = new Date();
  const p = x => String(x).padStart(2, '0');
  el.textContent = `${n.getFullYear()}/${n.getMonth()+1}/${n.getDate()}（${DOW[n.getDay()]}） ${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}`;
}
tickClock();
setInterval(tickClock, 1000);

// ---------- 祝日データのセット（gcal.jsから呼ばれる） ----------
function setHolidays(data) {
  // data: { 'YYYY-MM-DD': '祝日名', ... }
  holidays = data;
  render();
}