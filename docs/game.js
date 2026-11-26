'use strict';
// =====================================================================
//  Ember Hollow — an autumn silhouette puzzle-platformer prototype
// =====================================================================

const W = 960, H = 540;            // logical resolution
const INK = '#35170d';             // deep warm-brown silhouette colour
const PLAYER_CLOAK = '#71301d';
const PLAYER_RIM = '#d99445';
const PLAYER_FACE = '#bd7447';
const PLAYER_LANTERN = '#ffd47a';
const LEAF_COLORS = ['#d9662b', '#b8401f', '#e8a03a', '#8f2e16', '#f0c05a'];
const RES = Math.min(2, window.devicePixelRatio || 1);

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let scale = 1;
function resize() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = W * s + 'px';
  canvas.style.height = H * s + 'px';
  canvas.style.marginTop = Math.max(0, (innerHeight - H * s) / 2) + 'px';
  canvas.width = Math.round(W * s * dpr);
  canvas.height = Math.round(H * s * dpr);
  scale = canvas.width / W;
}
addEventListener('resize', resize);
resize();

// ---------- helpers ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
const ease = t => t * t * (3 - 2 * t);
function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// ---------- input ----------
const keys = {};
let jumpQueued = false;
addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  startAudio();
  if (!e.repeat) {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') jumpQueued = true;
    if (e.code === 'KeyM') toggleMute();
    if (e.code === 'KeyR' && !player.dead && !ended) killPlayer(false);
    if (e.code === 'KeyC') warpCheckpoint(cpIndex + 1);
    if (/^Digit[1-9]$/.test(e.code)) warpCheckpoint(Number(e.code.slice(-1)) - 1);
    if (e.code === 'Digit0') warpCheckpoint(checkpoints.length - 1);
    if (e.code === 'Enter' && ended && endT > 2) location.reload();
  }
  keys[e.code] = true;
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
const holdL = () => keys.ArrowLeft || keys.KeyA;
const holdR = () => keys.ArrowRight || keys.KeyD;
const holdJ = () => keys.Space || keys.ArrowUp || keys.KeyW;

// ---------- audio (all synthesized, no files needed) ----------
let actx = null, master, windGain, windFilter, noiseBuf, muted = false;
function startAudio() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const len = actx.sampleRate * 2;
    noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
    const n = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) n[i] = Math.random() * 2 - 1;
    const brown = actx.createBuffer(1, len, actx.sampleRate);
    const b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    master = actx.createGain(); master.gain.value = 0.7; master.connect(actx.destination);
    const src = actx.createBufferSource(); src.buffer = brown; src.loop = true;
    windFilter = actx.createBiquadFilter(); windFilter.type = 'lowpass'; windFilter.frequency.value = 400;
    windGain = actx.createGain(); windGain.gain.value = 0.1;
    src.connect(windFilter); windFilter.connect(windGain); windGain.connect(master);
    src.start();
  } catch (err) { actx = null; }
}
function toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.7; }
function noiseHit(freq, q, vol, dur, delay = 0, type = 'bandpass', attack = 0.005) {
  if (!actx) return;
  const t = actx.currentTime + delay;
  const s = actx.createBufferSource(); s.buffer = noiseBuf;
  const f = actx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
}
const crunch = v => noiseHit(1800 + Math.random() * 1800, 0.9, v, 0.07 + Math.random() * 0.06);
function thud() {
  if (!actx) return;
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.4);
  g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.55);
  crunch(0.35);
}
const rumble = () => noiseHit(130, 0.7, 0.7, 2.0, 0, 'lowpass', 0.4);
function flap() { for (let i = 0; i < 4; i++) noiseHit(700, 1.2, 0.07, 0.06, i * 0.08); }

// ---------- level ----------
const GROUND = 440;
const WORLD_END = 12000;
const solids = [
  { x: -240, y: -1000, w: 40, h: 2000, wall: true },
  { x: WORLD_END, y: -1000, w: 40, h: 2000, wall: true },
  { x: -200, y: GROUND, w: 1100, h: 200 },
  { x: 1010, y: GROUND, w: 890, h: 200 },
  { x: 1900, y: GROUND - 120, w: 400, h: 320 },   // high plateau (needs a step up)
  { x: 2600, y: GROUND, w: 750, h: 200 },
  { x: 3450, y: GROUND, w: 950, h: 200 },
  { x: 4400, y: GROUND, w: 700, h: 200 },
  { x: 5200, y: GROUND - 70, w: 260, h: 270 },
  { x: 5560, y: GROUND, w: 560, h: 200 },
  { x: 6220, y: GROUND - 100, w: 780, h: 300 },
  { x: 7500, y: GROUND, w: 350, h: 200 },
  { x: 7850, y: GROUND, w: 650, h: 200 },
  { x: 8500, y: GROUND - 80, w: 500, h: 280 },
  { x: 9200, y: GROUND, w: 500, h: 200 },
  { x: 9820, y: GROUND - 40, w: 350, h: 240 },
  { x: 10280, y: GROUND, w: 520, h: 200 },
  { x: 10880, y: GROUND - 70, w: 420, h: 270 },
  { x: 11340, y: GROUND, w: 660, h: 200 },
];
const leafPits = [
  { x: 900, w: 110, broken: false },
  { x: 3350, w: 100, broken: false },
  { x: 5100, w: 100, broken: false },
  { x: 6120, w: 100, broken: false },
  { x: 9700, w: 120, broken: false },
  { x: 10800, w: 80, broken: false },
];
const gate = { x: 1700, w: 26, h: 170, open: 0, latched: false };
const plate = { x: 1640, w: 60, press: 0 };
const brambles = { x: 2900, y: GROUND - 24, w: 90, h: 24 };
const WIND = { x0: 2150, x1: 2620 };
const WIND2 = { x0: 5300, x1: 5700 };
const WIND3 = { x0: 9660, x1: 10180 };
const FIRE_X = 11620;
const PUMPKIN_HOME = 1250;
const hillPlate = { x: 7660, w: 80, press: 0 };
const hillCrate = { x: 7780, y: GROUND - 48, w: 48, h: 48, vy: 0, roll: 0 };
const hillGate = { open: 0 };
const hillSteps = [
  { x: 8000, y: GROUND - 40, w: 120, h: 40 },
  { x: 8120, y: GROUND - 80, w: 120, h: 80 },
  { x: 8240, y: GROUND - 120, w: 120, h: 120 },
  { x: 8360, y: GROUND - 120, w: 140, h: 120 },
];
const checkpoints = [
  { x: 60, y: GROUND }, { x: 1060, y: GROUND }, { x: 1760, y: GROUND },
  { x: 1950, y: GROUND - 120 }, { x: 2660, y: GROUND }, { x: 3500, y: GROUND },
  { x: 4450, y: GROUND }, { x: 5200, y: GROUND - 70 }, { x: 5580, y: GROUND },
  { x: 6250, y: GROUND - 100 }, { x: 7480, y: GROUND },
  { x: 7760, y: GROUND }, { x: 8170, y: GROUND },
  { x: 8520, y: GROUND - 80 },
  { x: 9250, y: GROUND },
  { x: 10100, y: GROUND - 40 },
  { x: 10920, y: GROUND - 70 },
  { x: 11450, y: GROUND },
];
const hints = [
  { x: 130, y: 180, t: '←  →   walk' },
  { x: 130, y: 205, t: 'R restart   C next checkpoint   1-9 and 0 choose checkpoint   M mute', small: true },
  { x: 480, y: 180, t: 'space   jump' },
  { x: 1180, y: 180, t: 'walk into things to push them' },
  { x: 2020, y: 150, t: 'listen to the wind' },
  { x: 4520, y: 180, t: 'the old orchard continues beyond the hollow' },
  { x: 5380, y: 150, t: 'a second gust crosses the ridge' },
  { x: 6280, y: 130, t: 'follow the lantern glow' },
  { x: 9300, y: 150, t: 'the moonlit bridge is beyond the hollow' },
];
function gateRect() { return { x: gate.x, y: GROUND - gate.h - gate.open * gate.h, w: gate.w, h: gate.h }; }
const solidList = () => {
  const base = gate.open < 1 ? [...solids, gateRect(), ...movingPlatforms] : [...solids, ...movingPlatforms];
  return hillGate.open > 0.05 ? [...base, ...hillSteps.map(s => ({ ...s, y: GROUND - s.h + (1 - hillGate.open) * s.h }))] : base;
};

const pumpkin = { x: PUMPKIN_HOME, y: GROUND - 44, w: 48, h: 44, vy: 0, roll: 0 };
const crows = [
  { x: 660, y: GROUND }, { x: 1480, y: GROUND }, { x: 2240, y: GROUND - 120 },
  { x: 3180, y: GROUND }, { x: 3760, y: GROUND },
  { x: 4580, y: GROUND }, { x: 5350, y: GROUND - 70 },
  { x: 5750, y: GROUND }, { x: 6380, y: GROUND - 100 },
].map((c, i) => ({ ...c, fly: false, gone: false, vx: 0, vy: 0, t: i * 2.3, face: hash(i) > 0.5 ? 1 : -1 }));

const brambleShape = (() => {
  const r = rng(77), strands = [];
  for (let i = 0; i < 9; i++) {
    const pts = [];
    let x = brambles.x - 6 + r() * 20, y = GROUND;
    for (let j = 0; j < 7 && x < brambles.x + brambles.w + 6; j++) {
      pts.push([x, y]);
      x += 8 + r() * 10;
      y = GROUND - 4 - r() * 24;
    }
    strands.push(pts);
  }
  return strands;
})();

// ---------- player & state ----------
const RUN = 220, ACC = 1600, AIR_ACC = 1100, FRICTION = 1800, AIR_DRAG = 200;
const GRAV = 1600, JUMP = 760, MAX_FALL = 820;
const player = {
  x: 60, y: GROUND - 44, w: 20, h: 44, vx: 0, vy: 0, face: 1,
  onGround: false, coyote: 0, jumpBuf: 0, walk: 0, stepAcc: 0,
  dead: false, hidden: false, pushing: false,
};
let cpIndex = 0, deadTimer = 0, fade = 1, ended = false, endT = 0;
let time = 0, windT = 0, gust = 0;

function gustAt(t) {           // 5 s cycle: calm, then a strong gust
  const p = t % 5;
  if (p < 2.6) return 0;
  if (p < 3.2) return ease((p - 2.6) / 0.6);
  if (p < 4.4) return 1;
  return 1 - ease((p - 4.4) / 0.6);
}

function moveBox(b, dx, dy, list) {
  let hit = false;
  if (dx) { b.x += dx; for (const s of list) if (overlap(b, s)) { b.x = dx > 0 ? s.x - b.w : s.x + s.w; hit = true; } }
  if (dy) { b.y += dy; for (const s of list) if (overlap(b, s)) { b.y = dy > 0 ? s.y - b.h : s.y + s.h; hit = true; } }
  return hit;
}

function killPlayer(burst) {
  if (player.dead) return;
  player.dead = true;
  deadTimer = 1.5;
  if (burst) {
    player.hidden = true;
    leafBurst(player.x + player.w / 2, player.y + player.h / 2, 50, true);
    thud();
  } else if (player.y > H) thud();
}

function warpCheckpoint(index) {
  cpIndex = Math.max(0, Math.min(checkpoints.length - 1, index));
  const c = checkpoints[cpIndex];
  ended = false;
  endT = 0;
  fade = 0;
  player.dead = false;
  player.hidden = false;
  player.onGround = true;
  player.vx = 0;
  player.vy = 0;
  player.x = c.x;
  player.y = c.y - player.h;
  jumpQueued = false;
  for (const lp of leafPits) lp.broken = false;
  snapCamera = true;
}

function respawn() {
  let c = checkpoints[cpIndex];
  const hasSupport = x => solids.some(s => !s.wall && x >= s.x && x <= s.x + s.w && c.y >= s.y - 5 && c.y <= s.y + 5);
  if (!hasSupport(c.x)) {
    cpIndex = Math.max(0, cpIndex - 1);
    c = checkpoints[cpIndex];
  }
  Object.assign(player, { x: c.x, y: c.y - player.h, vx: 0, vy: 0, dead: false, hidden: false, onGround: true, face: 1, jumpBuf: 0 });
  jumpQueued = false;
  for (const lp of leafPits) lp.broken = false;
  snapCamera = true;
}

// ---------- update ----------
function update(dt) {
  time += dt; windT += dt; gust = gustAt(windT);
  updateGate(dt); updatePumpkin(dt); updateHillPuzzle(dt); updateCrows(dt); updateBursts(dt); updateMovingPlatforms(dt);
  if (ended) { endT += dt; return; }
  if (player.dead) {
    deadTimer -= dt;
    if (deadTimer < 0.9) fade = Math.min(1, fade + dt * 2.2);
    if (deadTimer <= 0) respawn();
    return;
  }
  fade = Math.max(0, fade - dt * 1.6);
  updatePlayer(dt);
}

function updatePlayer(dt) {
  const p = player;
  const dir = (holdR() ? 1 : 0) - (holdL() ? 1 : 0);
  if (dir) p.face = dir;
  else if (Math.abs(p.vx) > 20) p.face = p.vx > 0 ? 1 : -1;
  const maxSpd = RUN * (p.pushing ? 0.55 : 1);
  if (dir) {
    const keepMomentum = !p.onGround && Math.sign(p.vx) === dir && Math.abs(p.vx) > maxSpd;
    if (!keepMomentum) p.vx = approach(p.vx, dir * maxSpd, (p.onGround ? ACC : AIR_ACC) * dt);
  } else {
    p.vx = approach(p.vx, 0, (p.onGround ? FRICTION : AIR_DRAG) * dt);
  }

  // wind carries you through the air while it gusts
  const inWind = (p.x + p.w > WIND.x0 && p.x < WIND.x1) ||
                  (p.x + p.w > WIND2.x0 && p.x < WIND2.x1) ||
                  (p.x + p.w > WIND3.x0 && p.x < WIND3.x1);
  if (inWind && !p.onGround) p.vx = Math.min(p.vx + gust * 900 * dt, 560);

  // jumping (with a short buffer and "coyote time" for forgiving controls)
  if (jumpQueued) { p.jumpBuf = 0.12; jumpQueued = false; } else p.jumpBuf -= dt;
  p.coyote = p.onGround ? 0.1 : p.coyote - dt;
  if (p.jumpBuf > 0 && p.coyote > 0) {
    p.vy = -JUMP; p.jumpBuf = 0; p.coyote = 0; p.onGround = false; crunch(0.12);
  }
  p.vy += GRAV * dt * (p.vy < 0 && !holdJ() ? 2.2 : 1);   // release early = shorter jump
  p.vy = Math.min(p.vy, MAX_FALL);

  // horizontal movement + pushing the pumpkin
  const list = solidList();
  let dx = p.vx * dt;
  if (inWind && p.onGround) dx += gust * 30 * dt;
  p.pushing = false;
  if (dx !== 0) {
    p.x += dx;
    for (const s of list) if (overlap(p, s)) { p.x = dx > 0 ? s.x - p.w : s.x + s.w; p.vx = 0; }
    if (overlap(p, pumpkin)) {
      const push = dx > 0 ? p.x + p.w - pumpkin.x : p.x - (pumpkin.x + pumpkin.w);
      const before = pumpkin.x;
      moveBox(pumpkin, push, 0, list);
      if (overlap(p, pumpkin)) p.x = dx > 0 ? pumpkin.x - p.w : pumpkin.x + pumpkin.w;
      if (pumpkin.x !== before && p.onGround) { p.pushing = true; pumpkin.roll += pumpkin.x - before; }
    }
    if (overlap(p, hillCrate)) {
      const push = dx > 0 ? p.x + p.w - hillCrate.x : p.x - (hillCrate.x + hillCrate.w);
      const before = hillCrate.x;
      moveBox(hillCrate, push, 0, list);
      if (overlap(p, hillCrate)) p.x = dx > 0 ? hillCrate.x - p.w : hillCrate.x + hillCrate.w;
      if (hillCrate.x !== before && p.onGround) { p.pushing = true; hillCrate.roll += hillCrate.x - before; }
    }
  }

  // vertical movement
  const wasGround = p.onGround, vyBefore = p.vy;
  p.onGround = false;
  const dy = p.vy * dt;
  p.y += dy;
  for (const s of [...list, pumpkin]) {
    if (overlap(p, s)) {
      if (dy > 0) { p.y = s.y - p.h; p.onGround = true; } else p.y = s.y + s.h;
      p.vy = 0;
    }
  }
  if (p.onGround && !wasGround && vyBefore > 250) crunch(Math.min(0.25, vyBefore / 2500));

  // walk cycle & footsteps in the leaves
  if (p.onGround && Math.abs(p.vx) > 20) {
    p.walk += Math.abs(p.vx) * dt * 0.055;
    p.stepAcc += Math.abs(p.vx) * dt;
    if (p.stepAcc > 34) { p.stepAcc = 0; crunch(0.05); }
  }

  // leaf piles hiding pits
  for (const lp of leafPits) {
    if (!lp.broken && p.y + p.h > GROUND + 4 && p.x + p.w > lp.x && p.x < lp.x + lp.w) {
      lp.broken = true; leafBurst(p.x + p.w / 2, GROUND, 40, false); crunch(0.3);
    }
  }

  // hazards
  const b = brambles;
  if (p.x + p.w > b.x + 6 && p.x < b.x + b.w - 6 && p.y + p.h > b.y + 6) killPlayer(true);
  if (p.x + p.w > lateBramble.x && p.x < lateBramble.x + lateBramble.w && p.y + p.h > lateBramble.y) killPlayer(true);
  for (const pad of bouncePads) {
    if (p.vy >= 0 && p.x + p.w > pad.x && p.x < pad.x + pad.w && p.y + p.h >= pad.y && p.y + p.h <= pad.y + 12) {
      p.vy = -820; p.onGround = false; leafBurst(p.x + p.w / 2, pad.y, 18, false); crunch(0.18);
    }
  }
  if (p.y > H + 60) killPlayer(false);

  // checkpoints
  for (let i = cpIndex + 1; i < checkpoints.length; i++) {
    const c = checkpoints[i];
    const supported = solids.some(s => !s.wall && p.x + p.w > s.x && p.x < s.x + s.w && Math.abs(p.y + p.h - s.y) < 4);
    if (supported && p.onGround && p.x > c.x && Math.abs(p.y + p.h - c.y) < 4) cpIndex = i;
  }

  if (p.x > FIRE_X - 90) { ended = true; p.vx = 0; }
}

function updatePumpkin(dt) {
  const pk = pumpkin;
  pk.vy = Math.min(pk.vy + GRAV * dt, MAX_FALL);
  if (moveBox(pk, 0, pk.vy * dt, solidList())) { if (pk.vy > 300) crunch(0.2); pk.vy = 0; }
  if (pk.y > H + 80) Object.assign(pk, { x: PUMPKIN_HOME, y: GROUND - pk.h, vy: 0 });
}

function updateGate(dt) {
  const c = pumpkin.x + pumpkin.w / 2;
  const pressed = pumpkin.y + pumpkin.h >= GROUND - 1 && c > plate.x && c < plate.x + plate.w + 10;
  plate.press = approach(plate.press, pressed || gate.latched ? 1 : 0, dt * 6);
  if (pressed && !gate.latched) { gate.latched = true; rumble(); }
  if (gate.latched) gate.open = Math.min(1, gate.open + dt * 0.6);
}

function updateCrows(dt) {
  for (const c of crows) {
    c.t += dt;
    if (!c.fly && !c.gone && !player.dead && Math.abs(player.x - c.x) < 150) {
      c.fly = true;
      const d = c.x > player.x ? 1 : -1;
      c.vx = d * (120 + Math.random() * 60); c.vy = -220;
      flap();
    }
    if (c.fly) {
      c.vy -= 60 * dt; c.x += c.vx * dt; c.y += c.vy * dt;
      if (c.y < -60) { c.fly = false; c.gone = true; }
    }
  }
}

function updateMovingPlatforms(dt) {
  for (const platform of movingPlatforms) {
    platform.x = platform.baseX + Math.sin(time * 0.8 + platform.phase) * platform.ampX;
    platform.y = platform.baseY + Math.sin(time * 1.1 + platform.phase) * platform.ampY;
  }
}

function updateHillPuzzle(dt) {
  hillCrate.vy = Math.min(hillCrate.vy + GRAV * dt, MAX_FALL);
  if (moveBox(hillCrate, 0, hillCrate.vy * dt, solidList())) {
    if (hillCrate.vy > 300) crunch(0.2);
    hillCrate.vy = 0;
  }
  const center = hillCrate.x + hillCrate.w / 2;
  const pressed = hillCrate.y + hillCrate.h >= GROUND - 1 && center > hillPlate.x && center < hillPlate.x + hillPlate.w;
  hillPlate.press = approach(hillPlate.press, pressed ? 1 : 0, dt * 6);
  if (pressed) hillGate.open = Math.min(1, hillGate.open + dt * 0.8);
}

// ---------- particles ----------
const bursts = [];
function leafBurst(x, y, n, dark) {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, s = 120 + Math.random() * 260;
    bursts.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1.2 + Math.random() * 1.2,
      rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12, size: 3 + Math.random() * 4,
      color: dark && Math.random() < 0.5 ? INK : LEAF_COLORS[i % 5],
    });
  }
}
function updateBursts(dt) {
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.vy += 500 * dt; b.vx *= 1 - 1.8 * dt; b.vy *= 1 - 1.2 * dt;
    b.vx += (0.15 + gust) * 60 * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.vr * dt; b.life -= dt;
    if (b.life <= 0) bursts.splice(i, 1);
  }
}

function newLeaf(anywhere) {
  const z = 0.4 + Math.random() * 1.3;
  return {
    x: Math.random() * (W + 40) - 20, y: anywhere ? Math.random() * H : -20, z,
    fall: 25 + Math.random() * 35, sway: Math.random() * 6, swaySpd: 1 + Math.random() * 2,
    rot: Math.random() * 6, vr: (Math.random() - 0.5) * 4, flip: Math.random() * 6,
    size: (2.5 + Math.random() * 2.5) * z,
    color: z > 1.45 ? INK : LEAF_COLORS[Math.floor(Math.random() * 5)],
  };
}
const leaves = Array.from({ length: 380 }, () => newLeaf(true));
function updateLeaves(dt, camDX) {
  const wind = 0.15 + gust;
  for (const l of leaves) {
    l.sway += l.swaySpd * dt; l.flip += dt * 3; l.rot += l.vr * dt * (1 + gust);
    l.x += (Math.sin(l.sway) * 25 + wind * 170) * l.z * dt - camDX * l.z;
    l.y += (l.fall + Math.cos(l.sway * 1.3) * 10) * l.z * dt;
    if (l.y > H + 20) Object.assign(l, newLeaf(false));
    if (l.x > W + 30) l.x -= W + 60; else if (l.x < -30) l.x += W + 60;
  }
}

const puffs = Array.from({ length: 7 }, (_, i) => ({ x: i * 260, y: 300 + hash(i) * 150, r: 180 + hash(i + 3) * 160, spd: 6 + hash(i + 7) * 10 }));

// ---------- pre-rendered parallax layers ----------
function branch(g, x, y, len, ang, w, depth, r, o) {
  const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
  g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
  if (depth <= 0 || len < 3) {
    if (o.leafColor && r() < 0.78) {
      g.fillStyle = o.leafColor; g.beginPath(); g.arc(x2, y2, 2 + r() * 3.8, 0, Math.PI * 2); g.fill();
      g.fillStyle = o.color;
    }
    return;
  }
  const n = r() < 0.35 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const spread = (i - (n - 1) / 2) * (0.5 + r() * 0.35);
    const na = ang + spread + (r() - 0.5) * 0.35 + (-Math.PI / 2 - ang) * 0.12;
    branch(g, x2, y2, len * (0.66 + r() * 0.16), na, w * 0.66, depth - 1, r, o);
  }
}
function makeLayer(o) {
  const res = o.res || 1;
  const c = document.createElement('canvas');
  c.width = o.width * res; c.height = H * res;
  const g = c.getContext('2d'); g.scale(res, res);
  g.fillStyle = o.color; g.strokeStyle = o.color; g.lineCap = 'round';
  const hill = x => {
    const t = (x / o.width) * Math.PI * 2;
    return o.base + Math.sin(t * o.k1 + o.seed) * o.amp + Math.sin(t * o.k2 + o.seed * 2) * o.amp * 0.5;
  };
  g.beginPath(); g.moveTo(0, H);
  for (let x = 0; x <= o.width; x += 6) g.lineTo(x, hill(x));
  g.lineTo(o.width, H); g.closePath(); g.fill();
  const r = rng(o.seed);
  for (let i = 0; i < o.trees; i++) {
    const x = r() * o.width, h = o.minH + r() * (o.maxH - o.minH), ts = Math.floor(r() * 1e9);
    for (const off of [-o.width, 0, o.width]) {       // duplicate across the seam so it tiles
      if (x + off < -h || x + off > o.width + h) continue;
      const tr = rng(ts);
      branch(g, x + off, hill(x) + 3, h * 0.34, -Math.PI / 2 + (tr() - 0.5) * 0.15, Math.max(1.2, h * 0.045), o.depth, tr, o);
    }
  }
  return { canvas: c, w: o.width, factor: o.factor };
}
function makeForeground() {
  const width = 3200;
  const c = document.createElement('canvas');
  c.width = width * RES; c.height = H * RES;
  const g = c.getContext('2d'); g.scale(RES, RES);
  g.fillStyle = INK; g.strokeStyle = INK; g.lineCap = 'round';
  const r = rng(99), o = { color: INK };
  for (const tx of [500, 1700, 2600]) {
    const w = 46 + r() * 24;
    g.beginPath(); g.moveTo(tx - w * 0.8, H);
    g.quadraticCurveTo(tx - w * 0.45, H * 0.5, tx - w * 0.4, -10);
    g.lineTo(tx + w * 0.4, -10);
    g.quadraticCurveTo(tx + w * 0.45, H * 0.5, tx + w * 0.8, H);
    g.fill();
    for (let k = 0; k < 3; k++) {
      const side = r() < 0.5 ? -1 : 1;
      branch(g, tx + side * w * 0.3, 30 + r() * 150, 70 + r() * 50, side < 0 ? Math.PI + 0.4 + r() * 0.3 : -0.4 - r() * 0.3, 10, 4, r, o);
    }
  }
  g.beginPath(); g.moveTo(0, H);
  for (let x = 0; x <= width; x += 5) g.lineTo(x, H - 8 - hash(x) * 10 - Math.sin(x * 0.01) * 4);
  g.lineTo(width, H); g.closePath(); g.fill();
  return { canvas: c, w: width, factor: 1.35 };
}

const layers = [
  makeLayer({ seed: 11, width: 2400, color: '#b45a33', base: 330, amp: 25, k1: 2, k2: 5, trees: 40, minH: 40, maxH: 80, depth: 5, factor: 0.12 }),
  makeLayer({ seed: 22, width: 2400, color: '#86391f', base: 370, amp: 22, k1: 3, k2: 7, trees: 30, minH: 80, maxH: 150, depth: 6, factor: 0.25, leafColor: '#a8441f' }),
  makeLayer({ seed: 33, width: 2400, color: '#4f1f12', base: 410, amp: 16, k1: 2, k2: 9, trees: 22, minH: 150, maxH: 260, depth: 6, factor: 0.45, leafColor: '#7a2e14', res: RES }),
  makeLayer({ seed: 44, width: 2400, color: '#26110a', base: 445, amp: 12, k1: 4, k2: 11, trees: 12, minH: 260, maxH: 420, depth: 7, factor: 0.7, leafColor: '#45190b', res: RES }),
];
const fgLayer = makeForeground();

const vignette = document.createElement('canvas');
vignette.width = W; vignette.height = H;
{
  const g = vignette.getContext('2d');
  const gr = g.createRadialGradient(W / 2, H * 0.55, H * 0.35, W / 2, H * 0.55, W * 0.75);
  gr.addColorStop(0, 'rgba(255,180,90,0.05)'); gr.addColorStop(1, 'rgba(55,25,18,0.34)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
}
const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
skyGrad.addColorStop(0, '#6a4560'); skyGrad.addColorStop(0.45, '#ad5734');
skyGrad.addColorStop(0.72, '#e8a953'); skyGrad.addColorStop(1, '#f7d78d');

// ---------- rendering ----------
let camX = 0, prevCamX = 0, snapCamera = true;

function radial(x, y, r, col) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
function drawLeaf(x, y, s, rot, flip, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1, flip);
  ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(-s, 0); ctx.quadraticCurveTo(0, -s * 0.75, s, 0); ctx.quadraticCurveTo(0, s * 0.75, -s, 0);
  ctx.fill(); ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+60,y+7);ctx.lineTo(x+6,y+7);ctx.closePath();ctx.fill();
  for(let i=0;i<3;i++){const lx=x+w*(.18+i*.28);drawLeaf(lx,y-5-(i%2)*3,4,time*.7+i,i%2?-1:1,LEAF_COLORS[i%LEAF_COLORS.length]);}
  ctx.strokeStyle='#7f8a3e';ctx.lineWidth=1.4;ctx.beginPath();
  ctx.moveTo(x+20,y+h-2);ctx.quadraticCurveTo(x+14,y+h+12,x+21,y+h+19);
  ctx.moveTo(x+w-28,y+h-2);ctx.quadraticCurveTo(x+w-35,y+h+9,x+w-28,y+h+15);ctx.stroke();
  radial(x+w/2,y+h*.35,12,'rgba(255,192,94,.16)');ctx.fillStyle='#ffd47a';
  ctx.beginPath();ctx.arc(x+w/2,y+h*.35,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawLayer(L) {
  let off = -((camX * L.factor) % L.w);
  if (off > 0) off -= L.w;
  for (let x = off; x < W; x += L.w) ctx.drawImage(L.canvas, Math.round(x), 0, L.w, H);
}
function fogBand(alpha, top = 250, col = '240,150,90') {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${alpha})`);
  ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top);
}
function drawSky() {
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
  const sx = W * 0.68 - camX * 0.03, sy = 300;
  radial(sx, sy, 360, 'rgba(255,220,150,0.55)');
  ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawMovingPlatform(p) {
  const x=p.x,y=p.y,w=p.w,h=p.h;
  ctx.save();ctx.fillStyle='#5a2a16';ctx.beginPath();
  ctx.moveTo(x+4,y);ctx.quadraticCurveTo(x+w*.12,y-5,x+w*.28,y-2);
  ctx.quadraticCurveTo(x+w*.5,y-6,x+w*.72,y-2);ctx.quadraticCurveTo(x+w*.88,y-5,x+w-4,y);
  ctx.lineTo(x+w-7,y+h);ctx.lineTo(x+7,y+h);ctx.closePath();ctx.fill();
  ctx.fillStyle='#b86b32';ctx.fillRect(x+8,y-2,w-16,4);
  ctx.fillStyle='#d08a43';ctx.fillRect(x+15,y-3,w*.27,2);ctx.fillRect(x+w*.56,y-2,w*.18,2);
  ctx.strokeStyle='rgba(54,24,12,.72)';ctx.lineWidth=1;ctx.beginPath();
  ctx.moveTo(x+w*.18,y+4);ctx.lineTo(x+w*.21,y+h-4);
  ctx.moveTo(x+w*.49,y+2);ctx.lineTo(x+w*.46,y+h-5);
  ctx.moveTo(x+w*.78,y+5);ctx.lineTo(x+w*.76,y+h-3);ctx.stroke();
  ctx.fillStyle='#71803a';ctx.beginPath();ctx.moveTo(x+2,y+2);
  ctx.quadraticCurveTo(x+18,y-8,x+34,y+1);ctx.quadraticCurveTo(x+48,y-7,x+64,y+2);
  ctx.lineTo(x+