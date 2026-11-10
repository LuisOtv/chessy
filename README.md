# Chessy

**Game review with a coach, in your browser.** Type your Chess.com or Lichess username and Chessy loads your latest game, analyzes every move with Stockfish and walks you through it, Chess.com style.

**Live:** https://luisotv.github.io/chessy/

![Chessy](og-image.png)

## Features

- Latest game from **Chess.com** or **Lichess** (remembers your last username)
- **Stockfish 19** in WebAssembly, several engines in parallel; review at ~1 s per move, analysis up to 5 s with the top 3 lines
- Move classifications: brilliant, great, best, excellent, good, book, inaccuracy, mistake, miss, blunder
- Book moves from the Lichess opening database, with opening names
- Accuracy, estimated game rating and evaluation graph
- Talking coach with an AI voice (Kokoro, runs locally in the browser)
- Play moves for both sides to explore variations; click the engine's best move or any top line to play it
- Piece sets and board themes

## Run locally

```bash
python3 serve.py
```

Then open http://localhost:8765. `serve.py` sends the COOP/COEP headers that let WebAssembly use multiple threads (much faster AI voice). On GitHub Pages, `coi-serviceworker.js` does the same job.

The opening book (`openings.json`) is generated from [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) with `tools/build-openings.js`.

## Credits

- [Stockfish](https://stockfishchess.org/) via [stockfish.js](https://github.com/nmrugg/stockfish.js), GPL-3.0 (license in `engine/`)
- [chess.js](https://github.com/jhlywa/chess.js), BSD-2-Clause
- [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) via [kokoro-js](https://github.com/hexgrad/kokoro), Apache-2.0
- Opening names: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings), CC0
- Pieces: Vector Chess Pieces Pack by RhosGFX, CC0 (license in `pieces/`)
- Move classification icons: "brilliance" icon pack, extracted from chess.com
- UI icons: [Material Symbols](https://fonts.google.com/icons), Apache-2.0
- [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker), MIT
