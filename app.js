// v1.2 — baked local dataset first, bake button, offline stroke cache, service worker
const RAW_DATA_URL = "https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/wordlists/inclusive/new/1.min.json";

const LS_KEYS = {
  settings: "hsk1_settings",
  progress: "hsk1_progress_v12",
  history: "hsk1_history",
  streak: "hsk1_streak",
  xp: "hsk1_xp",
  badges: "hsk1_badges",
  recordings: "hsk1_recordings",
  offlineWords: "hsk1_offline_words_v12",
  strokePrefix: "hw3_char_" // + codepoint hex
};

const LOCAL_DATA_URL = "data/hsk1_500.json"; // baked file

const settings = loadSettings() || {
  newPerDay: 15,
  maxReviews: 999,
  sessionMins: 60,
  showPinyin: true,
  darkTheme: true
};

applyTheme(settings.darkTheme);

const FALLBACK = [
  { s: "你好", i: { y: "nǐ hǎo" }, f:[{ m:["hello"] }], p: ["i"] },
  { s: "谢谢", i: { y: "xièxie" }, f:[{ m:["thanks; thank you"] }], p: ["i"] },
  { s: "对不起", i: { y: "duìbuqǐ" }, f:[{ m:["sorry"] }], p: ["i"] },
  { s: "请", i: { y: "qǐng" }, f:[{ m:["please; to invite"] }], p: ["v"] }
];

let WORDS = [];
let QUEUE = { new: [], review: [] };
let currentCard = null;
let flipped = false;

(async function init() {
  bindUI();
  await loadDataset();
  rebuildTodayQueue();
  updateDashboard();
  renderTagProgress();
  initStrokeUI();
})();

async function loadDataset() {
  // 1) Use baked local JSON
  try {
    const resLocal = await fetch(LOCAL_DATA_URL, { cache: "no-store" });
    if (resLocal.ok) {
      const data = await resLocal.json();
      if (Array.isArray(data) && data.length > 10) {
        WORDS = data.map((entry, idx) => normalizeEntry(entry, idx));
        setBakeStatus(true, `Local baked dataset: ${WORDS.length} words`);
        return;
      }
    }
  } catch {}
  // 2) Use Offline Pack (from v1.1 / bake button)
  const cached = localStorage.getItem(LS_KEYS.offlineWords);
  if (cached) {
    try {
      const arr = JSON.parse(cached);
      WORDS = arr.map((entry, idx) => normalizeEntry(entry, idx));
      setBakeStatus(true, `Loaded from Offline Pack: ${WORDS.length} words`);
      return;
    } catch {}
  }
  // 3) Last resort: online raw
  try {
    const res = await fetch(RAW_DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    WORDS = data.map((entry, idx) => normalizeEntry(entry, idx));
    setBakeStatus(false, `Loaded from internet: ${WORDS.length} (click Bake to save locally)`);
  } catch (e) {
    console.warn("Falling back to built-in sample:", e);
    WORDS = FALLBACK.map((e, idx) => normalizeEntry(e, idx));
    setBakeStatus(false, "Using minimal built‑in sample (go online then click Bake).");
  }
}

function setBakeStatus(ok, msg) {
  const el = document.getElementById("bake-status");
  if (el) el.textContent = msg;
}

// Normalize entries
function normalizeEntry(entry, idx) {
  // Works with drkameleon dataset + our fallback
  const pinyin = entry.i?.y || entry.y || "";
  const english = Array.isArray(entry.f?.[0]?.m) ? entry.f[0].m[0] : (entry.english || "");
  const pos = entry.p || [];
  const tag = deriveTag({ p: pos, s: entry.s });
  return {
    id: entry.s + "#" + idx,
    hanzi: entry.s,
    pinyin,
    english,
    pos,
    tag,
    example: makeExample(entry.s, pinyin, pos[0] || "n"),
  };
}

function deriveTag(e) {
  const p = (e.p && e.p[0]) || "";
  if (p === "q") return "measure word";
  if (p === "m") return "number";
  if (p === "r") return "pronoun";
  if (p === "v") return "verb";
  if (["a","ad","an","ag"].includes(p)) return "adjective";
  if (p === "t") return "time";
  return "general";
}

function makeExample(hanzi, pinyin, pos) {
  const templates = {
    v: [ `我${hanzi}。`, `他在${hanzi}。`, `我们现在${hanzi}。` ],
    a: [ `这个很${hanzi}。`, `今天的天气很${hanzi}。` ],
    r: [ `${hanzi}在这儿。`, `${hanzi}喜欢汉语。` ],
    m: [ `我有三${hanzi}书。`, `请给我一${hanzi}水。` ],
    q: [ `一${hanzi}人。`, `三${hanzi}苹果。` ],
    t: [ `我们${hanzi}见。`, `他${hanzi}来。` ],
    default: [ `这是${hanzi}。`, `我喜欢${hanzi}。` ]
  };
  const arr = templates[pos] || templates.default;
  return arr[Math.floor(Math.random() * arr.length)];
}

// ===== UI
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

function bindUI() {
  $all(".tab").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
  $("#card-area").addEventListener("click", () => {
    flipped = !flipped;
    $("#card-front").classList.toggle("hidden", flipped);
    $("#card-back").classList.toggle("hidden", !flipped);
  });
  $all(".srs-btn").forEach(b => b.addEventListener("click", () => grade(b.dataset.grade)));
  $("#start-15").addEventListener("click", () => { settings.newPerDay = parseInt($("#new-per-day").value || "15", 10); rebuildTodayQueue(true); switchTab("study"); nextCard(); });
  $("#start-reviews").addEventListener("click", () => { rebuildTodayQueue(false); switchTab("study"); nextCard(); });
  $("#start-guided").addEventListener("click", () => { switchTab("guided"); });
  $("#speak-word").addEventListener("click", () => speak(currentCard?.hanzi, parseFloat($("#rate").value)));
  $("#speak-sent").addEventListener("click", () => speak(currentCard?.example, parseFloat($("#rate").value)));

  // Settings
  $("#new-per-day").value = settings.newPerDay;
  $("#max-reviews").value = settings.maxReviews;
  $("#session-mins").value = settings.sessionMins;
  $("#show-pinyin").checked = settings.showPinyin;
  $("#dark-theme").checked = settings.darkTheme;
  $("#new-per-day").addEventListener("input", e => saveSettings({ newPerDay: parseInt(e.target.value, 10) }));
  $("#max-reviews").addEventListener("input", e => saveSettings({ maxReviews: parseInt(e.target.value, 10) }));
  $("#session-mins").addEventListener("input", e => saveSettings({ sessionMins: parseInt(e.target.value, 10) }));
  $("#show-pinyin").addEventListener("change", e => saveSettings({ showPinyin: e.target.checked }));
  $("#dark-theme").addEventListener("change", e => { saveSettings({ darkTheme: e.target.checked }); applyTheme(e.target.checked); });

  // Quizzes
  $all("[data-quiz]").forEach(b => b.addEventListener("click", () => startQuiz(b.dataset.quiz)));

  // Import/Export
  $("#export-csv").addEventListener("click", exportCSV);
  $("#import-csv").addEventListener("change", importCSV);

  // Recorder
  setupRecorder();

  // Baking & strokes
  $("#bake-data").addEventListener("click", bakeDataNow);
  $("#bake-data-2").addEventListener("click", bakeDataNow);
  $("#download-dataset").addEventListener("click", downloadCurrentDataset);
  $("#cache-strokes").addEventListener("click", cacheStrokes);
  $("#cache-strokes-2").addEventListener("click", cacheStrokes);

  // Guided controls
  $("#guided-begin").addEventListener("click", beginGuided);
  $("#guided-end").addEventListener("click", endGuided);
  $("#guided-skip").addEventListener("click", nextGuidedStage);
}

function switchTab(name) {
  $all(".panel").forEach(p => p.classList.remove("active"));
  $all(".tab").forEach(t => t.classList.remove("active"));
  $(`#${name}`).classList.add("active");
  $(`.tab[data-tab='${name}']`).classList.add("active");
}

function applyTheme(dark) {
  document.documentElement.style.setProperty("--bg", dark ? "#0b0f14" : "#f4f8ff");
  document.documentElement.style.setProperty("--panel", dark ? "#101722" : "#fff");
  document.documentElement.style.setProperty("--text", dark ? "#e5ecfa" : "#0b0f14");
}

function updateDashboard() {
  const prog = loadProgress();
  const due = Object.values(prog).filter(p => new Date(p.due) <= today()).length;
  const learned = Object.keys(prog).length;
  $("#today-stats").textContent = `Learned: ${learned} · Due today: ${due}`;
  $("#streak").textContent = `Streak: ${getStreak()}🔥`;
  $("#xp").textContent = `XP: ${getXP()} · Level ${levelFromXP(getXP())}`;
  renderBadges();
}

// ===== Queue & Study
function rebuildTodayQueue(includeNew=true) {
  const prog = loadProgress();
  const due = WORDS.filter(w => {
    const p = prog[w.id];
    return p && new Date(p.due) <= today();
  });
  let newOnes = [];
  if (includeNew) {
    const unseen = WORDS.filter(w => !prog[w.id]);
    newOnes = shuffle(unseen).slice(0, settings.newPerDay);
  }
  QUEUE.review = shuffle(due).slice(0, settings.maxReviews);
  QUEUE.new = newOnes;
  $("#queue-info").textContent = `Queue — New: ${QUEUE.new.length} · Review: ${QUEUE.review.length}`;
}

function nextCard() {
  if (QUEUE.review.length) currentCard = QUEUE.review.shift();
  else if (QUEUE.new.length) currentCard = QUEUE.new.shift();
  else { alert("All done for now! 🎉"); updateDashboard(); return; }

  flipped = false;
  $("#card-front").classList.remove("hidden");
  $("#card-back").classList.add("hidden");
  $("#hanzi").textContent = currentCard.hanzi;
  $("#pinyin").textContent = settings.showPinyin ? currentCard.pinyin : "• • •";
  $("#english").textContent = currentCard.english;
  $("#example").textContent = currentCard.example;
  $("#queue-info").textContent = `Queue — New: ${QUEUE.new.length} · Review: ${QUEUE.review.length}`;
}

function grade(gradeValue) {
  if (!currentCard) return;
  const prog = loadProgress();
  const now = today();
  const rec = prog[currentCard.id] || { reps: 0, interval: 0, EF: 2.5, due: now, lapses: 0 };
  const grade = parseInt(gradeValue, 10);

  if (grade < 3) { // fail
    rec.reps = 0;
    rec.interval = 1;
    rec.due = addDays(now, 1);
    rec.lapses = (rec.lapses || 0) + 1;
    addXP(5);
  } else {
    rec.reps += 1;
    if (rec.reps === 1) rec.interval = 1;
    else if (rec.reps === 2) rec.interval = 6;
    else rec.interval = Math.round(rec.interval * rec.EF);
    rec.EF = Math.max(1.3, rec.EF + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
    rec.due = addDays(now, rec.interval);
    addXP(10 + grade);
  }
  prog[currentCard.id] = rec;
  saveProgress(prog);
  nextCard();
}

// ===== Misc utils
function today() { const d = new Date(); d.setHours(0,0,0,0); return d; }
function addDays(date, n) { return new Date(date.getTime() + n * 86400000); }
function shuffle(arr) { return arr.slice().sort(() => Math.random() - 0.5); }

function loadProgress() { try { return JSON.parse(localStorage.getItem(LS_KEYS.progress)) || {}; } catch { return {}; } }
function saveProgress(obj) { localStorage.setItem(LS_KEYS.progress, JSON.stringify(obj)); }

function loadSettings() { try { return JSON.parse(localStorage.getItem(LS_KEYS.settings)); } catch { return null; } }
function saveSettings(patch) { const next = { ...(loadSettings() || settings), ...patch }; localStorage.setItem(LS_KEYS.settings, JSON.stringify(next)); Object.assign(settings, next); }

function getXP() { return parseInt(localStorage.getItem(LS_KEYS.xp) || "0", 10); }
function addXP(n) { localStorage.setItem(LS_KEYS.xp, String(getXP() + n)); updateDashboard(); }
function levelFromXP(xp) { return Math.floor(Math.sqrt(xp/50)) + 1; }
function getStreak() {
  const key = LS_KEYS.streak;
  const last = localStorage.getItem(key);
  const todayStr = new Date().toDateString();
  if (last !== todayStr) {
    localStorage.setItem(key, todayStr);
    const n = parseInt(localStorage.getItem(key + "_count") || "0", 10) + 1;
    localStorage.setItem(key + "_count", String(n));
    return n;
  }
  return parseInt(localStorage.getItem(key + "_count") || "1", 10);
}
function renderBadges() {
  const xp = getXP();
  const badges = [];
  if (xp >= 100) badges.push("Tone Trainee");
  if (xp >= 300) badges.push("Tone Master");
  if (xp >= 600) badges.push("HSK 1 Hero");
  $("#badges").innerHTML = badges.map(b => `<span class="badge">${b}</span>`).join("") || "—";
}

// ===== Quizzes (same as v1.1)
function startQuiz(type) {
  const area = $("#quiz-area");
  area.innerHTML = "";
  $("#quiz-recap").classList.add("hidden");
  const pool = shuffle(WORDS).slice(0, 10);
  if (type === "mcq") runMCQ(pool);
  if (type === "typing") runTyping(pool);
  if (type === "listening") runListening(pool);
  if (type === "matching") runMatching(pool);
  if (type === "cloze") runCloze(pool);
}

function runMCQ(pool) {
  const area = $("#quiz-area");
  let i = 0, correct = 0, mistakes = [];
  function render() {
    if (i >= pool.length) return finish();
    const w = pool[i];
    area.innerHTML = `<div class="quiz-card">
      <div class="quiz-q">${w.hanzi}</div>
      <div class="quiz-options"></div>
    </div>`;
    const opts = shuffle([w, ...randomOthers(w, 3)]).map(o => o.english);
    const box = area.querySelector(".quiz-options");
    opts.forEach(opt => {
      const btn = document.createElement("button");
      btn.className = "quiz-opt";
      btn.textContent = opt;
      btn.onclick = () => {
        if (opt === w.english) { btn.classList.add("correct"); correct++; }
        else { btn.classList.add("wrong"); mistakes.push(w); }
        setTimeout(()=> { i++; render(); }, 400);
      };
      box.appendChild(btn);
    });
  }
  function finish() { recap(correct, pool.length, mistakes); }
  render();
}

function runTyping(pool) {
  const area = $("#quiz-area");
  let i = 0, correct = 0, mistakes = [];
  function render() {
    if (i >= pool.length) return finish();
    const w = pool[i];
    area.innerHTML = `<div class="quiz-card">
      <div class="quiz-q">${w.hanzi} — type pinyin (with tones)</div>
      <input id="type-in" placeholder="e.g., nǐ hǎo" />
      <button id="submit" class="primary">Check</button>
      <div class="muted">Answer: ${w.pinyin}</div>
    </div>`;
    $("#submit").onclick = ()=>{
      const val = $("#type-in").value.trim();
      if (normalizePinyin(val) === normalizePinyin(w.pinyin)) { correct++; }
      else mistakes.push(w);
      i++; render();
    };
  }
  function finish() { recap(correct, pool.length, mistakes); }
  render();
}

function runListening(pool) {
  const area = $("#quiz-area");
  let i = 0, correct = 0, mistakes = [];
  function render() {
    if (i >= pool.length) return finish();
    const w = pool[i];
    area.innerHTML = `<div class="quiz-card">
      <button class="primary" id="play">🔊 Play</button>
      <div class="quiz-q">Type what you hear (hanzi or pinyin)</div>
      <input id="type-in" />
      <button id="submit" class="ghost">Check</button>
      <div class="muted">Target: ${w.hanzi} — ${w.pinyin}</div>
    </div>`;
    $("#play").onclick = ()=> speak(w.hanzi, 1);
    $("#submit").onclick = ()=> {
      const val = $("#type-in").value.trim();
      const ok = val === w.hanzi || normalizePinyin(val) === normalizePinyin(w.pinyin);
      if (ok) correct++; else mistakes.push(w);
      i++; render();
    };
  }
  function finish() { recap(correct, pool.length, mistakes); }
  render();
}

function runMatching(pool) {
  const area = $("#quiz-area");
  const left = pool.map(w => ({...w}));
  const right = shuffle(pool.map(w => w.english));
  area.innerHTML = `<div class="quiz-card">
    <div class="quiz-q">Match Hanzi → English</div>
    <div class="quiz-options"></div>
  </div>`;
  const box = area.querySelector(".quiz-options");
  left.forEach((w, idx) => {
    const sel = document.createElement("select");
    sel.innerHTML = `<option value="">${w.hanzi}</option>` + right.map(r => `<option>${r}</option>`).join("");
    sel.onchange = ()=> { w.choice = sel.value; }
    box.appendChild(sel);
  });
  const btn = document.createElement("button");
  btn.textContent = "Check";
  btn.className = "primary";
  btn.onclick = ()=> {
    const mistakes = left.filter(w => w.choice !== w.english);
    recap(pool.length - mistakes.length, pool.length, mistakes);
  };
  area.appendChild(btn);
}

function runCloze(pool) {
  const area = $("#quiz-area");
  let i = 0, correct = 0, mistakes = [];
  function render() {
    if (i >= pool.length) return finish();
    const w = pool[i];
    const sentence = w.example.replace(w.hanzi, "____");
    const options = shuffle([w, ...randomOthers(w, 3)]);
    area.innerHTML = `<div class="quiz-card">
      <div class="quiz-q">${sentence}</div>
      <div class="quiz-options"></div>
    </div>`;
    const box = area.querySelector(".quiz-options");
    options.forEach(o => {
      const btn = document.createElement("button");
      btn.className = "quiz-opt";
      btn.textContent = o.hanzi;
      btn.onclick = () => {
        if (o.hanzi === w.hanzi) { btn.classList.add("correct"); correct++; }
        else { btn.classList.add("wrong"); mistakes.push(w); }
        setTimeout(()=> { i++; render(); }, 400);
      };
      box.appendChild(btn);
    });
  }
  function finish() { recap(correct, pool.length, mistakes); }
  render();
}

function recap(correct, total, mistakes) {
  const box = $("#quiz-recap");
  box.classList.remove("hidden");
  box.innerHTML = `<strong>Score:</strong> ${correct}/${total}. Mistakes: ${mistakes.map(w=>w.hanzi).join("、") || "—"}`;
}

// Helpers
function randomOthers(exclude, n) {
  const pool = WORDS.filter(w => w.hanzi !== exclude.hanzi);
  return shuffle(pool).slice(0, n);
}
function normalizePinyin(p) { return (p || "").toLowerCase().replace(/\s+/g,"").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }

// ===== Recorder
let mediaRecorder, chunks = [];
async function setupRecorder() {
  if (!navigator.mediaDevices?.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => chunks.push(e.data);
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      chunks = [];
      const url = URL.createObjectURL(blob);
      $("#rec-playback").src = url;
    };
    $("#rec-start").onclick = () => { mediaRecorder.start(); $("#rec-start").disabled = true; $("#rec-stop").disabled = false; };
    $("#rec-stop").onclick = () => { mediaRecorder.stop(); $("#rec-start").disabled = false; $("#rec-stop").disabled = true; };
    $("#rec-save").onclick = saveRecording;
  } catch (e) {
    console.warn("Recorder init failed", e);
  }
}
function saveRecording() {
  const url = $("#rec-playback").src;
  if (!url) { alert("Record first."); return; }
  const target = $("#speak-target").value;
  const notes = $("#rec-notes").value.trim();
  const recs = JSON.parse(localStorage.getItem(LS_KEYS.recordings) || "{}");
  const list = recs[currentCard?.id || "misc"] || [];
  list.push({ when: new Date().toISOString(), target, url, notes });
  recs[currentCard?.id || "misc"] = list;
  localStorage.setItem(LS_KEYS.recordings, JSON.stringify(recs));
  $("#rec-notes").value = "";
  renderRecHistory();
  addXP(5);
}
function renderRecHistory() {
  const recs = JSON.parse(localStorage.getItem(LS_KEYS.recordings) || "{}");
  const list = recs[currentCard?.id || "misc"] || [];
  $("#rec-history").innerHTML = list.slice(-5).map(r => `<div class="muted">${new Date(r.when).toLocaleString()} — ${r.target} <audio src="${r.url}" controls></audio> <em>${r.notes||""}</em></div>`).join("");
}

// ===== Tag progress
function renderTagProgress() {
  const prog = loadProgress();
  const counts = {};
  for (const w of WORDS) {
    counts[w.tag] = counts[w.tag] || { learned: 0, total: 0 };
    counts[w.tag].total++;
    if (prog[w.id]) counts[w.tag].learned++;
  }
  const dom = $("#tag-progress");
  dom.innerHTML = Object.entries(counts).map(([tag, c]) => {
    const pct = Math.round((c.learned / c.total) * 100);
    return `<div>${tag}: ${c.learned}/${c.total} (${pct}%)</div>`;
  }).join("");
}

// ===== Bake data now (fetch + save + download baked file)
async function bakeDataNow() {
  const log = (msg)=> { const l = $("#bake-log"); if (l) l.textContent += msg + "\n"; const s = $("#bake-status"); if (s) s.textContent = msg; };
  log("Fetching official HSK1 (500) JSON...");
  try {
    const res = await fetch(RAW_DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    localStorage.setItem(LS_KEYS.offlineWords, JSON.stringify(data));
    log("Saved to Offline Pack (browser storage).");
    // offer a baked file for replacing /data/hsk1_500.json
    const baked = JSON.stringify(data);
    downloadFile("hsk1_500.json", "application/json", baked);
    log("Downloaded 'hsk1_500.json'. Replace the one in the app's /data folder.");
    // refresh app words in-session
    WORDS = data.map((entry, idx) => normalizeEntry(entry, idx));
    rebuildTodayQueue();
    renderTagProgress();
    updateDashboard();
  } catch (e) {
    log("Failed to fetch now. Ensure you're online and try again.");
  }
}

function downloadCurrentDataset() {
  const baked = WORDS.length ? JSON.stringify(WORDS, null, 2) : "[]";
  downloadFile("current_dataset.json", "application/json", baked);
}

function downloadFile(name, mime, content) {
  const blob = new Blob([content], {type: mime});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

// ===== Offline Stroke Cache
async function cacheStrokes() {
  const log = (msg)=> { const l = $("#stroke-log"); if (l) l.textContent += msg + "\n"; const s = $("#stroke-status"); if (s) s.textContent = msg; };
  if (WORDS.length < 10) { log("Load/bake dataset first."); return; }
  const uniqueChars = Array.from(new Set(WORDS.flatMap(w => [...w.hanzi]))).filter(ch => ch.trim());
  let ok = 0, fail = 0;
  for (const ch of uniqueChars) {
    const code = ch.codePointAt(0).toString(16);
    if (localStorage.getItem(LS_KEYS.strokePrefix + code)) { ok++; continue; }
    try {
      const url = `https://cdn.jsdelivr.net/npm/hanzi-writer-data@latest/${code}.json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      localStorage.setItem(LS_KEYS.strokePrefix + code, JSON.stringify(data));
      ok++;
      log(`Cached ${ch} (${code}) — ${ok}/${uniqueChars.length}`);
      await new Promise(r => setTimeout(r, 30)); // throttle a bit
    } catch (e) {
      fail++; log(`Skip ${ch}: ${e}`);
    }
  }
  log(`Done. Cached ${ok}/${uniqueChars.length}.`);
}

// Hook Hanzi Writer to use local cache first
function charDataLoader(char, onComplete) {
  const code = char.codePointAt(0).toString(16);
  const key = LS_KEYS.strokePrefix + code;
  const cached = localStorage.getItem(key);
  if (cached) {
    onComplete(JSON.parse(cached));
    return;
  }
  // Fallback to CDN
  fetch(`https://cdn.jsdelivr.net/npm/hanzi-writer-data@latest/${code}.json`)
    .then(r => r.json()).then(d => onComplete(d))
    .catch(()=> onComplete(null));
}

// ===== Guided session (same structure as v1.1)
let guidedTimer = null, guidedEndAt = null, guidedStageIndex = -1;
const GUIDED_STAGES = [
  { type: "new", count: 15 },
  { type: "review" },
  { type: "quiz", mode: "typing" },
  { type: "quiz", mode: "listening" },
  { type: "quiz", mode: "cloze" },
];

function beginGuided() {
  guidedStageIndex = -1;
  startTimer(settings.sessionMins || 60);
  nextGuidedStage();
}
function endGuided() { stopTimer(); showGuidedRecap(); }
function nextGuidedStage() {
  guidedStageIndex++;
  if (guidedStageIndex >= GUIDED_STAGES.length) return endGuided();
  const stage = GUIDED_STAGES[guidedStageIndex];
  $("#guided-stage").textContent = `Stage ${guidedStageIndex+1}/${GUIDED_STAGES.length} — ${stage.type.toUpperCase()}`;
  runStage(stage);
}
function runStage(stage) {
  const area = $("#guided-area");
  area.innerHTML = "";
  if (stage.type === "new" || stage.type === "review") {
    rebuildTodayQueue(stage.type === "new");
    area.appendChild($("#study").cloneNode(true));
    nextCard();
    const finishBtn = document.createElement("button");
    finishBtn.textContent = "Finish stage";
    finishBtn.className = "primary";
    finishBtn.onclick = nextGuidedStage;
    area.appendChild(finishBtn);
  } else if (stage.type === "quiz") {
    const qbox = document.createElement("div");
    qbox.id = "guided-quiz";
    area.appendChild(qbox);
    const original = document.getElementById("quiz-area"); const originalId = original.id;
    original.id = "quiz-area-original";
    const tempDiv = document.createElement("div"); tempDiv.id = "quiz-area"; qbox.appendChild(tempDiv);
    startQuiz(stage.mode);
    const finishBtn = document.createElement("button");
    finishBtn.textContent = "Finish stage";
    finishBtn.className = "primary";
    finishBtn.onclick = () => { tempDiv.remove(); original.id = originalId; nextGuidedStage(); };
    qbox.appendChild(finishBtn);
  }
}
function startTimer(mins) {
  const end = Date.now() + mins*60*1000; guidedEndAt = end;
  if (guidedTimer) clearInterval(guidedTimer);
  tickTimer(); guidedTimer = setInterval(tickTimer, 1000);
}
function stopTimer() { if (guidedTimer) clearInterval(guidedTimer); guidedTimer = null; }
function tickTimer() {
  const remain = Math.max(0, guidedEndAt - Date.now());
  const m = Math.floor(remain/60000).toString().padStart(2,"0");
  const s = Math.floor((remain%60000)/1000).toString().padStart(2,"0");
  $("#guided-timer").textContent = `${m}:${s}`;
  if (remain <= 0) endGuided();
}
function showGuidedRecap() {
  const box = $("#guided-recap"); box.classList.remove("hidden");
  const prog = loadProgress(); const learned = Object.keys(prog).length;
  box.innerHTML = `<strong>Session done!</strong> Words learned so far: ${learned}.`;
}

// ===== Stroke UI init
let writer, strokeIndex = 0;
function initStrokeUI() {
  const wbox = document.getElementById("writer");
  if (!wbox || !window.HanziWriter) return;
  try {
    writer = HanziWriter.create("writer", "你", {
      width: 320, height: 320, padding: 10, showCharacter: true, strokeAnimationSpeed: 1.2,
      charDataLoader: (char, ok)=> charDataLoader(char, ok)
    });
    document.getElementById("stroke-play").onclick = () => writer.animateCharacter();
    document.getElementById("stroke-prev").onclick = () => { stepChar(-1); };
    document.getElementById("stroke-next").onclick = () => { stepChar(1); };
    updateStrokeChar();
  } catch (e) {
    wbox.innerHTML = "<div class='muted' style='padding:12px'>Stroke animation requires internet or the cache. Use Cache strokes button.</div>";
  }
}
function updateStrokeChar() {
  if (!writer || WORDS.length === 0) return;
  const idx = Math.max(0, Math.min(WORDS.length-1, strokeIndex));
  const ch = WORDS[idx].hanzi[0];
  writer.setCharacter(ch);
}
function stepChar(delta) {
  strokeIndex += delta;
  if (strokeIndex < 0) strokeIndex = 0;
  if (strokeIndex >= WORDS.length) strokeIndex = WORDS.length-1;
  updateStrokeChar();
}

// ===== Import/Export CSV
function exportCSV() {
  const prog = loadProgress();
  const rows = [["simplified","pinyin","english","pos","tag","reps","interval","due","EF","lapses"]];
  for (const w of WORDS) {
    const p = prog[w.id] || {};
    rows.push([w.hanzi, w.pinyin, w.english, (w.pos||[]).join("/"), w.tag, p.reps||0, p.interval||0, p.due||"", p.EF||2.5, p.lapses||0]);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  downloadFile("hsk1_progress.csv", "text/csv", csv);
}
function importCSV(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const lines = reader.result.split(/\r?\n/).filter(Boolean);
    const header = lines.shift();
    const prog = loadProgress();
    for (const line of lines) {
      const cols = parseCSVLine(line);
      const [hanzi, pinyin, english, pos, tag, reps, interval, due, EF, lapses] = cols;
      const w = WORDS.find(x => x.hanzi === hanzi && x.pinyin === pinyin);
      if (!w) continue;
      prog[w.id] = {
        reps: parseInt(reps||"0",10), interval: parseInt(interval||"0",10),
        due: due || today(), EF: parseFloat(EF||"2.5"), lapses: parseInt(lapses||"0",10)
      };
    }
    saveProgress(prog);
    alert("Import complete.");
    updateDashboard();
  };
  reader.readAsText(file);
}
function parseCSVLine(s) {
  const out = []; let i = 0, cur = "", inQ = false;
  while (i < s.length) {
    const ch = s[i++];
    if (ch === '"') { if (inQ && s[i] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (ch === "," && !inQ) { out.push(cur); cur=""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// ===== Speech
function speak(text, rate=1) {
  if (!window.speechSynthesis) { alert("No speech synthesis support."); return; }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-CN"; u.rate = rate;
  speechSynthesis.speak(u);
}

// ===== Service Worker helper
// (sw.js caches app shell + data/hsk1_500.json to make the app fully offline)
