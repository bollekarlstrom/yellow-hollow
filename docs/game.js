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
    if (e.code === 'KeyC' && !ended) {
      cpIndex = Math.min(checkpoints.length - 1, cpIndex + 1);
      respawn();
    }
    if (/^Digit[1-9]$/.test(e.code) && !ended) {
      const index = Math.min(checkpoints.length - 1, Number(e.code.slice(-1)) - 1);
      cpIndex = index;
      respawn();
    }
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
const WORLD_END = 9000;
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
];
const leafPits = [
  { x: 900, w: 110, broken: false },
  { x: 3350, w: 100, broken: false },
  { x: 5100, w: 100, broken: false },
  { x: 6120, w: 100, broken: false },
];
const gate = { x: 1700, w: 26, h: 170, open: 0, latched: false };
const plate = { x: 1640, w: 60, press: 0 };
const brambles = { x: 2900, y: GROUND - 24, w: 90, h: 24 };
const WIND = { x0: 2150, x1: 2620 };
const WIND2 = { x0: 5300, x1: 5700 };
const FIRE_X = 8720;
const PUMPKIN_HOME = 1250;
const checkpoints = [
  { x: 60, y: GROUND }, { x: 1060, y: GROUND }, { x: 1760, y: GROUND },
  { x: 1950, y: GROUND - 120 }, { x: 2660, y: GROUND }, { x: 3500, y: GROUND },
  { x: 4450, y: GROUND }, { x: 5200, y: GROUND - 70 }, { x: 5580, y: GROUND },
  { x: 6250, y: GROUND - 100 }, { x: 7400, y: GROUND }, { x: 8200, y: GROUND },
];
const hints = [
  { x: 130, y: 180, t: '←  →   walk' },
  { x: 130, y: 205, t: 'R restart   C next checkpoint   1-9 choose checkpoint   M mute', small: true },
  { x: 480, y: 180, t: 'space   jump' },
  { x: 1180, y: 180, t: 'walk into things to push them' },
  { x: 2020, y: 150, t: 'listen to the wind' },
  { x: 4520, y: 180, t: 'the old orchard continues beyond the hollow' },
  { x: 5380, y: 150, t: 'a second gust crosses the ridge' },
  { x: 6280, y: 130, t: 'follow the lantern glow' },
];
function gateRect() { return { x: gate.x, y: GROUND - gate.h - gate.open * gate.h, w: gate.w, h: gate.h }; }
const solidList = () => (gate.open < 1 ? [...solids, gateRect(), ...movingPlatforms] : [...solids, ...movingPlatforms]);

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

function respawn() {
  const c = checkpoints[cpIndex];
  Object.assign(player, { x: c.x, y: c.y - player.h, vx: 0, vy: 0, dead: false, hidden: false, onGround: true, face: 1, jumpBuf: 0 });
  jumpQueued = false;
  for (const lp of leafPits) lp.broken = false;
  snapCamera = true;
}

// ---------- update ----------
function update(dt) {
  time += dt; windT += dt; gust = gustAt(windT);
  updateGate(dt); updatePumpkin(dt); updateCrows(dt); updateBursts(dt); updateMovingPlatforms(dt);
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
  const maxSpd = RUN * (p.pushing ? 0.55 : 1);
  if (dir) {
    const keepMomentum = !p.onGround && Math.sign(p.vx) === dir && Math.abs(p.vx) > maxSpd;
    if (!keepMomentum) p.vx = approach(p.vx, dir * maxSpd, (p.onGround ? ACC : AIR_ACC) * dt);
  } else {
    p.vx = approach(p.vx, 0, (p.onGround ? FRICTION : AIR_DRAG) * dt);
  }

  // wind carries you through the air while it gusts
  const inWind = (p.x + p.w > WIND.x0 && p.x < WIND.x1) ||
                  (p.x + p.w > WIND2.x0 && p.x < WIND2.x1);
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
    if (p.onGround && p.x > c.x && Math.abs(p.y + p.h - c.y) < 4) cpIndex = i;
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
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(48,21,10,0.48)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
}
const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
skyGrad.addColorStop(0, '#51304b'); skyGrad.addColorStop(0.45, '#9b4b2b');
skyGrad.addColorStop(0.72, '#e09a48'); skyGrad.addColorStop(1, '#f6c76f');

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
function drawHints() {
  ctx.save(); ctx.textAlign = 'center';
  for (const h of hints) {
    const sx = h.x - camX;
    if (sx < -300 || sx > W + 300) continue;
    ctx.font = h.small ? '13px Georgia, serif' : 'italic 20px Georgia, serif';
    ctx.fillStyle = 'rgba(255,225,180,0.55)';
    ctx.fillText(h.t, sx, h.y);
  }
  ctx.restore();
}
function drawLeaves(front) {
  for (const l of leaves) {
    if ((l.z >= 1) !== front) continue;
    ctx.globalAlpha = Math.min(1, 0.45 + l.z * 0.4);
    drawLeaf(l.x, l.y, l.size, l.rot, Math.cos(l.flip), l.color);
  }
  ctx.globalAlpha = 1;
}
function drawWindStreaks() {
  if (gust < 0.05) return;
  const a = WIND.x0 - camX, b = WIND.x1 - camX + 200;
  if (b < 0 || a > W) return;
  ctx.save();
  ctx.strokeStyle = `rgba(255,230,190,${0.2 * gust})`; ctx.lineWidth = 1.2; ctx.beginPath();
  const span = b - a + 200;
  for (let i = 0; i < 26; i++) {
    const y = 120 + hash(i) * 320, len = 40 + hash(i + 9) * 80;
    const x = a - 100 + ((time * (500 + hash(i + 3) * 300) + hash(i + 5) * span) % span);
    ctx.moveTo(x, y); ctx.quadraticCurveTo(x + len * 0.5, y - 4, x + len, y);
  }
  ctx.stroke(); ctx.restore();
}

function drawGrass(x0, x1) {
  ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.beginPath();
  for (const s of solids) {
    if (s.wall) continue;
    const end = Math.min(s.x + s.w, x1);
    for (let x = s.x + Math.max(0, Math.ceil((x0 - s.x) / 3) * 3); x < end; x += 3) {
      const h = 2 + hash(x) * 8;
      const lean = (hash(x + 0.5) - 0.5) * 5 + (0.15 + gust) * 3 * Math.sin(time * 3 + x * 0.05);
      ctx.moveTo(x, s.y + 1); ctx.lineTo(x + lean, s.y - h);
    }
  }
  ctx.stroke();
}
function drawLeafPile(lp) {
  const r = rng(lp.x);
  if (!lp.broken) {
    ctx.fillStyle = INK; ctx.beginPath(); ctx.moveTo(lp.x - 6, GROUND + 18);
    for (let x = lp.x - 6; x <= lp.x + lp.w + 6; x += 6) {
      ctx.lineTo(x, GROUND - 2 - r() * 5 - Math.sin(((x - lp.x) / lp.w) * Math.PI) * 5);
    }
    ctx.lineTo(lp.x + lp.w + 6, GROUND + 18); ctx.closePath(); ctx.fill();
    for (let i = 0; i < 14; i++) {   // a few leaves that rustle slightly... a hint
      const lx = lp.x + r() * lp.w, ly = GROUND - 3 - r() * 6;
      drawLeaf(lx, ly, 3 + r() * 2, r() * 6 + Math.sin(time * 2 + i) * 0.15, 1, r() < 0.5 ? '#5a200e' : '#3a1508');
    }
  } else {
    for (let i = 0; i < 10; i++) {
      const side = i % 2 ? lp.x - r() * 14 : lp.x + lp.w + r() * 14;
      drawLeaf(side, GROUND - 2, 3 + r() * 2, r() * 6, 1, '#3a1508');
    }
  }
}
function drawPlate() {
  const y = GROUND - 6 + plate.press * 5;
  ctx.fillStyle = '#2a140b'; ctx.fillRect(plate.x, y, plate.w, 6);
  ctx.fillStyle = '#7a3516'; ctx.fillRect(plate.x, y, plate.w, 1.5);
}
function drawGate() {
  const g = gateRect();
  ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath();
  ctx.moveTo(g.x + 5, -10); ctx.lineTo(g.x + 5, g.y + 5);
  ctx.moveTo(g.x + g.w - 5, -10); ctx.lineTo(g.x + g.w - 5, g.y + 5);
  ctx.stroke();
  ctx.fillStyle = INK;
  const n = 3, sw = g.w / n;
  for (let i = 0; i < n; i++) {
    const x = g.x + i * sw;
    ctx.beginPath();
    ctx.moveTo(x + 1, g.y); ctx.lineTo(x + sw - 1, g.y); ctx.lineTo(x + sw - 1, g.y + g.h - 10);
    ctx.lineTo(x + sw / 2, g.y + g.h); ctx.lineTo(x + 1, g.y + g.h - 10); ctx.closePath(); ctx.fill();
  }
  ctx.fillRect(g.x - 3, g.y + 20, g.w + 6, 7);
  ctx.fillRect(g.x - 3, g.y + g.h - 60, g.w + 6, 7);
}
function drawBrambles() {
  ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
  for (const pts of brambleShape) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const [px, py] = pts[i - 1], [x, y] = pts[i];
      ctx.quadraticCurveTo(px + (x - px) * 0.5, py - 10, x, y);
    }
    ctx.stroke();
    for (const [x, y] of pts) {
      ctx.beginPath(); ctx.moveTo(x - 2, y); ctx.lineTo(x, y - 6); ctx.lineTo(x + 2, y); ctx.fill();
    }
  }
}
function drawPumpkin() {
  const pk = pumpkin, cx = pk.x + pk.w / 2, by = pk.y + pk.h;
  ctx.save(); ctx.translate(cx, by); ctx.rotate(Math.sin(pk.roll * 0.12) * 0.08);
  ctx.fillStyle = INK; ctx.beginPath();
  ctx.ellipse(-11, -21, 13, 21, 0, 0, Math.PI * 2);
  ctx.ellipse(11, -21, 13, 21, 0, 0, Math.PI * 2);
  ctx.ellipse(0, -22, 15, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#6a2a10'; ctx.lineWidth = 1.5;   // warm rim light = "you can use this"
  for (const [ox, rx] of [[-11, 13], [0, 15], [11, 13]]) {
    ctx.beginPath(); ctx.ellipse(ox, -21, rx - 1, 20, 0, -1.3, -0.3); ctx.stroke();
  }
  ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -41); ctx.quadraticCurveTo(1, -48, 6, -51); ctx.stroke();
  ctx.restore();
}
function drawCrow(c) {
  ctx.save(); ctx.translate(c.x, c.y); ctx.fillStyle = INK; ctx.strokeStyle = INK; ctx.lineCap = 'round';
  if (!c.fly) {
    ctx.scale(c.face, 1);
    const peck = Math.sin(c.t * 1.7) > 0.85 ? 3 : 0;
    ctx.beginPath(); ctx.ellipse(0, -9, 9, 6, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-6, -10); ctx.lineTo(-17, -6); ctx.lineTo(-15, -3); ctx.lineTo(-5, -6); ctx.fill();
    ctx.beginPath(); ctx.arc(8, -15 + peck, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(11, -16 + peck); ctx.lineTo(17, -14 + peck); ctx.lineTo(11, -13 + peck); ctx.fill();
    ctx.lineWidth = 1.2; ctx.beginPath();
    ctx.moveTo(-1, -4); ctx.lineTo(-2, 0); ctx.moveTo(2, -4); ctx.lineTo(3, 0); ctx.stroke();
  } else {
    ctx.scale(Math.sign(c.vx) || 1, 1);
    const f = Math.sin(c.t * 22) * 10;
    ctx.beginPath(); ctx.ellipse(0, 0, 9, 4.5, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(8, -4, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(-17, 3); ctx.lineTo(-8, 3); ctx.fill();
    ctx.lineWidth = 3; ctx.beginPath();
    ctx.moveTo(-2, -2); ctx.quadraticCurveTo(-8, -10 - f, -16, -6 - f * 1.6);
    ctx.moveTo(2, -2); ctx.quadraticCurveTo(6, -12 - f, 0, -16 - f * 1.8);
    ctx.stroke();
  }
  ctx.restore();
}
function drawFire() {
  if (FIRE_X - camX > W + 400) return;
  const x = FIRE_X, y = GROUND;
  // cottage
  const hx = FIRE_X + 110;
  ctx.fillStyle = INK;
  ctx.fillRect(hx, y - 90, 130, 90);
  ctx.beginPath(); ctx.moveTo(hx - 15, y - 88); ctx.lineTo(hx + 65, y - 150); ctx.lineTo(hx + 145, y - 88); ctx.fill();
  ctx.fillRect(hx + 95, y - 150, 16, 40);
  ctx.fillStyle = '#ffb85c'; ctx.fillRect(hx + 30, y - 65, 22, 22);
  ctx.fillStyle = INK; ctx.fillRect(hx + 40, y - 65, 2, 22); ctx.fillRect(hx + 30, y - 55, 22, 2);
  // logs
  ctx.save(); ctx.translate(x, y - 5); ctx.rotate(0.25); ctx.fillRect(-22, -4, 44, 8);
  ctx.rotate(-0.5); ctx.fillRect(-22, -4, 44, 8); ctx.restore();
  // flames
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    const h = 34 + 14 * Math.sin(time * 7 + i * 1.7) + 6 * Math.sin(time * 13 + i);
    const xo = x + (i - 1.5) * 7, w = 10;
    const g = ctx.createLinearGradient(0, y, 0, y - h);
    g.addColorStop(0, 'rgba(255,240,170,0.9)'); g.addColorStop(0.5, 'rgba(255,140,40,0.7)'); g.addColorStop(1, 'rgba(200,60,20,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(xo - w, y - 6);
    ctx.quadraticCurveTo(xo - w, y - h * 0.5, xo + Math.sin(time * 5 + i) * 4, y - h);
    ctx.quadraticCurveTo(xo + w, y - h * 0.5, xo + w, y - 6); ctx.fill();
  }
  for (let i = 0; i < 8; i++) {            // sparks
    const t = (time * 0.6 + i / 8) % 1;
    ctx.fillStyle = `rgba(255,190,90,${1 - t})`;
    ctx.fillRect(x + Math.sin(i * 12.9 + t * 6) * 14, y - 20 - t * 130, 2, 2);
  }
  ctx.restore();
}
function drawPlayer() {
  const p = player;
  if (p.hidden) return;
  const cx = p.x + p.w / 2, by = p.y + p.h;
  const moving = p.onGround && Math.abs(p.vx) > 20;
  const ph = p.walk;
  ctx.save(); ctx.translate(cx, by); ctx.scale(p.face * 1.25, 1.25);
  ctx.fillStyle = INK; ctx.strokeStyle = INK; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.translate(0, moving ? -Math.abs(Math.sin(ph)) * 1.5 : Math.sin(time * 2) * 0.4);

  // legs
  ctx.lineWidth = 4;
  const leg = (hx, a1, a2) => {
    const kx = hx + Math.sin(a1) * 8, ky = -16 + Math.cos(a1) * 8;
    const fx = kx + Math.sin(a2) * 8, fy = ky + Math.cos(a2) * 8;
    ctx.beginPath(); ctx.moveTo(hx, -16); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
    ctx.fillRect(fx - 2, fy - 1, 7, 3);
  };
  if (!p.onGround) {
    if (p.vy < 0) { leg(-1, -0.2, -0.7); leg(2, 0.9, 0.1); }
    else { leg(-1, -0.35, 0.1); leg(2, 0.5, -0.1); }
  } else if (moving) {
    for (const [hx, o] of [[-1, 0], [2, Math.PI]]) {
      const s = Math.sin(ph + o), a1 = s * 0.55;
      leg(hx, a1, a1 - Math.max(0, Math.cos(ph + o)) * 0.8);
    }
  } else { leg(-1, -0.08, -0.08); leg(2, 0.08, 0.08); }

  // lean forward when running or pushing
  ctx.translate(0, -16);
  ctx.rotate((Math.abs(p.vx) / RUN) * 0.07 + (p.pushing ? 0.2 : 0));
  ctx.translate(0, 16);

  // cloak, head, hood
  const flutter = Math.sin(time * 6) * 1.2 + (Math.abs(p.vx) / RUN) * 3;
  ctx.fillStyle = PLAYER_CLOAK;
  ctx.beginPath(); ctx.moveTo(-5, -33); ctx.lineTo(6, -33);
  ctx.quadraticCurveTo(10, -22, 9, -13);
  ctx.lineTo(-10 - flutter, -12 + Math.sin(time * 7));
  ctx.quadraticCurveTo(-9, -24, -5, -33); ctx.fill();

  ctx.strokeStyle = PLAYER_RIM; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-5, -31); ctx.quadraticCurveTo(-8, -21, -8, -14); ctx.stroke();

  // cloak folds, collar, and shoulder clasp
  ctx.strokeStyle = '#a85a32'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-3, -31); ctx.quadraticCurveTo(-1, -24, -3, -16); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4, -30); ctx.quadraticCurveTo(7, -23, 5, -15); ctx.stroke();
  ctx.fillStyle = PLAYER_RIM;
  ctx.beginPath(); ctx.ellipse(3, -32, 2.2, 2.8, 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(3, -32, 0.8, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.arc(1, -39, 7.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PLAYER_FACE;
  ctx.beginPath(); ctx.ellipse(-1, -39, 4.2, 5.5, 0, 0, Math.PI * 2); ctx.fill();

  // softer hair, brows, eyes, freckles, nose, and smile
  ctx.fillStyle = '#7a3a24';
  ctx.beginPath(); ctx.moveTo(-6, -43); ctx.quadraticCurveTo(-4, -49, 3, -46);
  ctx.quadraticCurveTo(7, -43, 5, -37); ctx.quadraticCurveTo(3, -42, -1, -44);
  ctx.quadraticCurveTo(-4, -44, -6, -43); ctx.fill();
  ctx.fillStyle = '#d68b72';
  ctx.beginPath(); ctx.ellipse(-3.7, -37.7, 1.5, 0.8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(2.6, -37.7, 1.5, 0.8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#4b2618'; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(-3.8, -41); ctx.quadraticCurveTo(-2.2, -41.8, -0.8, -41); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0.8, -41); ctx.quadraticCurveTo(2.2, -41.8, 3.8, -41); ctx.stroke();
  ctx.fillStyle = '#2b1711';
  ctx.beginPath(); ctx.arc(-2.1, -39.8, 0.85, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(2.1, -39.8, 0.85, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff2b4';
  ctx.beginPath(); ctx.arc(-1.8, -40.1, 0.22, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(2.4, -40.1, 0.22, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#713621'; ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.moveTo(0, -38.4); ctx.quadraticCurveTo(0.5, -37.2, 0.1, -36.8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-1.5, -35.4); ctx.quadraticCurveTo(0.1, -34.2, 1.7, -35.4); ctx.stroke();
  ctx.fillStyle = '#c96a50';
  ctx.fillRect(-3.4, -37.1, 0.55, 0.55); ctx.fillRect(-2.6, -36.7, 0.45, 0.45);
  ctx.fillRect(2.8, -37.1, 0.55, 0.55); ctx.fillRect(3.5, -36.7, 0.45, 0.45);
}
function drawBursts() {
  for (const b of bursts) {
    ctx.globalAlpha = Math.min(1, b.life);
    drawLeaf(b.x, b.y, b.size, b.rot, Math.cos(b.rot * 0.7), b.color);
  }
  ctx.globalAlpha = 1;
}
function drawGlow() {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  if (!player.hidden) {
    const lx = player.x + player.w / 2 + player.face * 14, ly = player.y + player.h - 14;
    const fl = 0.85 + Math.sin(time * 9) * 0.05 + Math.sin(time * 23) * 0.04;
    radial(lx, ly, 130 * fl, 'rgba(255,170,80,0.22)');
    radial(lx, ly, 18, 'rgba(255,210,140,0.5)');
  }
  if (FIRE_X - camX < W + 400) {
    radial(FIRE_X, GROUND - 20, 260 + Math.sin(time * 8) * 10, 'rgba(255,140,50,0.35)');
    radial(FIRE_X + 151, GROUND - 54, 70, 'rgba(255,170,80,0.25)');
  }
  ctx.restore();
}
function drawWorld() {
  const x0 = camX - 50, x1 = camX + W + 50;
  ctx.fillStyle = INK;
  for (const lp of leafPits) ctx.fillRect(lp.x, GROUND + 18, lp.w, H);   // darkness under the leaves
  for (const s of solids) {
    if (s.wall || s.x > x1 || s.x + s.w < x0) continue;
    ctx.fillRect(s.x, s.y, s.w, s.h);
  }
  drawGrass(x0, x1);
  drawLeafClusters();
  for (const lp of leafPits) drawLeafPile(lp);
  drawPlate(); drawGate(); drawBrambles(); drawPumpkin();
  ctx.fillStyle = '#5a2a16';
  for (const platform of movingPlatforms) {
    ctx.fillRect(platform.x, platform.y, platform.w, platform.h);
    ctx.fillStyle = '#b86b32'; ctx.fillRect(platform.x, platform.y, platform.w, 3);
    ctx.fillStyle = '#5a2a16';
  }
  for (const pad of bouncePads) {
    ctx.fillStyle = '#7a3516'; ctx.fillRect(pad.x, pad.y + 5, pad.w, 6);
    ctx.fillStyle = '#e09a48'; ctx.fillRect(pad.x + 8, pad.y + 2, pad.w - 16, 4);
  }
  ctx.fillStyle = INK;
  for (let x = lateBramble.x; x < lateBramble.x + lateBramble.w; x += 12) {
    ctx.beginPath(); ctx.moveTo(x - 5, GROUND); ctx.lineTo(x, lateBramble.y); ctx.lineTo(x + 5, GROUND); ctx.fill();
  }
  for (const c of crows) if (!c.gone) drawCrow(c);
  drawFire(); drawPlayer(); drawBursts(); drawGlow();
}
function drawOverlay() {
  if (time < 9 && cpIndex === 0) {
    const a = clamp(Math.min((time - 0.6) / 1.5, (8.5 - time) / 2), 0, 1);
    ctx.save(); ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(255,232,196,${a * 0.9})`;
    ctx.font = '300 54px Georgia, serif';
    ctx.fillText('E M B E R   H O L L O W', W / 2, 110);
    ctx.restore();
  }
  if (fade > 0) { ctx.fillStyle = `rgba(0,0,0,${fade})`; ctx.fillRect(0, 0, W, H); }
  if (ended) {
    ctx.fillStyle = `rgba(20,8,3,${clamp(endT / 2.5, 0, 1) * 0.75})`; ctx.fillRect(0, 0, W, H);
    const a = clamp((endT - 1.5) / 1.5, 0, 1);
    ctx.save(); ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(255,225,180,${a})`;
    ctx.font = 'italic 30px Georgia, serif'; ctx.fillText('The fire is warm. The forest is quiet.', W / 2, H / 2 - 10);
    ctx.fillStyle = `rgba(255,225,180,${a * 0.6})`;
    ctx.font = '15px Georgia, serif'; ctx.fillText('end of prototype  —  press Enter to walk again', W / 2, H / 2 + 30);
    ctx.restore();
  }
}

function render(dt) {
  const p = player;
  const target = clamp(p.x + p.w / 2 - W * 0.42 + p.face * 40, -200, WORLD_END - W);
  if (snapCamera) { camX = target; prevCamX = camX; snapCamera = false; }
  else camX += (target - camX) * Math.min(1, dt * 2.5);
  const camDX = camX - prevCamX; prevCamX = camX;
  updateLeaves(dt, camDX);

  if (actx) {
    const near = p.x > WIND.x0 - 300 && p.x < WIND.x1 + 200 ? 1 : 0.45;
    windGain.gain.setTargetAtTime(0.08 + gust * 0.4 * near, actx.currentTime, 0.25);
    windFilter.frequency.setTargetAtTime(350 + gust * 900 * near, actx.currentTime, 0.25);
  }

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawSky();
  drawLayer(layers[0]); fogBand(0.10);
  drawLayer(layers[1]); fogBand(0.12);
  drawLayer(layers[2]); drawPuffs();
  drawLayer(layers[3]);
  drawHints();
  drawLeaves(false);
  ctx.save(); ctx.translate(-Math.round(camX), 0); drawWorld(); ctx.restore();
  fogBand(0.07, 380, '200,110,60');
  drawWindStreaks();
  drawLeaves(true);
  drawLayer(fgLayer);
  ctx.drawImage(vignette, 0, 0, W, H);
  drawOverlay();
}

// ---------- main loop (fixed physics step, smooth rendering) ----------
const STEP = 1 / 120;
let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now; acc += dt;
  while (acc >= STEP) { update(STEP); acc -= STEP; }
  render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- new leaf clusters ----------
function drawLeafClusters() {
  const colors = ['#c85d2d', '#d98a3d', '#9b3d22', '#e2a84f', '#783019'];
  const r = rng(912);
  for (let i = 0; i < 180; i++) {
    const worldX = i * 67 + r() * 48;
    const sx = worldX - camX;
    if (sx < -40 || sx > W + 40) continue;
    const y = GROUND - 5 - r() * (i % 5 === 0 ? 46 : 12);
    const size = 4 + r() * 7;
    drawLeaf(sx, y, size, r() * 6, r() > 0.5 ? 1 : -1, colors[i % colors.length]);
  }
}

// ---------- extended level features ----------
const movingPlatforms = [
  { x: 6720, y: 350, baseX: 6720, baseY: 350, w: 190, h: 22, phase: 0, ampX: 35, ampY: 18 },
  { x: 7020, y: 310, baseX: 7020, baseY: 310, w: 180, h: 22, phase: 2.1, ampX: 30, ampY: 24 },
  { x: 7300, y: 270, baseX: 7300, baseY: 270, w: 200, h: 22, phase: 4.2, ampX: 35, ampY: 20 },
];
const bouncePads = [
  { x: 6800, y: GROUND - 8, w: 55 },
  { x: 7550, y: GROUND - 8, w: 55 },
];
const lateBramble = { x: 7900, y: GROUND - 52, w: 150, h: 52 };
const finalPlate = { x: 8200, w: 90, press: 0 };
