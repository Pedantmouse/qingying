/* 轻盈计划 · 主程序（纯前端，数据保存在本机 localStorage） */
'use strict';

const STORE_KEY = 'qingying_v1';
const BACKUP_PREFIX = 'QYJH1.';
const WATER_GOAL = 8;

/* ---------- 小工具 ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
const fmtMD = (k) => { const d = parseKey(k); return `${d.getMonth() + 1}月${d.getDate()}日`; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const round1 = (n) => Math.round(n * 10) / 10;
const toMin = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const slotName = (key) => (MEAL_SLOTS.find((s) => s.key === key) || {}).name || '';
const dayLabel = (k) => (k === dateKey() ? '今天' : k === addDays(dateKey(), -1) ? '昨天' : fmtMD(k));

/* ---------- 拍照 / 语音 / 播报 工具函数 ---------- */
const supportsCamera = () => !!document.getElementById('cameraInput');
const supportsSpeechRec = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
const supportsSpeechSyn = () => typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';

/* 压缩图片为 base64（最大宽度 800px、JPEG 0.7），单张约 30-100KB */
function compressImage(file, maxSize = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    if (!file || !/image\//.test(file.type)) { reject(new Error('not image')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read fail'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('img fail'));
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        try { resolve(canvas.toDataURL('image/jpeg', quality)); }
        catch (err) { reject(err); }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* 统一拍照入口：调用 #cameraInput 文件选择器，回调返回压缩后 base64
 * 用途：避免在每处都写 <input>，复用同一 input 元素
 * 调用方式：takePhoto((b64) => { ... }) */
let _cameraCb = null;
function takePhoto(cb) {
  const input = document.getElementById('cameraInput');
  if (!input) { toast('当前浏览器不支持拍照'); return; }
  _cameraCb = cb;
  input.value = '';
  input.click();
}
document.getElementById('cameraInput')?.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) { _cameraCb = null; return; }
  try {
    const b64 = await compressImage(file);
    if (_cameraCb) _cameraCb(b64);
  } catch (err) { toast('拍照处理失败，请重试'); }
  _cameraCb = null;
});

/* 全屏照片查看器 */
function viewPhoto(b64, alt) {
  const v = document.getElementById('photoViewer');
  if (!v) return;
  v.innerHTML = `<button class="pv-close" data-close-viewer aria-label="关闭">✕</button><img src="${b64}" alt="${esc(alt || '照片')}">`;
  v.hidden = false;
}
function closePhotoViewer() {
  const v = document.getElementById('photoViewer');
  if (v) { v.hidden = true; v.innerHTML = ''; }
}

/* 语音输入：解析中文口语 "米饭一碗" -> {name, portion, cat?}
 * 最长食物名优先匹配；分量用正则提取，复用 parsePortion 的 unit 关键字 */
function parseVoiceInput(text) {
  const t = String(text || '').replace(/\s+/g, '').trim();
  if (!t) return { name: '', portion: '一份' };
  let bestName = '', bestCat = '', bestLen = 0;
  FOOD_CATEGORIES.forEach((c) => (FOODS[c.key] || []).forEach((f) => {
    const n = f.name.replace(/\(.*?\)/g, '');
    if (n.length >= 2 && t.indexOf(n) >= 0 && n.length > bestLen) {
      bestName = n; bestCat = c.key; bestLen = n.length;
    }
  }));
  // 提取分量："半碗"、"一碗"、"二两"、"半盘"、"一个"、"一盘" 等
  let portion = '一份';
  if (bestName) {
    const idx = t.indexOf(bestName);
    const rest = t.slice(0, idx) + t.slice(idx + bestName.length);
    const m = rest.match(/[半一二两俩三四五六七八九十\d.]+\s*[碗盘份个根杯盒块片勺把只串瓶罐条张口点斤两]/);
    if (m) portion = m[0];
  } else if (t.length <= 8) {
    // 没匹配到食物库，整个串当作食物名（截断）
    bestName = t.slice(0, 12);
  }
  return { name: bestName, portion, cat: bestCat };
}

/* 启动一次语音识别，识别成功后回调 text */
let _recognition = null;
function startVoiceRec(onResult, onEnd) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) { toast('当前浏览器不支持语音输入（建议用 Chrome）'); onEnd && onEnd(); return; }
  if (_recognition) { try { _recognition.stop(); } catch (e) {} _recognition = null; }
  const r = new Rec();
  r.lang = 'zh-CN'; r.continuous = false; r.interimResults = false; r.maxAlternatives = 1;
  r.onresult = (e) => {
    const text = e.results && e.results[0] && e.results[0][0] && e.results[0][0].transcript || '';
    onResult && onResult(text);
  };
  r.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('请允许麦克风权限');
    else if (e.error === 'no-speech') toast('没听到声音，请重试');
    else if (e.error === 'network') toast('语音识别需要网络');
  };
  r.onend = () => { _recognition = null; onEnd && onEnd(); };
  _recognition = r;
  try { r.start(); } catch (e) { toast('无法启动语音'); onEnd && onEnd(); }
}
function stopVoiceRec() {
  if (_recognition) { try { _recognition.stop(); } catch (e) {} _recognition = null; }
}

/* 语音播报 */
function speak(text, opts) {
  if (!supportsSpeechSyn()) { toast('当前浏览器不支持语音播报'); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN'; u.rate = (opts && opts.rate) || 1.0; u.pitch = 1.0; u.volume = 1.0;
  window.speechSynthesis.speak(u);
}
function stopSpeak() {
  if (supportsSpeechSyn()) window.speechSynthesis.cancel();
}

/* ---------- 数据 ---------- */
const DEFAULT_SETTINGS = {
  sex: 'female', age: 46, height: 161, weight: 111, goalWeight: 104,
  activity: 1.375, deficit: 200,
  breakfastTime: '07:30', lunchTime: '12:00', dinnerTime: '18:00', workoutTime: '19:30',
  remind: true, notify: false, theme: 'auto'
};

function normalize(s) {
  s = s && typeof s === 'object' ? s : {};
  return {
    version: 1,
    settings: Object.assign({}, DEFAULT_SETTINGS, s.settings || {}),
    days: s.days && typeof s.days === 'object' ? s.days : {},
    weights: Array.isArray(s.weights) ? s.weights.filter((w) => w && /^\d{4}-\d{2}-\d{2}$/.test(w.date) && +w.jin > 0) : []
  };
}
/* 工具：清理单个 day 对象，确保 meals 结构正确并保留可选 photo/workoutPhoto 字段 */
function normalizeDay(d) {
  d = d && typeof d === 'object' ? d : {};
  d.meals = d.meals || {};
  MEAL_SLOTS.forEach((s) => { if (!Array.isArray(d.meals[s.key])) d.meals[s.key] = []; });
  // 每个 item 保留可选 photo 字段（base64 字符串）
  ['breakfast', 'lunch', 'dinner', 'snack'].forEach((slot) => {
    d.meals[slot] = (d.meals[slot] || []).map((it) => {
      if (!it || typeof it !== 'object') return null;
      const o = { id: it.id || uid(), name: it.name || '未知', portion: it.portion || '一份', kcal: +it.kcal || 0, protein: +it.protein || 0 };
      if (it.plan) o.plan = true;
      if (it.manual) o.manual = true;
      if (typeof it.photo === 'string' && it.photo) o.photo = it.photo;
      return o;
    }).filter(Boolean);
  });
  if (typeof d.water !== 'number') d.water = 0;
  if (typeof d.workout !== 'boolean') d.workout = false;
  d.dismissed = d.dismissed || {};
  d.notified = d.notified || {};
  // workoutPhoto 是可选字符串
  if (typeof d.workoutPhoto !== 'string') delete d.workoutPhoto;
  return d;
}
function load() {
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) return normalize(JSON.parse(raw)); } catch (e) { /* 数据损坏时使用默认值 */ }
  return normalize({});
}
let state = load();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { toast('保存失败：手机存储空间不足'); }
}

function getDay(k, create) {
  let d = state.days[k];
  if (!d) {
    d = { meals: {}, water: 0, workout: false };
    if (create) state.days[k] = d;
  }
  d = normalizeDay(d);
  if (create) state.days[k] = d;
  return d;
}
function dayTotals(k) {
  const d = state.days[k];
  let kcal = 0, protein = 0;
  if (d && d.meals) Object.values(d.meals).forEach((arr) => (arr || []).forEach((it) => { kcal += +it.kcal || 0; protein += +it.protein || 0; }));
  return { kcal: Math.round(kcal), protein: Math.round(protein) };
}
function slotKcal(k, slot) {
  const d = state.days[k];
  return d && d.meals && d.meals[slot] ? Math.round(d.meals[slot].reduce((a, it) => a + (+it.kcal || 0), 0)) : 0;
}
function sortedWeights() { return state.weights.slice().sort((a, b) => (a.date < b.date ? -1 : 1)); }
function currentWeightJin() { const w = sortedWeights(); return w.length ? +w[w.length - 1].jin : +state.settings.weight; }

/* 每日热量目标：Mifflin-St Jeor 公式 × 活动系数 − 热量缺口 */
function calcTarget() {
  const s = state.settings;
  const kg = currentWeightJin() / 2;
  const bmr = 10 * kg + 6.25 * +s.height - 5 * +s.age + (s.sex === 'male' ? 5 : -161);
  const tdee = bmr * +s.activity;
  const floor = s.sex === 'male' ? 1500 : 1200;
  return Math.max(floor, Math.round((tdee - +s.deficit) / 10) * 10);
}
function proteinTarget() { return Math.round((currentWeightJin() / 2) * 1.3); }

/* ---------- 界面通用 ---------- */
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}
function openModal(html) {
  const m = $('#modal');
  $('.modal-panel', m).innerHTML = html;
  m.hidden = false;
  const first = $('input', m);
  if (first && first.type !== 'checkbox') setTimeout(() => first.focus(), 60);
}
function closeModal() { $('#modal').hidden = true; }

let currentPage = 'today';
function go(page) {
  currentPage = page;
  document.querySelectorAll('.page[data-page]').forEach((p) => { p.hidden = p.dataset.page !== page; });
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.go === page));
  render();
  window.scrollTo(0, 0);
}
function render() {
  applyTheme();
  renderBanners();
  ({ today: renderToday, log: renderLog, records: renderRecords, plan: renderPlan }[currentPage])();
  renderFab();
}
function applyTheme() {
  const t = state.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

/* ---------- 提醒横幅 ---------- */
function activeReminders() {
  const s = state.settings;
  if (!s.remind) return [];
  const k = dateKey();
  const day = getDay(k);
  const dismissed = day.dismissed || {};
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const wd = now.getDay();
  const list = [];
  ['breakfast', 'lunch', 'dinner'].forEach((slot) => {
    const t = toMin(s[slot + 'Time']);
    if (nowMin >= t - 15 && nowMin <= t + 90 && !day.meals[slot].length && !dismissed[slot]) {
      const plan = MEAL_PLAN[wd][slot];
      list.push({ id: slot, icon: MEAL_SLOTS.find((m) => m.key === slot).icon, title: `${slotName(slot)}时间到啦`, text: `今日建议：${plan.text}`, btn: '照这个吃', action: 'eatPlan', slot });
    }
  });
  const wt = toMin(s.workoutTime);
  if (nowMin >= wt - 10 && nowMin <= wt + 120 && !day.workout && !dismissed.workout) {
    const w = WORKOUTS[wd];
    list.push({ id: 'workout', icon: w.icon, title: '该运动啦', text: `今天：${w.title}（${w.time}）`, btn: '去看看', action: 'goWorkout', warn: true });
  }
  return list;
}
function renderBanners() {
  const list = activeReminders();
  $('#banners').innerHTML = list.map((r) => `
    <div class="banner ${r.warn ? 'warn' : ''}">
      <div class="b-ico">${r.icon}</div>
      <div class="b-text"><b>${esc(r.title)}</b>${esc(r.text)}</div>
      <button class="btn sm" data-action="${r.action}" data-slot="${r.slot || ''}">${r.btn}</button>
      <button class="icon-btn" data-action="dismiss" data-id="${r.id}" aria-label="关闭">✕</button>
    </div>`).join('');
  maybeNotify(list);
}
function maybeNotify(list) {
  if (!state.settings.notify || !('Notification' in window) || Notification.permission !== 'granted' || !list.length) return;
  const day = getDay(dateKey(), true);
  day.notified = day.notified || {};
  const fresh = list.filter((r) => !day.notified[r.id]);
  if (!fresh.length) return;
  fresh.forEach((r) => { day.notified[r.id] = true; });
  save();
  const r = fresh[0];
  const opts = { body: r.text, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'qy-' + r.id };
  if (navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then((reg) => reg.showNotification('轻盈计划 · ' + r.title, opts)).catch(() => {});
  }
}

/* ---------- 今日页 ---------- */
function renderToday() {
  const k = dateKey();
  const now = new Date();
  const wd = now.getDay();
  const day = getDay(k);
  const tot = dayTotals(k);
  const target = calcTarget();
  const pTarget = proteinTarget();
  const over = tot.kcal > target;
  const R = 56, C = 2 * Math.PI * R;
  const offset = C * (1 - Math.min(1, tot.kcal / target));
  const h = now.getHours();
  const hello = h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
  const w = WORKOUTS[wd];
  const plan = MEAL_PLAN[wd];
  const todayWeight = state.weights.find((x) => x.date === k);

  const checks = [
    ...['breakfast', 'lunch', 'dinner'].map((slot) => {
      const kc = slotKcal(k, slot);
      return { icon: MEAL_SLOTS.find((m) => m.key === slot).icon, name: slotName(slot), done: day.meals[slot].length > 0, sub: day.meals[slot].length ? `${kc} 千卡` : '去记录', action: 'goLog', slot };
    }),
    { icon: '🏃‍♀️', name: '运动', done: !!day.workout, sub: day.workout ? '已完成' : w.title, action: 'toggleWorkout' },
    { icon: '⚖️', name: '体重', done: !!todayWeight, sub: todayWeight ? `${todayWeight.jin} 斤` : '去称重', action: 'weighModal' },
    { icon: '💧', name: '喝水', done: day.water >= WATER_GOAL, sub: `${day.water}/${WATER_GOAL} 杯`, action: 'addWater' }
  ];

  $('#page-today').innerHTML = `
    <div class="hello">
      <div class="row between" style="align-items:flex-start">
        <div>
          <h1>${hello} 👋</h1>
          <p class="muted">${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAY_NAMES[wd]} · 今天是「${w.title}」日</p>
        </div>
        ${supportsSpeechSyn() ? `<button class="speak-btn" data-action="speakToday" aria-label="语音播报今日情况">🔊 播报</button>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="ring-wrap">
        <div class="ring ${over ? 'over' : ''}">
          <svg viewBox="0 0 132 132" aria-hidden="true">
            <circle class="track" cx="66" cy="66" r="${R}" fill="none" stroke-width="12"></circle>
            <circle class="bar" cx="66" cy="66" r="${R}" fill="none" stroke-width="12" stroke-linecap="round"
              stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"></circle>
          </svg>
          <div class="ring-center"><span class="num">${tot.kcal}</span><span class="unit">/ ${target} 千卡</span></div>
        </div>
        <div class="ring-info">
          <div class="big ${over ? 'over' : ''}">${over ? `今天超出 ${tot.kcal - target} 千卡` : `还可以吃 ${target - tot.kcal} 千卡`}</div>
          <div>
            <div class="kv"><span>蛋白质</span><b>${tot.protein} / ${pTarget} 克</b></div>
            <div class="pbar"><i style="width:${Math.min(100, (tot.protein / pTarget) * 100).toFixed(0)}%"></i></div>
          </div>
          <div class="muted small">${over ? '没关系，明天加一点运动、少一点主食就好。' : tot.protein < pTarget * 0.6 && h >= 14 ? '蛋白质偏少，晚餐可以多吃点鱼虾蛋豆腐。' : '吃够蛋白质，帮助增肌哦。'}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>✅ 今日打卡</h2>
      <div class="checks">
        ${checks.map((c) => `
          <button class="check ${c.done ? 'done' : ''}" data-action="${c.action}" data-slot="${c.slot || ''}">
            <span class="c-ico">${c.icon}</span><span class="c-name">${c.name}${c.done ? ' ✓' : ''}</span><span class="c-sub">${esc(c.sub)}</span>
          </button>`).join('')}
      </div>
      <div class="water" aria-label="喝水">
        ${Array.from({ length: WATER_GOAL }, (_, i) => `<button class="cup ${i < day.water ? 'on' : ''}" data-action="setWater" data-n="${i + 1}" aria-label="第${i + 1}杯">💧</button>`).join('')}
      </div>
      <p class="muted small" style="margin:6px 0 0">点水杯记录喝水，每杯约250毫升。</p>
    </div>

    <div class="card" id="todayWorkout">
      <h2>${w.icon} 今日运动：${w.title} <span class="tag">${w.time}</span></h2>
      ${workoutList(w)}
      <p class="muted small" style="margin:8px 0">${esc(w.note)}</p>
      ${day.workout && day.workoutPhoto ? `<img class="workout-photo" src="${day.workoutPhoto}" alt="运动打卡照" data-action="viewPhoto">` : ''}
      <div class="row" style="gap:8px;margin-top:6px">
        <button class="btn grow ${day.workout ? 'ghost' : ''}" data-action="toggleWorkout">${day.workout ? '🎉 已完成（点此撤销）' : '✅ 完成今日运动'}</button>
        ${supportsCamera() ? `<button class="btn line grow" data-action="takeWorkoutPhoto">${day.workoutPhoto ? '📷 换张照片' : '📷 拍照打卡'}</button>` : ''}
      </div>
    </div>

    <div class="card">
      <h2>🥗 今日减脂餐建议 <span class="tag">中式 · 不辣</span></h2>
      <div class="meal-sug">
        ${MEAL_SLOTS.map((s) => {
          const p = plan[s.key];
          const done = day.meals[s.key].some((it) => it.plan);
          return `<div class="sug ${done ? 'done' : ''}">
            <div class="s-top"><span class="s-name">${s.icon} ${s.name}</span><span class="tag">约${p.kcal}千卡</span></div>
            <div class="s-text">${esc(p.text)}</div>
            ${done ? '<div class="muted small">✓ 已记入今日</div>' : `<button class="btn ghost sm" data-action="eatPlan" data-slot="${s.key}">照这个吃，记入</button>`}
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

function workoutList(w) {
  return `<ul class="ex-list">${w.items.map((it) => `
    <li><div class="ex-main">
      <div class="ex-head"><span class="ex-name">${esc(it.name)}</span><span class="ex-dose">${esc(it.dose)}</span></div>
      <div class="ex-tip">${esc(it.tip)}</div>
    </div></li>`).join('')}</ul>`;
}

function addPlanMeal(slot, k = dateKey()) {
  const wd = parseKey(k).getDay();
  const p = MEAL_PLAN[wd][slot];
  const day = getDay(k, true);
  if (day.meals[slot].some((it) => it.plan)) { toast('这一餐已经记过啦'); return; }
  day.meals[slot].push({ id: uid(), name: p.text, portion: '计划餐一份', kcal: p.kcal, protein: p.protein, plan: true });
  save();
  toast(`已记入${slotName(slot)}：约${p.kcal}千卡`);
}

function weighModal() {
  const latest = currentWeightJin();
  const hasCam = supportsCamera();
  openModal(`
    <h3>⚖️ 记录今天的体重</h3>
    <label class="field">体重（斤）
      <input class="input" id="wInput" type="number" inputmode="decimal" step="0.1" min="50" max="400" value="${latest}">
    </label>
    <div id="weightPhotoPreview" class="photo-preview"></div>
    <p class="muted small">建议每天早上起床、上完厕所、吃早饭前称。</p>
    <div class="row" style="gap:8px;margin-top:12px">
      <button class="btn line grow" data-close>取消</button>
      <button class="btn line grow" data-action="saveWeightModal">保存</button>
      ${hasCam ? `<button class="btn ghost grow" data-action="takeWeightPhoto">📷 拍体重秤</button>` : ''}
    </div>`);
}
function addWeight(k, jin, photo) {
  jin = round1(+jin);
  if (!(jin >= 50 && jin <= 400)) { toast('请输入正确的体重（斤）'); return false; }
  state.weights = state.weights.filter((w) => w.date !== k);
  const w = { date: k, jin };
  if (typeof photo === 'string' && photo) w.photo = photo;
  state.weights.push(w);
  save();
  toast(`已记录：${jin} 斤${photo ? '（含照片）' : ''}`);
  return true;
}

/* ---------- 记餐页 ---------- */
function defaultSlot() {
  const s = state.settings;
  const m = new Date().getHours() * 60 + new Date().getMinutes();
  if (m < toMin(s.breakfastTime) + 120) return 'breakfast';
  if (m >= toMin(s.lunchTime) - 60 && m < toMin(s.lunchTime) + 150) return 'lunch';
  if (m >= toMin(s.dinnerTime) - 60 && m < toMin(s.dinnerTime) + 180) return 'dinner';
  return 'snack';
}
const logState = { date: dateKey(), slot: defaultSlot(), cat: 'staple', search: '', basket: [] };
/* pendingPhoto：手动输入区或 pickFood 模态框中临时存放的拍照 base64
 * - manualPhoto：手动输入区拍的，附加到下一条 basket item
 * - foodPhoto：pickFood 模态框拍的，附加到下一条 pickUnit 添加的 basket item */
const pendingPhoto = { manual: '', food: '', weight: '' };

function renderLog() {
  const L = logState;
  $('#page-log').innerHTML = `
    <div class="card">
      <div class="row between wrap">
        <h2 style="margin:0">🍽️ 记一餐</h2>
        <input type="date" class="input" style="width:auto;min-height:36px;padding:4px 8px" data-input="logDate" value="${L.date}" max="${dateKey()}" aria-label="日期">
      </div>
      <div class="seg" style="margin-top:10px">
        ${MEAL_SLOTS.map((s) => `<button data-action="logSlot" data-slot="${s.key}" class="${L.slot === s.key ? 'on' : ''}">${s.name}</button>`).join('')}
      </div>
    </div>
    <div id="basketArea"></div>
    <div class="card">
      <h3>① 选食物 → ② 点分量</h3>
      <input class="input" type="search" placeholder="🔍 搜索，如：米饭、鸡蛋、鱼" data-input="foodSearch" value="${esc(L.search)}" enterkeyhint="search">
      <div class="cat-tabs" style="margin-top:8px">
        ${FOOD_CATEGORIES.map((c) => `<button data-action="logCat" data-cat="${c.key}" class="${!L.search && L.cat === c.key ? 'on' : ''}">${c.icon} ${c.name}</button>`).join('')}
      </div>
      <div id="foodArea" style="margin-top:10px"></div>
    </div>
    <div class="card">
      <h3>✍️ 没找到？手动输入</h3>
      <div class="setting-group">
        <div class="row" style="gap:8px;margin-bottom:8px">
          ${supportsSpeechRec() ? `<button class="voice-btn grow" data-action="voiceInput" id="voiceBtn">🎤 语音输入</button>` : ''}
          ${supportsCamera() ? `<button class="photo-btn grow" data-action="takeManualPhoto" id="manualPhotoBtn">📷 拍食物照</button>` : ''}
        </div>
        <label class="field">吃了什么
          <input class="input" id="mName" placeholder="如：西红柿鸡蛋面" maxlength="30">
        </label>
        <label class="field">吃了多少
          <input class="input" id="mPortion" placeholder="如：一碗、半盘、二两" maxlength="12" value="一份">
        </label>
        <div class="chips">
          ${['一碗', '半碗', '一盘', '半盘', '一两', '二两', '一个', '半个', '一份'].map((p) => `<button class="chip" data-action="mPortion" data-p="${p}">${p}</button>`).join('')}
        </div>
        <label class="field">它更像哪一类？（帮助估算）
          <select class="input" id="mCat">
            ${FOOD_CATEGORIES.map((c) => `<option value="${c.key}">${c.icon} ${c.name}</option>`).join('')}
          </select>
        </label>
        <div id="manualPhotoPreview" class="photo-preview"></div>
        <button class="btn ghost block" data-action="manualAdd">＋ 加入待记入</button>
      </div>
    </div>
    <div class="card">
      <h3>📒 ${dayLabel(L.date)}${slotName(L.slot)}已记录</h3>
      <div id="loggedArea"></div>
    </div>`;
  renderFoodArea();
  renderBasket();
  renderLogged();
}

function renderFoodArea() {
  const L = logState;
  const q = L.search.trim();
  let list;
  if (q) {
    list = [];
    FOOD_CATEGORIES.forEach((c) => FOODS[c.key].forEach((f, i) => { if (f.name.includes(q)) list.push({ cat: c.key, i, f }); }));
  } else {
    list = FOODS[L.cat].map((f, i) => ({ cat: L.cat, i, f }));
  }
  $('#foodArea').innerHTML = list.length
    ? `<div class="food-grid">${list.map(({ cat, i, f }) => `
        <button class="food" data-action="pickFood" data-cat="${cat}" data-i="${i}">
          <span class="f-ico">${f.icon}</span><span class="f-name">${esc(f.name)}</span>
        </button>`).join('')}</div>`
    : '<div class="empty">没找到这个食物，可以在下方“手动输入”。</div>';
}

function pickFood(cat, i) {
  const f = FOODS[cat][i];
  const hasCam = supportsCamera();
  openModal(`
    <h3>${f.icon} ${esc(f.name)} · 吃了多少？</h3>
    <div class="unit-grid">
      ${f.units.map((u, j) => `<button data-action="pickUnit" data-cat="${cat}" data-i="${i}" data-j="${j}">${esc(u[0])}</button>`).join('')}
    </div>
    <div id="foodPhotoPreview" class="photo-preview"></div>
    ${hasCam ? `<button class="photo-btn block" data-action="takeFoodPhoto" id="foodPhotoBtn" data-cat="${cat}" data-i="${i}" style="margin-top:8px">📷 先拍照再选分量</button>` : ''}
    <p class="muted small" style="margin-top:12px">点一下就加入；吃了两份就点两次。</p>
    <button class="btn line block" data-close style="margin-top:6px">完成</button>`);
}

function renderBasket() {
  const L = logState;
  const el = $('#basketArea');
  if (!el) return;
  if (!L.basket.length) { el.innerHTML = ''; return; }
  const kcal = L.basket.reduce((a, b) => a + b.kcal, 0);
  el.innerHTML = `
    <div class="card">
      <h3>🧺 待记入（${L.basket.length}样）<span class="tag">约${Math.round(kcal)}千卡</span></h3>
      <ul class="items">
        ${L.basket.map((it, idx) => `<li><span class="i-name">${esc(it.name)}</span><span class="i-sub">${esc(it.portion)}</span>
          <button class="icon-btn" data-action="basketDel" data-idx="${idx}" aria-label="移除">✕</button></li>`).join('')}
      </ul>
    </div>`;
}

function renderFab() {
  const bar = $('#fabBar');
  const L = logState;
  const show = currentPage === 'log' && L.basket.length > 0;
  bar.hidden = !show;
  document.body.classList.toggle('has-fab', show);
  if (!show) return;
  const kcal = Math.round(L.basket.reduce((a, b) => a + b.kcal, 0));
  bar.innerHTML = `
    <div class="fb-text">已选 <b>${L.basket.length}</b> 样 · 约 <b>${kcal}</b> 千卡</div>
    <button class="btn" data-action="commitBasket">✅ 记入${L.date === dateKey() ? '今日' : fmtMD(L.date)}${slotName(L.slot)}</button>`;
}

function renderLogged() {
  const L = logState;
  const el = $('#loggedArea');
  if (!el) return;
  const items = getDay(L.date).meals[L.slot];
  el.innerHTML = items.length
    ? `<ul class="items">${items.map((it) => itemRow(it, L.date, L.slot)).join('')}</ul>
       <div class="muted small" style="text-align:right">这一餐约 ${slotKcal(L.date, L.slot)} 千卡</div>`
    : '<div class="empty">还没有记录</div>';
}
function itemRow(it, k, slot) {
  const photo = (it && typeof it.photo === 'string' && it.photo) ? `<img class="i-photo" src="${it.photo}" alt="${esc(it.name)}" data-action="viewPhoto">` : '';
  return `<li>${photo}<span class="i-name">${esc(it.name)}</span><span class="i-sub">${esc(it.portion)} · ${Math.round(it.kcal)}千卡</span>
    <button class="icon-btn" data-action="delItem" data-k="${k}" data-slot="${slot}" data-id="${esc(it.id)}" aria-label="删除">🗑️</button></li>`;
}

/* 手动输入：解析中文分量，估算热量 */
const CN_NUM = { 半: 0.5, 一: 1, 二: 2, 两: 2, 俩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const UNIT_FACTOR = { 斤: 5, 两: 0.5, 碗: 1, 盘: 1, 份: 1, 个: 1, 根: 1, 杯: 1, 盒: 1, 块: 0.6, 片: 0.4, 勺: 0.4, 把: 0.6, 只: 0.5, 串: 0.8, 瓶: 1.2, 罐: 1, 条: 1, 张: 0.8, 口: 0.15, 点: 0.3 };
function parsePortion(text) {
  const t = String(text || '').replace(/\s/g, '');
  let count = 1;
  const m = t.match(/(\d+(?:\.\d+)?)/);
  if (m) count = parseFloat(m[1]);
  else {
    const c = t.match(/[半一二两俩三四五六七八九十]/);
    if (c) count = CN_NUM[c[0]];
  }
  if (/小半/.test(t)) count = 0.35;
  // “两”既可作数字也可作单位：如“二两”“三两”中最后一个“两”是单位
  let unit = '';
  const u = t.match(/([斤碗盘份个根杯盒块片勺把只串瓶罐条张口点])/);
  if (/[一二两三四五六七八九十半\d]两$/.test(t) || t === '两') unit = '两';
  else if (u) unit = u[1];
  if (unit === '两' && /^两两?$/.test(t)) count = 1;
  let factor = count * (UNIT_FACTOR[unit] != null ? UNIT_FACTOR[unit] : 1);
  if (/大/.test(t)) factor *= 1.5; else if (/小(?!半)/.test(t)) factor *= 0.7;
  return { count, unit, factor: Math.min(8, Math.max(0.1, factor)) };
}
function estimateManual(name, portion, cat) {
  const p = parsePortion(portion);
  // 先在食物库里找同名食物，按相同单位换算
  let best = null;
  FOOD_CATEGORIES.forEach((c) => FOODS[c.key].forEach((f) => {
    const n = f.name.replace(/\(.*?\)/g, '');
    if (name.includes(n) || n.includes(name)) if (!best || n.length > best.n.length) best = { f, n };
  }));
  if (best && p.unit) {
    const unit = best.f.units.find((u) => u[0] === '一' + p.unit) || best.f.units.find((u) => u[0].endsWith(p.unit) && !/[大小半]/.test(u[0]));
    if (unit) {
      let mult = p.unit === '两' ? p.count / (CN_NUM[unit[0][0]] || 1) : p.count;
      if (/大/.test(portion)) mult *= 1.5; else if (/小(?!半)/.test(portion)) mult *= 0.7;
      return { kcal: Math.round(unit[1] * mult), protein: round1(unit[2] * mult) };
    }
  }
  const base = MANUAL_BASE[cat] || MANUAL_BASE.other;
  return { kcal: Math.round(base[0] * p.factor), protein: round1(base[1] * p.factor) };
}

/* ---------- 记录页 ---------- */
let historyDate = dateKey();
function renderRecords() {
  const ws = sortedWeights();
  const cur = currentWeightJin();
  const first = ws.length ? ws[0].jin : cur;
  const change = round1(cur - first);
  const goal = +state.settings.goalWeight;
  const bmi = (cur / 2) / Math.pow(state.settings.height / 100, 2);
  const histDay = getDay(historyDate);
  const histTot = dayTotals(historyDate);
  const target = calcTarget();

  $('#page-records').innerHTML = `
    <div class="card">
      <h2>⚖️ 记体重</h2>
      <div class="grid2">
        <label class="field">日期<input class="input" type="date" id="rwDate" value="${dateKey()}" max="${dateKey()}"></label>
        <label class="field">体重（斤）<input class="input" type="number" id="rwJin" inputmode="decimal" step="0.1" min="50" max="400" value="${cur}"></label>
      </div>
      <button class="btn block" style="margin-top:10px" data-action="saveWeight">记录体重</button>
      <div class="stats">
        <div class="stat"><b>${cur}</b><span>当前(斤)</span></div>
        <div class="stat"><b style="color:${change <= 0 ? 'var(--primary-2)' : 'var(--warn)'}">${change > 0 ? '+' : ''}${change}</b><span>累计变化</span></div>
        <div class="stat"><b>${cur > goal ? round1(cur - goal) : '达成'}</b><span>${cur > goal ? '距目标(斤)' : '目标🎉'}</span></div>
      </div>
      <p class="muted small" style="margin:8px 0 0">BMI ${bmi.toFixed(1)}（18.5-23.9 为正常）· 目标体重 ${goal} 斤</p>
    </div>

    <div class="card">
      <h2>📉 体重趋势 <span class="muted small">近30次</span></h2>
      ${weightChart(ws.slice(-30), goal)}
      ${ws.length ? `<details style="margin-top:8px"><summary class="muted small">查看/删除体重记录</summary>
        <ul class="items">${ws.slice().reverse().slice(0, 60).map((w) => `<li>${w.photo ? `<img class="i-photo" src="${w.photo}" alt="体重秤照片" data-action="viewPhoto">` : ''}<span class="i-name">${fmtMD(w.date)}</span><span class="i-sub">${w.jin} 斤</span>
          <button class="icon-btn" data-action="delWeight" data-date="${w.date}" aria-label="删除">🗑️</button></li>`).join('')}</ul></details>` : ''}
    </div>

    <div class="card">
      <h2>📊 每日摄入 <span class="muted small">近14天</span></h2>
      ${intakeChart(target)}
      <div class="legend"><span><i style="background:var(--primary)"></i>未超标</span><span><i style="background:var(--warn)"></i>超过目标</span><span>虚线：目标 ${target} 千卡</span></div>
    </div>

    <div class="card">
      <h2>📅 饮食历史</h2>
      <div class="row">
        <button class="btn line sm" data-action="histPrev" aria-label="前一天">‹</button>
        <input class="input grow" type="date" data-input="histDate" value="${historyDate}" max="${dateKey()}" style="min-height:36px;padding:4px 8px">
        <button class="btn line sm" data-action="histNext" aria-label="后一天" ${historyDate >= dateKey() ? 'disabled' : ''}>›</button>
      </div>
      <p style="margin:10px 0 4px"><b>${dayLabel(historyDate)}</b> 共约 <b>${histTot.kcal}</b> 千卡 · 蛋白质 ${histTot.protein} 克
        ${histTot.kcal > target ? '<span class="tag warn">超标</span>' : histTot.kcal ? '<span class="tag">达标</span>' : ''}</p>
      <p class="muted small" style="margin:0 0 6px">喝水 ${histDay.water} 杯 · 运动${histDay.workout ? '已完成 ✓' : '未打卡'}</p>
      ${MEAL_SLOTS.map((s) => {
        const items = histDay.meals[s.key];
        return `<div style="margin-top:8px"><div class="row between"><b>${s.icon} ${s.name}</b><span class="muted small">${items.length ? slotKcal(historyDate, s.key) + ' 千卡' : ''}</span></div>
          ${items.length ? `<ul class="items">${items.map((it) => itemRow(it, historyDate, s.key)).join('')}</ul>` : '<div class="muted small">未记录</div>'}</div>`;
      }).join('')}
    </div>`;
}

function weightChart(ws, goal) {
  if (ws.length < 2) return `<div class="empty">${ws.length ? '再记录一次就能看到趋势啦' : '还没有体重记录，先在上面记一次吧'}</div>`;
  const W = 340, H = 180, l = 36, r = 12, t = 14, b = 26;
  const vals = ws.map((w) => +w.jin);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (goal && goal >= min - 6 && goal < min) min = goal;
  if (max - min < 2) { const mid = (max + min) / 2; min = mid - 1; max = mid + 1; }
  min = Math.floor(min - 0.5); max = Math.ceil(max + 0.5);
  const x = (i) => l + (ws.length === 1 ? 0 : (i * (W - l - r)) / (ws.length - 1));
  const y = (v) => t + ((max - v) * (H - t - b)) / (max - min);
  const pts = ws.map((w, i) => [x(i), y(+w.jin)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - b} L${pts[0][0].toFixed(1)},${H - b} Z`;
  const ticks = [0, 1, 2, 3].map((i) => min + ((max - min) * i) / 3);
  const xl = [0, Math.floor((ws.length - 1) / 2), ws.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  const last = pts[pts.length - 1];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="体重趋势图">
    ${ticks.map((v) => `<line class="grid" x1="${l}" x2="${W - r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${l - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${round1(v)}</text>`).join('')}
    ${goal >= min && goal <= max ? `<line class="goal" x1="${l}" x2="${W - r}" y1="${y(goal).toFixed(1)}" y2="${y(goal).toFixed(1)}"/><text x="${W - r}" y="${(y(goal) - 4).toFixed(1)}" text-anchor="end">目标 ${goal}</text>` : ''}
    <path class="area" d="${area}"/>
    <path class="line" d="${line}"/>
    ${pts.map((p) => `<circle class="dot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${ws.length > 15 ? 2.2 : 3.2}"/>`).join('')}
    <text x="${Math.min(last[0], W - r - 4).toFixed(1)}" y="${(last[1] - 8).toFixed(1)}" text-anchor="end" style="font-weight:700;fill:var(--primary-2)">${ws[ws.length - 1].jin}</text>
    ${xl.map((i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === ws.length - 1 ? 'end' : 'middle'}">${parseKey(ws[i].date).getMonth() + 1}/${parseKey(ws[i].date).getDate()}</text>`).join('')}
  </svg>`;
}

function intakeChart(target) {
  const W = 340, H = 180, l = 36, r = 8, t = 14, b = 26;
  const today = dateKey();
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const vals = days.map((k) => dayTotals(k).kcal);
  if (!vals.some((v) => v > 0)) return '<div class="empty">记录饮食后，这里会显示每天吃了多少</div>';
  const max = Math.max(target * 1.25, ...vals) * 1.05;
  const y = (v) => t + ((max - v) * (H - t - b)) / max;
  const slot = (W - l - r) / 14;
  const bw = slot * 0.62;
  const ticks = [0, Math.round(max / 3 / 100) * 100, Math.round((max * 2) / 3 / 100) * 100];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="每日摄入柱状图">
    ${ticks.map((v) => `<line class="grid" x1="${l}" x2="${W - r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${l - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${v}</text>`).join('')}
    ${vals.map((v, i) => {
      const bx = l + i * slot + (slot - bw) / 2;
      const by = y(v);
      return v > 0 ? `<rect class="${v > target ? 'bar-over' : 'bar-ok'}" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - b - by).toFixed(1)}" rx="3" data-action="barInfo" data-k="${days[i]}"/>` : '';
    }).join('')}
    <line class="target" x1="${l}" x2="${W - r}" y1="${y(target).toFixed(1)}" y2="${y(target).toFixed(1)}"/>
    ${days.map((k, i) => (i % 2 === 1 || i === 13) ? `<text x="${(l + i * slot + slot / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" ${k === today ? 'style="font-weight:700;fill:var(--primary-2)"' : ''}>${k === today ? '今' : parseKey(k).getDate()}</text>` : '').join('')}
  </svg>`;
}

/* ---------- 计划页 ---------- */
let planTab = 'workout';
function renderPlan() {
  const wd = new Date().getDay();
  const s = state.settings;
  let body = '';
  if (planTab === 'workout') {
    body = `<div class="card">
      <h2>🏋️‍♀️ 一周运动计划 <span class="tag">居家 · 徒手/弹力带</span></h2>
      <p class="muted small" style="margin-top:-4px">运动前热身5分钟，运动后拉伸5分钟。有不适就停下休息。</p>
      ${WEEK_ORDER.map((d) => {
        const w = WORKOUTS[d];
        return `<details class="day-card ${d === wd ? 'today' : ''}" ${d === wd ? 'open' : ''}>
          <summary><span class="d-ico">${w.icon}</span><span class="d-main"><span class="d-title">${WEEKDAY_NAMES[d]} · ${w.title}</span>${d === wd ? ' <span class="tag">今天</span>' : ''}<br><span class="muted small">${w.items.map((i) => i.name).join('、')}</span></span></summary>
          <div class="d-body">${workoutList(w)}<p class="muted small" style="margin:8px 0 0">${esc(w.note)}</p></div>
        </details>`;
      }).join('')}
    </div>`;
  } else if (planTab === 'meal') {
    body = `<div class="card">
      <h2>🥗 一周减脂餐 <span class="tag">中式 · 不辣 · 约1400千卡/天</span></h2>
      <p class="muted small" style="margin-top:-4px">少油少盐，蒸煮炖拌为主；汤去浮油。可以同类互换，如鲈鱼换鳕鱼。</p>
      ${WEEK_ORDER.map((d) => {
        const p = MEAL_PLAN[d];
        const total = MEAL_SLOTS.reduce((a, m) => a + p[m.key].kcal, 0);
        return `<details class="day-card ${d === wd ? 'today' : ''}" ${d === wd ? 'open' : ''}>
          <summary><span class="d-ico">🍱</span><span class="d-main"><span class="d-title">${WEEKDAY_NAMES[d]}</span>${d === wd ? ' <span class="tag">今天</span>' : ''}<br><span class="muted small">全天约 ${total} 千卡</span></span></summary>
          <div class="d-body">${MEAL_SLOTS.map((m) => `<div class="plan-meal"><div class="row between"><b>${m.icon} ${m.name}</b><span class="tag">约${p[m.key].kcal}千卡</span></div><div>${esc(p[m.key].text)}</div></div>`).join('')}</div>
        </details>`;
      }).join('')}
    </div>`;
  } else {
    const opt = (v, cur, label) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${label}</option>`;
    body = `
    <div class="card">
      <h2>👤 个人设置</h2>
      <div class="note" style="margin-bottom:10px">每日热量目标：<b style="color:var(--primary-2);font-size:16px">${calcTarget()} 千卡</b>（根据最新体重 ${currentWeightJin()} 斤自动计算）</div>
      <div class="setting-group">
        <div class="grid2">
          <label class="field">性别<select class="input" data-setting="sex">${opt('female', s.sex, '女')}${opt('male', s.sex, '男')}</select></label>
          <label class="field">年龄<input class="input" type="number" inputmode="numeric" data-setting="age" value="${s.age}" min="16" max="90"></label>
          <label class="field">身高（厘米）<input class="input" type="number" inputmode="numeric" data-setting="height" value="${s.height}" min="120" max="210"></label>
          <label class="field">初始体重（斤）<input class="input" type="number" inputmode="decimal" step="0.1" data-setting="weight" value="${s.weight}" min="50" max="400"></label>
          <label class="field">目标体重（斤）<input class="input" type="number" inputmode="decimal" step="0.1" data-setting="goalWeight" value="${s.goalWeight}" min="50" max="400"></label>
          <label class="field">热量缺口<select class="input" data-setting="deficit">
            ${opt(0, s.deficit, '不减（维持）')}${opt(150, s.deficit, '温和 150')}${opt(200, s.deficit, '推荐 200')}${opt(300, s.deficit, '适中 300')}${opt(400, s.deficit, '较快 400')}</select></label>
        </div>
        <label class="field">日常活动量<select class="input" data-setting="activity">
          ${opt(1.2, s.activity, '久坐（基本不运动）')}${opt(1.375, s.activity, '轻度（每周运动3-5次，推荐）')}${opt(1.55, s.activity, '中度（每天运动或站立工作）')}${opt(1.725, s.activity, '较高（体力劳动）')}</select></label>
      </div>
    </div>
    <div class="card">
      <h2>⏰ 提醒时间</h2>
      <div class="setting-group">
        <label class="switch"><span>饭点 / 运动时显示提醒横幅</span><input type="checkbox" data-setting="remind" ${s.remind ? 'checked' : ''}></label>
        <div class="grid2">
          <label class="field">运动提醒<input class="input" type="time" data-setting="workoutTime" value="${s.workoutTime}"></label>
          <label class="field">早餐<input class="input" type="time" data-setting="breakfastTime" value="${s.breakfastTime}"></label>
          <label class="field">午餐<input class="input" type="time" data-setting="lunchTime" value="${s.lunchTime}"></label>
          <label class="field">晚餐<input class="input" type="time" data-setting="dinnerTime" value="${s.dinnerTime}"></label>
        </div>
        <label class="switch"><span>同时发送手机通知<br><span class="muted small">需打开过本应用，部分手机在后台可能收不到</span></span><input type="checkbox" data-setting="notify" ${s.notify ? 'checked' : ''}></label>
        <label class="field">显示模式<select class="input" data-setting="theme">${opt('auto', s.theme, '跟随系统（自动深色/浅色）')}${opt('light', s.theme, '浅色')}${opt('dark', s.theme, '深色')}</select></label>
      </div>
    </div>
    <div class="card">
      <h2>💾 备份与恢复</h2>
      <p class="muted small" style="margin-top:-4px">数据只保存在这部手机的浏览器里。换手机或清理浏览器前，请先导出备份码，发到微信“文件传输助手”保存。</p>
      <button class="btn block" data-action="exportData">📤 导出备份码</button>
      <div id="exportBox"></div>
      <label class="field" style="margin-top:12px">粘贴备份码恢复
        <textarea class="input" id="importText" placeholder="把之前导出的备份码粘贴到这里" spellcheck="false"></textarea>
      </label>
      <button class="btn ghost block" style="margin-top:8px" data-action="importData">📥 恢复数据</button>
    </div>
    <div class="card">
      <h2>📲 添加到手机桌面</h2>
      ${installNote()}
      <button class="btn ghost block" style="margin-top:10px" data-action="installApp" ${deferredPrompt ? '' : 'hidden'} id="installBtn2">一键添加到桌面</button>
    </div>
    <div class="card">
      <h2>🗑️ 清空数据</h2>
      <p class="muted small" style="margin-top:-4px">会删除所有饮食、运动、体重记录，无法撤销。建议先导出备份。</p>
      <button class="btn danger block" data-action="clearData">清空所有数据</button>
      <p class="muted small" style="text-align:center;margin:12px 0 0">轻盈计划 v1.0 · 热量数据为估算值，仅供参考</p>
    </div>`;
  }
  $('#page-plan').innerHTML = `
    <div class="seg">
      <button data-action="planTab" data-tab="workout" class="${planTab === 'workout' ? 'on' : ''}">运动计划</button>
      <button data-action="planTab" data-tab="meal" class="${planTab === 'meal' ? 'on' : ''}">减脂餐</button>
      <button data-action="planTab" data-tab="settings" class="${planTab === 'settings' ? 'on' : ''}">设置</button>
    </div>${body}`;
}

function installNote() {
  if (isStandalone()) return '<div class="note">✅ 你正在以桌面 App 方式使用轻盈计划。</div>';
  return `<div class="note">
    <b>华为浏览器：</b>
    <ol>
      <li>点屏幕底部（或右上角）的 <b>“☰ / ⋮” 菜单</b></li>
      <li>选择 <b>“添加至桌面”</b>（有的版本在“工具箱”或“分享”里）</li>
      <li>回到桌面，点“轻盈计划”图标打开</li>
    </ol>
    <b style="display:block;margin-top:6px">Chrome / Edge：</b>菜单 → “添加到主屏幕”或“安装应用”。
  </div>`;
}
function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}

/* ---------- 备份恢复 ---------- */
function toB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromB64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function exportCode() { return BACKUP_PREFIX + toB64(JSON.stringify(state)); }
function importCode(code) {
  let c = String(code || '').replace(/\s+/g, '');
  if (c.startsWith(BACKUP_PREFIX)) c = c.slice(BACKUP_PREFIX.length);
  const data = JSON.parse(fromB64(c));
  if (!data || typeof data !== 'object' || !data.settings) throw new Error('bad');
  return normalize(data);
}
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); } finally { ta.remove(); }
  });
}

/* ---------- 点击事件 ---------- */
const ACTIONS = {
  goLog(el) { logState.slot = el.dataset.slot || defaultSlot(); logState.date = dateKey(); go('log'); },
  goWorkout() { go('today'); setTimeout(() => { const c = $('#todayWorkout'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50); },
  eatPlan(el) { addPlanMeal(el.dataset.slot); render(); },
  toggleWorkout() {
    const day = getDay(dateKey(), true);
    day.workout = !day.workout; save();
    toast(day.workout ? '太棒了！今日运动已完成 💪' : '已撤销运动打卡');
    render();
  },
  weighModal() { weighModal(); },
  saveWeightModal() {
    const photo = pendingPhoto.weight || '';
    if (addWeight(dateKey(), $('#wInput').value, photo)) {
      pendingPhoto.weight = '';
      closeModal(); render();
    }
  },
  addWater() {
    const day = getDay(dateKey(), true);
    if (day.water >= WATER_GOAL) { toast('今天8杯水已喝够，真棒！'); return; }
    day.water += 1; save(); toast(`已喝 ${day.water} 杯水`); render();
  },
  setWater(el) {
    const day = getDay(dateKey(), true);
    const n = +el.dataset.n;
    day.water = day.water === n ? n - 1 : n; save(); render();
  },
  dismiss(el) {
    const day = getDay(dateKey(), true);
    day.dismissed = day.dismissed || {};
    day.dismissed[el.dataset.id] = true; save(); renderBanners();
  },
  logSlot(el) { logState.slot = el.dataset.slot; renderLog(); renderFab(); },
  logCat(el) { logState.cat = el.dataset.cat; logState.search = ''; const s = $('[data-input="foodSearch"]'); if (s) s.value = ''; document.querySelectorAll('.cat-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.cat === logState.cat)); renderFoodArea(); },
  pickFood(el) { pickFood(el.dataset.cat, +el.dataset.i); },
  pickUnit(el) {
    const f = FOODS[el.dataset.cat][+el.dataset.i];
    const u = f.units[+el.dataset.j];
    const item = { name: f.name, portion: u[0], kcal: u[1], protein: u[2] };
    if (pendingPhoto.food) { item.photo = pendingPhoto.food; }
    logState.basket.push(item);
    toast(`已加入：${f.name} ${u[0]}${pendingPhoto.food ? ' 📷' : ''}`);
    pendingPhoto.food = '';
    // 同步更新模态框中的预览
    const prev = $('#foodPhotoPreview'); if (prev) prev.innerHTML = '';
    const btn = $('#foodPhotoBtn'); if (btn) { btn.classList.remove('has-photo'); btn.textContent = '📷 先拍照再选分量'; }
    renderBasket(); renderFab();
  },
  basketDel(el) { logState.basket.splice(+el.dataset.idx, 1); renderBasket(); renderFab(); },
  mPortion(el) { $('#mPortion').value = el.dataset.p; },
  manualAdd() {
    const name = $('#mName').value.trim();
    const portion = $('#mPortion').value.trim() || '一份';
    if (!name) { toast('请先写上吃了什么'); $('#mName').focus(); return; }
    const est = estimateManual(name, portion, $('#mCat').value);
    const item = { name, portion, kcal: est.kcal, protein: est.protein, manual: true };
    if (pendingPhoto.manual) item.photo = pendingPhoto.manual;
    logState.basket.push(item);
    $('#mName').value = ''; $('#mPortion').value = '一份';
    pendingPhoto.manual = '';
    // 清空手动输入区照片预览
    const prev = $('#manualPhotoPreview'); if (prev) prev.innerHTML = '';
    const btn = $('#manualPhotoBtn'); if (btn) { btn.classList.remove('has-photo'); btn.textContent = '📷 拍食物照'; }
    toast(`已加入：${name} ${portion}${item.photo ? ' 📷' : ''}`);
    renderBasket(); renderFab();
  },
  commitBasket() {
    const L = logState;
    if (!L.basket.length) return;
    const day = getDay(L.date, true);
    L.basket.forEach((it) => day.meals[L.slot].push(Object.assign({ id: uid() }, it)));
    const kcal = Math.round(L.basket.reduce((a, b) => a + b.kcal, 0));
    L.basket = [];
    save();
    toast(`已记入${slotName(L.slot)}，约 ${kcal} 千卡 ✓`);
    renderBanners(); renderLog(); renderFab();
  },
  delItem(el) {
    const { k, slot, id } = el.dataset;
    const day = getDay(k, true);
    const it = day.meals[slot].find((x) => x.id === id);
    if (!it || !confirm(`删除“${it.name}”？`)) return;
    day.meals[slot] = day.meals[slot].filter((x) => x.id !== id);
    save(); toast('已删除'); render();
  },
  saveWeight() { if (addWeight($('#rwDate').value || dateKey(), $('#rwJin').value)) render(); },
  delWeight(el) {
    if (!confirm(`删除 ${fmtMD(el.dataset.date)} 的体重记录？`)) return;
    state.weights = state.weights.filter((w) => w.date !== el.dataset.date); save(); render();
  },
  barInfo(el) { toast(`${fmtMD(el.dataset.k)}：约 ${dayTotals(el.dataset.k).kcal} 千卡`); },
  histPrev() { historyDate = addDays(historyDate, -1); renderRecords(); },
  histNext() { if (historyDate < dateKey()) { historyDate = addDays(historyDate, 1); renderRecords(); } },
  planTab(el) { planTab = el.dataset.tab; renderPlan(); },
  exportData() {
    const code = exportCode();
    $('#exportBox').innerHTML = `
      <textarea class="input" readonly style="margin-top:8px" id="exportText">${esc(code)}</textarea>
      <button class="btn ghost block" style="margin-top:8px" data-action="copyExport">📋 复制备份码</button>`;
    ACTIONS.copyExport();
  },
  copyExport() {
    const ta = $('#exportText');
    copyText(ta.value).then(() => toast('备份码已复制，请粘贴到微信等地方保存')).catch(() => { ta.focus(); ta.select(); toast('请长按文本框手动复制'); });
  },
  importData() {
    const text = $('#importText').value;
    if (!text.trim()) { toast('请先粘贴备份码'); return; }
    let data;
    try { data = importCode(text); } catch (e) { toast('备份码不正确，请检查是否复制完整'); return; }
    const n = Object.keys(data.days).length;
    if (!confirm(`备份中有 ${n} 天的记录、${data.weights.length} 条体重。恢复后会覆盖当前手机上的数据，确定吗？`)) return;
    state = data; save(); toast('恢复成功 ✓'); render();
  },
  clearData() {
    if (!confirm('确定清空所有数据吗？此操作无法撤销。')) return;
    if (!confirm('再确认一次：真的要删除全部记录吗？')) return;
    const settings = state.settings;
    state = normalize({ settings }); save(); toast('已清空记录（个人设置已保留）'); render();
  },
  installApp() { promptInstall(); },

  /* === 拍照 ACTIONS === */
  /* 在 pickFood 模态框中拍照，存到 pendingPhoto.food，并显示预览 */
  takeFoodPhoto(el) {
    takePhoto((b64) => {
      pendingPhoto.food = b64;
      const prev = $('#foodPhotoPreview');
      if (prev) prev.innerHTML = `<img src="${b64}" alt="食物照片"><button class="pp-remove" data-action="removeFoodPhoto" aria-label="移除照片">✕</button>`;
      const btn = $('#foodPhotoBtn');
      if (btn) { btn.classList.add('has-photo'); btn.textContent = '✓ 已拍照，将附加到下一条'; }
    });
  },
  removeFoodPhoto() {
    pendingPhoto.food = '';
    const prev = $('#foodPhotoPreview'); if (prev) prev.innerHTML = '';
    const btn = $('#foodPhotoBtn'); if (btn) { btn.classList.remove('has-photo'); btn.textContent = '📷 先拍照再选分量'; }
  },
  /* 在手动输入区拍照 */
  takeManualPhoto() {
    takePhoto((b64) => {
      pendingPhoto.manual = b64;
      const prev = $('#manualPhotoPreview');
      if (prev) prev.innerHTML = `<img src="${b64}" alt="食物照片"><button class="pp-remove" data-action="removeManualPhoto" aria-label="移除照片">✕</button>`;
      const btn = $('#manualPhotoBtn');
      if (btn) { btn.classList.add('has-photo'); btn.textContent = '✓ 已拍照，将附加到下一条'; }
    });
  },
  removeManualPhoto() {
    pendingPhoto.manual = '';
    const prev = $('#manualPhotoPreview'); if (prev) prev.innerHTML = '';
    const btn = $('#manualPhotoBtn'); if (btn) { btn.classList.remove('has-photo'); btn.textContent = '📷 拍食物照'; }
  },
  /* 在体重模态框中拍体重秤 */
  takeWeightPhoto() {
    takePhoto((b64) => {
      pendingPhoto.weight = b64;
      const prev = $('#weightPhotoPreview');
      if (prev) prev.innerHTML = `<img src="${b64}" alt="体重秤照片"><button class="pp-remove" data-action="removeWeightPhoto" aria-label="移除照片">✕</button>`;
    });
  },
  removeWeightPhoto() {
    pendingPhoto.weight = '';
    const prev = $('#weightPhotoPreview'); if (prev) prev.innerHTML = '';
  },
  /* 运动打卡拍照（在今日运动卡片） */
  takeWorkoutPhoto() {
    takePhoto((b64) => {
      const day = getDay(dateKey(), true);
      day.workoutPhoto = b64;
      // 自动把今日运动标记为已完成
      if (!day.workout) day.workout = true;
      save();
      toast('运动打卡照片已保存 🎉');
      render();
    });
  },
  /* 查看大图（食物/体重/运动照片通用） */
  viewPhoto(el) {
    if (!el || !el.src) return;
    viewPhoto(el.src, el.alt);
  },

  /* === 语音 ACTIONS === */
  /* 记餐页语音输入：识别"米饭一碗"等口语，自动填入 mName / mPortion */
  voiceInput() {
    if (!supportsSpeechRec()) { toast('当前浏览器不支持语音输入'); return; }
    const btn = $('#voiceBtn');
    if (btn) { btn.classList.add('recording'); btn.textContent = '🎙️ 录音中…'; }
    startVoiceRec((text) => {
      const { name, portion } = parseVoiceInput(text);
      const nameInput = $('#mName');
      const portionInput = $('#mPortion');
      if (nameInput && name) nameInput.value = name;
      if (portionInput && portion) portionInput.value = portion;
      toast(`识别：${name || '未识别'} ${portion}`);
    }, () => {
      if (btn) { btn.classList.remove('recording'); btn.textContent = '🎤 语音输入'; }
    });
  },
  /* 今日页语音播报 */
  speakToday() {
    const k = dateKey();
    const day = getDay(k);
    const tot = dayTotals(k);
    const target = calcTarget();
    const pTarget = proteinTarget();
    const todayWeight = state.weights.find((x) => x.date === k);
    const wd = new Date().getDay();
    const w = WORKOUTS[wd] || {};
    const parts = [];
    parts.push(`今天是${WEEKDAY_NAMES[wd]}，今日运动是${w.title || '休息'}。`);
    parts.push(`今天已经吃了${tot.kcal}千卡，目标${target}千卡，${tot.kcal > target ? `已超出${tot.kcal - target}千卡` : `还可以吃${target - tot.kcal}千卡`}。`);
    parts.push(`蛋白质${tot.protein}克，目标${pTarget}克。`);
    if (todayWeight) parts.push(`今日体重${todayWeight.jin}斤。`);
    parts.push(`已喝${day.water}杯水。`);
    if (day.workout) parts.push('今日运动已完成，真棒！');
    else parts.push('今日运动还没打卡。');
    speak(parts.join(''));
    toast('开始语音播报…');
  }
};

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) { closeModal(); return; }
  // 点击照片查看器关闭按钮或背景关闭
  if (e.target.closest('[data-close-viewer]') || e.target.id === 'photoViewer') { closePhotoViewer(); return; }
  const nav = e.target.closest('[data-go]');
  if (nav) { go(nav.dataset.go); return; }
  const el = e.target.closest('[data-action]');
  if (el && ACTIONS[el.dataset.action]) {
    // 弹窗里的操作执行后，若弹窗内容没被替换则保持打开（如连续选分量）
    ACTIONS[el.dataset.action](el, e);
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.input === 'foodSearch') {
    logState.search = el.value;
    document.querySelectorAll('.cat-tabs button').forEach((b) => b.classList.toggle('on', !el.value.trim() && b.dataset.cat === logState.cat));
    renderFoodArea();
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.input === 'logDate' && el.value) {
    logState.date = el.value > dateKey() ? dateKey() : el.value; renderLog(); renderFab();
  } else if (el.dataset.input === 'histDate' && el.value) {
    historyDate = el.value > dateKey() ? dateKey() : el.value; renderRecords();
  } else if (el.dataset.setting) {
    const key = el.dataset.setting;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (['age', 'height', 'weight', 'goalWeight', 'activity', 'deficit'].includes(key)) {
      v = +v;
      const limits = { age: [16, 90], height: [120, 210], weight: [50, 400], goalWeight: [50, 400], activity: [1.2, 1.9], deficit: [0, 500] }[key];
      if (!(v >= limits[0] && v <= limits[1])) { toast('请输入合理的数值'); el.value = state.settings[key]; return; }
    }
    if (key === 'notify' && v) {
      if (!('Notification' in window)) { toast('当前浏览器不支持通知'); el.checked = false; return; }
      Notification.requestPermission().then((p) => {
        state.settings.notify = p === 'granted'; save();
        toast(p === 'granted' ? '已开启通知' : '未获得通知权限，可在浏览器设置中允许');
        renderPlan();
      });
      return;
    }
    state.settings[key] = v; save();
    toast('已保存');
    applyTheme();
    renderBanners();
    renderPlan();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closePhotoViewer(); closeModal(); }
  if (e.key === 'Enter' && e.target.id === 'wInput') ACTIONS.saveWeightModal();
});

/* ---------- 安装到桌面 ---------- */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('#installBtn').hidden = false;
  const b2 = $('#installBtn2'); if (b2) b2.hidden = false;
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  $('#installBtn').hidden = true;
  toast('已添加到桌面 🎉');
});
function promptInstall() {
  if (!deferredPrompt) {
    openModal(`<h3>📲 添加到手机桌面</h3>${installNote()}<button class="btn block" data-close style="margin-top:12px">知道了</button>`);
    return;
  }
  deferredPrompt.prompt();
  deferredPrompt.userChoice.finally(() => { deferredPrompt = null; $('#installBtn').hidden = true; });
}
$('#installBtn').addEventListener('click', promptInstall);

/* ---------- 启动 ---------- */
let lastDay = dateKey();
setInterval(() => {
  const k = dateKey();
  if (k !== lastDay) { lastDay = k; logState.date = k; historyDate = k; logState.slot = defaultSlot(); render(); return; }
  renderBanners();
}, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (dateKey() !== lastDay) { lastDay = dateKey(); logState.date = lastDay; historyDate = lastDay; } render(); } });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}

/* 支持 manifest shortcuts 通过 ?page=xxx 直接打开对应页面 */
(function () {
  const params = new URLSearchParams(location.search);
  const page = params.get('page');
  if (page && ['today', 'log', 'records', 'plan'].indexOf(page) >= 0) {
    go(page);
  } else {
    go('today');
  }
})();
