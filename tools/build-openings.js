// Gera openings.json: { "<fen sem relógios>": "Nome da abertura" } a partir do chess-openings do Lichess.
// Posições intermediárias de cada linha também contam como teoria e herdam o nome do ancestral nomeado mais próximo.
const fs = require("fs"), path = require("path");
const dir = process.argv[2], out = process.argv[3];
const { Chess } = require(path.join(dir, "chess.js"));
const key = (g) => g.fen().split(" ").slice(0, 4).join(" ");
const lines = [];
for (const f of "abcde") {
  for (const line of fs.readFileSync(path.join(dir, f + ".tsv"), "utf8").trim().split("\n").slice(1)) {
    const [, name, pgn] = line.split("\t");
    const g = new Chess(), keys = [];
    let ok = true;
    for (const s of pgn.replace(/\d+\.(\.\.)?/g, " ").trim().split(/\s+/)) { if (!g.move(s)) { ok = false; break; } keys.push(key(g)); }
    if (ok) lines.push({ name, keys }); else console.error("falhou:", name);
  }
}
const named = {};
for (const { name, keys } of lines) { const k = keys[keys.length - 1]; if (!named[k] || name.length < named[k].length) named[k] = name; }
const map = { ...named };
for (const { keys } of lines) {
  let last = null;
  for (const k of keys) { if (named[k]) last = named[k]; else if (!map[k] && last) map[k] = last; }
}
fs.writeFileSync(out, JSON.stringify(map));
console.log(Object.keys(named).length, "nomeadas,", Object.keys(map).length, "posições no total");
