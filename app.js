'use strict';

// ---------- хранилище ----------
const STORE = 'hy-trainer-v1';
// через сколько карточек вернуть слово на каждом уровне знания
const INTERVALS = [3, 6, 12, 25, 50, 100, 200];
// слово выучено после стольких правильных ответов (в любом направлении)
const LEARNED_AFTER = 3;
// запасные модели, если список моделей Google получить не удалось
const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

const PRAISE = [
  'Молодец!', 'Всё верно!', 'Ты просто вау!', 'Ты супер класс!', 'Ապրե՛ս! Умница!', 'Браво!',
  'Точно в цель!', 'Шикарно!', 'Блестяще!', 'Так держать!', 'Идеально!', 'Կեցցե՛ս!'
];
const TRY_AGAIN = [
  'Подумай ещё', 'Ты уверена?', 'Кажется, это неверно', 'Почти! Попробуй ещё раз',
  'Хм, не совсем', 'Давай ещё разок', 'Не то слово — подумай ещё'
];
const WELCOME_EMOJI = ['🍑', '🌸', '🚀', '🦄', '☀️', '🥳', '🌈', '⭐', '🐣', '🍇', '💜', '🎈'];
const WELCOME_TEXT = [
  'Ты молодец, что решила попрактиковаться в армянском. Давай начнём!',
  'Армянские слова уже соскучились по тебе. Давай начнём!',
  'Пять минут армянского — и день прожит не зря. Поехали!',
  'Маштоц бы тобой гордился. Продолжим?',
  'Ещё немного практики — и таксисты примут тебя за местную. Давай начнём!',
  'Сегодня отличный день, чтобы удивить себя. Вперёд!',
  'Ты уже знаешь {n}. Давай добавим ещё!',
  'Каждая карточка — маленький шаг к свободному армянскому. Начнём?'
];
// названия уровней; дальше 15-го — «Легенда Еревана» с номером
const LEVELS = [
  'Туристка с разговорником',
  'Знаток «Барев дзез»',
  'Уверенно говорю «мерси»',
  'Королева торга на ГУМ-рынке',
  'Почти своя в маршрутке',
  'Заказываю хоровац без жестов',
  'Спорю с таксистом по-армянски',
  'Понимаю тосты на свадьбе',
  'Своя в Конде',
  'Тикин с Каскада',
  'Армянская тётя одобряет',
  'Говорю как в сериале',
  'Шутки про Гюмри понимаю',
  'Арарат машет мне рукой',
  'Месроп Маштоц аплодирует'
];

const $ = id => document.getElementById(id);
const pick = list => list[Math.random() * list.length | 0];

function defaults() {
  return { step: 0, mode: 'ru2hy', streak: 0, best: 0, cards: {}, learned: {}, key: '', theme: 'light', models: null, modelsAt: 0 };
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

// ---------- уровни ----------
// чтобы получить уровень L, нужно выучить 5·L·(L−1)/2 слов: 0, 5, 15, 30, 50, 75…
const levelNeed = L => 5 * L * (L - 1) / 2;
function levelOf(n) {
  let L = 1;
  while (levelNeed(L + 1) <= n) L++;
  return L;
}
const levelName = L => LEVELS[L - 1] || ('Легенда Еревана ×' + (L - LEVELS.length));
const learnedCount = () => WORDS.filter(w => S.learned[w.hy]).length;

function plural(n, one, few, many) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}
const wordsTxt = n => n + ' ' + plural(n, 'слово', 'слова', 'слов');

function renderLevel() {
  const n = learnedCount(), L = levelOf(n);
  const from = levelNeed(L), to = levelNeed(L + 1);
  const pct = Math.round((n - from) / (to - from) * 100);
  const left = to - n;
  $('lvLabel').textContent = 'Уровень ' + L;
  $('lvBar').style.width = pct + '%';
  $('lvWords').textContent = wordsTxt(n) + ' выучено';
  $('lvLeft').textContent = 'до уровня ' + (L + 1) + ': ' + left;
  $('stLvNum').textContent = 'Уровень ' + L;
  $('stLvName').textContent = levelName(L);
  $('stLvBar').style.width = pct + '%';
  $('stLvLeft').textContent = 'Ещё ' + wordsTxt(left) + ' до уровня ' + (L + 1) + ' «' + levelName(L + 1) + '»';
}

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
    return pick(due.slice(0, 3))[0];
  }
  if (fresh.length) return pick(fresh);
  return soonest ? soonest[0] : WORDS[0];
}

// kind: 'right' | 'hint' | 'wrong'
function grade(kind) {
  const k = cardKey(cur);
  const r = S.cards[k] || { lvl: 0, due: 0, right: 0, wrong: 0, seen: 0 };
  const first = r.seen === 0;
  const levelBefore = levelOf(learnedCount());
  const bestBefore = S.best;
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
  if (kind !== 'wrong' && !S.learned[cur.hy] && totalRight(cur) >= LEARNED_AFTER) S.learned[cur.hy] = Date.now();
  save();
  renderStreak();
  renderLevel();

  const levelAfter = levelOf(learnedCount());
  if (levelAfter > levelBefore) celebrate('🎖️', 'Новый уровень!', 'Уровень ' + levelAfter + ' · ' + levelName(levelAfter));
  // праздник — один раз, в момент когда серия обогнала прежний рекорд (и рекорд был не совсем крошечный)
  if (S.streak === bestBefore + 1 && bestBefore >= 3) celebrate('🏆', 'Новый рекорд!', S.streak + ' подряд без ошибок');
}

const totalRight = w => ((rec(w, 'ru2hy') || {}).right || 0) + ((rec(w, 'hy2ru') || {}).right || 0);

// слова, выученные до появления уровней, засчитываем по истории ответов
function backfillLearned() {
  for (const w of WORDS) if (!S.learned[w.hy] && totalRight(w) >= LEARNED_AFTER) S.learned[w.hy] = Date.now();
}

// ---------- состояние карточки ----------
let cur = null;
let graded = false;
let hints = 0;

const target = () => (S.mode === 'ru2hy' ? cur.hy : cur.ru);
const promptText = () => (S.mode === 'ru2hy' ? cur.ru : cur.hy);

function nextCard() {
  cur = pickWord(cur);
  graded = false;
  hints = 0;
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
  animateCard('pop');
  phase('ask');
}

function animateCard(name) {
  const c = $('card');
  c.classList.remove('pop', 'shake');
  void c.offsetWidth;
  c.classList.add(name);
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
  b.textContent = (kind === 'ok' ? '🎉 ' : '🤔 ') + title;
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
}

function reveal() {
  $('answer').classList.add('on');
  $('hint').textContent = '';
}

// подсказка: открываем по одной букве, пробелы и знаки остаются видны
function showHint() {
  const t = target();
  const isLetter = ch => /[\p{L}\p{N}]/u.test(ch);
  const letters = [...t].filter(isLetter).length;
  if (hints >= letters - 1) { $('note').textContent = 'Больше подсказок нет — открой ответ'; return; }
  hints++;
  let shown = 0;
  $('hint').textContent = [...t].map(ch => (!isLetter(ch) ? ch : shown++ < hints ? ch : '•')).join('');
}

// ---------- праздники и приветствие ----------
const overlayQueue = [];
let overlayBusy = false;

function celebrate(emoji, title, sub) {
  overlayQueue.push({ emoji, title, sub });
  if (!overlayBusy) nextOverlay();
}

function nextOverlay() {
  const item = overlayQueue.shift();
  if (!item) { overlayBusy = false; return; }
  overlayBusy = true;
  const ov = buildOverlay(item.emoji, item.title, item.sub, null);
  ov.classList.add('celebrate');
  fireworks();
  const close = () => {
    if (ov.classList.contains('out')) return;
    ov.classList.add('out');
    setTimeout(() => { ov.remove(); nextOverlay(); }, 350);
  };
  ov.onclick = close;
  setTimeout(close, 2600);
}

function buildOverlay(emoji, title, sub, buttonText) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  const card = document.createElement('div');
  card.className = 'ov-card';
  const e = document.createElement('div'); e.className = 'ov-emoji'; e.textContent = emoji;
  const t = document.createElement('div'); t.className = 'ov-title'; t.textContent = title;
  const s = document.createElement('div'); s.className = 'ov-sub'; s.textContent = sub;
  card.append(e, t, s);
  if (buttonText) {
    const b = document.createElement('button');
    b.className = 'btn main';
    b.textContent = buttonText;
    card.appendChild(b);
  }
  ov.appendChild(card);
  document.body.appendChild(ov);
  return ov;
}

function fireworks() {
  const colors = ['#D9B3CA', '#9B87BC', '#FFD36E', '#FFFFFF', '#B897C1', '#FF9EC4'];
  for (let burst = 0; burst < 3; burst++) {
    setTimeout(() => {
      const cx = 25 + Math.random() * 50, cy = 25 + Math.random() * 30;
      for (let i = 0; i < 26; i++) {
        const s = document.createElement('i');
        s.className = 'spark';
        const a = (i / 26) * Math.PI * 2, d = 70 + Math.random() * 70;
        s.style.left = cx + '%';
        s.style.top = cy + '%';
        s.style.background = pick(colors);
        s.style.setProperty('--x', Math.cos(a) * d + 'px');
        s.style.setProperty('--y', Math.sin(a) * d + 'px');
        document.body.appendChild(s);
        setTimeout(() => s.remove(), 1200);
      }
    }, burst * 380);
  }
}

function welcome() {
  const n = learnedCount();
  let text = pick(WELCOME_TEXT.filter(t => n > 0 || !t.includes('{n}')));
  text = text.replace('{n}', wordsTxt(n));
  const emoji = pick(WELCOME_EMOJI);
  $('ava').textContent = emoji;
  const ov = buildOverlay(emoji, 'Привет, Жанна!', text, 'Давай начнём →');
  const close = () => { ov.classList.add('out'); setTimeout(() => ov.remove(), 350); };
  ov.querySelector('.btn').onclick = close;
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
    if (!blob.size) throw userError('Запись пустая — проверь, что микрофон разрешён');
    const audio = await toWav16k(blob).catch(async err => {
      console.warn('WAV не получился, отправляю как есть', err);
      return { mime: geminiMime(blob.type), data: await blobToB64(blob), seconds: 1 };
    });
    if (audio.seconds < 0.3) throw userError('Ничего не услышал — попробуй ещё раз');
    onVoiceResult(await checkAnswer(audio));
  } catch (e) {
    console.error(e);
    phase('ask');
    const note = $('note');
    note.textContent = e.userMsg || (navigator.onLine
      ? 'Не получилось проверить. Открой ответ и отметь сама'
      : 'Нет связи. Открой ответ и отметь сама');
    // техническая причина мелко — чтобы можно было понять, что сломалось
    if (!e.userMsg && navigator.onLine) {
      const sm = document.createElement('small');
      sm.textContent = 'Причина: ' + String(e.message || e).slice(0, 160);
      note.appendChild(sm);
    }
  }
}

// у Gemini свои названия аудиоформатов
function geminiMime(type) {
  const t = (type || '').split(';')[0];
  if (t === 'audio/mp4' || t === 'audio/x-m4a' || t === 'audio/m4a') return 'audio/aac';
  if (t === 'audio/webm') return 'audio/webm';
  return t || 'audio/aac';
}

function onVoiceResult(res) {
  if (res.correct) {
    if (!graded) grade(hints ? 'hint' : 'right');
    setVerdict('ok', pick(PRAISE), res.heard);
    reveal();
    animateCard('pop');
    phase('done');
  } else {
    if (!graded) grade('wrong');
    setVerdict('bad', pick(TRY_AGAIN), res.heard);
    animateCard('shake');
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
const API = 'https://generativelanguage.googleapis.com/v1beta/';

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

// узнаём у Google, какие модели сейчас доступны по ключу, и берём лучшие «flash»
async function getModels() {
  if (S.models && S.models.length && Date.now() - S.modelsAt < 3 * 864e5) return S.models;
  try {
    const res = await fetch(API + 'models?pageSize=1000', { headers: { 'x-goog-api-key': S.key } });
    if (!res.ok) return FALLBACK_MODELS;
    const j = await res.json();
    const ver = n => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]);
    const names = (j.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''))
      .filter(n => /^gemini-\d+(\.\d+)?-flash(-lite)?(-preview)?(-[\d-]+)?$/.test(n))
      .sort((a, b) => (a.includes('preview') - b.includes('preview')) || (ver(b) - ver(a)) || (a.includes('lite') - b.includes('lite')));
    if (!names.length) return FALLBACK_MODELS;
    S.models = names.slice(0, 4);
    S.modelsAt = Date.now();
    save();
    return S.models;
  } catch (e) {
    return FALLBACK_MODELS;
  }
}

async function checkAnswer(audio) {
  const models = await getModels();
  const errors = [];
  for (const m of models) {
    try {
      const res = await callGemini(m, buildPrompt(), audio);
      if (!res.correct && sameText(res.heard, target())) res.correct = true;
      return res;
    } catch (e) {
      if (e.userMsg) throw e;
      errors.push(e.message);
      // модель пропала — в следующий раз перечитаем список
      if (/404|not found/i.test(e.message)) S.modelsAt = 0;
    }
  }
  throw new Error(errors.join(' | '));
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
  const res = await fetch(API + 'models/' + model + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': S.key },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 400 && /thinking/i.test(text) && !noThinking) return callGemini(model, prompt, audio, true);
    if ((res.status === 400 && /api key/i.test(text)) || res.status === 401 || res.status === 403)
      throw userError('Ключ Gemini не подходит — проверь его в Профиле');
    if (res.status === 429) throw userError('Лимит Gemini пока исчерпан — отметь сама, позже голос снова заработает');
    let msg = text;
    try { msg = JSON.parse(text).error.message; } catch (e) {}
    throw new Error(model + ' ' + res.status + ': ' + String(msg).slice(0, 120));
  }
  const j = await res.json();
  const txt = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  let out;
  try { out = JSON.parse(txt.replace(/^```(json)?|```$/g, '').trim()); }
  catch (e) { throw new Error(model + ': непонятный ответ «' + txt.slice(0, 60) + '»'); }
  return { heard: String(out.heard || '').trim(), correct: !!out.correct };
}

async function testKey(key) {
  const res = await fetch(API + 'models?pageSize=1', { headers: { 'x-goog-api-key': key } });
  return res.ok;
}

// ---------- серия и статистика ----------
function renderStreak() {
  $('streak').textContent = S.streak;
  $('best').textContent = S.best;
}

function renderStats() {
  let learned = 0, progress = 0, fresh = 0;
  for (const w of WORDS) {
    if (S.learned[w.hy]) learned++;
    else if (rec(w, 'ru2hy') || rec(w, 'hy2ru')) progress++;
    else fresh++;
  }
  $('stLearned').textContent = learned;
  $('stProgress').textContent = progress;
  $('stNew').textContent = fresh;
  renderLevel();

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
function showView(id) {
  for (const v of ['viewTrain', 'viewStats', 'viewSet']) $(v).hidden = v !== id;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.view === id));
  if (id === 'viewStats') renderStats();
  if (id === 'viewSet') openSettings();
  if (id === 'viewTrain' && !$('askControls').hidden) renderMic();
  window.scrollTo(0, 0);
}

function renderMode() {
  $('modeLabel').textContent = S.mode === 'ru2hy' ? 'Русский → Армянский' : 'Армянский → Русский';
}

function applyTheme() {
  document.documentElement.dataset.theme = S.theme;
  document.querySelector('meta[name="theme-color"]').content = S.theme === 'dark' ? '#15102B' : '#F4F1F8';
}

function bind() {
  $('mic').onclick = async () => {
    if (!S.key) { showView('viewSet'); return; }
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
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => showView(t.dataset.view));

  $('keySave').onclick = async () => {
    const key = $('keyInput').value.trim();
    const note = $('keyNote');
    if (!key) { S.key = ''; save(); note.textContent = 'Ключ удалён'; return; }
    note.textContent = 'Проверяю ключ…';
    try {
      if (await testKey(key)) {
        S.key = key; S.models = null; save();
        note.textContent = 'Ключ работает ✓ Голосовая проверка включена';
      } else note.textContent = 'Google не принял ключ — проверь, что скопирован целиком';
    } catch (e) {
      note.textContent = 'Нет связи — попробуй, когда будет интернет';
    }
  };
  $('themeBtn').onclick = () => { S.theme = S.theme === 'dark' ? 'light' : 'dark'; save(); applyTheme(); };
  $('resetBtn').onclick = () => {
    if (!confirm('Сбросить весь прогресс, уровни и статистику? Ключ останется.')) return;
    S.cards = {}; S.learned = {}; S.step = 0; S.streak = 0; S.best = 0;
    save(); renderStreak(); renderLevel(); showView('viewTrain'); nextCard();
  };

  window.addEventListener('online', () => { if (!$('askControls').hidden) renderMic(); });
  window.addEventListener('offline', () => { if (!$('askControls').hidden) renderMic(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopRec(); releaseMic(); } });
}

function openSettings() {
  $('keyInput').value = S.key;
  $('keyNote').textContent = S.key ? 'Ключ сохранён' : '';
  const models = S.models && S.models.length ? ' · модель: ' + S.models[0] : '';
  $('about').textContent = 'Слов в словаре: ' + WORDS.length + models;
}

async function init() {
  // старая тема из первой версии была тёмной по умолчанию — переводим на новую светлую
  if (!S.themeV2) { S.theme = 'light'; S.themeV2 = true; save(); }
  applyTheme();
  bind();
  renderMode();
  renderStreak();
  try {
    const res = await fetch('words.json', { cache: 'no-cache' });
    WORDS = (await res.json()).map(({ hy, ru }) => ({ hy, ru }));
  } catch (e) {
    $('prompt').textContent = 'Не удалось загрузить слова';
    return;
  }
  backfillLearned();
  save();
  renderLevel();
  nextCard();
  welcome();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
