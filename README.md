# Battling Ships

A 3-player hex-board strategy game, playable in any browser — no build step, no dependencies.

**[Play it here](https://flabongo.github.io/battling-ships/)**

## How to play

Three players — Circles, Squares, and Triangles — each hold a supply of Yellow, Red, and Blue pucks and battle for control of a 91-hex board.

- **Placing pucks**: click a puck in your tray, then click a highlighted hex in your front row to place it (up to once per turn). Each color costs coins from your bank: Yellow costs 1, Red costs 3, Blue costs 6.
- **Moving pucks**: click a puck on the board (up to twice per turn) to pick it up. Yellow moves 1 hex, Red moves 2, Blue moves 3. In a stack, clicking a puck moves it and everything stacked above it.
- **Routing multi-space moves**: for Red and Blue, hover to trace the exact path your puck hops along instead of just picking an end point — useful for landing on multiple opponents or coin piles in a single move. Hover back over an earlier hex to backtrack.
- **Capturing**: landing on an opponent's hex captures their whole stack there; those pucks return to their owner's tray. Landing on your own stack merges with it (any color mix, up to 3 per hex).
- **Coins**: coins rain onto empty tiles every 4 turns (watch the star token above the board — it flips yellow right before a drop). Land a puck on a coin tile to collect it into your bank.
- **Undo**: use the Undo button to step back through any number of moves.
- **Winning**: first player to place every Yellow, Red, and Blue puck from their tray wins.

Full rules are also available in-game via the "How to play" button.

## Running locally

No build step — just serve the three files:

```bash
npx serve .
# or any static file server, e.g.:
python3 -m http.server 8080
```

Then open the served `index.html` in a browser.

## Tech

Vanilla HTML, CSS, and JavaScript — a single hand-rolled SVG rendering engine for the hex grid, pieces, and animations. No frameworks, no build tools, no external dependencies.
