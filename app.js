"use strict";

/* ====== Configuração ====== */
const STOCKFISH_URL = "engine/stockfish-19-lite-single.js"; // Stockfish 19 WASM (lite, 1 thread)
/* ====== Personalização (peças, tabuleiro, ícones) — salva por navegador ====== */
const PIECE_SETS = {
  "modern-outline": { label: "Modern outline" },        // RhosGFX (CC0)
  modern:           { label: "Modern" },
  "wood-outline":   { label: "Wood outline" },
  wood:             { label: "Wood" },
  flat:             { label: "Silhouette" },
};
const BOARD_THEMES = {
  chesscom: { label: "Green",        light: "#eeeed2", dark: "#769656" },
  lime:     { label: "Lime",         light: "#fff2d4", dark: "#8cc936" },
  brown:    { label: "Brown",        light: "#f0d9b5", dark: "#b58863" },
  orange:   { label: "Orange",       light: "#fff2d4", dark: "#de925a" },
  blue:     { label: "Blue",         light: "#ffffff", dark: "#96dbff" },
  slate:    { label: "Slate",        light: "#dee3e6", dark: "#8ca2ad" },
};
// Motor com os mesmos padrões do Chess.com: revisão "Fast" (~1 s por lance), análise até 5 s com 3 linhas
const REVIEW_TIMES = { 1000: "Fast (~1 sec)", 3000: "Standard (~3 sec)" };
const ANALYSIS_TIMES = { 1000: "1 sec", 3000: "3 sec", 5000: "5 sec", 10000: "10 sec" };
const Settings = { pieces: "modern-outline", board: "chesscom", tts: "kokoro", coachVoice: "bm_fable", reviewTime: 1000, analysisTime: 5000, lines: 3 };
try { Object.assign(Settings, JSON.parse(localStorage.getItem("chessy.settings") || "{}")); } catch (_) { /* sem storage */ }
if (!PIECE_SETS[Settings.pieces]) Settings.pieces = "modern-outline";
if (!BOARD_THEMES[Settings.board]) Settings.board = "chesscom";
// Vozes do Kokoro, das mais suaves para as mais brilhantes
const KOKORO_VOICES = {
  bm_fable: "Fable · UK ♂", bm_george: "George · UK ♂", am_michael: "Michael · US ♂", am_fenrir: "Fenrir · US ♂",
  af_nicole: "Nicole · soft ♀", bf_emma: "Emma · UK ♀", af_bella: "Bella · US ♀", af_heart: "Heart · US ♀",
};
if (!["kokoro", "browser"].includes(Settings.tts)) Settings.tts = "kokoro";
if (!KOKORO_VOICES[Settings.coachVoice]) Settings.coachVoice = "bm_fable";
if (!REVIEW_TIMES[Settings.reviewTime]) Settings.reviewTime = 1000;
if (!ANALYSIS_TIMES[Settings.analysisTime]) Settings.analysisTime = 5000;
if (![1, 2, 3].includes(Settings.lines)) Settings.lines = 3;
delete Settings.lang; delete Settings.kokoroVoice; delete Settings.icons; delete Settings.voiceQuality; // chaves antigas
function saveSettings() { try { localStorage.setItem("chessy.settings", JSON.stringify(Settings)); } catch (_) { /* sem storage */ } }
function applyBoardTheme() {
  const th = BOARD_THEMES[Settings.board];
  document.documentElement.style.setProperty("--light", th.light);
  document.documentElement.style.setProperty("--dark", th.dark);
}
applyBoardTheme();

const PIECE_URL = (c, t, set = Settings.pieces) => `pieces/${set}/${c}${t.toUpperCase()}.svg`;

// Livro de aberturas (gerado do chess-openings do Lichess): fen sem relógios -> nome
let OPENINGS = {};
const openingsReady = fetch("openings.json").then((r) => r.json()).then((j) => { OPENINGS = j; }).catch(() => {});
const fenKey = (fen) => fen.split(" ").slice(0, 4).join(" ");

const CLASSES = {
  brilliant:  { label: "Brilliant",  color: "#1baca6" },
  great:      { label: "Great",      color: "#5c8bb0" },
  best:       { label: "Best",       color: "#81b64c" },
  excellent:  { label: "Excellent",  color: "#96bc4b" },
  good:       { label: "Good",       color: "#97af8b" },
  book:       { label: "Book",       color: "#a88865" },
  inaccuracy: { label: "Inaccuracy", color: "#f0c15c" },
  mistake:    { label: "Mistake",    color: "#e6912c" },
  miss:       { label: "Miss",       color: "#ff7769" },
  blunder:    { label: "Blunder",    color: "#ca3431" },
};
const SUMMARY_ORDER = ["brilliant", "great", "best", "excellent", "good", "book", "inaccuracy", "mistake", "miss", "blunder"];
const SUMMARY_DEFAULT = ["great", "best", "excellent", "mistake", "miss", "blunder"];

/* ====== Ícones de classificação (pacote brilliance_v2) ====== */
// O arquivo vai dentro de um <svg> para herdar os mesmos tamanhos de CSS em todos os lugares
const icon = (cls) => `<svg viewBox="0 0 18 19" aria-label="${CLASSES[cls].label}"><image href="icons/chesscom/${cls}.svg" width="18" height="19"/></svg>`;

/* ====== Estado ====== */
const S = {
  runId: 0, moves: [], fens: [], evals: [], quals: [], clocks: [], initClock: null,
  cur: 0, flipped: false, showBest: false, userColor: "w", headers: {}, avatars: {},
  voiceOn: true, analysisDone: false, phase: "summary", expanded: false, playTimer: null,
  main: null, branchBase: 0, sel: null, cache: new Map(), spoken: new Set(), // variação: S.main guarda a partida original
};

const $ = (id) => document.getElementById(id);
const el = {
  form: $("searchForm"), user: $("username"), btn: $("searchBtn"), modal: $("loginModal"), loginErr: $("loginErr"),
  app: $("app"), board: $("board"), arrows: $("arrows"), evalBar: $("evalBar"), evalFill: $("evalFill"), evalNum: $("evalNum"),
  top: $("playerTop"), bottom: $("playerBottom"), panel: document.querySelector(".panel"),
  coachText: $("coachText"), bestLine: $("bestLine"), lines: $("engineLines"), badge: $("moveBadge"), chip: $("evalChip"), avatar: $("avatar"),
  btnShowBest: $("btnShowBest"), btnNextBig: $("btnNextBig"), btnVoice: $("btnVoice"), btnStart: $("btnStart"), btnPlay: $("btnPlay"),
  summary: $("summary"), graphS: $("graphS"), graphR: $("graphR"), moves: $("moves"), status: $("status"),
  vSum: $("viewSummary"), vRev: $("viewReview"),
};
el.titleIcon = $("titleIcon");
el.titleIcon.innerHTML = icon("best");

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function status(msg, err) {
  el.status.textContent = msg || "";
  el.status.className = "status" + (msg ? " show" : "") + (err ? " err" : "");
}

/* ====== Busca de partida ====== */
async function fetchLatestPgn(platform, user) {
  if (platform === "lichess") {
    const r = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=1&clocks=true&evals=false&opening=false`,
      { headers: { Accept: "application/x-chess-pgn" } });
    if (r.status === 404) throw new Error("User not found on Lichess.");
    if (!r.ok) throw new Error("Lichess request failed (" + r.status + ").");
    const pgn = (await r.text()).trim();
    if (!pgn) throw new Error("This user has no games on Lichess.");
    return pgn;
  }
  const base = `https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}/games`;
  const ra = await fetch(base + "/archives");
  if (ra.status === 404) throw new Error("User not found on Chess.com.");
  if (!ra.ok) throw new Error("Chess.com request failed (" + ra.status + ").");
  const archives = (await ra.json()).archives || [];
  for (let i = archives.length - 1; i >= 0; i--) {
    const rg = await fetch(archives[i]);
    if (!rg.ok) continue;
    const games = ((await rg.json()).games || []).filter((g) => g.pgn && (!g.rules || g.rules === "chess"));
    if (games.length) {
      games.sort((a, b) => b.end_time - a.end_time);
      return games[0].pgn;
    }
  }
  throw new Error("No games found for this user.");
}

async function loadAvatars(platform, names) {
  if (platform !== "chesscom") return;
  await Promise.all(names.filter(Boolean).map(async (n) => {
    try {
      const r = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(n.toLowerCase())}`);
      if (r.ok) { const j = await r.json(); if (j.avatar) S.avatars[n.toLowerCase()] = j.avatar; }
    } catch (_) { /* sem avatar */ }
  }));
  renderPlayers(); renderSummary();
}

/* ====== Motor (Stockfish 19 WASM) ====== */
// Um processo do Stockfish (Web Worker, 1 thread)
class EngineWorker {
  constructor() { this.cb = null; this.lines = {}; this.turn = "w"; this.readyRes = null; this.busy = false; this.stopped = false; }
  async init() {
    this.worker = new Worker(STOCKFISH_URL);
    this.worker.onmessage = (e) => this.onLine(typeof e.data === "string" ? e.data : "");
    await new Promise((res) => { this.readyRes = res; this.worker.postMessage("uci"); });
    this.worker.postMessage("setoption name Hash value 16");
    await new Promise((res) => { this.readyRes = res; this.worker.postMessage("isready"); });
  }
  onLine(line) {
    if (line === "uciok" || line === "readyok") { const r = this.readyRes; this.readyRes = null; r && r(); return; }
    if (line.startsWith("info") && line.includes(" score ") && line.includes(" pv ") && !/bound/.test(line)) {
      const m = line.match(/score (cp|mate) (-?\d+)/);
      const pv = line.match(/ pv (.+)$/);
      const mpv = line.match(/multipv (\d+)/);
      if (m && pv) {
        const v = parseInt(m[2], 10) * (this.turn === "w" ? 1 : -1);
        this.lines[mpv ? mpv[1] : "1"] = { cp: m[1] === "cp" ? v : null, mate: m[1] === "mate" ? v : null, pv: pv[1].trim().split(/\s+/).slice(0, 10) };
      }
    } else if (line.startsWith("bestmove")) {
      const bm = line.split(" ")[1];
      const r = this.cb; this.cb = null;
      if (!r) return;
      const l1 = this.lines["1"];
      if (!l1 || this.stopped) return r(null); // interrompida: resultado raso, descarta
      const lines = Object.keys(this.lines).sort((a, b) => a - b).map((k) => this.lines[k]);
      r({ cp: l1.cp, mate: l1.mate, pv: l1.pv, best: bm && bm !== "(none)" ? bm : l1.pv[0], second: lines[1] || null, lines });
    }
  }
  analyze(fen, { movetime, multipv }) {
    return new Promise((res) => {
      this.cb = res; this.lines = {}; this.turn = fen.split(" ")[1]; this.stopped = false;
      this.worker.postMessage(`setoption name MultiPV value ${multipv}`);
      this.worker.postMessage("position fen " + fen);
      this.worker.postMessage(`go movetime ${movetime}`);
    });
  }
  stop() { if (this.cb) { this.stopped = true; this.worker.postMessage("stop"); } }
}

// Vários motores em paralelo (um por núcleo livre), cada um analisando uma posição diferente
const Engine = {
  pool: [], queue: [],
  async init() {
    if (this.pool.length) return;
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    this.pool = Array.from({ length: n }, () => new EngineWorker());
    await Promise.all(this.pool.map((w) => w.init()));
  },
  enqueue(fen, opts) { return new Promise((res) => { this.queue.push({ fen, opts, res }); this.pump(); }); },
  pump() {
    for (const w of this.pool) {
      if (w.busy || !this.queue.length) continue;
      const job = this.queue.shift();
      w.busy = true;
      w.analyze(job.fen, job.opts).then((r) => { w.busy = false; job.res(r); this.pump(); });
    }
  },
  stop() { this.queue.splice(0).forEach((j) => j.res(null)); this.pool.forEach((w) => w.stop()); },
};

// kind "review": partida analisada (~1 s); "analysis": lances que você joga no tabuleiro (até 5 s)
async function evalPosition(fen, kind = "review") {
  if (S.cache.has(fen)) return S.cache.get(fen);
  const g = new Chess(fen);
  let ev;
  if (g.in_checkmate()) ev = { cp: g.turn() === "w" ? -1000 : 1000, mate: null, best: null };
  else if (g.game_over()) ev = { cp: 0, mate: null, best: null };
  else {
    // pelo menos 2 linhas: a segunda é usada para achar os lances "ótimos"
    const opts = { movetime: kind === "analysis" ? Settings.analysisTime : Settings.reviewTime, multipv: Math.max(2, Settings.lines) };
    ev = await Engine.enqueue(fen, opts);
    if (!ev) return { cp: 0, mate: null, best: null }; // cancelada: não guarda no cache
  }
  S.cache.set(fen, ev);
  return ev;
}

/* ====== Avaliação / classificação ====== */
const cpOf = (e) => (e.mate !== null ? (e.mate > 0 ? 1 : -1) * 1000 : Math.max(-1000, Math.min(1000, e.cp)));
const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
const fmtEval = (e) => {
  if (!e) return "";
  if (e.mate !== null) return e.mate === 0 ? "#" : (e.mate > 0 ? "+M" : "-M") + Math.abs(e.mate);
  const v = e.cp / 100; return (v > 0 ? "+" : "") + v.toFixed(2);
};
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function sanOf(fen, uci) {
  if (!uci) return null;
  const m = new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
  return m ? m.san : null;
}

// Sacrifício: seguindo a melhor linha, o jogador fica com ao menos 2 pontos de material a menos
function isSacrifice(i) {
  const pv = S.evals[i - 1].pv;
  if (!pv || pv.length < 2) return false;
  const g = new Chess(S.fens[i - 1]);
  const mover = g.turn();
  const mat = () => { let s = 0; g.board().forEach((r) => r.forEach((p) => { if (p) s += (p.color === mover ? 1 : -1) * VAL[p.type]; })); return s; };
  const base = mat();
  let last = base;
  for (let k = 0; k < Math.min(pv.length, 3); k++) {
    if (!g.move({ from: pv[k].slice(0, 2), to: pv[k].slice(2, 4), promotion: pv[k][4] || undefined })) break;
    last = mat();
  }
  return last - base <= -2;
}

function quality(i) { // i = número do lance (1..n)
  if (S.quals[i]) return S.quals[i];
  const before = S.evals[i - 1], after = S.evals[i];
  if (!before || !after) return null;
  const mv = S.moves[i - 1];
  const sgn = mv.color === "w" ? 1 : -1;
  const wb = winPct(sgn * cpOf(before)), wa = winPct(sgn * cpOf(after));
  const loss = Math.max(0, wb - wa);
  const uci = mv.from + mv.to + (mv.promotion || "");
  const isBest = before.best === uci;
  const prevLoss = i > 1 ? (quality(i - 1) || { loss: 0 }).loss : 0;
  // Teoria = posição está no livro de aberturas e a partida ainda não saiu dele
  const opening = OPENINGS[fenKey(S.fens[i])];
  const prevBook = i === 1 || (quality(i - 1) || {}).cls === "book";
  let cls;
  if (opening && prevBook) cls = "book";
  else if (isBest && loss <= 2 && wa >= 45 && wb <= 92 && i > 6 && isSacrifice(i)) cls = "brilliant";
  else if (isBest) {
    const gap = before.second ? wb - winPct(sgn * cpOf(before.second)) : 0;
    cls = gap >= 13 && wb <= 92 && i > 6 ? "great" : "best";
  }
  else if (loss <= 2) cls = "excellent";
  else if (loss <= 5) cls = "good";
  else if (loss <= 10) cls = "inaccuracy";
  else if (prevLoss >= 10 && loss <= 25) cls = "miss";
  else if (loss <= 20) cls = "mistake";
  else cls = "blunder";
  const acc = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
  return (S.quals[i] = { cls, loss, acc, opening: cls === "book" ? opening : null, bestUci: before.best, bestSan: sanOf(S.fens[i - 1], before.best) });
}

/* ====== Tabuleiro ====== */
const FILES = "abcdefgh";

function renderBoard() {
  const idx = S.showBest ? S.cur - 1 : S.cur;
  const board = new Chess(S.fens[idx]).board();
  const hl = new Set(), hlBest = new Set();
  let badge = null;
  const mvPlayed = S.cur > 0 ? S.moves[S.cur - 1] : null;
  const q = S.cur > 0 && S.phase === "review" ? quality(S.cur) : null;
  if (mvPlayed && !S.showBest) { hl.add(mvPlayed.from); hl.add(mvPlayed.to); if (q) badge = { sq: mvPlayed.to, q }; }
  if (S.showBest && q) { hlBest.add(q.bestUci.slice(0, 2)); hlBest.add(q.bestUci.slice(2, 4)); }

  const interactive = canPlay() && !S.showBest;
  el.board.classList.toggle("playable", interactive);
  const tg = new Map();
  if (interactive && S.sel) new Chess(S.fens[S.cur]).moves({ square: S.sel, verbose: true }).forEach((m) => tg.set(m.to, !!m.captured));

  const frag = document.createDocumentFragment();
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const file = S.flipped ? 7 - c : c;
    const rank = S.flipped ? r + 1 : 8 - r;
    const name = FILES[file] + rank;
    const d = document.createElement("div");
    d.className = "sq " + ((file + rank) % 2 === 1 ? "l" : "d") + (hlBest.has(name) ? " hlBest" : hl.has(name) ? " hl" : "")
      + (interactive && S.sel === name ? " sel" : "") + (tg.has(name) ? (tg.get(name) ? " tgt cap" : " tgt") : "");
    d.dataset.sq = name;
    if (c === 0) { const s = document.createElement("span"); s.className = "coord rank"; s.textContent = rank; d.appendChild(s); }
    if (r === 7) { const s = document.createElement("span"); s.className = "coord file"; s.textContent = FILES[file]; d.appendChild(s); }
    const p = board[8 - rank][file];
    if (p) { const im = document.createElement("img"); im.className = "pc-" + p.type; im.src = PIECE_URL(p.color, p.type); im.alt = ""; im.draggable = false; d.appendChild(im); }
    if (badge && badge.sq === name) { const b = document.createElement("div"); b.className = "mbadge"; b.innerHTML = icon(badge.q.cls); d.appendChild(b); }
    frag.appendChild(d);
  }
  el.board.querySelectorAll(".sq").forEach((n) => n.remove());
  el.board.insertBefore(frag, el.arrows);

  el.arrows.innerHTML = "";
  if (S.showBest && q) {
    if (mvPlayed.from + mvPlayed.to !== q.bestUci.slice(0, 4)) drawArrow(mvPlayed.from, mvPlayed.to, "#ca3431", 0.75);
    drawArrow(q.bestUci.slice(0, 2), q.bestUci.slice(2, 4), "#81b64c", 0.92);
  }
}

function center(sq) {
  const file = FILES.indexOf(sq[0]), rank = +sq[1];
  const fx = S.flipped ? 7 - file : file, fy = S.flipped ? rank - 1 : 8 - rank;
  return [(fx + 0.5) * 100, (fy + 0.5) * 100];
}
function drawArrow(from, to, color, op) {
  const [x1, y1] = center(from), [x2, y2] = center(to);
  const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const head = 34, hw = 26;
  const bx = x2 - ux * (head + 6), by = y2 - uy * (head + 6);
  const tx = x2 - ux * 6, ty = y2 - uy * 6;
  const sx = x1 + ux * 18, sy = y1 + uy * 18;
  const ns = "http://www.w3.org/2000/svg";
  const g = document.createElementNS(ns, "g"); g.setAttribute("opacity", op);
  const l = document.createElementNS(ns, "line");
  l.setAttribute("x1", sx); l.setAttribute("y1", sy); l.setAttribute("x2", bx); l.setAttribute("y2", by);
  l.setAttribute("stroke", color); l.setAttribute("stroke-width", 16); l.setAttribute("stroke-linecap", "round");
  const p = document.createElementNS(ns, "polygon");
  p.setAttribute("points", `${tx},${ty} ${bx - uy * hw},${by + ux * hw} ${bx + uy * hw},${by - ux * hw}`);
  p.setAttribute("fill", color);
  g.append(l, p); el.arrows.appendChild(g);
}

/* ====== Barra de avaliação, jogadores, relógios ====== */
function renderEvalBar() {
  const e = S.evals[S.cur];
  const w = e ? winPct(cpOf(e)) : 50;
  el.evalBar.classList.toggle("flipped", S.flipped);
  el.evalFill.style.height = w + "%";
  // número no lado de quem está pior, como no Chess.com
  const whiteBetter = w >= 50;
  const atBottom = S.flipped ? !whiteBetter : whiteBetter;
  el.evalNum.textContent = e ? (e.mate !== null ? fmtEval(e).replace(/^[+-]/, "") : Math.abs(e.cp / 100).toFixed(1)) : "";
  el.evalNum.style.top = atBottom ? "auto" : "4px"; el.evalNum.style.bottom = atBottom ? "4px" : "auto";
  el.evalNum.style.color = whiteBetter ? "#403d39" : "#bdbbb7";
}

const fmtClock = (s) => {
  if (s == null) return "";
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
function clockAt(color, upto) {
  for (let k = upto; k >= 1; k--) if (S.moves[k - 1].color === color && S.clocks[k] != null) return S.clocks[k];
  return S.initClock;
}
function avatarUrl(name) { return S.avatars[(name || "").toLowerCase()]; }

function renderPlayers() {
  if (!S.fens.length) return;
  const h = S.headers;
  const bottomColor = S.flipped ? "b" : "w";
  const toMove = new Chess(S.fens[S.cur]).turn();
  const mk = (color) => {
    const n = color === "w" ? h.White : h.Black, r = color === "w" ? h.WhiteElo : h.BlackElo;
    const av = avatarUrl(n);
    const ck = S.main && S.cur > S.branchBase ? null : clockAt(color, S.cur); // variação não tem relógio
    const gameOver = S.cur === S.fens.length - 1;
    return `<div class="pav" ${av ? `style="background-image:url('${esc(av)}')"` : ""}></div>
      <div><span class="pname">${esc(n || "?")}</span><span class="prate">${r ? "(" + esc(r) + ")" : ""}</span></div>
      <div class="clock${ck == null ? " empty" : ""}${toMove === color && !gameOver ? " active" : ""}">${fmtClock(ck)}</div>`;
  };
  el.bottom.innerHTML = mk(bottomColor);
  el.top.innerHTML = mk(bottomColor === "w" ? "b" : "w");
}

/* ====== Gráfico (com pontos de erro) ====== */
function renderGraph() {
  const n = S.fens.length;
  if (!n) return;
  const W = 400, H = 60;
  const xs = (i) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const pts = [];
  for (let i = 0; i < n; i++) { const e = S.evals[i]; if (!e) break; pts.push([xs(i), H * (1 - winPct(cpOf(e)) / 100)]); }
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><rect width="${W}" height="${H}" fill="#3b3935"/>`;
  if (pts.length > 1) svg += `<polygon points="0,${H} ${pts.map((p) => p.join(",")).join(" ")} ${pts[pts.length - 1][0]},${H}" fill="#f5f5f5"/>`;
  svg += `<line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#888" stroke-width=".8" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>`;
  if (S.phase === "review") svg += `<line x1="${xs(S.cur)}" x2="${xs(S.cur)}" y1="0" y2="${H}" stroke="#81b64c" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  svg += "</svg>";
  let dots = "";
  if (S.analysisDone) {
    for (let i = 1; i < n; i++) {
      const q = quality(i);
      if (!q || !["brilliant", "great", "inaccuracy", "mistake", "miss", "blunder"].includes(q.cls)) continue;
      dots += `<span class="dot" style="left:${(xs(i) / W) * 100}%;top:${(pts[i][1] / H) * 100}%;background:${CLASSES[q.cls].color}"></span>`;
    }
  }
  const html = svg + dots;
  el.graphS.innerHTML = html; el.graphR.innerHTML = html;
}

/* ====== Resumo ====== */
function computeStats() {
  const sides = { w: { acc: [], c: {} }, b: { acc: [], c: {} } };
  S.moves.forEach((m, i) => {
    const q = quality(i + 1); if (!q) return;
    sides[m.color].acc.push(q.acc);
    sides[m.color].c[q.cls] = (sides[m.color].c[q.cls] || 0) + 1;
  });
  for (const k of ["w", "b"]) { const a = sides[k].acc; sides[k].avg = a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
  return sides;
}
const estRating = (acc) => Math.max(100, Math.round((Math.pow(acc / 100, 3) * 3000) / 50) * 50);

function renderSummary() {
  if (!S.analysisDone) { el.summary.innerHTML = ""; return; }
  const st = S.stats; // calculado só sobre a partida original
  const h = S.headers;
  const pav = (n) => { const a = avatarUrl(n); return `<div class="pav" ${a ? `style="background-image:url('${esc(a)}')"` : ""}></div>`; };
  let g = `<div class="sumGrid">
    <div class="lab">Players</div>
    <div class="pcol">${pav(h.White)}<span>${esc(h.White || "")}</span></div><div></div>
    <div class="pcol">${pav(h.Black)}<span>${esc(h.Black || "")}</span></div>
    <div class="lab">Accuracy</div>
    <div class="c"><div class="accBox">${st.w.avg.toFixed(1)}</div></div><div></div>
    <div class="c"><div class="accBox">${st.b.avg.toFixed(1)}</div></div>
    <hr class="rule">`;
  SUMMARY_ORDER.forEach((k) => {
    const a = st.w.c[k] || 0, b = st.b.c[k] || 0;
    if (!S.expanded && !SUMMARY_DEFAULT.includes(k) && !(k === "brilliant" && (a || b))) return;
    const col = (n) => `<div class="c cnt" style="color:${n ? CLASSES[k].color : "#7a7874"}">${n}</div>`;
    g += `<div class="lab">${CLASSES[k].label}</div>${col(a)}<div class="c ic">${icon(k)}</div>${col(b)}`;
  });
  g += `<button class="chev" id="btnChev" aria-label="Show more">${S.expanded ? "⌃" : "⌄"}</button>
    <hr class="rule">
    <div class="lab">Game Rating</div>
    <div class="c"><div class="ratingBox">${estRating(st.w.avg)}</div></div><div></div>
    <div class="c"><div class="ratingBox">${estRating(st.b.avg)}</div></div>
  </div>`;
  el.summary.innerHTML = g;
  $("btnChev").onclick = () => { S.expanded = !S.expanded; renderSummary(); };
}

/* ====== Lista de lances ====== */
// Notação com figurinhas, como no Chess.com: Nf3 -> ♞f3, e8=Q -> e8=♛
const FIGS = { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞" };
const FIG_NAME = { "♚": "king", "♛": "queen", "♜": "rook", "♝": "bishop", "♞": "knight" };
const figSan = (san) => (san ? san.replace(/^[KQRBN]/, (p) => FIGS[p]).replace(/=([QRBN])/, (_, p) => "=" + FIGS[p]) : san);
const figHtml = (san) => esc(figSan(san)).replace(/[♚♛♜♝♞]/g, (g) => `<span class="fig">${g}</span>`);
// Para a voz: "♞xe4+" -> "knight takes e4, check"
function speakable(t) {
  return t.replace(/O-O-O/g, "castles queenside").replace(/O-O/g, "castles kingside")
    .replace(/([a-h1-8♚♛♜♝♞])x([a-h][1-8])/g, "$1 takes $2")
    .replace(/=([♛♜♝♞])/g, (_, g) => ` promotes to ${FIG_NAME[g]}`)
    .replace(/[♚♛♜♝♞]/g, (g) => FIG_NAME[g] + " ")
    .replace(/\+/g, ", check").replace(/#/g, ", checkmate")
    .replace(/ {2,}/g, " ");
}
function renderMoves() {
  let html = "";
  const n = S.moves.length;
  for (let i = 0; i < n; i += 2) {
    const cell = (j) => {
      if (j >= n) return "<div></div>";
      const m = S.moves[j], q = quality(j + 1);
      const showIcon = q && ["brilliant", "great", "book", "inaccuracy", "mistake", "miss", "blunder"].includes(q.cls);
      const label = figHtml(m.san);
      const color = q && ["mistake", "miss", "blunder"].includes(q.cls) ? ` style="color:${CLASSES[q.cls].color}"` : "";
      const isVar = S.main && j + 1 > S.branchBase;
      return `<div class="mv${j + 1 === S.cur ? " active" : ""}${isVar ? " var" : ""}" data-i="${j + 1}"${color}>${showIcon ? icon(q.cls) : ""}${label}</div>`;
    };
    html += `<div class="mrow"><div class="num">${i / 2 + 1}.</div>${cell(i)}${cell(i + 1)}</div>`;
  }
  el.moves.innerHTML = html;
  const act = el.moves.querySelector(".active");
  if (act) {
    const box = el.moves.getBoundingClientRect(), r = act.getBoundingClientRect();
    if (r.top < box.top || r.bottom > box.bottom) el.moves.scrollTop += r.top - box.top - box.height / 2;
  }
}

/* ====== Coach ====== */
const Coach = {
  timer: null, speaking: false, typing: false,
  setTalking() { el.avatar.classList.toggle("talking", this.speaking || this.typing); },
  // O texto completo é renderizado desde o início (parte "ghost" invisível), então o layout nunca se mexe.
  // Trechos entre \u0001 e \u0002 viram lances clicáveis (jogam `uci` no tabuleiro).
  say(text, voice = true, uci = null) {
    clearInterval(this.timer);
    stopVoices();
    this.speaking = false; this.typing = true; this.setTalking();
    const segs = text.split(/(\u0001[^\u0002]*\u0002)/).filter(Boolean)
      .map((p) => (p[0] === "\u0001" ? { s: p.slice(1, -1), link: true } : { s: p }));
    const plain = segs.map((x) => x.s).join("");
    const wrap = (seg, t) => (seg.link && t ? `<a class="mvlink" data-uci="${esc(uci || "")}" title="Play this move on the board">${esc(t)}</a>` : esc(t));
    let i = 0;
    const paint = () => {
      let left = i, vis = "", ghost = "";
      for (const seg of segs) {
        const k = Math.max(0, Math.min(seg.s.length, left)); left -= k;
        vis += wrap(seg, seg.s.slice(0, k)); ghost += wrap(seg, seg.s.slice(k));
      }
      el.coachText.innerHTML = `${vis}<span class="ghost">${ghost}</span>`;
    };
    paint(); el.coachText.scrollTop = 0;
    this.timer = setInterval(() => {
      i += 2; paint();
      if (i >= plain.length) { clearInterval(this.timer); this.typing = false; this.setTalking(); }
    }, 22);
    if (!voice || !S.voiceOn) return;
    const talk = (on) => { this.speaking = on; this.setTalking(); };
    if (useKokoro()) {
      Kokoro.speak(speakable(plain), Settings.coachVoice, () => talk(true), () => talk(false));
    } else if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(speakable(plain));
      u.lang = "en-US"; u.rate = 1;
      const v = Voices.current();
      if (v) { u.voice = v; u.lang = v.lang; }
      u.onstart = () => { this.speaking = true; this.setTalking(); };
      u.onend = u.onerror = () => { this.speaking = false; this.setTalking(); };
      speechSynthesis.speak(u);
    }
  },
};
// escolha estável pelo texto do lance: a mesma fala pode ser pré-gerada e reaproveitada
const pick = (a, seed = "") => a[[...seed].reduce((h, c) => h + c.charCodeAt(0), 0) % a.length];

/* ====== Vozes: escolhe a mais natural disponível, com seletor manual ====== */
const Voices = {
  list: [], chosen: null,
  score(v) {
    let s = 0;
    if (/^en[-_]US/i.test(v.lang)) s += 100; else if (/^en/i.test(v.lang)) s += 60;
    if (/natural|neural|online/i.test(v.name)) s += 50;          // Edge/Windows: vozes neurais
    if (/google/i.test(v.name)) s += 30;                          // Chrome: voz do Google
    if (/aria|jenny|guy|samantha|ava|andrew|emma/i.test(v.name)) s += 20;
    if (/espeak|festival/i.test(v.name)) s -= 40;                 // vozes robóticas do Linux
    if (!v.localService) s += 5;
    return s;
  },
  refresh() {
    const all = speechSynthesis.getVoices();
    const mine = all.filter((v) => /^en/i.test(v.lang));
    this.list = (mine.length ? mine : all).slice().sort((a, b) => this.score(b) - this.score(a));
    const sel = $("voiceSel");
    let saved = null; try { saved = localStorage.getItem("chessy.voice"); } catch (_) {}
    sel.innerHTML = this.list.map((v, i) => `<option value="${esc(v.name)}">${esc(v.name.replace(/^(Microsoft|Google) /, ""))}${i === 0 ? " ★" : ""}</option>`).join("");
    if (saved && this.list.some((v) => v.name === saved)) sel.value = saved;
    this.chosen = this.list.find((v) => v.name === sel.value) || this.list[0] || null;
    sel.classList.toggle("hidden", this.list.length < 2 || useKokoro());
  },
  current() { return this.chosen; },
};
if ("speechSynthesis" in window) {
  Voices.refresh();
  speechSynthesis.addEventListener("voiceschanged", () => Voices.refresh());
  $("voiceSel").addEventListener("change", (e) => {
    Voices.chosen = Voices.list.find((v) => v.name === e.target.value) || null;
    try { localStorage.setItem("chessy.voice", e.target.value); } catch (_) {}
    Coach.say(T().test);
  });
} else $("voiceSel").classList.add("hidden");

/* ====== Voz por IA (Kokoro, roda no navegador num Web Worker) ====== */
const VOICE_SPEED = 1; // velocidade natural (mais lento soa mais artificial)
const useKokoro = () => Settings.tts === "kokoro" && !S.kokoroFailed;
const Kokoro = {
  worker: null, ready: false, ctx: null, token: 0, playing: [], pending: new Map(), expect: 0, total: 0, nextTime: 0,
  init() {
    if (this.worker) return;
    this.worker = new Worker("tts-worker.js", { type: "module" });
    this.worker.onmessage = (e) => this.onMsg(e.data);
    this.worker.onerror = (e) => this.fail(e.message || "worker");
    this.worker.postMessage({ type: "load" });
  },
  fail(why) {
    console.error("Kokoro:", why);
    S.kokoroFailed = true;
    status("Couldn't load the AI voice; using the browser voice.", true);
    setTimeout(() => status(""), 5000);
    if (this.onEnd) this.onEnd();
  },
  onMsg(m) {
    if (m.type === "progress") { if (!this.ready) status(`Downloading voice… ${Math.round(m.progress)}%`); }
    else if (m.type === "ready") { this.ready = true; status(""); }
    else if (m.type === "error") this.fail(m.message);
    else if (m.type === "audio" && m.token === this.token) { this.pending.set(m.idx, m); this.flush(); }
  },
  // Divide em frases: a primeira já toca enquanto as outras são geradas
  split: (text) => (text.match(/[^.!?…]+[.!?…]*/g) || [text]).map((x) => x.trim()).filter(Boolean),
  prefetch(text, voice) {
    if (!this.worker) return;
    this.split(text).forEach((t) => this.worker.postMessage({ type: "prefetch", text: t, voice, speed: VOICE_SPEED }));
  },
  speak(text, voice, onStart, onEnd) {
    this.init(); this.stop();
    const token = this.token;
    const parts = this.split(text);
    this.onStart = onStart; this.onEnd = onEnd; this.total = parts.length; this.expect = 0; this.nextTime = 0;
    this.ctx = this.ctx || new AudioContext();
    this.ctx.resume();
    parts.forEach((t, idx) => this.worker.postMessage({ type: "speak", token, idx, text: t, voice, speed: VOICE_SPEED }));
  },
  flush() {
    while (this.pending.has(this.expect)) {
      const m = this.pending.get(this.expect); this.pending.delete(this.expect);
      const buf = this.ctx.createBuffer(1, m.samples.length, m.rate);
      buf.copyToChannel(m.samples, 0);
      const src = this.ctx.createBufferSource();
      src.buffer = buf; src.connect(this.output());
      const at = Math.max(this.ctx.currentTime + 0.03, this.nextTime);
      src.start(at); this.nextTime = at + buf.duration;
      if (this.expect === 0 && this.onStart) this.onStart();
      const last = this.expect === this.total - 1, tok = this.token;
      src.onended = () => {
        this.playing = this.playing.filter((x) => x !== src);
        if (last && tok === this.token && this.onEnd) this.onEnd();
      };
      this.playing.push(src); this.expect++;
    }
  },
  // Deixa a voz mais "aveludada": mais calor nos graves, menos agudo estridente e menos sibilância
  output() {
    if (this.out) return this.out;
    const c = this.ctx, f = (type, freq, gain, Q = 0.8) => Object.assign(c.createBiquadFilter(), { type }, { _f: [freq, gain, Q] });
    const chain = [f("lowshelf", 220, 3), f("peaking", 3200, -5, 0.9), f("highshelf", 6500, -9), f("lowpass", 9000, 0)];
    chain.forEach((n) => { n.frequency.value = n._f[0]; n.gain.value = n._f[1]; n.Q.value = n._f[2]; });
    const vol = c.createGain(); vol.gain.value = 0.85;
    chain.reduce((a, b) => (a.connect(b), b)).connect(vol).connect(c.destination);
    return (this.out = chain[0]);
  },
  stop() {
    this.token++;
    if (this.worker) this.worker.postMessage({ type: "cancel", token: this.token });
    this.playing.forEach((x) => { try { x.onended = null; x.stop(); } catch (_) { /* já parou */ } });
    this.playing = []; this.pending.clear();
  },
};
function stopVoices() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  Kokoro.stop();
}

// Mensagens curtas e neutras, no estilo do Chess.com
const MSG = {
  is: { brilliant: "is brilliant", great: "is a great move", best: "is best", excellent: "is excellent", good: "is good",
        book: "is a book move", inaccuracy: "is an inaccuracy", mistake: "is a mistake", miss: "is a miss", blunder: "is a blunder" },
  lastBook: "is the last book move",
  mate: "is checkmate",
  bestLabel: "Best:",
  analyzing: "Analyzing the game…",
  summary: (mine, theirs) => `Accuracy: you ${mine}%, opponent ${theirs}%.`,
  start: "Let's review this game.",
  pending: (san) => `Analyzing ${san}…`,
  test: "Hi! This is my voice.",
};
const T = () => MSG;

function coachMessage(at = S.cur) {
  const L = T(), you = S.userColor;
  if (S.phase === "summary") {
    if (!S.analysisDone) return { text: L.analyzing };
    return { text: L.summary(S.stats[you].avg.toFixed(0), S.stats[you === "w" ? "b" : "w"].avg.toFixed(0)) };
  }
  if (at === 0) return { text: L.start };
  const i = at, mv = S.moves[i - 1], q = quality(i);
  const san = figSan(mv.san);
  if (!q) return { pending: true, text: L.pending(san) };
  if (new Chess(S.fens[i]).in_checkmate()) return { badge: q.cls, chip: "#", text: `${san} ${L.mate}` };
  let verb = L.is[q.cls];
  if (q.cls === "book") { const nq = i < S.moves.length ? quality(i + 1) : null; if (nq && nq.cls !== "book") verb = L.lastBook; }
  const showBest = q.bestSan && !["best", "book", "great", "brilliant"].includes(q.cls);
  return { badge: q.cls, chip: fmtEval(S.evals[i]), text: `${san} ${verb}`, best: showBest ? { san: figSan(q.bestSan), uci: q.bestUci } : null };
}

function updateCoach(mode = "say") { // "say" = texto + voz, "silent" = só texto, "none" = só controles
  const m = coachMessage();
  const q = S.phase === "review" && S.cur > 0 ? quality(S.cur) : null;
  const bc = m.badge && CLASSES[m.badge].color;
  el.avatar.style.setProperty("--mood", bc || "#81b64c");
  el.badge.innerHTML = m.badge ? icon(m.badge) : "";
  el.bestLine.innerHTML = m.best ? `${T().bestLabel} <a class="mvlink" data-uci="${esc(m.best.uci)}" title="Play this move on the board">${esc(m.best.san)}</a>` : "";
  el.chip.textContent = m.chip || "";
  el.btnShowBest.disabled = !(q && q.bestUci && !["best", "book", "great", "brilliant"].includes(q.cls));
  el.btnShowBest.textContent = S.showBest ? "Back" : "Best";
  el.btnNextBig.disabled = S.cur >= S.fens.length - 1;
  renderVarBar();
  // cada fala só é dita uma vez por partida
  if (mode === "say" && !m.pending) {
    const key = S.fens[S.cur] + "|" + m.text;
    if (S.spoken.has(key)) mode = "silent"; else S.spoken.add(key);
  }
  if (mode !== "none") Coach.say(m.text, mode === "say" && !m.pending);
  // já prepara a fala do próximo lance para o "Próximo" responder na hora
  if (mode === "say" && S.voiceOn && useKokoro() && S.phase === "review" && S.cur + 1 < S.fens.length) {
    const n = coachMessage(S.cur + 1);
    if (!n.pending) Kokoro.prefetch(speakable(n.text), Settings.coachVoice);
  }
}

function renderVarBar() {
  const vb = $("varBar");
  vb.classList.toggle("on", !!S.main);
  vb.innerHTML = S.main
    ? `<span>Variation from move ${Math.floor(S.branchBase / 2) + 1}</span><button id="btnBackMain" class="linkBtn">Back to game</button>`
    : "";
}

/* ====== Navegação ====== */
function render() { renderBoard(); renderEvalBar(); renderPlayers(); renderLines(); renderMoves(); renderGraph(); }

function renderLines() {
  const e = S.evals[S.cur];
  if (S.phase !== "review" || new Chess(S.fens[S.cur]).game_over()) { el.lines.innerHTML = ""; return; }
  const avail = e && e.lines ? e.lines.slice(0, Settings.lines) : [];
  const rows = (avail.length ? avail : Array(Settings.lines).fill(null)).map((l) => {
    if (!l) return `<div class="eline"><span class="echip w">…</span></div>`;
    const g = new Chess(S.fens[S.cur]);
    const [, turn, , , , full] = S.fens[S.cur].split(" ");
    let num = +full, white = turn === "w", txt = "";
    for (const [j, u] of l.pv.entries()) {
      const m = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
      if (!m) break;
      if (white) txt += `<span class="enum">${num}.</span>`; else if (j === 0) txt += `<span class="enum">${num}…</span>`;
      txt += figHtml(m.san) + " ";
      if (!white) num++;
      white = !white;
    }
    return `<div class="eline" data-uci="${esc(l.pv[0])}" title="Play this line"><span class="echip ${winPct(cpOf(l)) >= 50 ? "w" : "b"}">${fmtEval(l)}</span><span class="emoves">${txt}</span></div>`;
  });
  el.lines.innerHTML = rows.join("");
}
function goto(i, mode = "say") {
  const prev = S.cur;
  S.cur = Math.max(0, Math.min(S.fens.length - 1, i));
  if (S.main && S.cur <= S.branchBase) exitBranch(); // voltou para antes da variação: volta para a partida
  if (S.cur < prev && mode === "say") mode = "silent"; // voltando: sem repetir a voz
  S.showBest = false; S.sel = null;
  render(); updateCoach(mode);
}

/* ====== Variações: jogar pelos dois lados ====== */
const canPlay = () => S.phase === "review" && S.analysisDone;

function enterBranch(base) {
  S.main = { moves: S.moves, fens: S.fens, evals: S.evals, quals: S.quals };
  S.branchBase = base;
  S.moves = S.moves.slice(0, base); S.fens = S.fens.slice(0, base + 1);
  S.evals = S.evals.slice(0, base + 1); S.quals = S.quals.slice(0, base + 1);
}
function exitBranch() {
  if (!S.main) return S.cur;
  const base = S.branchBase;
  Object.assign(S, S.main);
  S.main = null; S.sel = null;
  return base;
}

function requestEval(idx) {
  const fen = S.fens[idx];
  evalPosition(fen, "analysis").then((ev) => {
    if (S.fens[idx] !== fen) return; // a linha mudou enquanto o motor pensava
    S.evals[idx] = ev;
    if (S.cur === idx || S.cur === idx + 1) { render(); updateCoach("say"); }
    else { renderMoves(); renderGraph(); }
  });
}

function playMove(from, to, promotion = "q") {
  const g = new Chess(S.fens[S.cur]);
  const m = g.move({ from, to, promotion });
  if (!m) return false;
  stopPlay(); S.sel = null; S.showBest = false;
  // se for o mesmo lance da linha atual, só avança
  const next = S.moves[S.cur];
  if (next && next.from === m.from && next.to === m.to && (next.promotion || "") === (m.promotion || "")) { goto(S.cur + 1); return true; }
  if (!S.main) enterBranch(S.cur);
  else {
    S.moves.length = S.cur; S.fens.length = S.cur + 1; S.evals.length = S.cur + 1; S.quals.length = S.cur + 1;
    S.branchBase = Math.min(S.branchBase, S.cur);
  }
  S.moves.push(m); S.fens.push(g.fen()); S.cur++;
  render(); updateCoach("say");
  requestEval(S.cur);
  return true;
}

const targetsFrom = (sq) => new Chess(S.fens[S.cur]).moves({ square: sq, verbose: true }).map((m) => m.to);

// Lance feito no tabuleiro: se for promoção, pergunta a peça antes de jogar
function userMove(from, to) {
  const promo = new Chess(S.fens[S.cur]).moves({ square: from, verbose: true }).some((m) => m.to === to && m.promotion);
  if (promo) askPromotion(from, to); else playMove(from, to);
}

const PROMO_PIECES = [["q", "Queen"], ["n", "Knight"], ["r", "Rook"], ["b", "Bishop"]];
function askPromotion(from, to) {
  const color = new Chess(S.fens[S.cur]).turn();
  const [cx, cy] = center(to);
  const ov = document.createElement("div");
  ov.className = "promoOverlay";
  const box = document.createElement("div");
  // a coluna nasce na casa de destino e cresce para dentro do tabuleiro
  box.className = "promoBox " + (cy < 400 ? "fromTop" : "fromBottom");
  box.style.left = Math.floor(cx / 100) * 12.5 + "%";
  for (const [p, label] of PROMO_PIECES) {
    const b = document.createElement("button");
    b.className = "promoPiece"; b.title = label; b.setAttribute("aria-label", label);
    b.innerHTML = `<img class="pc-${p}" src="${PIECE_URL(color, p)}" alt="">`;
    b.onclick = () => { ov.remove(); playMove(from, to, p); };
    box.appendChild(b);
  }
  // clicar fora cancela
  ov.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    if (e.target === ov) { ov.remove(); S.sel = null; renderBoard(); }
  });
  ov.appendChild(box);
  el.board.appendChild(ov);
}

el.board.addEventListener("pointerdown", (e) => {
  if (!canPlay() || S.showBest || e.button !== 0) return;
  const sqEl = e.target.closest(".sq"); if (!sqEl) return;
  const sq = sqEl.dataset.sq;
  if (S.sel && S.sel !== sq && targetsFrom(S.sel).includes(sq)) { userMove(S.sel, sq); return; }
  const g = new Chess(S.fens[S.cur]), p = g.get(sq);
  if (!p || p.color !== g.turn()) { if (S.sel) { S.sel = null; renderBoard(); } return; }
  e.preventDefault();
  S.sel = sq; renderBoard();
  startDrag(sq);
});

function startDrag(from) {
  const sqEl = el.board.querySelector(`[data-sq="${from}"]`), img = sqEl && sqEl.querySelector("img");
  if (!img) return;
  const ghost = img.cloneNode();
  ghost.className = "dragGhost";
  ghost.style.width = ghost.style.height = sqEl.getBoundingClientRect().width + "px";
  let moved = false;
  const move = (ev) => {
    if (!moved) { moved = true; document.body.appendChild(ghost); img.style.opacity = ".3"; }
    ghost.style.left = ev.clientX + "px"; ghost.style.top = ev.clientY + "px";
  };
  const up = (ev) => {
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
    ghost.remove(); img.style.opacity = "";
    if (!moved) return; // foi só um clique: a peça fica selecionada
    const t = document.elementFromPoint(ev.clientX, ev.clientY);
    const target = t && t.closest(".sq");
    if (target && target.dataset.sq !== from && targetsFrom(from).includes(target.dataset.sq)) userMove(from, target.dataset.sq);
  };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
}

// Clicar no lance sugerido pelo coach: volta uma posição e joga o melhor lance
el.bestLine.addEventListener("click", (e) => {
  const a = e.target.closest(".mvlink");
  if (!a || !a.dataset.uci || !canPlay() || S.cur < 1) return;
  const uci = a.dataset.uci;
  S.cur -= 1;
  if (!playMove(uci.slice(0, 2), uci.slice(2, 4), uci[4] || "q")) { S.cur += 1; }
});
el.lines.addEventListener("click", (e) => {
  const r = e.target.closest(".eline");
  if (!r || !r.dataset.uci || !canPlay()) return;
  const u = r.dataset.uci;
  playMove(u.slice(0, 2), u.slice(2, 4), u[4] || "q");
});
$("varBar").addEventListener("click", (e) => { if (e.target.id === "btnBackMain") goto(exitBranch()); });

function setPhase(p) {
  S.phase = p; stopPlay(); exitBranch();
  el.panel.classList.toggle("review", p === "review");
  el.vSum.classList.toggle("hidden", p !== "summary");
  el.vRev.classList.toggle("hidden", p !== "review");
  if (p === "summary") { S.cur = 0; S.showBest = false; render(); updateCoach("say"); }
  else goto(0);
}
const msIcon = (name) => `<span class="ms" aria-hidden="true">${name}</span>`;
function stopPlay() { clearInterval(S.playTimer); S.playTimer = null; el.btnPlay.innerHTML = msIcon("play_arrow"); }
function togglePlay() {
  if (S.playTimer) return stopPlay();
  if (S.cur >= S.fens.length - 1) goto(0, "silent");
  el.btnPlay.innerHTML = msIcon("pause");
  S.playTimer = setInterval(() => { if (S.cur >= S.fens.length - 1) return stopPlay(); goto(S.cur + 1, "silent"); }, 1400);
}

el.moves.addEventListener("click", (e) => { const t = e.target.closest(".mv"); if (t) { stopPlay(); goto(+t.dataset.i); } });
for (const g of [el.graphS, el.graphR]) g.addEventListener("click", (e) => {
  if (!S.analysisDone) return;
  const r = g.getBoundingClientRect();
  const i = Math.round(((e.clientX - r.left) / r.width) * (S.fens.length - 1));
  if (S.phase !== "review") { S.phase = "review"; setPhase("review"); }
  goto(i);
});
el.btnStart.onclick = () => setPhase("review");
$("btnBack").onclick = () => setPhase("summary");
$("btnFirst").onclick = () => { stopPlay(); goto(0); };
$("btnPrev").onclick = () => { stopPlay(); goto(S.cur - 1); };
$("btnNext").onclick = () => { stopPlay(); goto(S.cur + 1); };
$("btnLast").onclick = () => { stopPlay(); goto(S.fens.length - 1); };
el.btnNextBig.onclick = () => goto(S.cur + 1);
el.btnPlay.onclick = togglePlay;
$("btnFlip").onclick = flip;
function flip() { S.flipped = !S.flipped; render(); }
el.btnShowBest.onclick = () => { S.showBest = !S.showBest; renderBoard(); updateCoach("none"); };
el.btnVoice.onclick = () => {
  S.voiceOn = !S.voiceOn; el.btnVoice.innerHTML = msIcon(S.voiceOn ? "volume_up" : "volume_off");
  if (!S.voiceOn) stopVoices();
};
document.addEventListener("keydown", (e) => {
  if (el.app.classList.contains("hidden") || /INPUT|SELECT/.test(e.target.tagName)) return;
  if (e.key.toLowerCase() === "f") return flip();
  if (S.phase !== "review") return;
  if (e.key === "ArrowLeft") goto(S.cur - 1);
  else if (e.key === "ArrowRight") goto(S.cur + 1);
  else if (e.key === "Home") goto(0);
  else if (e.key === "End") goto(S.fens.length - 1);
});

/* ====== Fluxo principal ====== */
async function analyzeGame(runId) {
  const total = S.fens.length;
  let done = 0;
  await Promise.all(S.fens.map((fen, i) => evalPosition(fen).then((ev) => {
    if (runId !== S.runId) return;
    S.evals[i] = ev;
    el.btnStart.textContent = `Analyzing… ${Math.round((++done / total) * 100)}%`;
    if (i === S.cur) renderEvalBar();
    renderGraph();
  })));
  if (runId !== S.runId) return;
  S.analysisDone = true;
  S.stats = computeStats();
  el.btnStart.disabled = false; el.btnStart.textContent = "Start Review";
  renderSummary(); renderGraph(); renderMoves(); updateCoach("say");
}

function parseClocks(g) {
  S.clocks = []; S.initClock = null;
  const tc = (S.headers.TimeControl || "").match(/^(\d+)(?:\+\d+)?$/);
  if (tc) S.initClock = +tc[1];
  if (typeof g.get_comments !== "function") return;
  const map = {};
  g.get_comments().forEach((c) => { map[c.fen] = c.comment; });
  S.fens.forEach((f, i) => {
    const m = (map[f] || "").match(/\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]/);
    if (m) S.clocks[i] = +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
  });
}

/* ====== Modal de entrada (lembra o último nickname) ====== */
const platformValue = () => document.querySelector('input[name="platform"]:checked').value;
try {
  const last = JSON.parse(localStorage.getItem("chessy.lastUser") || "null");
  if (last) {
    el.user.value = last.user || "";
    const r = document.querySelector(`input[name="platform"][value="${last.platform}"]`);
    if (r) r.checked = true;
  }
} catch (_) { /* sem storage */ }
function openModal() {
  el.modal.classList.remove("hidden");
  el.loginErr.textContent = "";
  $("btnCloseModal").classList.toggle("hidden", !S.fens.length); // só dá para cancelar se já houver partida
  el.user.focus(); el.user.select();
}
function closeModal() { el.modal.classList.add("hidden"); }
$("btnNewGame").onclick = openModal;
$("btnCloseModal").onclick = closeModal;
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.modal.classList.contains("hidden") && S.fens.length) closeModal(); });
el.user.focus();

el.form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const user = el.user.value.trim(), platform = platformValue();
  if (!user) return;
  const runId = ++S.runId;
  Engine.stop(); stopPlay();
  el.btn.disabled = true; el.btn.textContent = "Fetching game…"; el.loginErr.textContent = "";
  let pgn;
  try {
    pgn = await fetchLatestPgn(platform, user);
  } catch (e) {
    console.error(e);
    if (runId === S.runId) el.loginErr.textContent = e.message || "Unexpected error.";
    return;
  } finally {
    el.btn.disabled = false; el.btn.textContent = "Review";
  }
  if (runId !== S.runId) return;
  try { localStorage.setItem("chessy.lastUser", JSON.stringify({ user, platform })); } catch (_) { /* sem storage */ }
  try {
    const g = new Chess();
    if (!g.load_pgn(pgn, { sloppy: true })) throw new Error("Couldn't read this game's PGN.");
    const hist = g.history({ verbose: true });
    if (!hist.length) throw new Error("The latest game has no moves.");
    closeModal();
    S.headers = g.header();
    const rep = new Chess(); S.fens = [rep.fen()];
    hist.forEach((m) => { rep.move({ from: m.from, to: m.to, promotion: m.promotion }); S.fens.push(rep.fen()); });
    S.main = null; S.sel = null; S.cache = new Map(); S.spoken = new Set();
    S.moves = hist; S.evals = []; S.quals = []; S.cur = 0; S.showBest = false; S.analysisDone = false; S.avatars = {}; S.expanded = false;
    parseClocks(g);
    S.userColor = (S.headers.Black || "").toLowerCase() === user.toLowerCase() ? "b" : "w";
    S.flipped = S.userColor === "b";
    el.app.classList.remove("hidden");
    $("btnNewGame").classList.remove("hidden");
    el.btnStart.disabled = true; el.btnStart.textContent = "Starting engine…";
    el.summary.innerHTML = "";
    setPhase("summary");
    loadAvatars(platform, [S.headers.White, S.headers.Black]);
    if (useKokoro() && S.voiceOn) Kokoro.init(); // baixa a voz enquanto o motor analisa
    await Promise.all([Engine.init(), openingsReady]);
    if (runId !== S.runId) return;
    await analyzeGame(runId);
  } catch (e) {
    console.error(e);
    if (el.modal.classList.contains("hidden")) { status(e.message || "Unexpected error.", true); setTimeout(() => status(""), 6000); }
    else el.loginErr.textContent = e.message || "Unexpected error.";
  }
});

/* ====== Menu de personalização ====== */
const pop = $("settingsPop"), btnSettings = $("btnSettings");
function renderSettings() {
  const th = BOARD_THEMES[Settings.board];
  const opt = (kind, key, inner, label) => {
    const on = Settings[kind] === key;
    return `<button class="sOpt${on ? " on" : ""}" data-kind="${kind}" data-key="${key}" aria-pressed="${on}">${inner}<span>${label}</span></button>`;
  };
  const pieces = Object.entries(PIECE_SETS).map(([k, v]) => opt("pieces", k,
    `<span class="sPrev"><span style="background:${th.light}"><img src="${PIECE_URL("w", "n", k)}" alt=""></span><span style="background:${th.dark}"><img src="${PIECE_URL("b", "n", k)}" alt=""></span></span>`, v.label)).join("");
  const boards = Object.entries(BOARD_THEMES).map(([k, v]) => opt("board", k,
    `<span class="sPrev"><span style="background:${v.light}"></span><span style="background:${v.dark}"></span></span>`, v.label)).join("");
  const seg = (kind, opts) => `<div class="sSeg">${opts.map(([k, label]) => `<button class="sOpt${String(Settings[kind]) === k ? " on" : ""}" data-kind="${kind}" data-key="${k}" aria-pressed="${String(Settings[kind]) === k}"><span>${label}</span></button>`).join("")}</div>`;
  const sel = (id, opts, cur) => `<select id="${id}" class="voiceSel wide">${Object.entries(opts).map(([k, v]) => `<option value="${k}"${String(cur) === k ? " selected" : ""}>${v}</option>`).join("")}</select>`;
  pop.innerHTML = `<h4>Engine</h4>
    <div class="sRow"><span>Review strength</span>${sel("setReviewTime", REVIEW_TIMES, Settings.reviewTime)}</div>
    <div class="sRow"><span>Analysis time</span>${sel("setAnalysisTime", ANALYSIS_TIMES, Settings.analysisTime)}</div>
    <div class="sRow"><span>Lines</span>${seg("lines", [["1", "1"], ["2", "2"], ["3", "3"]])}</div>
    <h4>Coach voice</h4>
    <div class="sRow"><span>Engine</span>${seg("tts", [["kokoro", "AI (Kokoro)"], ["browser", "Browser"]])}</div>
    ${Settings.tts === "kokoro" ? `<div class="sRow"><span>Voice</span><select id="coachVoice" class="voiceSel wide">${Object.entries(KOKORO_VOICES).map(([k, v]) => `<option value="${k}"${Settings.coachVoice === k ? " selected" : ""}>${v}</option>`).join("")}</select></div>` : ""}
    <button class="sTest" id="btnTestVoice">${msIcon("play_arrow")} Test voice</button>
    <h4>Pieces</h4><div class="sGrid">${pieces}</div>
    <h4>Board</h4><div class="sGrid last">${boards}</div>`;
}
function toggleSettings(open = pop.classList.contains("hidden")) {
  pop.classList.toggle("hidden", !open);
  btnSettings.setAttribute("aria-expanded", open);
  if (open) renderSettings();
}
btnSettings.onclick = () => toggleSettings();
pop.addEventListener("click", (e) => {
  const b = e.target.closest(".sOpt");
  if (!b) return;
  Settings[b.dataset.kind] = b.dataset.kind === "lines" ? +b.dataset.key : b.dataset.key;
  saveSettings(); applyBoardTheme(); renderSettings();
  if (b.dataset.kind === "tts") {
    stopVoices();
    if ("speechSynthesis" in window) Voices.refresh();
    if (useKokoro()) Kokoro.init();
  }
  if (S.fens.length) render();
});
pop.addEventListener("change", (e) => {
  if (e.target.id === "setReviewTime" || e.target.id === "setAnalysisTime") {
    Settings[e.target.id === "setReviewTime" ? "reviewTime" : "analysisTime"] = +e.target.value; saveSettings();
    return;
  }
  if (e.target.id !== "coachVoice") return;
  Settings.coachVoice = e.target.value; saveSettings();
  Coach.say(T().test);
});
pop.addEventListener("click", (e) => { if (e.target.closest("#btnTestVoice")) { S.voiceOn = true; el.btnVoice.innerHTML = msIcon("volume_up"); Coach.say(T().test); } });
// fecha ao clicar fora ou com Esc
document.addEventListener("pointerdown", (e) => {
  if (!pop.classList.contains("hidden") && !pop.contains(e.target) && !btnSettings.contains(e.target)) toggleSettings(false);
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") toggleSettings(false); });

if ("speechSynthesis" in window) speechSynthesis.getVoices();
