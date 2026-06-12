// ===========================
// app.js - Bioスケジューラ本体（バグ修正版）
// ===========================

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

let bday       = new Date(1975,3,1);
let view       = 'month';
let yr, mo, wkStart;
let selDay     = null;
let selWkStart = null;
let events     = loadEvents();
let gcalEvents = {};
let holidays   = {};   // 祝日 { 'YYYY-MM-DD': '祝日名' }
let bioChart   = null;
let clickedHour = null;
let weekStart0 = parseInt(localStorage.getItem('bio_week_start') ?? '0'); // 0=日, 1=月

// ---------- バイオリズム計算 ----------
function bio(d) {
  const days = Math.floor((d - bday) / 86400000);
  return {
    p: Math.sin(2 * Math.PI * days / 23),
    e: Math.sin(2 * Math.PI * days / 28),
    i: Math.sin(2 * Math.PI * days / 33)
  };
}
function isCrit(b) { return Math.abs(b.p)<0.15 || Math.abs(b.e)<0.15 || Math.abs(b.i)<0.15; }
function isGood(b) { return b.p>0.5 && b.e>0.5 && b.i>0.5; }
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

      // バイオリズムマーカー（灰色=非表示）
      function mColor(val) {
        if (Math.abs(val) < 0.15) return '#E24B4A';
        if (val > 0.5)            return '#185FA5';
        return null;
      }
      const mp = mColor(b.p), me = mColor(b.e), mi = mColor(b.i);
      const hasM = mp||me||mi;
      const mSvg = hasM ? `<svg width="28" height="7" style="display:inline-block;vertical-align:middle;margin-left:1px">
        ${mp?`<rect x="0" y="0" width="6" height="6" fill="${mp}"/>`:''}
        ${me?`<circle cx="11" cy="3" r="3" fill="${me}"/>`:''}
        ${mi?`<polygon points="19,7 22,1 25,7" fill="${mi}"/>`:''}
      </svg>` : '';

      html += `<td style="border:${border};border-radius:5px;height:52px;padding:3px;
        background:${bg};vertical-align:top;overflow:hidden;width:14.28%"
        onclick="event.stopPropagation();clickDay(${d.getTime()})">`;

      // 日付＋マーカー横並び
      html += `<div style="display:flex;align-items:center;margin-bottom:1px">
        <span style="font-size:11px;font-weight:600;color:${dnColor}">${dd}</span>${mSvg}
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

// ---------- 週表示（終日イベント表示修正） ----------
function renderWeek() {
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
      allDayHtml += `<span style="font-size:9px;padding:1px 3px;border-radius:2px;
        background:${bg};color:${fg};display:block;margin:1px 0;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(ev.title)}</span>`;
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

    // バイオリズム3指標のマーカー
    // 注意日=赤、好調=青、通常=灰
    function bioColor(val) {
      if (Math.abs(val) < 0.15) return '#E24B4A'; // 注意：赤
      if (val > 0.5)            return '#185FA5'; // 好調：青
      return '#bbb';                              // 通常：灰
    }
    const pc = bioColor(b.p);
    const ec = bioColor(b.e);
    const ic = bioColor(b.i);

    // SVGマーカー（■●▲）灰色（通常）は非表示・詰めて表示
    const pShow = pc !== '#bbb';
    const eShow = ec !== '#bbb';
    const iShow = ic !== '#bbb';

    // 表示するマーカーだけ幅を計算して詰める
    let mItems = [];
    if (pShow) mItems.push(`<rect x="0" y="1" width="6" height="6" fill="${pc}"/>`);
    if (eShow) mItems.push(`<circle cx="${mItems.length*9+3}" cy="4" r="3" fill="${ec}"/>`);
    if (iShow) {
      const ox = mItems.length * 9;
      mItems.push(`<polygon points="${ox},8 ${ox+3},1 ${ox+6},8" fill="${ic}"/>`);
    }
    // cx/points を詰めて再計算
    let mx = 0;
    const mParts = [];
    if (pShow) { mParts.push(`<rect x="${mx}" y="1" width="6" height="6" fill="${pc}"/>`); mx+=9; }
    if (eShow) { mParts.push(`<circle cx="${mx+3}" cy="4" r="3" fill="${ec}"/>`); mx+=9; }
    if (iShow) { mParts.push(`<polygon points="${mx},8 ${mx+3},1 ${mx+6},8" fill="${ic}"/>`); mx+=9; }
    const mw = mx > 0 ? mx-3 : 0;
    const markers = mw > 0
      ? `<svg width="${mw}" height="8" style="display:inline-block;vertical-align:middle;margin-left:3px">${mParts.join('')}</svg>`
      : '';

    html += `<th style="font-size:11px;font-weight:500;text-align:center;padding:3px 2px;
      border:0.5px solid #ddd;background:${bgH};color:${fgH};cursor:pointer;width:${(100/daysLen).toFixed(2)}%"
      onclick="clickDay(${d.getTime()})">
      <div style="font-size:15px;font-weight:600;line-height:1.2">${d.getDate()}</div>
      <div style="font-size:11px;line-height:1.2">${DOW[d.getDay()]}${markers}</div>
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
        html += `<div style="position:absolute;top:1px;left:calc(${left}% + 1px);
          width:calc(${width}% - 2px);height:${(rows*26.5-4).toFixed(1)}px;
          background:${bg};color:${fg};font-size:9px;padding:1px 3px;border-radius:3px;
          z-index:1;overflow:hidden;box-sizing:border-box">
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

  document.getElementById('bio-area').innerHTML = `
    <div class="bio-box">
      <div class="bio-box-hdr">
        <div class="bio-box-title">${title}</div>
        <div class="bio-legend">
          <div class="bleg">
            <svg width="22" height="12" style="vertical-align:middle">
              <line x1="0" y1="6" x2="22" y2="6" stroke="#378ADD" stroke-width="2"/>
              <rect x="7" y="2" width="8" height="8" fill="#378ADD"/>
            </svg>身体P
          </div>
          <div class="bleg">
            <svg width="22" height="12" style="vertical-align:middle">
              <line x1="0" y1="6" x2="22" y2="6" stroke="#D85A30" stroke-width="2"/>
              <circle cx="11" cy="6" r="4" fill="#D85A30"/>
            </svg>感情S
          </div>
          <div class="bleg">
            <svg width="22" height="12" style="vertical-align:middle">
              <line x1="0" y1="6" x2="22" y2="6" stroke="#1D9E75" stroke-width="2"/>
              <polygon points="11,1 16,11 6,11" fill="#1D9E75"/>
            </svg>知性I
          </div>
        </div>
      </div>
      <div style="position:relative;height:160px">
        <canvas id="bioChart" role="img" aria-label="週のバイオリズムグラフ"></canvas>
      </div>
      <div id="day-score-row" style="display:grid;grid-template-columns:36px repeat(${days.length},1fr);gap:1px;margin-top:4px"></div>
    </div>`;

  requestAnimationFrame(() => {
    if (bioChart) { bioChart.destroy(); bioChart=null; }
    const canvas = document.getElementById('bioChart');
    if (!canvas) return;

    const labels=[], pData=[], eData=[], iData=[];
    days.forEach(d => {
      labels.push((d.getMonth()+1)+'/'+d.getDate()+'\n'+DOW[d.getDay()]);
      const b = bio(d);
      pData.push(parseFloat(b.p.toFixed(3)));
      eData.push(parseFloat(b.e.toFixed(3)));
      iData.push(parseFloat(b.i.toFixed(3)));
    });

    const mk = (label,data,color,marker) => ({
      label,data,borderColor:color,borderWidth:2,backgroundColor:color,
      pointStyle:marker,pointRadius:6,pointHoverRadius:8,fill:false,tension:0.4
    });

    bioChart = new Chart(canvas, {
      type:'line',
      data:{ labels, datasets:[
        mk('身体P',pData,'#378ADD','rect'),
        mk('感情S',eData,'#D85A30','circle'),
        mk('知性I',iData,'#1D9E75','triangle'),
      ]},
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
        <div style="height:3px;background:#378ADD;width:${pct(b.p)}%;max-width:100%;margin:0 auto 1px"></div>
        <div style="height:3px;background:#D85A30;width:${pct(b.e)}%;max-width:100%;margin:0 auto 1px"></div>
        <div style="height:3px;background:#1D9E75;width:${pct(b.i)}%;max-width:100%;margin:0 auto 1px"></div>
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
  const pp=pct(b.p), pe=pct(b.e), pi=pct(b.i);

  let adv='',acls='';
  if (isCrit(b))             { adv='要注意日：リズムの切り替わりです。重要な予定は慎重に。'; acls='danger'; }
  else if (isGood(b))        { adv='好調日：3リズムがすべて高め。重要な予定に最適です。';    acls='good'; }
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
      <div class="scores3">
        <div class="s3"><div class="s3-l">身体P</div><div class="s3-v" style="color:#185FA5">${pp}%</div></div>
        <div class="s3"><div class="s3-l">感情S</div><div class="s3-v" style="color:#993C1D">${pe}%</div></div>
        <div class="s3"><div class="s3-l">知性I</div><div class="s3-v" style="color:#0F6E56">${pi}%</div></div>
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
  render();
  const btn = document.getElementById('gcal-btn');
  btn.textContent = '連携済み ✓';
  btn.classList.add('connected');
  document.getElementById('gcal-signout').style.display = 'inline';
}

function clearGcalEvents() {
  Object.keys(gcalEvents).forEach(k => delete gcalEvents[k]);
  const btn = document.getElementById('gcal-btn');
  btn.textContent = 'Googleカレンダーと連携';
  btn.classList.remove('connected');
  document.getElementById('gcal-signout').style.display = 'none';
  render();
}

// ---------- 初期化 ----------
const BDAY_KEY = 'bio_bday';
function init() {
  const v = document.getElementById('bday').value;
  if (!v) return;
  localStorage.setItem(BDAY_KEY, v);
  const [y,m,d] = v.split('-').map(Number);
  bday = new Date(y,m-1,d); bday.setHours(0,0,0,0);
  yr=TODAY.getFullYear(); mo=TODAY.getMonth();
  const ws=getWeekStart(TODAY);
  wkStart=ws; selDay=null; selWkStart=null;
  if (bioChart) { bioChart.destroy(); bioChart=null; }
  render();
}

yr=TODAY.getFullYear(); mo=TODAY.getMonth();
wkStart=getWeekStart(TODAY);
// 保存済みの生年月日があれば入力欄に復元してから初期化
{
  const savedBday = localStorage.getItem(BDAY_KEY);
  if (savedBday) {
    const el = document.getElementById('bday');
    if (el) el.value = savedBday;
  }
}
init();

// ---------- 週開始曜日の切替 ----------
function setWeekStart(val) {
  weekStart0 = parseInt(val);
  localStorage.setItem('bio_week_start', val);
  wkStart = getWeekStart(TODAY);
  selDay = null; selWkStart = null;
  render();
}

// ---------- 祝日データのセット（gcal.jsから呼ばれる） ----------
function setHolidays(data) {
  // data: { 'YYYY-MM-DD': '祝日名', ... }
  holidays = data;
  render();
}