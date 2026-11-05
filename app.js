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
  return { step: 0, mode: 'ru2hy', streak: 0, best: 0, cards: {}, learned: {}, key: '', theme: 'light', models: null, modelsAt: 0,
    ghToken: '', gistId: '', backupAt: 0, backupDirty: false, picked: {} };
}
function load() {
  try { return Object.assign(defaults(), JSON.parse(localStorage.getItem(STORE) || '{}')); }
  catch (e) { return defaults(); }
}
// progressChanged: false — когда сохраняем служебное (ключи, отметку о копии), а не прогресс
function save(progressChanged = true) {
  if (progressChanged) S.backupDirty = true;
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {}
}

let S = load();
let WORDS = [];

// ---------- уровни ----------
// каждый уровень — ещё 30 выученных слов: уровень 2 с 30 слов, 3 с 60, 4 с 90…
const WORDS_PER_LEVEL = 30;
const levelNeed = L => WORDS_PER_LEVEL * (L - 1);
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
  $('lvLabel').textContent = levelName(L);
  $('lvBar').style.width = pct + '%';
  $('lvWords').textContent = wordsTxt(n) + ' выучено';
  $('lvLeft').textContent = 'до следующего уровня: ' + left;
  $('stLvNum').textContent = 'Уровень ' + L;
  $('stLvName').textContent = levelName(L);
  $('stLvBar').style.width = pct + '%';
  $('stLvLeft').textContent = 'Ещё ' + wordsTxt(left) + ' до уровня ' + (L + 1) + ' «' + levelName(L + 1) + '»';
}

// ---------- выбор карточки (интервальное повторение) ----------
const cardKey = (w, mode = S.mode) => mode + ':' + w.hy;
const rec = (w, mode) => S.cards[cardKey(w, mode)];

// слова, отмеченные в словаре; ничего не отмечено — учим все
const pickedWords = () => WORDS.filter(w => S.picked[w.hy]);
const pool = () => { const p = pickedWords(); return p.length ? p : WORDS; };

// Колода: все слова выбранного набора по одному разу в случайном порядке, потом новая колода.
// Приоритет у всех одинаковый — ни ошибки, ни «выучено» на порядок не влияют.

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const buildDeck = words => shuffle(words.map(w => w.hy));

function pickWord(exclude) {
  const words = pool();
  const byHy = new Map(words.map(w => [w.hy, w]));
  const sig = words.map(w => w.hy).join('|');
  if (S.deckSig !== sig) { S.deckSig = sig; S.deck = []; }
  S.deck = (S.deck || []).filter(h => byHy.has(h));
  if (!S.deck.length) {
    S.deck = buildDeck(words);
    // на стыке колод не показываем то же слово дважды подряд
    if (exclude && S.deck.length > 1 && S.deck[0] === exclude.hy) S.deck.push(S.deck.shift());
  }
  const w = byHy.get(S.deck.shift());
  save(false);
  return w;
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
    r.due = S.step + 7 + (Math.random() * 2 | 0);
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
let autoNext = null;

const target = () => (S.mode === 'ru2hy' ? cur.hy : cur.ru);
const promptText = () => (S.mode === 'ru2hy' ? cur.ru : cur.hy);

function nextCard() {
  clearTimeout(autoNext);
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
  // «подумай ещё» над открытым ответом только путает — убираем
  if ($('verdict').classList.contains('bad')) setVerdict(null);
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
  const ov = buildOverlay(emoji, 'Привет, Жанна!', text, 'давай начнём');
  const close = () => { ov.classList.add('out'); setTimeout(() => ov.remove(), 350); };
  ov.querySelector('.btn').onclick = close;
}

// ---------- запись голоса ----------
let stream = null, recorder = null, chunks = [], recTimer = null;
let vadCtx = null, vadTimer = null;

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
  $('micLabel').textContent = 'Говори… я сам пойму, когда закончишь';
  $('note').textContent = '';
  recTimer = setTimeout(stopRec, 8000);
  watchSilence();
}

// автостоп: как только после речи наступает пауза ~0,7 с, запись останавливается сама
function watchSilence() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    vadCtx = vadCtx || new AC();
    const src = vadCtx.createMediaStreamSource(stream);
    const an = vadCtx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    const started = Date.now();
    let noise = 0.005, spoke = false, quietSince = 0;
    vadTimer = setInterval(() => {
      if (!recorder || recorder.state !== 'recording') { clearInterval(vadTimer); src.disconnect(); return; }
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const t = Date.now() - started;
      if (t < 250) { noise = Math.max(noise, rms); return; } // первые доли секунды — меряем фоновый шум
      const loud = rms > Math.max(0.02, noise * 2.5);
      if (loud) { spoke = true; quietSince = 0; }
      else if (spoke) {
        quietSince = quietSince || Date.now();
        if (Date.now() - quietSince > 700) stopRec();
      } else if (t > 5000) stopRec(); // так и не заговорила
    }, 50);
  } catch (e) {
    console.warn('Автостоп недоступен', e);
  }
}

function stopRec() {
  clearTimeout(recTimer);
  clearInterval(vadTimer);
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
    // через полторы секунды — следующая карточка сама (если ничего не нажали раньше)
    const same = cur;
    clearTimeout(autoNext);
    autoNext = setTimeout(() => { if (cur === same && !$('nextControls').hidden && !$('viewTrain').hidden) nextCard(); }, 1500);
  } else {
    if (!graded) grade('wrong');
    // если услышанное почти совпадает с ответом, не показываем его — это была бы подсказка
    setVerdict('bad', pick(TRY_AGAIN), res.sim < 0.5 ? res.heard : '');
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
  const pcm = trimSilence(out.getChannelData(0), rate);
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
  return { mime: 'audio/wav', data: bytesToB64(new Uint8Array(view.buffer)), seconds: pcm.length / rate };
}

// отрезаем тишину в начале и в конце (с запасом 0,15 с), чтобы файл был меньше и уходил быстрее
function trimSilence(pcm, rate) {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  if (peak < 0.01) return pcm;
  const thr = Math.max(0.015, peak * 0.08), pad = Math.round(rate * 0.15);
  let a = 0, b = pcm.length - 1;
  while (a < pcm.length && Math.abs(pcm[a]) < thr) a++;
  while (b > a && Math.abs(pcm[b]) < thr) b--;
  return pcm.subarray(Math.max(0, a - pad), Math.min(pcm.length, b + pad));
}

// ---------- проверка через Gemini ----------
const API = 'https://generativelanguage.googleapis.com/v1beta/';

// модель только записывает, что услышала, — правильный ответ ей НЕ показываем,
// иначе она «слышит» ожидаемое слово. Сравнивает уже само приложение.
function transcribePrompt() {
  if (S.mode === 'ru2hy') {
    return `На записи человек произносит одно армянское слово или короткое выражение (восточноармянский, возможно разговорное произношение).
Запиши армянскими буквами ровно то, что прозвучало. Не исправляй, не угадывай и не подбирай похожее слово — только услышанное.
Если речи нет или ничего не разобрать — пустая строка.`;
  }
  return `На записи человек произносит одно русское слово или короткое выражение.
Запиши по-русски ровно то, что прозвучало. Не исправляй и не подбирай похожее — только услышанное.
Если речи нет или ничего не разобрать — пустая строка.`;
}

// узнаём у Google, какие модели сейчас доступны по ключу; берём обычную «flash» — она точнее слышит армянский
async function getModels() {
  if (S.models && S.models.length && S.modelsV === 3 && Date.now() - S.modelsAt < 3 * 864e5) return S.models;
  try {
    const res = await fetch(API + 'models?pageSize=1000', { headers: { 'x-goog-api-key': S.key } });
    if (!res.ok) return FALLBACK_MODELS;
    const j = await res.json();
    const ver = n => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]);
    const names = (j.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''))
      .filter(n => /^gemini-\d+(\.\d+)?-flash(-lite)?(-preview)?(-[\d-]+)?$/.test(n))
      .sort((a, b) => (a.includes('preview') - b.includes('preview')) || (a.includes('lite') - b.includes('lite')) || (ver(b) - ver(a)));
    if (!names.length) return FALLBACK_MODELS;
    S.models = names.slice(0, 4);
    S.modelsAt = Date.now();
    S.modelsV = 3;
    save(false);
    return S.models;
  } catch (e) {
    return FALLBACK_MODELS;
  }
}

// перебираем модели, пока одна не ответит; сработавшую запоминаем первой
async function askGemini(parts, schema) {
  const models = await getModels();
  const errors = [];
  for (const m of models) {
    try {
      const out = await callGemini(m, parts, schema);
      if (S.models && S.models[0] !== m) { S.models = [m, ...S.models.filter(x => x !== m)]; save(false); }
      return out;
    } catch (e) {
      if (e.userMsg) throw e;
      errors.push(e.message);
      // модель пропала — в следующий раз перечитаем список
      if (/404|not found/i.test(e.message)) S.modelsAt = 0;
    }
  }
  throw new Error(errors.join(' | '));
}

async function checkAnswer(audio) {
  const out = await askGemini(
    [{ text: transcribePrompt() }, { inline_data: { mime_type: audio.mime, data: audio.data } }],
    { type: 'OBJECT', properties: { heard: { type: 'STRING' } }, required: ['heard'] }
  );
  const heard = String(out.heard || '').trim();
  const sim = similarity(heard, target());
  let correct = isMatch(heard, target());
  // для перевода на русский синонимы тоже засчитываем — это проверяем отдельным текстовым вопросом
  if (!correct && S.mode === 'hy2ru' && heard) correct = await sameMeaning(heard).catch(() => false);
  return { heard, correct, sim };
}

async function sameMeaning(heard) {
  const out = await askGemini(
    [{ text: `Армянское слово/выражение «${cur.hy}» переводится как «${cur.ru}». Ученица ответила по-русски: «${heard}».
Это тот же смысл (синоним, другая форма того же слова)? Если смысл другой — false.` }],
    { type: 'OBJECT', properties: { same: { type: 'BOOLEAN' } }, required: ['same'] }
  );
  return !!out.same;
}

// ---------- сравнение ответа с правильным ----------
function norm(s) {
  return (s || '').toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/և/g, 'եվ').replace(/է/g, 'ե').replace(/օ/g, 'ո') // армянские буквы, которые звучат одинаково
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

// варианты ответа: «զով / հով», «сфера, область», «снимать (кино)» → снимать
function variants(expected) {
  const base = expected.replace(/\([^)]*\)/g, ' ');
  return [expected, base, ...base.split(/[\/,;]/)].map(norm).filter(Boolean);
}

function levenshtein(a, b) {
  const A = [...a], B = [...b];
  let prev = Array.from({ length: B.length + 1 }, (_, j) => j);
  for (let i = 1; i <= A.length; i++) {
    const row = [i];
    for (let j = 1; j <= B.length; j++)
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[B.length];
}

// насколько услышанное похоже на правильный ответ: 1 — совпадает, 0 — ничего общего
function similarity(heard, expected) {
  const h = norm(heard);
  if (!h) return 0;
  return Math.max(...variants(expected).map(v => 1 - levenshtein(h, v) / Math.max([...h].length, [...v].length)));
}

// засчитываем, если совпало или отличается на мелочь (акцент, одна-две буквы в длинном слове)
function isMatch(heard, expected) {
  const h = norm(heard);
  if (!h) return false;
  return variants(expected).some(v => {
    const d = levenshtein(h, v), len = Math.max([...h].length, [...v].length);
    if (len <= 4) return d === 0; // короткие слова — только точно (բանտ ≠ բանկ)
    if (len <= 8) return d <= 1;
    return d / len <= 0.15;
  });
}

async function callGemini(model, parts, schema, noThinking) {
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema }
  };
  // «размышления» модели здесь не нужны и сильно замедляют ответ
  if (!noThinking) {
    const v = parseFloat((model.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]);
    body.generationConfig.thinkingConfig = v >= 3 ? { thinkingLevel: 'minimal' } : { thinkingBudget: 0 };
  }
  const res = await fetch(API + 'models/' + model + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': S.key },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 400 && /thinking/i.test(text) && !noThinking) return callGemini(model, parts, schema, true);
    if ((res.status === 400 && /api key/i.test(text)) || res.status === 401 || res.status === 403)
      throw userError('Ключ Gemini не подходит — проверь его в Профиле');
    if (res.status === 429) throw userError('Лимит Gemini пока исчерпан — отметь сама, позже голос снова заработает');
    let msg = text;
    try { msg = JSON.parse(text).error.message; } catch (e) {}
    throw new Error(model + ' ' + res.status + ': ' + String(msg).slice(0, 120));
  }
  const j = await res.json();
  const txt = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  try { return JSON.parse(txt.replace(/^```(json)?|```$/g, '').trim()); }
  catch (e) { throw new Error(model + ': непонятный ответ «' + txt.slice(0, 60) + '»'); }
}

async function testKey(key) {
  const res = await fetch(API + 'models?pageSize=1', { headers: { 'x-goog-api-key': key } });
  return res.ok;
}

// ---------- резервная копия в GitHub (закрытый gist) ----------
const GH = 'https://api.github.com/';
const GIST_FILE = 'armenian-trainer-progress.json';
const GIST_DESC = 'Армянский тренажёр — резервная копия прогресса';
const ghHeaders = token => ({ Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' });
const PROGRESS_FIELDS = ['step', 'mode', 'streak', 'best', 'cards', 'learned', 'theme', 'picked'];

// в копию идёт только прогресс — ключи Gemini и GitHub остаются на телефоне
function backupPayload() {
  const out = { v: 1, savedAt: Date.now() };
  for (const k of PROGRESS_FIELDS) out[k] = S[k];
  return JSON.stringify(out);
}

async function findGist(token) {
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(GH + 'gists?per_page=100&page=' + page, { headers: ghHeaders(token) });
    if (!res.ok) throw new Error('GitHub ' + res.status);
    const list = await res.json();
    const g = list.find(x => x.files && x.files[GIST_FILE]);
    if (g) return g.id;
    if (list.length < 100) break;
  }
  return '';
}

async function readGist(token, id) {
  const res = await fetch(GH + 'gists/' + id, { headers: ghHeaders(token) });
  if (!res.ok) throw new Error('GitHub ' + res.status);
  const f = (await res.json()).files[GIST_FILE];
  const content = f.truncated ? await (await fetch(f.raw_url)).text() : f.content;
  return JSON.parse(content);
}

// одна запись, которая каждый раз перезаписывается; keepalive — чтобы успело уйти при закрытии
async function uploadBackup(onClose) {
  if (!S.ghToken || !S.backupDirty || !WORDS.length) return;
  const content = backupPayload();
  const body = JSON.stringify(S.gistId
    ? { files: { [GIST_FILE]: { content } } }
    : { description: GIST_DESC, public: false, files: { [GIST_FILE]: { content } } });
  const opts = { method: S.gistId ? 'PATCH' : 'POST', headers: { ...ghHeaders(S.ghToken), 'Content-Type': 'application/json' }, body };
  const url = GH + 'gists' + (S.gistId ? '/' + S.gistId : '');
  let res;
  try {
    res = await fetch(url, onClose && new Blob([body]).size < 60000 ? { ...opts, keepalive: true } : opts);
  } catch (e) {
    res = await fetch(url, opts).catch(() => null); // если keepalive не поддержан — обычным запросом
  }
  if (!res || !res.ok) { console.warn('Копия не сохранилась', res && res.status); return; }
  if (!S.gistId) S.gistId = (await res.json()).id;
  S.backupDirty = false;
  S.backupAt = Date.now();
  save(false);
}

function restoreFrom(r) {
  for (const k of PROGRESS_FIELDS) if (r[k] !== undefined) S[k] = r[k];
  S.backupDirty = false;
  save(false);
  applyTheme(); renderMode(); renderStreak(); renderLevel(); renderPool(); nextCard();
}

async function connectBackup(token) {
  const note = $('ghNote');
  note.textContent = 'Подключаю…';
  try {
    const id = await findGist(token);
    S.ghToken = token;
    S.gistId = id;
    if (id) {
      const remote = await readGist(token, id);
      if ((remote.step || 0) > S.step) {
        const date = new Date(remote.savedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
        if (S.step === 0 || confirm('Нашёл копию прогресса от ' + date + ' — в ней больше ответов, чем на телефоне. Восстановить?')) {
          restoreFrom(remote);
          note.textContent = 'Прогресс восстановлен ✓ Копия подключена';
          return;
        }
      }
    }
    S.backupDirty = true;
    save(false);
    await uploadBackup(false);
    note.textContent = S.gistId ? 'Копия подключена ✓ Дальше она обновляется сама' : 'Не удалось сохранить копию — попробуй ещё раз';
  } catch (e) {
    note.textContent = /401|403/.test(e.message)
      ? 'GitHub не принял ключ — проверь, что он скопирован целиком и стоит галочка «gist»'
      : 'Не получилось подключиться (' + e.message + ')';
  }
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

// ---------- словарь ----------
let dictFilter = 'all';

function wordStatus(w) {
  if (S.learned[w.hy]) return 'learned';
  return rec(w, 'ru2hy') || rec(w, 'hy2ru') ? 'progress' : 'new';
}
const STATUS_TXT = { learned: 'выучено', progress: 'в процессе', new: 'новое' };

const blocks = () => {
  const m = new Map();
  for (const w of WORDS) (m.get(w.block) || m.set(w.block, []).get(w.block)).push(w);
  return [...m];
};
const openBlocks = new Set();
let poolChanged = false;

function setPicked(words, on) {
  for (const w of words) { if (on) S.picked[w.hy] = 1; else delete S.picked[w.hy]; }
  poolChanged = true;
  save();
  renderDict();
  renderPool();
}

// что сейчас в карточках: «все слова», название блока или число слов
function poolText() {
  const p = pickedWords();
  if (!p.length) return 'все слова';
  const full = blocks().filter(([, ws]) => ws.every(w => S.picked[w.hy]));
  const inFull = full.reduce((n, [, ws]) => n + ws.length, 0);
  if (full.length && inFull === p.length && full.length <= 2) return full.map(([n]) => n).join(' + ');
  return wordsTxt(p.length);
}
function renderPool() { $('poolLabel').textContent = 'Учу: ' + poolText(); }

function checkbox(state, onTap) {
  const c = document.createElement('button');
  c.className = 'chk' + (state ? ' ' + state : '');
  c.setAttribute('aria-label', 'Учить');
  c.onclick = e => { e.stopPropagation(); onTap(); };
  return c;
}

function wordRow(w) {
  const a = rec(w, 'ru2hy') || {}, b = rec(w, 'hy2ru') || {};
  const right = (a.right || 0) + (b.right || 0), wrong = (a.wrong || 0) + (b.wrong || 0);
  const st = wordStatus(w);
  const on = !!S.picked[w.hy];
  const it = document.createElement('div');
  it.className = 'item pickable';
  const toggle = () => setPicked([w], !on);
  it.onclick = toggle;
  const box = document.createElement('div');
  box.className = 'w';
  const hb = document.createElement('b'); hb.textContent = w.hy;
  const rs = document.createElement('span'); rs.textContent = w.ru;
  const bd = document.createElement('div');
  const badge = document.createElement('span'); badge.className = 'badge ' + st; badge.textContent = STATUS_TXT[st];
  bd.appendChild(badge);
  box.append(hb, rs, bd);
  const c = document.createElement('div');
  c.className = 'c';
  if (right || wrong) {
    const ok = document.createElement('span'); ok.className = 'ok'; ok.textContent = '✓ ' + right;
    const bad = document.createElement('span'); bad.className = 'bad'; bad.textContent = '✗ ' + wrong;
    c.append(ok, document.createElement('br'), bad);
  }
  it.append(checkbox(on ? 'on' : '', toggle), box, c);
  return it;
}

function renderDict() {
  const q = norm($('dictSearch').value);
  const match = w => (dictFilter === 'all' || wordStatus(w) === dictFilter) &&
    (!q || norm(w.hy).includes(q) || norm(w.ru).includes(q));
  const filtering = q || dictFilter !== 'all';
  const picked = pickedWords().length;
  $('dictCount').textContent = picked ? 'В карточках: ' + wordsTxt(picked) : 'Отметь блок или отдельные слова — карточки будут только из них. Сейчас учатся все слова.';
  $('dictClear').hidden = !picked;
  const list = $('dictList');
  list.innerHTML = '';
  let shown = 0;
  for (const [name, ws] of blocks()) {
    const rows = ws.filter(match);
    if (!rows.length) continue;
    shown += rows.length;
    const n = ws.filter(w => S.picked[w.hy]).length;
    const state = n === ws.length ? 'on' : n ? 'part' : '';
    const open = filtering || openBlocks.has(name);
    const h = document.createElement('div');
    h.className = 'blk' + (open ? ' open' : '') + (state ? ' sel' : '');
    h.onclick = () => { openBlocks.has(name) ? openBlocks.delete(name) : openBlocks.add(name); renderDict(); };
    const t = document.createElement('div');
    t.className = 't';
    const tb = document.createElement('b'); tb.textContent = name;
    const ts = document.createElement('span');
    ts.textContent = wordsTxt(ws.length) + ' · выучено ' + ws.filter(w => S.learned[w.hy]).length + (n && n < ws.length ? ' · отмечено ' + n : '');
    t.append(tb, ts);
    const chev = document.createElement('span'); chev.className = 'chev'; chev.textContent = '›';
    h.append(checkbox(state, () => setPicked(ws, state !== 'on')), t, chev);
    list.appendChild(h);
    if (!open) continue;
    const box = document.createElement('div');
    box.className = 'blk-words';
    for (const w of rows) box.appendChild(wordRow(w));
    list.appendChild(box);
  }
  if (!shown) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'Ничего не нашлось';
    list.appendChild(e);
  }
}

// ---------- интерфейс ----------
function showView(id) {
  for (const v of ['viewTrain', 'viewStats', 'viewDict', 'viewSet']) $(v).hidden = v !== id;
  const tabId = id === 'viewDict' ? 'viewStats' : id;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.view === tabId));
  if (id === 'viewStats') renderStats();
  if (id === 'viewDict') renderDict();
  if (id === 'viewSet') openSettings();
  if (id === 'viewTrain' && !$('askControls').hidden) renderMic();
  // поменялся выбор слов, а на экране слово не из него — сразу берём подходящее
  if (id === 'viewTrain' && poolChanged) { poolChanged = false; if (!graded && cur && !pool().includes(cur)) nextCard(); }
  window.scrollTo(0, 0);
}

function renderMode() {
  $('modeLabel').textContent = S.mode === 'ru2hy' ? 'RUS → ARM' : 'ARM → RUS';
}

function applyTheme() {
  document.documentElement.dataset.theme = S.theme;
  document.querySelector('meta[name="theme-color"]').content = S.theme === 'dark' ? '#15102B' : '#F4F1F8';
}

function bind() {
  $('mic').onclick = async () => {
    if (!S.key) { showView('viewSet'); return; }
    if (recorder && recorder.state === 'recording') { stopRec(); return; }
    // iPhone разрешает звук только прямо в момент нажатия — готовим анализатор тишины сразу
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      vadCtx = vadCtx || new AC();
      if (vadCtx.state === 'suspended') vadCtx.resume();
    } catch (e) {}
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
  // в словарь можно прийти из статистики или с карточек — туда же и возвращаемся
  let dictFrom = 'viewStats';
  const openDict = from => { dictFrom = from; $('dictBack').textContent = from === 'viewTrain' ? '‹ Карточки' : '‹ Статистика'; showView('viewDict'); };
  $('dictBtn').onclick = () => openDict('viewStats');
  $('dictBack').onclick = () => showView(dictFrom);
  $('dictSearch').oninput = renderDict;
  $('dictClear').onclick = () => setPicked(WORDS, false);
  $('poolLabel').onclick = () => openDict('viewTrain');
  document.querySelectorAll('.fchip').forEach(ch => ch.onclick = () => {
    dictFilter = ch.dataset.f;
    document.querySelectorAll('.fchip').forEach(x => x.classList.toggle('on', x === ch));
    renderDict();
  });

  $('keySave').onclick = async () => {
    const key = $('keyInput').value.trim();
    const note = $('keyNote');
    if (!key) { S.key = ''; save(false); note.textContent = 'Ключ удалён'; return; }
    note.textContent = 'Проверяю ключ…';
    try {
      if (await testKey(key)) {
        S.key = key; S.models = null; save(false);
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
  // закрытие или сворачивание приложения: отпускаем микрофон и обновляем резервную копию
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopRec(); releaseMic(); uploadBackup(true); }
  });
  window.addEventListener('pagehide', () => uploadBackup(true));

  $('ghSave').onclick = () => {
    const token = $('ghInput').value.trim();
    if (!token) { S.ghToken = ''; S.gistId = ''; save(false); $('ghNote').textContent = 'Резервная копия отключена'; return; }
    connectBackup(token);
  };
}

function openSettings() {
  $('keyInput').value = S.key;
  $('keyNote').textContent = S.key ? 'Ключ сохранён' : '';
  $('ghInput').value = S.ghToken;
  $('ghNote').textContent = !S.ghToken ? '' : S.backupAt
    ? 'Последняя копия: ' + new Date(S.backupAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    : 'Копия подключена';
  const models = S.models && S.models.length ? ' · модель: ' + S.models[0] : '';
  $('about').textContent = 'Слов в словаре: ' + WORDS.length + models;
}

async function init() {
  // старая тема из первой версии была тёмной по умолчанию — переводим на новую светлую
  if (!S.themeV2) { S.theme = 'light'; S.themeV2 = true; save(false); }
  applyTheme();
  bind();
  renderMode();
  renderStreak();
  try {
    const res = await fetch('words.json', { cache: 'no-cache' });
    WORDS = (await res.json()).map(({ hy, ru, block }) => ({ hy, ru, block: block || 'Без блока' }));
  } catch (e) {
    $('prompt').textContent = 'Не удалось загрузить слова';
    return;
  }
  backfillLearned();
  save(false);
  renderPool();
  renderLevel();
  nextCard();
  welcome();
  // если в прошлый раз копия не успела уйти при закрытии — досылаем сейчас
  uploadBackup(false);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
