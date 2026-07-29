"use strict";

/* ===================== Constants ===================== */

const SVGNS = "http://www.w3.org/2000/svg";
// A visual edge of the big hexagon is made of R structural ring hexes plus
// the corner hex shared with the next edge, so a radius of R gives R+1
// hexagons per visible edge. We want 6 per edge, so R = 5.
const R = 5;
const HEX_SIZE = 48;
const BOARD_PIECE_R = HEX_SIZE * 0.62;
const BOARD_FAN_STEP = HEX_SIZE * 0.3;

const COLORS = {
  yellow: "#f2c14e",
  red: "#d94f4f",
  blue: "#4a7fd1",
};

const COLOR_ORDER = ["yellow", "red", "blue"];
const MOVE_RANGE = { yellow: 1, red: 2, blue: 3 };
const STARTING_COUNTS = { yellow: 7, red: 3, blue: 2 };
const PRICES = { yellow: 1, red: 3, blue: 6 };
const STARTING_BANK = 10;
const MAX_STACK = 3;

const DIRS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

const SHAPES = ["circle", "square", "triangle"];
const SHAPE_LABELS = { circle: "Circles", square: "Squares", triangle: "Triangles" };
const FRONT_ROW_CLASS = ["front-row-p0", "front-row-p1", "front-row-p2"];

/* ===================== Hex math ===================== */

function axialToCube(q, r) {
  return { x: q, y: -q - r, z: r };
}

function cubeDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}

function hexDistance(h1, h2) {
  return cubeDistance(axialToCube(h1.q, h1.r), axialToCube(h2.q, h2.r));
}

function hexKey(q, r) {
  return q + "," + r;
}

function cubeRound(x, y, z) {
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { x: rx, y: ry, z: rz };
}

// canonical straight hex line from a to b (inclusive of both), as a list of
// hex descriptors pulled from state.hexIndex where possible
function computeHexLine(a, b) {
  const n = hexDistance(a, b);
  const ac = axialToCube(a.q, a.r);
  const bc = axialToCube(b.q, b.r);
  const results = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    // tiny nudge avoids ties landing exactly on a hex edge
    const x = ac.x + (bc.x - ac.x) * t + 1e-6;
    const y = ac.y + (bc.y - ac.y) * t + 2e-6;
    const z = ac.z + (bc.z - ac.z) * t - 3e-6;
    const cube = cubeRound(x, y, z);
    const q = cube.x, r = cube.z;
    // fall back to a computed pixel position (not just {q,r}) in case
    // rounding lands one hex outside the board near an edge — every point
    // in this list must always have real x/y, or the hop animation math
    // downstream produces NaN and the piece appears to jump unpredictably
    results.push(state.hexIndex.get(hexKey(q, r)) || Object.assign({ q, r }, hexToPixel(q, r, HEX_SIZE)));
  }
  return results;
}

// smooth curve through every point (Catmull-Rom, converted to cubic bezier
// segments) — unlike a simple corner-rounded polyline, this still passes
// exactly through each point, so the curve stays centered on every hex it
// visits rather than cutting corners short of them
function catmullRomPathD(pts) {
  if (pts.length < 2) return "";
  if (pts.length === 2) {
    return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  }
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
  }
  return d;
}

function hexToPixel(q, r, size) {
  // pointy-top individual hexes -> flat-top overall hexagon (flat edge at bottom)
  return {
    x: size * Math.sqrt(3) * (q + r / 2),
    y: size * 1.5 * r,
  };
}

function hexCorners(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push({ x: cx + size * Math.cos(angle), y: cy + size * Math.sin(angle) });
  }
  return pts;
}

function pointsAttr(pts) {
  return pts.map((p) => p.x.toFixed(2) + "," + p.y.toFixed(2)).join(" ");
}

/* ===================== Board generation ===================== */

function generateAllHexes(radius) {
  const list = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      list.push({ q, r });
    }
  }
  return list;
}

function generateRingEdgeGroups(radius) {
  let hex = { q: DIRS[4].q * radius, r: DIRS[4].r * radius };
  const groups = [];
  for (let i = 0; i < 6; i++) {
    const group = [];
    for (let j = 0; j < radius; j++) {
      group.push(hex);
      hex = { q: hex.q + DIRS[i].q, r: hex.r + DIRS[i].r };
    }
    groups.push(group);
  }
  return groups;
}

/* ===================== SVG helpers ===================== */

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  if (attrs) {
    for (const k in attrs) el.setAttribute(k, attrs[k]);
  }
  return el;
}

function shapeElement(shape, color, size, opts) {
  opts = opts || {};
  const g = svgEl("g", {});
  let el;
  if (shape === "circle") {
    el = svgEl("circle", { cx: 0, cy: 0, r: size, class: "piece-shape" });
  } else if (shape === "square") {
    const s = size * 0.85;
    el = svgEl("rect", { x: -s, y: -s, width: s * 2, height: s * 2, rx: size * 0.18, class: "piece-shape" });
  } else {
    const s = size * 1.75;
    const pts = [
      { x: 0, y: -s * 0.62 },
      { x: s * 0.55, y: s * 0.42 },
      { x: -s * 0.55, y: s * 0.42 },
    ];
    el = svgEl("polygon", { points: pointsAttr(pts), class: "piece-shape" });
  }
  el.setAttribute("fill", color);
  if (opts.opacity != null) el.setAttribute("opacity", opts.opacity);
  g.appendChild(el);
  return g;
}

// a simple gold coin: outer disc, inner ring, vertical bar through the middle
function coinIcon(r, opts) {
  opts = opts || {};
  const g = svgEl("g", { class: "coin-icon" });
  if (opts.opacity != null) g.setAttribute("opacity", opts.opacity);
  g.appendChild(svgEl("circle", { cx: 0, cy: 0, r, fill: "#f2c14e", stroke: "#b8860b", "stroke-width": r * 0.1 }));
  g.appendChild(
    svgEl("circle", { cx: 0, cy: 0, r: r * 0.76, fill: "none", stroke: "#d9a63c", "stroke-width": r * 0.08 })
  );
  const barW = r * 0.3;
  const barH = r * 1.1;
  g.appendChild(
    svgEl("rect", { x: -barW / 2, y: -barH / 2, width: barW, height: barH, rx: r * 0.06, fill: "#d9a63c" })
  );
  return g;
}

// a coin with a price number stamped on top, used on tray stacks
function priceBadge(r, price) {
  const g = svgEl("g", { class: "price-badge" });
  g.appendChild(coinIcon(r, {}));
  const text = svgEl("text", { x: 0, y: r * 0.05, class: "price-badge-text" });
  text.textContent = price;
  g.appendChild(text);
  return g;
}

/* ===================== Sound ===================== */

let audioCtx = null;
function getAudioCtx() {
  if (audioCtx === null) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

// bright two-note chime for picking up coins
function playDing() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  [1318.5, 1975.5].forEach((freq, i) => {
    const t = now + i * 0.07;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.6);
  });
}

// filtered noise burst + low thump for a piece being destroyed
function playExplosion() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  const dur = 0.45;

  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const decay = Math.pow(1 - i / data.length, 2);
    data[i] = (Math.random() * 2 - 1) * decay;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1400, now);
  filter.frequency.exponentialRampToValueAtTime(140, now + dur);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.45, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  src.start(now);

  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(130, now);
  osc.frequency.exponentialRampToValueAtTime(36, now + 0.3);
  oscGain.gain.setValueAtTime(0.5, now);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
  osc.connect(oscGain);
  oscGain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.4);
}

/* ===================== Game state ===================== */

const state = {
  // key "q,r" -> {playerId, pieces: [{id, color}, ...]} (index 0 = bottom, last = top)
  board: new Map(),
  hexes: [], // all hex descriptors {q,r,x,y,corners,frontRowOwner}
  hexIndex: new Map(), // key -> hex descriptor
  players: [],
  currentPlayerIndex: 0,
  placedThisTurn: false,
  movesUsed: 0,
  // {type:'tray', color, playerId} | {type:'board', hexId, moveCount, colors, pieceIds, playerId}
  heldPiece: null,
  validTargets: new Set(),
  gameOver: false,
  boardOuterRadius: 0,
  nextPieceId: 1,
  // ids of pieces that have already been the subject of a move this turn
  movedPieceIds: new Set(),
  // stack of snapshots taken before each committed action, for Undo
  history: [],
  // key "q,r" -> number of coins sitting on that tile
  coins: new Map(),
  // the first-player token: which player holds it, and whether it's gone
  // yellow yet. It arrives grey, flips yellow at the end of that player's
  // turn (dropping coins), then passes on at the end of their next turn.
  starHolder: 0,
  starYellow: true,
  // bumped whenever state is restored, so in-flight animations know to
  // discard any deferred effect (e.g. crediting a bank) that is now stale
  animGeneration: 0,
  viewHalf: 0,
  // piece ids currently mid-hop-animation: already placed in the board
  // data model at their destination, but not yet drawn there
  hiddenPieceIds: new Set(),
};

function makePlayer(id, shape) {
  return {
    id,
    shape,
    label: SHAPE_LABELS[shape],
    tray: Object.assign({}, STARTING_COUNTS),
    bank: STARTING_BANK,
    frontRow: [],
    trayOrigin: null,
    trayNormal: null,
    trayTangent: null,
  };
}

/* ===================== Build geometry ===================== */

let svg, boardGroup, highlightHexes, coinsGroup, pathGroup, piecesGroup, traysGroup, tokenGroup, effectsGroup;

function buildGeometry() {
  const rawHexes = generateAllHexes(R);
  let maxExtent = 0;
  rawHexes.forEach((h) => {
    const { x, y } = hexToPixel(h.q, h.r, HEX_SIZE);
    const corners = hexCorners(x, y, HEX_SIZE);
    corners.forEach((c) => {
      maxExtent = Math.max(maxExtent, Math.hypot(c.x, c.y));
    });
    const desc = { q: h.q, r: h.r, x, y, corners, frontRowOwner: null, el: null };
    state.hexes.push(desc);
    state.hexIndex.set(hexKey(h.q, h.r), desc);
  });
  state.boardOuterRadius = maxExtent;

  const edgeGroups = generateRingEdgeGroups(R);
  // find bottom-most edge group (largest avg pixel y)
  let bottomIdx = 0;
  let bestY = -Infinity;
  edgeGroups.forEach((group, idx) => {
    const avgY =
      group.reduce((sum, h) => sum + hexToPixel(h.q, h.r, HEX_SIZE).y, 0) / group.length;
    if (avgY > bestY) {
      bestY = avgY;
      bottomIdx = idx;
    }
  });

  const playerEdgeIdx = [bottomIdx, (bottomIdx + 2) % 6, (bottomIdx + 4) % 6];

  state.players = SHAPES.map((shape, i) => makePlayer(i, shape));

  playerEdgeIdx.forEach((edgeIdx, playerId) => {
    const group = edgeGroups[edgeIdx];
    // the visual edge also includes the far corner hex, which structurally
    // starts the next ring group (see comment on R above)
    const cornerHex = edgeGroups[(edgeIdx + 1) % 6][0];
    const fullEdgeHexes = group.concat([cornerHex]);
    const player = state.players[playerId];
    let sumX = 0,
      sumY = 0;
    fullEdgeHexes.forEach((h) => {
      const desc = state.hexIndex.get(hexKey(h.q, h.r));
      desc.frontRowOwner = playerId;
      player.frontRow.push(desc);
    });
    // use all 6 visible edge hexes (including the far shared corner) so the
    // computed centerline is the true midpoint of the edge, not skewed
    // toward the near corner
    fullEdgeHexes.forEach((h) => {
      const p = hexToPixel(h.q, h.r, HEX_SIZE);
      sumX += p.x;
      sumY += p.y;
    });
    const avgX = sumX / fullEdgeHexes.length;
    const avgY = sumY / fullEdgeHexes.length;
    const len = Math.hypot(avgX, avgY) || 1;
    const normal = { x: avgX / len, y: avgY / len };
    // tangent chosen so the bottom player's row stays upright (angle 0)
    const tangent = { x: normal.y, y: -normal.x };
    const trayGap = BOARD_PIECE_R * 2.0;
    const origin = {
      x: normal.x * (state.boardOuterRadius + trayGap),
      y: normal.y * (state.boardOuterRadius + trayGap),
    };
    // rotate so local +X (the panel's long axis) points along tangent,
    // i.e. the panel sits parallel to the edge it belongs to
    const panelAngleDeg = (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI;
    player.trayNormal = normal;
    player.trayTangent = tangent;
    player.trayOrigin = origin;
    player.trayAngleDeg = panelAngleDeg;
  });
}

/* ===================== Rendering ===================== */

function initSVG() {
  svg = document.getElementById("board-svg");
  // pad must clear the tray gap, the panel's own half-extent (worst case a
  // corner), and the first-player token sitting beside the row
  const pad = BOARD_PIECE_R * 2.0 + PANEL_HALF_DIAG + BOARD_PIECE_R * 1.0;
  const half = state.boardOuterRadius + pad;
  state.viewHalf = half;
  svg.setAttribute("viewBox", `${-half} ${-half} ${half * 2} ${half * 2}`);

  boardGroup = svgEl("g", { id: "board-hexes" });
  coinsGroup = svgEl("g", { id: "board-coins" });
  pathGroup = svgEl("g", { id: "move-path" });
  piecesGroup = svgEl("g", { id: "board-pieces" });
  traysGroup = svgEl("g", { id: "trays" });
  tokenGroup = svgEl("g", { id: "first-player-token" });
  effectsGroup = svgEl("g", { id: "board-effects" });

  svg.appendChild(boardGroup);
  svg.appendChild(coinsGroup);
  svg.appendChild(pathGroup);
  svg.appendChild(piecesGroup);
  svg.appendChild(traysGroup);
  svg.appendChild(tokenGroup);
  svg.appendChild(effectsGroup);

  state.hexes.forEach((h) => {
    const poly = svgEl("polygon", {
      points: pointsAttr(h.corners),
      class: "hex",
      "data-q": h.q,
      "data-r": h.r,
    });
    if (h.frontRowOwner != null) {
      poly.classList.add("front-row", FRONT_ROW_CLASS[h.frontRowOwner]);
    }
    poly.addEventListener("click", () => onHexClick(h));
    poly.addEventListener("mouseenter", () => onHexHover(h));
    boardGroup.appendChild(poly);
    h.el = poly;
  });

  renderTrays();
  renderPieces();
  renderToken();
  updateStatusBar();
  // the star starts yellow on player 1, so the very first turn already
  // qualifies for a coin drop before anyone has moved
  maybeDropCoinsForTurnStart();

  document.getElementById("finish-turn-btn").addEventListener("click", finishTurn);
  document.getElementById("undo-btn").addEventListener("click", undo);
  document.getElementById("restart-btn").addEventListener("click", () => location.reload());
  document.getElementById("legend-toggle").addEventListener("click", () => {
    document.getElementById("legend-modal").classList.remove("hidden");
  });
  document.getElementById("legend-close").addEventListener("click", () => {
    document.getElementById("legend-modal").classList.add("hidden");
  });
  document.getElementById("legend-backdrop").addEventListener("click", () => {
    document.getElementById("legend-modal").classList.add("hidden");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.getElementById("legend-modal").classList.add("hidden");
      cancelHeldPiece();
    }
  });
  document.addEventListener("mousemove", onMouseMove);
}

// tray pieces render at the same size as pieces on the board
const PIECE_R = BOARD_PIECE_R;
const FAN_STEP = BOARD_FAN_STEP;
const MAX_COL_WIDTH = PIECE_R * 2 + (STARTING_COUNTS.yellow - 1) * FAN_STEP;
const COL_SPACING = MAX_COL_WIDTH + PIECE_R * 0.5;
const PANEL_ROW_WIDTH = COL_SPACING * (COLOR_ORDER.length - 1) + MAX_COL_WIDTH + PIECE_R * 0.6;
const PANEL_HALF_H = PIECE_R * 1.3;
const BANK_GAP = PIECE_R * 0.6;
const BANK_COIN_R = PIECE_R * 0.42;
// the bank display sticks out below the panel, so it extends the panel's
// effective half-height for padding purposes
const PANEL_TOTAL_HALF_H = PANEL_HALF_H + BANK_GAP + BANK_COIN_R * 2.5;
const PANEL_HALF_DIAG = Math.hypot(PANEL_ROW_WIDTH / 2, PANEL_TOTAL_HALF_H);

function renderTrays() {
  traysGroup.innerHTML = "";
  state.players.forEach((player) => {
    const g = svgEl("g", { class: "tray-panel", "data-player": player.id });
    const rowWidth = PANEL_ROW_WIDTH;
    const panelHalfH = PANEL_HALF_H;
    const bg = svgEl("rect", {
      x: -rowWidth / 2,
      y: -panelHalfH,
      width: rowWidth,
      height: panelHalfH * 2,
      rx: 10,
      class: "player-panel-bg",
    });
    if (player.id === state.currentPlayerIndex) bg.classList.add("active");
    const transform = `translate(${player.trayOrigin.x}, ${player.trayOrigin.y}) rotate(${player.trayAngleDeg})`;
    g.setAttribute("transform", transform);
    g.appendChild(bg);

    COLOR_ORDER.forEach((color, i) => {
      const anchorX = (i - (COLOR_ORDER.length - 1) / 2) * COL_SPACING;
      const slotG = svgEl("g", { class: "tray-slot" });
      const count = player.tray[color];
      const price = PRICES[color];
      const isActivePlayer = player.id === state.currentPlayerIndex;
      const affordable = player.bank >= price;
      const clickable =
        isActivePlayer &&
        !state.gameOver &&
        count > 0 &&
        affordable &&
        !state.placedThisTurn &&
        !(state.heldPiece && state.heldPiece.type === "board");
      // pieces stay fully opaque regardless of whose turn it is; only
      // affordability (can't buy it at all) or the active player briefly
      // being unable to act (already placed / mid-move) dims them
      let opacity = 1;
      if (count === 0) opacity = 0.3;
      else if (!affordable) opacity = 0.4;
      else if (isActivePlayer && !clickable) opacity = 0.65;

      // the "top" (frontmost, last-drawn) piece of the fan is the far end
      const topX = count > 1 ? anchorX + ((count - 1) * FAN_STEP) / 2 : anchorX;

      if (count > 0) {
        const startX = anchorX - ((count - 1) * FAN_STEP) / 2;
        for (let j = 0; j < count; j++) {
          const shapeG = shapeElement(player.shape, COLORS[color], PIECE_R, { opacity });
          shapeG.setAttribute("transform", `translate(${startX + j * FAN_STEP}, 0) rotate(${-player.trayAngleDeg})`);
          slotG.appendChild(shapeG);
        }
      } else {
        // whole stack has been placed: show a translucent ghost tile in its spot
        const ghost = shapeElement(player.shape, COLORS[color], PIECE_R, { opacity: 0.28 });
        ghost.setAttribute("transform", `translate(${anchorX}, 0) rotate(${-player.trayAngleDeg})`);
        slotG.appendChild(ghost);
      }

      // price coin is centered on the top piece of the stack (or the ghost)
      const badge = priceBadge(PIECE_R * 0.5, price);
      badge.setAttribute("transform", `translate(${topX}, 0) rotate(${-player.trayAngleDeg})`);
      slotG.appendChild(badge);

      if (count === 0) {
        slotG.classList.add("empty");
      } else if (clickable) {
        slotG.classList.add("active-turn");
      }

      // generous invisible hit-area so the whole column is easy to click
      const hitArea = svgEl("rect", {
        x: anchorX - COL_SPACING / 2,
        y: -panelHalfH,
        width: COL_SPACING,
        height: panelHalfH * 2,
        fill: "transparent",
      });
      slotG.insertBefore(hitArea, slotG.firstChild);

      slotG.addEventListener("click", (e) => {
        e.stopPropagation();
        onTraySlotClick(player, color, clickable, e);
      });

      g.appendChild(slotG);
    });

    // bank display: coin + ":" + balance, sitting below the tray, parallel
    // to (rotated the same as) the supply row rather than screen-upright
    const bankOuter = svgEl("g", { transform: `translate(0, ${panelHalfH + BANK_GAP})`, class: "bank-display" });
    const coin = coinIcon(BANK_COIN_R, {});
    coin.setAttribute("transform", `translate(${-BANK_COIN_R * 1.6}, 0)`);
    bankOuter.appendChild(coin);
    const bankText = svgEl("text", { x: 0, y: BANK_COIN_R * 0.05, class: "bank-text" });
    bankText.textContent = `: ${player.bank}`;
    bankOuter.appendChild(bankText);
    g.appendChild(bankOuter);

    // whole-panel click = return held tray piece (if owner matches)
    g.addEventListener("click", () => {
      if (
        state.heldPiece &&
        state.heldPiece.type === "tray" &&
        player.id === state.currentPlayerIndex
      ) {
        cancelHeldPiece();
      }
    });

    traysGroup.appendChild(g);
  });
}

function getDisplayPieces(hexKeyStr) {
  const stack = state.board.get(hexKeyStr);
  if (!stack) return [];
  let pieces = stack.pieces;
  if (
    state.heldPiece &&
    state.heldPiece.type === "board" &&
    state.heldPiece.hexId === hexKeyStr
  ) {
    pieces = pieces.slice(0, pieces.length - state.heldPiece.moveCount);
  }
  // pieces mid-hop-animation are already in the board data at their
  // destination but shouldn't be drawn there until the hop finishes
  if (state.hiddenPieceIds.size > 0) {
    pieces = pieces.filter((p) => !state.hiddenPieceIds.has(p.id));
  }
  return pieces;
}

function renderPieces() {
  piecesGroup.innerHTML = "";
  state.board.forEach((stack, key) => {
    const displayPieces = getDisplayPieces(key);
    if (displayPieces.length === 0) return;
    const hexDesc = state.hexIndex.get(key);
    const player = state.players[stack.playerId];
    const g = svgEl("g", {
      class: "board-piece",
      transform: `translate(${hexDesc.x}, ${hexDesc.y})`,
    });
    const stackInteractive =
      !state.gameOver &&
      !state.heldPiece &&
      state.movesUsed < 2 &&
      stack.playerId === state.currentPlayerIndex;

    const pieceEls = [];
    displayPieces.forEach((piece, i) => {
      const off = i * BOARD_FAN_STEP;
      const shapeG = shapeElement(player.shape, COLORS[piece.color], BOARD_PIECE_R, {});
      shapeG.setAttribute("transform", `translate(${-off}, ${-off})`);
      shapeG.classList.add("board-piece-shape");
      pieceEls.push(shapeG);
      g.appendChild(shapeG);
    });

    // clicking a piece moves it and everything stacked above it; hovering
    // previews that same selection — but only for pieces that could
    // actually be picked as the anchor of a move (not already moved this
    // turn); passengers riding above an unmoved anchor still light up as
    // part of the preview even if they themselves already moved
    displayPieces.forEach((piece, i) => {
      const anchorMovable = stackInteractive && !state.movedPieceIds.has(piece.id);
      if (!anchorMovable) return;
      const shapeG = pieceEls[i];
      shapeG.style.pointerEvents = "auto";
      shapeG.style.cursor = "pointer";
      shapeG.addEventListener("mouseenter", () => {
        pieceEls.forEach((el, j) => el.classList.toggle("piece-highlight", j >= i));
      });
      shapeG.addEventListener("mouseleave", () => {
        pieceEls.forEach((el) => el.classList.remove("piece-highlight"));
      });
      shapeG.addEventListener("click", (e) => {
        e.stopPropagation();
        onStackPieceClick(hexDesc, key, stack, i, e);
      });
    });

    piecesGroup.appendChild(g);
  });
}

function onStackPieceClick(hexDesc, key, stack, clickedIndex, event) {
  if (state.gameOver || state.heldPiece) return;
  if (state.movesUsed >= 2) {
    showMessage("Already moved 2 pieces this turn.");
    return;
  }
  const anchor = stack.pieces[clickedIndex];
  if (state.movedPieceIds.has(anchor.id)) {
    showMessage("That piece already moved this turn.");
    return;
  }
  const moveCount = stack.pieces.length - clickedIndex;
  beginBoardPickup(hexDesc, key, stack, moveCount, event);
}

/* ===================== Coins ===================== */

const COIN_R = BOARD_PIECE_R * 0.46;
const COIN_FAN_STEP = COIN_R * 0.45;
const COINS_PER_DROP = 6;

const HOP_DURATION_MS = 320;
const HOP_HEIGHT = BOARD_PIECE_R * 0.55;

function renderCoins() {
  coinsGroup.innerHTML = "";
  state.coins.forEach((count, key) => {
    const hexDesc = state.hexIndex.get(key);
    if (!hexDesc) return;
    const outer = svgEl("g", {
      class: "board-coin",
      "data-key": key,
      transform: `translate(${hexDesc.x}, ${hexDesc.y})`,
    });
    // coins on the same tile stack the same way player pieces do
    for (let i = 0; i < count; i++) {
      const off = i * COIN_FAN_STEP;
      const c = coinIcon(COIN_R, {});
      c.setAttribute("transform", `translate(${-off}, ${-off})`);
      outer.appendChild(c);
    }
    coinsGroup.appendChild(outer);
  });
}

function dropCoins() {
  // coins only land on tiles with no pieces on them, at most one per tile
  // per drop (but tiles that already hold coins can receive another)
  const free = state.hexes.filter((h) => !state.board.has(hexKey(h.q, h.r)));
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  const chosen = free.slice(0, COINS_PER_DROP);
  if (chosen.length === 0) return;

  chosen.forEach((h) => {
    const key = hexKey(h.q, h.r);
    state.coins.set(key, (state.coins.get(key) || 0) + 1);
  });
  renderCoins();

  // make the newly-landed coin of each chosen tile rain down from above
  chosen.forEach((h, i) => {
    const key = hexKey(h.q, h.r);
    const outer = coinsGroup.querySelector(`.board-coin[data-key="${key}"]`);
    if (!outer) return;
    const newest = outer.lastElementChild;
    if (!newest) return;
    const baseTransform = newest.getAttribute("transform") || "";
    // start far enough above that the coin enters from off-screen
    const fallFrom = -state.viewHalf - h.y - COIN_R * 3;
    animateCoinFall(newest, baseTransform, fallFrom, i * 90);
  });

  showMessage(`Coins drop! ${chosen.length} coins scattered across the board.`);
}

function animateCoinFall(el, baseTransform, fromDy, delayMs) {
  const duration = 620;
  const startTime = performance.now() + delayMs;
  el.style.opacity = "0";
  function frame(now) {
    if (now < startTime) {
      requestAnimationFrame(frame);
      return;
    }
    el.style.opacity = "1";
    const t = Math.min(1, (now - startTime) / duration);
    // ease-in for the fall, then a small squash-free settle
    const e = t < 0.85 ? Math.pow(t / 0.85, 2) : 1;
    const dy = fromDy * (1 - e);
    el.setAttribute("transform", `${baseTransform} translate(0, ${dy})`);
    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      land();
    }
  }
  function land() {
    el.setAttribute("transform", baseTransform);
    el.style.opacity = "";
  }
  requestAnimationFrame(frame);
  // rAF stalls while the tab is hidden; make sure the coin ends up visible
  // and correctly placed regardless
  setTimeout(land, delayMs + duration + 250);
}

// called whenever a player's pieces land on a tile; returns true if coins
// were there to collect
function collectCoinsAt(targetKey, playerId) {
  const count = state.coins.get(targetKey);
  if (!count) return false;
  state.coins.delete(targetKey);

  const hexDesc = state.hexIndex.get(targetKey);
  const player = state.players[playerId];
  playDing();
  spawnSparkles(hexDesc);
  driftCoinsToBank(hexDesc, player, count);
  return true;
}

function spawnSparkles(hexDesc) {
  const n = 10;
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n + Math.random() * 0.4;
    const dist = COIN_R * (1.6 + Math.random() * 1.8);
    const outer = svgEl("g", { transform: `translate(${hexDesc.x}, ${hexDesc.y})` });
    const size = COIN_R * (0.22 + Math.random() * 0.2);
    // 4-point sparkle
    const spark = svgEl("polygon", {
      points: pointsAttr([
        { x: 0, y: -size * 2.2 },
        { x: size * 0.6, y: 0 },
        { x: 0, y: size * 2.2 },
        { x: -size * 0.6, y: 0 },
      ]),
      fill: i % 2 === 0 ? "#fff3b0" : "#ffd54a",
    });
    outer.appendChild(spark);
    effectsGroup.appendChild(outer);

    const duration = 480 + Math.random() * 220;
    const startTime = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - startTime) / duration);
      const e = 1 - Math.pow(1 - t, 2);
      const x = hexDesc.x + Math.cos(angle) * dist * e;
      const y = hexDesc.y + Math.sin(angle) * dist * e;
      const scale = 1 - t * 0.6;
      const rot = t * 180;
      outer.setAttribute("transform", `translate(${x}, ${y}) rotate(${rot}) scale(${scale})`);
      outer.style.opacity = String(1 - t);
      if (t < 1) requestAnimationFrame(frame);
      else outer.remove();
    }
    requestAnimationFrame(frame);
    setTimeout(() => outer.remove(), duration + 250);
  }
}

function driftCoinsToBank(hexDesc, player, count) {
  const fromX = hexDesc.x;
  const fromY = hexDesc.y;
  const toX = player.trayOrigin.x;
  const toY = player.trayOrigin.y;
  const duration = 750;
  const gen = state.animGeneration;

  for (let i = 0; i < count; i++) {
    const off = i * COIN_FAN_STEP;
    const delay = i * 110;
    const outer = svgEl("g", { transform: `translate(${fromX - off}, ${fromY - off})` });
    outer.appendChild(coinIcon(COIN_R, {}));
    effectsGroup.appendChild(outer);

    let settled = false;
    function settle() {
      if (settled) return;
      settled = true;
      outer.remove();
      // credit the bank as each coin arrives, but skip it entirely if the
      // game state was rewound while this coin was still in flight
      if (gen === state.animGeneration) {
        player.bank += 1;
        renderTrays();
        updateStatusBar();
      }
    }

    const startTime = performance.now() + delay;
    function frame(now) {
      if (settled) return;
      if (now < startTime) {
        requestAnimationFrame(frame);
        return;
      }
      const t = Math.min(1, (now - startTime) / duration);
      const e = easeInOutCubic(t);
      const x = fromX - off + (toX - (fromX - off)) * e;
      const y = fromY - off + (toY - (fromY - off)) * e;
      const scale = 1 + (0.35 - 1) * e;
      outer.setAttribute("transform", `translate(${x}, ${y}) scale(${scale})`);
      outer.style.opacity = String(1 - e * 0.9);
      if (t < 1) requestAnimationFrame(frame);
      else settle();
    }
    requestAnimationFrame(frame);
    // rAF is paused while the tab is hidden, so guarantee the payout lands
    // even if the player never watches the animation finish
    setTimeout(settle, delay + duration + 250);
  }
}

function renderToken() {
  tokenGroup.innerHTML = "";
  // the token tracks its own holder, not the current player
  const player = state.players[state.starHolder];
  const tangentClearance = PANEL_ROW_WIDTH / 2 + PIECE_R * 1.3;
  const pos = {
    x: player.trayOrigin.x + player.trayTangent.x * tangentClearance,
    y: player.trayOrigin.y + player.trayTangent.y * tangentClearance,
  };
  const g = svgEl("g", { transform: `translate(${pos.x}, ${pos.y})` });
  const s = PIECE_R * 0.55;
  const starPts = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? s : s * 0.42;
    const angle = (Math.PI / 180) * (i * 36 - 90);
    starPts.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  // yellow = coins will drop when this player finishes; grey = just arrived
  const fill = state.starYellow ? "#ffcf3f" : "#9d9d9d";
  const line = state.starYellow ? "#a8790a" : "#5c5c5c";
  const face = state.starYellow ? "#5a3d0a" : "#3d3d3d";
  const star = svgEl("polygon", {
    points: pointsAttr(starPts),
    fill,
    stroke: line,
    "stroke-width": 1.4,
    "stroke-linejoin": "round",
  });
  g.appendChild(star);
  // simple smiley face
  const eyeL = svgEl("circle", { cx: -s * 0.22, cy: -s * 0.08, r: s * 0.09, fill: face });
  const eyeR = svgEl("circle", { cx: s * 0.22, cy: -s * 0.08, r: s * 0.09, fill: face });
  const smile = svgEl("path", {
    d: `M ${-s * 0.28} ${s * 0.15} Q 0 ${s * 0.45} ${s * 0.28} ${s * 0.15}`,
    fill: "none",
    stroke: face,
    "stroke-width": s * 0.09,
    "stroke-linecap": "round",
  });
  g.appendChild(eyeL);
  g.appendChild(eyeR);
  g.appendChild(smile);
  tokenGroup.appendChild(g);
}

function updateStatusBar() {
  const player = state.players[state.currentPlayerIndex];
  const icon = document.getElementById("turn-shape-icon");
  icon.innerHTML = "";
  const svgIcon = svgEl("svg", { viewBox: "-12 -12 24 24", width: "20", height: "20" });
  svgIcon.appendChild(shapeElement(player.shape, "#ffcf7d", 9, {}));
  icon.appendChild(svgIcon);
  document.getElementById("turn-text").textContent = `${player.label}'s turn — Placed: ${
    state.placedThisTurn ? "yes" : "no"
  }, Moves used: ${state.movesUsed}/2`;
}

let toastTimeout = null;
function showMessage(msg) {
  const el = document.getElementById("message-toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.remove("show"), 2200);
}

function rerenderAll() {
  renderTrays();
  renderCoins();
  renderPieces();
  renderToken();
  updateStatusBar();
  applyHighlightClasses();
}

/* ===================== Highlighting ===================== */

function clearHighlights() {
  state.hexes.forEach((h) => {
    h.el.classList.remove("hl-place", "hl-move", "clickable-own");
  });
  state.validTargets = new Set();
}

function applyHighlightClasses() {
  state.hexes.forEach((h) => {
    h.el.classList.remove("hl-place", "hl-move", "clickable-own");
  });
  if (state.heldPiece) {
    const cls = state.heldPiece.type === "tray" ? "hl-place" : "hl-move";
    state.validTargets.forEach((key) => {
      const h = state.hexIndex.get(key);
      if (h) h.el.classList.add(cls);
    });
  } else if (!state.gameOver && state.movesUsed < 2) {
    // highlight own movable stacks
    const activeId = state.currentPlayerIndex;
    state.board.forEach((stack, key) => {
      if (stack.playerId === activeId) {
        const h = state.hexIndex.get(key);
        if (h) h.el.classList.add("clickable-own");
      }
    });
  }
}

/* ===================== Interaction: Tray ===================== */

function onTraySlotClick(player, color, clickable, event) {
  if (state.gameOver) return;
  if (state.heldPiece) return; // ignore stray slot clicks while holding (panel bg handles cancel)
  if (player.id !== state.currentPlayerIndex) {
    showMessage("It's not this player's turn.");
    return;
  }
  if (state.placedThisTurn) {
    showMessage("Already placed a piece this turn.");
    return;
  }
  if (player.tray[color] <= 0) {
    showMessage("No pieces of that color left in tray.");
    return;
  }
  if (player.bank < PRICES[color]) {
    showMessage(`Not enough coins — ${color[0].toUpperCase() + color.slice(1)} costs ${PRICES[color]}.`);
    return;
  }
  state.heldPiece = { type: "tray", color, playerId: player.id };
  computeValidPlaceTargets(player, color);
  // re-render so board pieces lose their hover/click interactivity while a
  // piece is held (otherwise stale listeners from before pickup keep
  // highlighting on hover and swallow clicks meant for the hex underneath)
  renderPieces();
  applyHighlightClasses();
  showDragGhost(player.shape, [color], event.clientX, event.clientY);
}

function computeValidPlaceTargets(player, color) {
  const targets = new Set();
  player.frontRow.forEach((h) => {
    const key = hexKey(h.q, h.r);
    const stack = state.board.get(key);
    if (!stack) {
      targets.add(key);
    } else if (stack.playerId !== player.id) {
      targets.add(key); // capture
    } else if (stack.pieces.length < MAX_STACK) {
      targets.add(key); // own stack, any color mix, same shape
    }
  });
  state.validTargets = targets;
}

/* ===================== Interaction: Board pieces ===================== */

function onHexClick(hexDesc) {
  if (state.gameOver) return;
  const key = hexKey(hexDesc.q, hexDesc.r);

  if (state.heldPiece) {
    // clicking the source hex of a board pickup cancels the move, same as Escape
    if (state.heldPiece.type === "board" && state.heldPiece.hexId === key) {
      cancelHeldPiece();
      return;
    }
    // make sure the traced route actually ends here even if this hex was
    // never hovered first (e.g. a quick click right after pickup)
    if (state.heldPiece.type === "board") {
      updateMovePath(hexDesc);
    }
    attemptDrop(key);
    return;
  }

  // no held piece: picking up a stack now happens by clicking directly on
  // one of its pieces (see onStackPieceClick); a bare hex click with
  // nothing held has nothing to do
  if (state.movesUsed >= 2) {
    const stack = state.board.get(key);
    if (stack && stack.playerId === state.currentPlayerIndex) {
      showMessage("Already moved 2 pieces this turn.");
    }
  }
}

function onHexHover(hexDesc) {
  if (state.heldPiece && state.heldPiece.type === "board") {
    updateMovePath(hexDesc);
  }
}

function beginBoardPickup(hexDesc, key, stack, moveCount, event) {
  const movedPieces = stack.pieces.slice(-moveCount);
  const colors = movedPieces.map((p) => p.color);
  state.heldPiece = {
    type: "board",
    hexId: key,
    moveCount,
    colors,
    pieceIds: movedPieces.map((p) => p.id),
    playerId: stack.playerId,
    path: [hexDesc],
  };
  computeValidMoveTargets(hexDesc, colors);
  renderPieces();
  applyHighlightClasses();
  renderMovePath();
  const player = state.players[stack.playerId];
  showDragGhost(player.shape, colors, event.clientX, event.clientY);
}

/* ===================== Move route tracing ===================== */

// Multi-space pieces can trace a specific hop-by-hop route to their
// destination instead of just picking an end point: hovering extends the
// route hex by hex, hovering back over an earlier hex in the route
// backtracks to it, and hovering somewhere the route can't simply reach
// (because it would exceed the piece's range) snaps to a fresh straight
// route to that hex instead.
function updateMovePath(hoveredHexDesc) {
  const held = state.heldPiece;
  if (!held || held.type !== "board") return;
  const path = held.path;
  const source = path[0];

  if (hoveredHexDesc.q === source.q && hoveredHexDesc.r === source.r) {
    if (path.length > 1) {
      held.path = [source];
      renderMovePath();
    }
    return;
  }

  const range = MOVE_RANGE[held.colors[0]];
  if (hexDistance(source, hoveredHexDesc) > range) return; // out of reach, ignore

  // backtrack: hovered hex is already on the current route
  const idx = path.findIndex((h) => h.q === hoveredHexDesc.q && h.r === hoveredHexDesc.r);
  if (idx !== -1) {
    if (idx !== path.length - 1) {
      held.path = path.slice(0, idx + 1);
      renderMovePath();
    }
    return;
  }

  const last = path[path.length - 1];

  // simple extension: hovered hex is adjacent to the route's current end
  // and there's still room within the piece's range
  if (hexDistance(last, hoveredHexDesc) === 1 && path.length - 1 < range) {
    held.path = path.concat([hoveredHexDesc]);
    renderMovePath();
    return;
  }

  // snap: the freeform trace can't simply reach this hex anymore (it would
  // take more hops than the piece has), so replace it with the canonical
  // straight route from the source
  held.path = computeHexLine(source, hoveredHexDesc);
  renderMovePath();
}

function renderMovePath() {
  pathGroup.innerHTML = "";
  const held = state.heldPiece;
  if (!held || held.type !== "board" || !held.path || held.path.length < 2) return;
  const pts = held.path.map((h) => {
    const d = state.hexIndex.get(hexKey(h.q, h.r)) || h;
    return { x: d.x, y: d.y };
  });

  const line = svgEl("path", {
    d: catmullRomPathD(pts),
    fill: "none",
    stroke: "#000",
    "stroke-width": 5,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    class: "move-route-line",
  });
  pathGroup.appendChild(line);

  // the held puck sits right on the last hex's center — stop the line at
  // its edge instead of drawing underneath/through it. Trimming by arc
  // length (not a straight-line shortcut) keeps this accurate even though
  // the path curves.
  const total = line.getTotalLength();
  const visible = Math.max(0, total - BOARD_PIECE_R);
  line.setAttribute("stroke-dasharray", visible <= 0.01 ? `0 ${total + 1}` : `${visible} ${total}`);

  pts.forEach((p, i) => {
    if (i === 0 || i === pts.length - 1) return; // no dot on the origin or the puck-covered end
    pathGroup.appendChild(
      svgEl("circle", { cx: p.x, cy: p.y, r: 5, class: "move-route-dot" })
    );
  });
}

function computeValidMoveTargets(sourceHexDesc, colors) {
  // the bottom piece of the moved group (the anchor, colors[0]) sets the
  // range for the whole selection, regardless of what's stacked above it
  const range = MOVE_RANGE[colors[0]];
  const targets = new Set();
  const activeId = state.currentPlayerIndex;
  state.hexes.forEach((h) => {
    if (h === sourceHexDesc) return;
    const dist = hexDistance(sourceHexDesc, h);
    if (dist < 1 || dist > range) return;
    const key = hexKey(h.q, h.r);
    const stack = state.board.get(key);
    const moveCount = state.heldPiece.moveCount;
    if (!stack) {
      targets.add(key);
    } else if (stack.playerId !== activeId) {
      targets.add(key); // capture
    } else if (stack.pieces.length + moveCount <= MAX_STACK) {
      targets.add(key); // same shape, any color mix
    }
  });
  state.validTargets = targets;
}

/* ===================== Drop / cancel ===================== */

function attemptDrop(targetKey) {
  if (!state.validTargets.has(targetKey)) {
    showMessage("Not a valid spot for that piece.");
    return;
  }
  pushHistory();
  if (state.heldPiece.type === "tray") {
    executeTrayPlacement(targetKey);
  } else {
    executeBoardMove(targetKey);
  }
}

/* ===================== Undo ===================== */

function snapshotState() {
  return {
    board: Array.from(state.board.entries()).map(([key, stack]) => [
      key,
      { playerId: stack.playerId, pieces: stack.pieces.map((p) => ({ id: p.id, color: p.color })) },
    ]),
    trays: state.players.map((p) => Object.assign({}, p.tray)),
    banks: state.players.map((p) => p.bank),
    currentPlayerIndex: state.currentPlayerIndex,
    placedThisTurn: state.placedThisTurn,
    movesUsed: state.movesUsed,
    movedPieceIds: Array.from(state.movedPieceIds),
    gameOver: state.gameOver,
    nextPieceId: state.nextPieceId,
    coins: Array.from(state.coins.entries()),
    starHolder: state.starHolder,
    starYellow: state.starYellow,
  };
}

function pushHistory() {
  state.history.push(snapshotState());
}

function restoreSnapshot(snap) {
  state.board = new Map(
    snap.board.map(([key, stack]) => [
      key,
      { playerId: stack.playerId, pieces: stack.pieces.map((p) => ({ id: p.id, color: p.color })) },
    ])
  );
  snap.trays.forEach((tray, i) => {
    state.players[i].tray = Object.assign({}, tray);
  });
  snap.banks.forEach((bank, i) => {
    state.players[i].bank = bank;
  });
  state.currentPlayerIndex = snap.currentPlayerIndex;
  state.placedThisTurn = snap.placedThisTurn;
  state.movesUsed = snap.movesUsed;
  state.movedPieceIds = new Set(snap.movedPieceIds);
  state.gameOver = snap.gameOver;
  state.nextPieceId = snap.nextPieceId;
  state.coins = new Map(snap.coins);
  state.starHolder = snap.starHolder;
  state.starYellow = snap.starYellow;
  // invalidate any coin/capture animation still in flight so it can't
  // credit a bank after we've rewound past the event that started it
  state.animGeneration++;
  effectsGroup.innerHTML = "";
}

function undo() {
  if (state.history.length === 0) {
    showMessage("Nothing to undo.");
    return;
  }
  state.heldPiece = null;
  state.validTargets = new Set();
  state.hiddenPieceIds = new Set();
  hideDragGhost();
  pathGroup.innerHTML = "";
  const snap = state.history.pop();
  restoreSnapshot(snap);
  document.getElementById("winner-banner").classList.toggle("hidden", !state.gameOver);
  rerenderAll();
  showMessage("Move undone.");
}

function captureIfOpponent(targetKey, movingPlayerId) {
  const existing = state.board.get(targetKey);
  if (existing && existing.playerId !== movingPlayerId) {
    const opponent = state.players[existing.playerId];
    const hexDesc = state.hexIndex.get(targetKey);
    spawnCaptureEffect(hexDesc, opponent, existing.pieces);
    existing.pieces.forEach((piece) => {
      opponent.tray[piece.color] += 1;
    });
    state.board.delete(targetKey);
  }
}

/* ===================== Capture animation ===================== */

function spawnCaptureEffect(hexDesc, opponent, pieces) {
  playExplosion();
  spawnExplosion(hexDesc);
  spawnDrift(hexDesc, opponent, pieces);
}

function spawnExplosion(hexDesc) {
  const outer = svgEl("g", { transform: `translate(${hexDesc.x}, ${hexDesc.y})` });
  const boom = svgEl("g", { class: "capture-boom" });
  const flash = svgEl("circle", { cx: 0, cy: 0, r: 9, fill: "#ffdf7d" });
  boom.appendChild(flash);
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI / 180) * (i * 45);
    const x1 = Math.cos(angle) * 4;
    const y1 = Math.sin(angle) * 4;
    const x2 = Math.cos(angle) * 17;
    const y2 = Math.sin(angle) * 17;
    boom.appendChild(
      svgEl("line", {
        x1,
        y1,
        x2,
        y2,
        stroke: i % 2 === 0 ? "#ff8a3f" : "#e6493f",
        "stroke-width": 2.4,
        "stroke-linecap": "round",
      })
    );
  }
  outer.appendChild(boom);
  effectsGroup.appendChild(outer);
  boom.addEventListener("animationend", () => outer.remove());
  setTimeout(() => outer.remove(), 700);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function spawnDrift(hexDesc, opponent, pieces) {
  const fromX = hexDesc.x;
  const fromY = hexDesc.y;
  const toX = opponent.trayOrigin.x;
  const toY = opponent.trayOrigin.y;
  const duration = 700;

  pieces.forEach((piece, i) => {
    const off = i * BOARD_FAN_STEP;
    const outer = svgEl("g", { transform: `translate(${fromX - off}, ${fromY - off})` });
    const shapeG = shapeElement(opponent.shape, COLORS[piece.color], BOARD_PIECE_R, {});
    outer.appendChild(shapeG);
    effectsGroup.appendChild(outer);

    const delay = i * 90;
    const startTime = performance.now() + delay;

    function frame(now) {
      if (now < startTime) {
        requestAnimationFrame(frame);
        return;
      }
      const t = Math.min(1, (now - startTime) / duration);
      const e = easeInOutCubic(t);
      const x = fromX - off + (toX - (fromX - off)) * e;
      const y = fromY - off + (toY - (fromY - off)) * e;
      const scale = 1 + (0.3 - 1) * e;
      outer.setAttribute("transform", `translate(${x}, ${y}) scale(${scale})`);
      outer.style.opacity = String(1 - e);
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        outer.remove();
      }
    }
    requestAnimationFrame(frame);
    setTimeout(() => outer.remove(), delay + duration + 250);
  });
}

function executeTrayPlacement(targetKey) {
  const { color, playerId } = state.heldPiece;
  const player = state.players[playerId];

  captureIfOpponent(targetKey, playerId);

  const newPiece = { id: state.nextPieceId++, color };
  const existing = state.board.get(targetKey);
  if (existing && existing.playerId === playerId) {
    existing.pieces.push(newPiece);
  } else {
    state.board.set(targetKey, { playerId, pieces: [newPiece] });
  }

  player.tray[color] -= 1;
  player.bank -= PRICES[color];
  state.placedThisTurn = true;
  collectCoinsAt(targetKey, playerId);
  clearHeldPieceState();
  rerenderAll();
  checkWin(player);
}

function executeBoardMove(targetKey) {
  const { hexId, moveCount, pieceIds, playerId, path } = state.heldPiece;
  const sourceStack = state.board.get(hexId);
  const movedPieces = sourceStack.pieces.slice(-moveCount);

  const remaining = sourceStack.pieces.length - moveCount;
  if (remaining <= 0) {
    state.board.delete(hexId);
  } else {
    sourceStack.pieces = sourceStack.pieces.slice(0, remaining);
  }

  // hop along the traced route if there is one ending here, otherwise a
  // plain direct hop (e.g. a click with no prior hover)
  const sourceHexDesc = state.hexIndex.get(hexId);
  const targetHexDesc = state.hexIndex.get(targetKey);
  const tracedEnd = path && path.length > 1 ? path[path.length - 1] : null;
  const hopPath =
    tracedEnd && tracedEnd.q === targetHexDesc.q && tracedEnd.r === targetHexDesc.r
      ? path
      : [sourceHexDesc, targetHexDesc];

  // only the anchor (bottommost piece of this move's selection) is locked
  // for the rest of the turn — passengers riding above it can still be
  // picked out and moved independently later this turn
  state.movedPieceIds.add(pieceIds[0]);
  state.movesUsed += 1;

  // the moved pieces are logically gone from the source already, but stay
  // invisible until the hop animation delivers them to their destination
  state.hiddenPieceIds = new Set(pieceIds);
  clearHeldPieceState();
  rerenderAll();

  animateHopMove(hopPath, movedPieces, playerId);
}

// animates a piece/stack hopping tile by tile along hopPath (hopPath[0] is
// the tile it's leaving). Every tile it passes through or lands on — not
// just the final one — triggers captures and coin collection at the
// moment the hop visually arrives there, so a single multi-space move can
// hit several opponents or scoop up several coin piles along the way.
function animateHopMove(hopPath, movedPieces, playerId) {
  const gen = state.animGeneration;
  const player = state.players[playerId];
  const waypoints = hopPath.slice(1); // excludes the origin tile
  const colors = movedPieces.map((p) => p.color);

  // must start at the origin tile's position immediately — leaving the
  // transform unset until the first animation frame lands means it briefly
  // renders at the SVG's (0,0) origin (the board's center), which looks
  // like the piece glitches to a wrong spot before snapping into place
  const ghost = svgEl("g", { transform: `translate(${hopPath[0].x}, ${hopPath[0].y})` });
  colors.forEach((color, i) => {
    const off = i * BOARD_FAN_STEP;
    const s = shapeElement(player.shape, COLORS[color], BOARD_PIECE_R, {});
    s.setAttribute("transform", `translate(${-off}, ${-off})`);
    ghost.appendChild(s);
  });
  effectsGroup.appendChild(ghost);

  const totalDuration = waypoints.length * HOP_DURATION_MS;
  // anchored to the first frame that actually runs rather than to now, so
  // any delay between scheduling and that frame doesn't eat into the hop
  let startTime = null;
  // index of the next waypoint whose capture/coin/placement effects still
  // need to fire — driven off the SAME clock as the visual hop below, so
  // the reveal can never desync from (or outrun) the animation
  let nextWaypointIdx = 0;

  function resolveWaypoint(i) {
    const hexDesc = waypoints[i];
    const key = hexKey(hexDesc.q, hexDesc.r);
    const isFinal = i === waypoints.length - 1;
    captureIfOpponent(key, playerId);
    if (isFinal) {
      const destExisting = state.board.get(key);
      if (destExisting && destExisting.playerId === playerId) {
        destExisting.pieces.push(...movedPieces);
      } else {
        state.board.set(key, { playerId, pieces: movedPieces.slice() });
      }
      movedPieces.forEach((p) => state.hiddenPieceIds.delete(p.id));
    }
    collectCoinsAt(key, playerId);
    // a full rerenderAll() also rebuilds the token graphic and re-applies
    // highlight classes across every hex — neither changes mid-hop (no
    // piece is held), and that wasted work eats into the frame budget on
    // slower devices, which can visibly stutter the hop. Only refresh what
    // captures/coin-collection can actually change.
    renderPieces();
    renderCoins();
    renderTrays();
  }

  function finish() {
    // catches up on any waypoints the frame loop never reached (e.g. the
    // tab was backgrounded and requestAnimationFrame stopped firing) so
    // the move always resolves correctly even without a visible animation
    while (nextWaypointIdx < waypoints.length) {
      resolveWaypoint(nextWaypointIdx);
      nextWaypointIdx++;
    }
    ghost.remove();
  }

  function frame(now) {
    if (gen !== state.animGeneration) {
      ghost.remove();
      return;
    }
    if (startTime === null) startTime = now;
    // Chrome dispatches input events *before* the rAF callbacks of the
    // same frame, so a rAF scheduled from a click handler can fire in that
    // very frame carrying a timestamp from before the handler ran — making
    // this negative. Left unclamped it floors to segIdx -1, hopPath[-1] is
    // undefined, and reading .x throws inside the callback: the loop then
    // never reschedules and the move silently teleports via the fallback.
    const elapsed = Math.max(0, now - startTime);
    const segFloat = Math.min(waypoints.length, elapsed / HOP_DURATION_MS);
    const segIdx = Math.min(waypoints.length - 1, Math.max(0, Math.floor(segFloat)));
    const segT = Math.min(1, Math.max(0, segFloat - segIdx));
    const from = hopPath[segIdx];
    const to = hopPath[segIdx + 1];
    const x = from.x + (to.x - from.x) * segT;
    const y = from.y + (to.y - from.y) * segT;
    const bounce = Math.sin(Math.PI * segT) * HOP_HEIGHT;
    ghost.setAttribute("transform", `translate(${x}, ${y - bounce})`);

    // resolve every waypoint the hop has now visually reached — using
    // this frame's own elapsed time means the reveal always happens on
    // the exact frame the ghost arrives, never before and never after
    while (nextWaypointIdx < waypoints.length && elapsed >= (nextWaypointIdx + 1) * HOP_DURATION_MS) {
      resolveWaypoint(nextWaypointIdx);
      nextWaypointIdx++;
    }

    if (elapsed < totalDuration) {
      requestAnimationFrame(frame);
    } else {
      finish();
    }
  }
  requestAnimationFrame(frame);
  // rAF pauses while the tab is hidden; guarantee the move still resolves
  setTimeout(() => {
    if (gen !== state.animGeneration) return;
    finish();
  }, totalDuration + 400);
}

function clearHeldPieceState() {
  state.heldPiece = null;
  state.validTargets = new Set();
  hideDragGhost();
  clearHighlights();
  pathGroup.innerHTML = "";
}

function cancelHeldPiece() {
  if (!state.heldPiece) return;
  clearHeldPieceState();
  rerenderAll();
}

/* ===================== Drag ghost ===================== */

function showDragGhost(shape, colors, x, y) {
  const ghost = document.getElementById("drag-ghost");
  // pieces while held are 15% larger than board pieces: same fan offset
  // but minimal padding in the SVG container
  const r = BOARD_PIECE_R;
  const maxOff = (colors.length - 1) * BOARD_FAN_STEP;
  // viewBox needs to fit all pieces
  const viewHalf = r + maxOff + r * 0.2;
  // keep a constant screen-px-per-viewBox-unit scale (calibrated so a
  // single piece renders at 1.15x its board radius) so a whole stack scales
  // the same way a single piece does, instead of shrinking as it grows
  const singlePieceViewHalf = r * 1.2;
  const ghostScale = (r * 1.15) / (2 * singlePieceViewHalf);
  const displaySize = viewHalf * 2 * ghostScale;
  const svgIcon = svgEl("svg", {
    viewBox: `${-viewHalf} ${-viewHalf} ${viewHalf * 2} ${viewHalf * 2}`,
    width: displaySize,
    height: displaySize,
  });
  colors.forEach((color, i) => {
    const off = i * BOARD_FAN_STEP;
    const s = shapeElement(shape, COLORS[color], r, {});
    s.setAttribute("transform", `translate(${-off}, ${-off})`);
    svgIcon.appendChild(s);
  });
  ghost.innerHTML = "";
  ghost.appendChild(svgIcon);
  ghost.style.left = x + "px";
  ghost.style.top = y + "px";
  ghost.classList.remove("hidden");
}

function hideDragGhost() {
  const ghost = document.getElementById("drag-ghost");
  ghost.classList.add("hidden");
  ghost.innerHTML = "";
}

function onMouseMove(e) {
  const ghost = document.getElementById("drag-ghost");
  if (ghost.classList.contains("hidden")) return;
  ghost.style.left = e.clientX + "px";
  ghost.style.top = e.clientY + "px";
}

/* ===================== Turn management ===================== */

function finishTurn() {
  if (state.gameOver) return;
  pushHistory();
  cancelHeldPiece();
  state.placedThisTurn = false;
  state.movesUsed = 0;
  state.movedPieceIds = new Set();

  // Advance the first-player token. It arrives on a player grey; at the end
  // of that player's turn it flips yellow; it then sits yellow until that
  // same player finishes another turn, when it moves on to the next player
  // and goes grey again. That makes one full token step take 4 turns.
  if (state.currentPlayerIndex === state.starHolder) {
    if (state.starYellow) {
      state.starHolder = (state.starHolder + 1) % state.players.length;
      state.starYellow = false;
    } else {
      state.starYellow = true;
    }
  }

  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
  rerenderAll();
  maybeDropCoinsForTurnStart();
}

// coins drop at the START of a turn whose player already holds the yellow
// star — not at the moment it flips (that flip happens at the end of a
// DIFFERENT player's turn, before the star holder has actually started
// theirs). Called once at game init (the star starts yellow on player 1)
// and again at the top of every subsequent turn.
function maybeDropCoinsForTurnStart() {
  if (state.starYellow && state.starHolder === state.currentPlayerIndex) {
    dropCoins();
  } else {
    showMessage(`${state.players[state.currentPlayerIndex].label}'s turn.`);
  }
}

function checkWin(player) {
  const total = player.tray.yellow + player.tray.red + player.tray.blue;
  if (total === 0) {
    state.gameOver = true;
    const banner = document.getElementById("winner-banner");
    document.getElementById("winner-text").textContent = `${player.label} win! All Yellow, Red & Blue pieces are on the board.`;
    banner.classList.remove("hidden");
    clearHighlights();
  }
}

/* ===================== Init ===================== */

function init() {
  buildGeometry();
  initSVG();
}

init();
