'use strict';

// ---------- хранилище ----------
const STORE = 'hy-trainer-v1';
// через сколько карточек вернуть слово на каждом уровне знания
const INTERVALS = [3, 6, 12, 25, 50, 100, 200];
const LEARNED_LVL = 3;
const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

const PRAISE = [
  'Молодец!', 'Всё верно!', 'Ты просто вау!', 'Ты супер класс!', 'Ապրե՛ս! Умница!', 'Браво!',
  'Точно в цель!', 'Шикарно!', 'Блестяще!', 'Так держать!', 'Идеально!', 'Կեցցե՛ս!'
];
const TRY_AGAIN = [
  'Подумай ещё', 'Ты уверена?', 'Кажется, это неверно', 'Почти! Попробуй ещё раз',
  'Хм, не совсем', 'Давай ещё разок', 'Не то слово — подумай ещё'
];
let lastPhrase = '';
function phraseFrom(list) {
  let p;
  do { p = list[Math.random() * list.length | 0]; } while (p === lastPhrase && list.length > 1);
  return (lastPhrase = p);
}

const $ = id => document.getElementById(id);

function defaults() {
  return { step: 0, mode: 'ru2hy', streak: 0, best: 0, cards: {}, key: '', model: MODELS[0], theme: 'dark' };
}
function load() {
  try { return Object.assign(defaults(), JSON.parse(localStorage.getItem(STORE) || '{}')); }
  catch (e) { return defaults(); }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {}
}

let S = load();
let WORDS = [];

// ---------- выбор карточки (интервальное повторение) ----------
const cardKey = (w, mode = S.mode) => mode + ':' + w.hy;
const rec = (w, mode) => S.cards[cardKey(w, mode)];

function pickWord(exclude) {
  const due = [], fresh = [];
  let soonest = null;
  for (const w of WORDS) {
    if (w === exclude && WORDS.length > 1) continue;
    const r = rec(w);
    if (!r) fresh.push(w);
    else if (r.due <= S.step) due.push([w, r]);
    else if (!soonest || r.due < soonest[1].due) soonest = [w, r];
  }
  if (due.length) {
    // самые «просроченные» вперёд, среди первых трёх — случайно
    due.sort((a, b) => a[1].due - b[1].due);
    const top = due.slice(0, 3);
    return top[Math.random() * top.length | 0][0];
  }
  if (fresh.length) return fresh[Math.random() * fresh.length | 0];
  return soonest ? soonest[0] : WORDS[0];
}

// kind: 'right' | 'hint' | 'wrong'
function grade(kind) {
  const k = cardKey(cur);
  const r = S.cards[k] || { lvl: 0, due: 0, right: 0, wrong: 0, seen: 0 };
  const first = r.seen === 0;
  r.seen++;
  if (kind === 'wrong') {
    r.wrong++;
    r.lvl = 0;
    r.due = S.step + 3 + (Math.random() * 2 | 0);
    S.streak = 0;
  } else {
    r.right++;
    if (kind === 'right') r.lvl = Math.min(r.lvl + (first ? 2 : 1), INTERVALS.length - 1);
    r.due = S.step + Math.round(INTERVALS[r.lvl] * (0.8 + Math.random() * 0.4));
    S.streak++;
    S.best = Math.max(S.best, S.streak);
  }
  S.cards[k] = r;
  S.step++;
  graded = true;
  save();
  renderStreak();
}

// ---------- состояние карточки ----------
let cur = null;
let graded = false;
let hints = 0;

const target = () => (S.mode === 'ru2hy' ? cur.hy : cur.ru);
const promptText = () => (S.mode === 'ru2hy' ? cur.ru : cur.hy);
const voiceReady = () => navigator.onLine && !!S.key;

function nextCard() {
  cur = pickWord(cur);
  graded = false;
  hints = 0;
  const card = $('card');
  card.classList.remove('ok', 'bad');
  $('dirLabel').textContent = S.mode === 'ru2hy' ? 'Скажи по-армянски' : 'Скажи по-русски';
  const p = $('prompt');
  const text = promptText();
  p.textContent = text;
  p.lang = S.mode === 'ru2hy' ? 'ru' : 'hy';
  // длинные слова и фразы — мельче, чтобы не рвались посередине
  const longest = Math.max(...text.split(/\s+/).map(s => s.length));
  p.className = 'prompt' + (text.length > 40 || longest > 17 ? ' xs' : text.length > 24 || longest > 14 ? ' s' : longest > 11 ? ' m' : '');
  const r = rec(cur);
  const tag = $('tag');
  tag.className = 'tag';
  if (!r) { tag.textContent = 'новое'; tag.classList.add('new'); }
  else if (r.wrong > r.right) { tag.textContent = 'трудное'; tag.classList.add('hard'); }
  else tag.textContent = '';
  $('hint').textContent = '';
  $('answer').classList.remove('on');
  $('answerText').textContent = target();
  setVerdict(null);
  phase('ask');
}

function phase(name) {
  $('askControls').hidden = name !== 'ask';
  $('selfControls').hidden = name !== 'self';
  $('retryControls').hidden = name !== 'retry';
  $('nextControls').hidden = name !== 'done';
  if (name === 'ask') renderMic();
  if (name === 'done' || name === 'self') $('note').textContent = '';
}

function renderMic() {
  const mic = $('mic');
  mic.classList.remove('rec', 'wait');
  mic.disabled = false;
  if (!navigator.onLine) {
    mic.hidden = true;
    $('note').textContent = 'Офлайн: скажи вслух, открой ответ и отметь сама';
  } else if (!S.key) {
    mic.hidden = false;
    $('micLabel').textContent = 'Подключить голос';
    $('note').textContent = 'Для проверки голосом нужен ключ Gemini';
  } else {
    mic.hidden = false;
    $('micLabel').textContent = 'Ответить голосом';
    $('note').textContent = '';
  }
}

function setVerdict(kind, title, heard) {
  const v = $('verdict');
  if (!kind) { v.className = 'verdict'; v.innerHTML = ''; return; }
  v.className = 'verdict on ' + kind;
  v.innerHTML = '';
  const b = document.createElement('span');
  b.className = 'big';
  b.textContent = title;
  v.appendChild(b);
  if (heard) {
    const h = document.createElement('div');
    h.className = 'heard';
    h.append('Я услышал: ');
    const hb = document.createElement('b');
    hb.textContent = heard;
    h.appendChild(hb);
    v.appendChild(h);
  }
  $('card').classList.remove('ok', 'bad');
  $('card').classList.add(kind);
}

function reveal() {
  $('answer').classList.add('on');
  $('hint').textContent = '';
}

// подсказка: открываем по одной букве, пробелы и знаки остаются видны
function showHint() {
  const t = target();
  const letters = [...t].filter(ch => /[\p{L}\p{N}]/u.test(ch)).length;
  if (hints >= letters - 1) { $('note').textContent = 'Больше подсказок нет — открой ответ'; return; }
  hints++;
  let shown = 0;
  $('hint').textContent = [...t].map(ch => {
    if (!/[\p{L}\p{N}]/u.test(ch)) return ch;
    return shown++ < hints ? ch : '•';
  }).join('');
}

// ---------- запись голоса ----------
let stream = null, recorder = null, chunks = [], recTimer = null;

async function startRec() {
  if (!stream || stream.getAudioTracks().every(t => t.readyState === 'ended')) {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  }
  chunks = [];
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onstop = onRecStop;
  recorder.start();
  $('mic').classList.add('rec');
  $('micLabel').textContent = 'Говори… нажми, когда закончишь';
  $('note').textContent = '';
  recTimer = setTimeout(stopRec, 8000);
}

function stopRec() {
  clearTimeout(recTimer);
  if (recorder && recorder.state === 'recording') recorder.stop();
}

function releaseMic() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
}

async function onRecStop() {
  const mic = $('mic');
  mic.classList.remove('rec');
  mic.classList.add('wait');
  mic.disabled = true;
  $('micLabel').textContent = 'Проверяю…';
  const blob = new Blob(chunks, { type: (recorder && recorder.mimeType) || 'audio/mp4' });
  try {
    const audio = await toWav16k(blob).catch(async () => ({
      mime: (blob.type || 'audio/mp4').split(';')[0], data: await blobToB64(blob), seconds: 1
    }));
    if (audio.seconds < 0.3) throw userError('Ничего не услышал — попробуй ещё раз');
    const res = await checkAnswer(audio);
    onVoiceResult(res);
  } catch (e) {
    console.error(e);
    phase('ask');
    $('note').textContent = e.userMsg || (navigator.onLine
      ? 'Не получилось проверить. Открой ответ и отметь сама'
      : 'Нет связи. Открой ответ и отметь сама');
  }
}

function onVoiceResult(res) {
  if (res.correct) {
    if (!graded) grade(hints ? 'hint' : 'right');
    setVerdict('ok', phraseFrom(PRAISE), res.heard);
    reveal();
    phase('done');
  } else {
    if (!graded) grade('wrong');
    setVerdict('bad', phraseFrom(TRY_AGAIN), res.heard);
    phase('retry');
  }
}

function userError(msg) { const e = new Error(msg); e.userMsg = msg; return e; }

async function blobToB64(blob) {
  return bytesToB64(new Uint8Array(await blob.arrayBuffer()));
}
function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// перекодируем запись в WAV 16 кГц моно — этот формат Gemini понимает надёжно
async function toWav16k(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  const buf = await blob.arrayBuffer();
  const audio = await new Promise((res, rej) => ac.decodeAudioData(buf, res, rej));
  if (ac.close) ac.close();
  const rate = 16000;
  const len = Math.max(1, Math.ceil(audio.duration * rate));
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new OAC(1, len, rate);
  const src = off.createBufferSource();
  src.buffer = audio;
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  const pcm = out.getChannelData(0);
  const view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const x = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return { mime: 'audio/wav', data: bytesToB64(new Uint8Array(view.buffer)), seconds: audio.duration };
}

// ---------- проверка через Gemini ----------
function buildPrompt() {
  if (S.mode === 'ru2hy') {
    return `Ты проверяешь тренировку армянских слов. Ученице показали по-русски: «${cur.ru}».
Правильный ответ по-армянски (восточноармянский): «${cur.hy}». Если в ответе есть «/», подходит любой из вариантов.
На записи она произносит ответ по-армянски.
1) heard — запиши армянскими буквами то, что она сказала (пустая строка, если речи нет).
2) correct — true, если она сказала правильное слово или выражение. Прощай акцент, разговорное произношение (например «ա» вместо «է» в конце) и мелкие фонетические неточности. false — если это другое слово, другая форма, пропущена часть выражения или речи нет.`;
  }
  return `Ты проверяешь тренировку армянских слов. Ученице показали армянское слово или выражение: «${cur.hy}».
Правильный перевод на русский: «${cur.ru}». Если перечислено несколько вариантов, достаточно любого.
На записи она произносит перевод по-русски.
1) heard — запиши по-русски то, что она сказала (пустая строка, если речи нет).
2) correct — true, если смысл совпадает с правильным переводом (синонимы и другая грамматическая форма подходят). false — если смысл другой или речи нет.`;
}

async function checkAnswer(audio) {
  const models = [S.model, ...MODELS.filter(m => m !== S.model)];
  let lastErr;
  for (const m of models) {
    try {
      const res = await callGemini(m, buildPrompt(), audio);
      if (!res.correct && sameText(res.heard, target())) res.correct = true;
      return res;
    } catch (e) {
      lastErr = e;
      if (e.userMsg) throw e;
    }
  }
  throw lastErr;
}

function norm(s) {
  return (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, '');
}
function sameText(heard, expected) {
  const h = norm(heard);
  if (!h) return false;
  return expected.split(/[\/,]/).some(v => norm(v) === h);
}

async function callGemini(model, prompt, audio, noThinking) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: audio.mime, data: audio.data } }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: { heard: { type: 'STRING' }, correct: { type: 'BOOLEAN' } },
        required: ['heard', 'correct']
      }
    }
  };
  if (!noThinking) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': S.key },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 400 && /thinking/i.test(text) && !noThinking) return callGemini(model, prompt, audio, true);
    if ((res.status === 400 && /api key/i.test(text)) || res.status === 401 || res.status === 403)
      throw userError('Ключ Gemini не подходит — проверь его в Настройках');
    if (res.status === 429) throw userError('Лимит Gemini на сегодня исчерпан — отметь сама');
    throw new Error(model + ': ' + res.status + ' ' + text.slice(0, 200));
  }
  const j = await res.json();
  const txt = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  const out = JSON.parse(txt);
  return { heard: String(out.heard || '').trim(), correct: !!out.correct };
}

async function testKey(key) {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key } });
  return res.ok;
}

// ---------- статистика ----------
function renderStreak() {
  $('streak').textContent = S.streak;
  $('best').textContent = S.best;
}

function renderStats() {
  let learned = 0, progress = 0, fresh = 0;
  for (const w of WORDS) {
    const r = rec(w);
    if (!r) fresh++;
    else if (r.lvl >= LEARNED_LVL) learned++;
    else progress++;
  }
  $('stLearned').textContent = learned;
  $('stProgress').textContent = progress;
  $('stNew').textContent = fresh;

  const hard = WORDS.map(w => {
    const a = rec(w, 'ru2hy') || {}, b = rec(w, 'hy2ru') || {};
    const wrong = (a.wrong || 0) + (b.wrong || 0), right = (a.right || 0) + (b.right || 0);
    return { w, wrong, right };
  }).filter(x => x.wrong > 0)
    .sort((x, y) => (y.wrong / (y.wrong + y.right)) - (x.wrong / (x.wrong + x.right)) || y.wrong - x.wrong)
    .slice(0, 30);

  const list = $('hardList');
  list.innerHTML = '';
  if (!hard.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'Ошибок пока нет. Здесь появятся слова, в которых ты ошибаешься чаще всего.';
    list.appendChild(e);
    return;
  }
  for (const x of hard) {
    const it = document.createElement('div');
    it.className = 'item';
    const w = document.createElement('div');
    w.className = 'w';
    const b = document.createElement('b'); b.textContent = x.w.hy;
    const s = document.createElement('span'); s.textContent = x.w.ru;
    w.append(b, s);
    const c = document.createElement('div');
    c.className = 'c';
    const cb = document.createElement('b'); cb.textContent = x.wrong;
    c.append(cb, document.createElement('br'), 'ошибок из ' + (x.wrong + x.right));
    it.append(w, c);
    list.appendChild(it);
  }
}

// ---------- интерфейс ----------
function openSheet(id) { $(id).classList.add('on'); }
function closeSheets() { document.querySelectorAll('.sheet').forEach(s => s.classList.remove('on')); }

function renderMode() {
  $('modeBtn').textContent = S.mode === 'ru2hy' ? 'RU → HY' : 'HY → RU';
}

function renderNet() {
  const n = $('net');
  n.classList.toggle('off', !navigator.onLine);
  n.lastChild.textContent = navigator.onLine ? 'онлайн' : 'офлайн';
  if (!$('askControls').hidden) renderMic();
}

function applyTheme() {
  document.documentElement.dataset.theme = S.theme;
  document.querySelector('meta[name="theme-color"]').content = S.theme === 'light' ? '#FBFAF3' : '#0F0F0C';
}

function bind() {
  $('mic').onclick = async () => {
    if (!S.key) { openSettings(); return; }
    if (recorder && recorder.state === 'recording') { stopRec(); return; }
    try { await startRec(); }
    catch (e) {
      console.error(e);
      $('note').textContent = 'Нет доступа к микрофону — разреши его в настройках iPhone';
    }
  };
  $('hintBtn').onclick = showHint;
  $('showBtn').onclick = () => {
    stopRec();
    reveal();
    phase(graded ? 'done' : 'self');
  };
  $('yesBtn').onclick = () => { grade(hints ? 'hint' : 'right'); nextCard(); };
  $('noBtn').onclick = () => { grade('wrong'); nextCard(); };
  // «Попробовать ещё раз» сразу включает запись
  $('retryBtn').onclick = () => { phase('ask'); $('mic').click(); };
  $('retryHintBtn').onclick = showHint;
  $('giveUpBtn').onclick = () => { reveal(); phase('done'); };
  $('nextBtn').onclick = nextCard;

  $('modeBtn').onclick = () => {
    S.mode = S.mode === 'ru2hy' ? 'hy2ru' : 'ru2hy';
    save(); renderMode(); nextCard();
  };
  $('statsBtn').onclick = () => { renderStats(); openSheet('statsSheet'); };
  $('setBtn').onclick = openSettings;
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { closeSheets(); if (!$('askControls').hidden) renderMic(); });

  $('keySave').onclick = async () => {
    const key = $('keyInput').value.trim();
    const note = $('keyNote');
    if (!key) { S.key = ''; save(); note.textContent = 'Ключ удалён'; return; }
    note.textContent = 'Проверяю ключ…';
    try {
      if (await testKey(key)) { S.key = key; save(); note.textContent = 'Ключ работает ✓ Голосовая проверка включена'; }
      else note.textContent = 'Google не принял ключ — проверь, что скопирован целиком';
    } catch (e) {
      note.textContent = 'Нет связи — попробуй, когда будет интернет';
    }
  };
  $('modelSel').onchange = e => { S.model = e.target.value; save(); };
  $('themeBtn').onclick = () => { S.theme = S.theme === 'light' ? 'dark' : 'light'; save(); applyTheme(); };
  $('resetBtn').onclick = () => {
    if (!confirm('Сбросить весь прогресс и статистику? Ключ останется.')) return;
    S.cards = {}; S.step = 0; S.streak = 0; S.best = 0;
    save(); renderStreak(); closeSheets(); nextCard();
  };

  window.addEventListener('online', renderNet);
  window.addEventListener('offline', renderNet);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopRec(); releaseMic(); } });
}

function openSettings() {
  $('keyInput').value = S.key;
  $('modelSel').value = S.model;
  $('keyNote').textContent = S.key ? 'Ключ сохранён' : '';
  $('about').textContent = 'Слов в словаре: ' + WORDS.length;
  openSheet('setSheet');
}

async function init() {
  applyTheme();
  bind();
  renderMode();
  renderStreak();
  renderNet();
  try {
    const res = await fetch('words.json', { cache: 'no-cache' });
    WORDS = (await res.json()).map(({ hy, ru }) => ({ hy, ru }));
  } catch (e) {
    $('prompt').textContent = 'Не удалось загрузить слова';
    return;
  }
  nextCard();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
