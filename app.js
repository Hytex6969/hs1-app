// v1.3.1 — removed Typing quiz; Listening hides answers; Matching uses click-pair matcher
const RAW_DATA_URL = "https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/wordlists/inclusive/new/1.min.json";

const LS_KEYS = {
  settings: "hsk1_settings",
  progress: "hsk1_progress_v131",
  streak: "hsk1_streak",
  xp: "hsk1_xp",
  badges: "hsk1_badges",
  offlineWords: "hsk1_offline_words_v12"
};

const LOCAL_DATA_URL = "data/hsk1_500.json";

const settings = loadSettings() || {
  newPerDay: 15,
  maxReviews: 999,
  sessionMins: 60,
  showPinyin: true,
  darkTheme: true
};

applyTheme(settings.darkTheme);

const FALLBACK = [
  { s: "你好", f:[{ i:{ y: "nǐ hǎo" }, m:["hello"] }], p: ["i"] },
  { s: "谢谢", f:[{ i:{ y: "xièxie" }, m:["thanks"] }], p: ["i"] },
  { s: "对不起", f:[{ i:{ y: "duìbuqǐ" }, m:["sorry"] }], p: ["i"] },
  { s: "请", f:[{ i:{ y: "qǐng" }, m:["please; to invite"] }], p: ["v"] }
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
})();

async function loadDataset() {
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
  const cached = localStorage.getItem(LS_KEYS.offlineWords);
  if (cached) {
    try {
      const arr = JSON.parse(cached);
      WORDS = arr.map((entry, idx) => normalizeEntry(entry, idx));
      setBakeStatus(true, `Loaded from Offline Pack: ${WORDS.length} words`);
      return;
    } catch {}
  }
  try {
    const res = await fetch(RAW_DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    WORDS = data.map((entry, idx) => normalizeEntry(entry, idx));
    setBakeStatus(false, `Loaded from internet: ${WORDS.length} (click Bake to save locally)`);
  } catch (e) {
    WORDS = FALLBACK.map((e, idx) => normalizeEntry(e, idx));
    setBakeStatus(false, "Using minimal built-in sample (go online then click Bake).");
  }
}

function setBakeStatus(ok, msg) {
  const el = document.getElementById("bake-status");
  if (el) el.textContent = msg;
}

function normalizeEntry(entry, idx) {
  const form = (entry.f && entry.f[0]) || {};
  const pinyin = form.i?.y || entry.i?.y || entry.y || "";
  const english = Array.isArray(form.m) ? form.m[0] : (entry.english || "");
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
  $("#speak-word").addEventListener("click", () => speak(currentCard?.hanzi, parseFloat($("#rate").value)));
  $("#speak-sent").addEventListener("click", () => speak(currentCard?.example, parseFloat($("#rate").value)));

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

  $all("[data-quiz]").forEach(b => b.addEventListener("click", () => startQuiz(b.dataset.quiz)));

  $("#export-csv").addEventListener("click", exportCSV);
  $("#import-csv").addEventListener("change", importCSV);

  $("#bake-data").addEventListener("click", bakeDataNow);
  $("#bake-data-2").addEventListener("click", bakeDataNow);
  $("#download-dataset").addEventListener("click", downloadCurrentDataset);
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
  $("#streak").textContent = `Streak: ${getStreak()}`;
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
  else { alert("All done for now."); updateDashboard(); return; }

  flipped = false;
  $("#card-front").classList.remove("hidden");
  $("#card-back").classList.add("hidden");
  $("#hanzi").textContent = currentCard.hanzi;
  $("#pinyin-front").textContent = settings.showPinyin ? currentCard.pinyin : "";
  $("#pinyin").textContent = currentCard.pinyin;
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

  if (grade < 3) {
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

// ===== Utilities
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
  $("#badges").innerHTML = badges.map(b => `<span class="badge">${b}</span>`).join("") || "";
}

// ===== Quizzes
function startQuiz(type) {
  const area = $("#quiz-area");
  area.innerHTML = "";
  $("#quiz-recap").classList.add("hidden");
  const pool = shuffle(WORDS).slice(0, 10);
  if (type === "mcq") runMCQ(pool);
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
      <div class="quiz-sub">${w.pinyin}</div>
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
        setTimeout(()=> { i++; render(); }, 350);
      };
      box.appendChild(btn);
    });
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
      <button class="primary" id="play">Play</button>
      <div class="quiz-q">Type what you hear (hanzi or pinyin)</div>
      <input id="type-in" />
      <button id="submit" class="ghost">Check</button>
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
  const items = shuffle(pool).slice(0, 6); // 6 pairs
  const left = items.map(w => ({ id: w.id, label: `${w.hanzi} — ${w.pinyin}`, w }));
  const right = shuffle(items.map(w => ({ id: w.id, label: w.english })));

  area.innerHTML = `<div class="quiz-card">
    <div class="quiz-q">Match pairs</div>
    <div style="display:flex; gap:8px;">
      <div id="leftCol"  style="flex:1; display:grid; gap:8px;"></div>
      <div id="rightCol" style="flex:1; display:grid; gap:8px;"></div>
    </div>
  </div>`;

  const leftCol  = $("#leftCol");
  const rightCol = $("#rightCol");
  let selected = null, matched = 0, mistakes = [];

  left.forEach(item => {
    const b = document.createElement("button");
    b.className = "quiz-opt";
    b.textContent = item.label;
    b.onclick = () => { if (b.disabled) return; selected = { ...item, btn: b }; };
    leftCol.appendChild(b);
  });

  right.forEach(item => {
    const b = document.createElement("button");
    b.className = "quiz-opt";
    b.textContent = item.label;
    b.onclick = () => {
      if (b.disabled || !selected) return;
      if (item.id === selected.id) {
        b.classList.add("correct"); selected.btn.classList.add("correct");
        b.disabled = true; selected.btn.disabled = true;
        matched++; selected = null;
        if (matched === items.length) recap(items.length, items.length, []);
      } else {
        b.classList.add("wrong"); selected.btn.classList.add("wrong");
        mistakes.push(selected.w);
        setTimeout(() => { b.classList.remove("wrong"); selected.btn.classList.remove("wrong"); selected = null; }, 350);
      }
    };
    rightCol.appendChild(b);
  });
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
      <div class="quiz-sub">Answer: ${w.hanzi} — ${w.pinyin}</div>
      <div class="quiz-options"></div>
    </div>`;
    const box = area.querySelector(".quiz-options");
    options.forEach(o => {
      const btn = document.createElement("button");
      btn.className = "quiz-opt";
      btn.textContent = `${o.hanzi}`;
      btn.onclick = () => {
        if (o.hanzi === w.hanzi) { btn.classList.add("correct"); correct++; }
        else { btn.classList.add("wrong"); mistakes.push(w); }
        setTimeout(()=> { i++; render(); }, 350);
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
  box.innerHTML = `<strong>Score:</strong> ${correct}/${total}. Mistakes: ${mistakes.map(w=>w.hanzi).join("、") || "None"}`;
}

// Helpers
function randomOthers(exclude, n) {
  const pool = WORDS.filter(w => w.hanzi !== exclude.hanzi);
  return shuffle(pool).slice(0, n);
}
function normalizePinyin(p) { return (p || "").toLowerCase().replace(/\s+/g,"").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }

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
    lines.shift();
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
  out.push(cur); return out;
}
function downloadFile(name, mime, content) {
  const blob = new Blob([content], {type: mime});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

// ===== Speech
function speak(text, rate=1) {
  if (!window.speechSynthesis) { alert("Speech synthesis not supported."); return; }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-CN"; u.rate = rate;
  speechSynthesis.speak(u);
}
