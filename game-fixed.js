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
    startMusic();
  } catch (err) { actx = null; }
}
// Soft ambient music: slow warm pad chords, an occasional music-box note, and a gentle echo.
// It plays quietly underneath the wind (both go through the same master volume, so M mutes all).
let musicGain = null, musicVerb = null, musicNext = 0, musicChord = 0, musicNoteT = 0;
const MUSIC_CHORDS = [            // frequencies in Hz (D minor-ish, dreamy)
  [146.83, 220.00, 261.63, 329.63],   // Dm9-ish   D A C E
  [116.54, 174.61, 233.08, 293.66],   // Bbmaj     Bb F Bb D
  [130.81, 196.00, 261.63, 329.63],   // C         C G C E
  [110.00, 164.81, 220.00, 261.63],   // Am        A E A C
];
const MUSIC_MELODY = [440.00, 523.25, 587.33, 659.25, 783.99, 880.00];   // A C D E G A (pentatonic)
function makeReverb() {
  const len = actx.sampleRate * 3.2, buf = actx.createBuffer(2, len, actx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  const c = actx.createConvolver(); c.buffer = buf; return c;
}
function startMusic() {
  musicGain = actx.createGain(); musicGain.gain.value = 0;
  musicGain.gain.setTargetAtTime(0.16, actx.currentTime + 0.5, 3);      // slow fade in
  musicVerb = makeReverb();
  const wet = actx.createGain(); wet.gain.value = 0.55;
  musicVerb.connect(wet); wet.connect(musicGain);
  musicGain.connect(master);
  musicNext = actx.currentTime + 0.3; musicNoteT = actx.currentTime + 4;
}
function padVoice(freq, t, dur) {
  for (const det of [-4, 4]) {
    const o = actx.createOscillator(), f = actx.createBiquadFilter(), g = actx.createGain();
    o.type = 'triangle'; o.frequency.value = freq; o.detune.value = det;
    f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 0.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(0.045, t + dur * 0.75);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 3);
    o.connect(f); f.connect(g); g.connect(musicGain); g.connect(musicVerb);
    o.start(t); o.stop(t + dur + 3.2);
  }
}
function musicBoxNote(freq, t) {
  for (const [mult, vol] of [[1, 0.15], [2, 0.035], [3.01, 0.014]]) {   // soft bell-like tone
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.value = freq * mult;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6 / mult);
    o.connect(g); g.connect(musicVerb); g.connect(musicGain);
    o.start(t); o.stop(t + 2.8);
  }
}
function updateMusic() {
  if (!actx || !musicGain) return;
  const now = actx.currentTime;
  if (musicNext < now) musicNext = now + 0.1;          // the tab was hidden: don't play all the missed chords at once
  if (musicNoteT < now) musicNoteT = now + 1;
  if (now > musicNext - 0.5) {                       // schedule the next pad chord (every ~9 s)
    const chord = MUSIC_CHORDS[musicChord % MUSIC_CHORDS.length];
    for (const f of chord) padVoice(f, musicNext, 8.5);
    musicChord++; musicNext += 9;
  }
  if (now > musicNoteT - 0.3) {                       // now and then, a few soft music-box notes
    if (Math.random() < 0.75) {
      const n = 1 + Math.floor(Math.random() * 3);
      let idx = Math.floor(Math.random() * MUSIC_MELODY.length);
      for (let k = 0; k < n; k++) {
        musicBoxNote(MUSIC_MELODY[idx], musicNoteT + k * (0.45 + Math.random() * 0.3));
        idx = Math.max(0, Math.min(MUSIC_MELODY.length - 1, idx + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2))));
      }
    }
    musicNoteT += 2.2 + Math.random() * 2.8;
  }
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
const WORLD_END = 18400;
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
  { x: 11340, y: GROUND, w: 500, h: 200 },
  // --- sinking bridge hole is 11840..12310 ---
  { x: 12310, y: GROUND, w: 690, h: 200 },            // apple meadow
  { x: 13000, y: GROUND - 230, w: 500, h: 430 },      // tall hill (only the apple stairs reach it)
  { x: 13500, y: GROUND, w: 320, h: 200 },            // pumpkin hill, bottom terrace
  { x: 13820, y: GROUND - 60, w: 320, h: 260 },
  { x: 14140, y: GROUND - 120, w: 320, h: 320 },
  { x: 14460, y: GROUND - 180, w: 450, h: 380 },      // top terrace with the pumpkin pile
  { x: 13570, y: GROUND - 48, w: 36, h: 48, stump: true },
  { x: 13870, y: GROUND - 108, w: 36, h: 48, stump: true },
  { x: 14190, y: GROUND - 168, w: 36, h: 48, stump: true },
  { x: 14510, y: GROUND - 228, w: 36, h: 48, stump: true },
  { x: 14910, y: GROUND, w: 590, h: 200 },            // treasure meadow (arch puzzle)
  // --- arch chasm is 15500..15900 ---
  { x: 15900, y: GROUND, w: 1360, h: 200 },           // lantern glade + crate yard
  { x: 16760, y: GROUND - 100, w: 200, h: 20 },       // floating ledge with the second crate on it (you can walk under it)
  { x: 17260, y: GROUND - 250, w: 420, h: 450 },      // the tall cliff: only two stacked crates reach it
  { x: 17680, y: GROUND, w: 720, h: 200 },            // campfire clearing
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
const FIRE_X = 18050;
const PUMPKIN_HOME = 1250;
const CRATE_HOME = 7780;
const hillCrate = { x: CRATE_HOME, y: GROUND - 60, w: 56, h: 60, vy: 0, roll: 0 };
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
  { x: 12340, y: GROUND },
  { x: 13060, y: GROUND - 230 },
  { x: 13520, y: GROUND },
  { x: 13830, y: GROUND - 60 },
  { x: 14150, y: GROUND - 120 },
  { x: 14470, y: GROUND - 180 },
  { x: 14930, y: GROUND },
  { x: 15930, y: GROUND },
  { x: 16640, y: GROUND },
  { x: 17300, y: GROUND - 250 },
  { x: 17720, y: GROUND },
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
  { x: 11560, y: 150, t: 'the old bridge sinks and rises — wait for it' },
  { x: 12420, y: 150, t: 'the apple belongs in the nest' },
  { x: 13560, y: 130, t: 'pumpkins tumble from the hilltop — hide behind the stumps' },
  { x: 14990, y: 130, t: 'three treasures, three glowing sockets — the old arch remembers' },
  { x: 15100, y: 155, t: 'if something gets stuck, press R', small: true },
  { x: 15990, y: 130, t: 'light all four lanterns — each one wakes its neighbours' },
  { x: 16000, y: 155, t: 'jump onto a lantern to touch it', small: true },
  { x: 16700, y: 130, t: 'one crate will never reach the top of that cliff' },
];
function gateRect() { return { x: gate.x, y: GROUND - gate.h - gate.open * gate.h, w: gate.w, h: gate.h }; }
const solidList = () => {
  const base = gate.open < 1 ? [...solids, gateRect(), ...movingPlatforms] : [...solids, ...movingPlatforms];
  return [...base, ...newSectionSolids()];
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
  resetNewSections();
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
  resetNewSections();
  snapCamera = true;
}

// ---------- update ----------
function update(dt) {
  time += dt; windT += dt; gust = gustAt(windT);
  updateGate(dt); updatePumpkin(dt); updateHillPuzzle(dt); updateNewSections(dt); updateCrows(dt); updateBursts(dt); updateMovingPlatforms(dt);
  if (ended) { endT += dt; return; }
  if (player.dead) {
    deadTimer -= dt;
    if (deadTimer < 0.9) fade = Math.min(1, fade + dt * 2.2);
    if (deadTimer <= 0) respawn();
    return;
  }
  fade = Math.max(0, fade - dt * 1.6);
  updatePlayer(dt);
  updateHair(dt);
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
    for (const s of list) if (overlap(p, s)) {
      if (s.step && p.y + p.h - s.y <= 9) { p.y = s.y - p.h; continue; }   // walk up the arch's curve
      p.x = dx > 0 ? s.x - p.w : s.x + s.w; p.vx = 0;
    }
    for (const { b, blockers, locked } of pushables(list)) {
      if (!overlap(p, b)) continue;
      const before = b.x;
      if (!locked) moveBox(b, dx > 0 ? p.x + p.w - b.x : p.x - (b.x + b.w), 0, blockers);
      if (overlap(p, b)) p.x = dx > 0 ? b.x - p.w : b.x + b.w;
      if (b.x !== before && p.onGround) { p.pushing = true; b.roll += b.x - before; }
      const moved = b.x - before;
      if (moved && yardCrates.includes(b)) for (const r of yardCrates)
        if (r !== b && Math.abs(r.y + r.h - b.y) < 1.5 && r.x < b.x - moved + b.w && r.x + r.w > b.x - moved) moveBox(r, moved, 0, list);
    }
  }

  // vertical movement
  const wasGround = p.onGround, vyBefore = p.vy;
  p.onGround = false;
  const dy = p.vy * dt;
  p.y += dy;
  for (const s of [...list, pumpkin, apple, hillCrate, ...archItems, ...yardCrates]) {
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
  if (p.x + p.w > lateBramble.x + 6 && p.x < lateBramble.x + lateBramble.w - 6 && p.y + p.h > lateBramble.y + 6) killPlayer(true);
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
  const p = player;
  for (const platform of movingPlatforms) {
    const nx = platform.baseX + Math.sin(time * 0.8 + platform.phase) * platform.ampX;
    const ny = platform.baseY + Math.sin(time * 1.1 + platform.phase) * platform.ampY;
    const riding = !p.dead && p.vy >= 0 && p.x + p.w > platform.x && p.x < platform.x + platform.w &&
      Math.abs(p.y + p.h - platform.y) < 4;
    const dx = nx - platform.x, dy = ny - platform.y;
    platform.x = nx; platform.y = ny;
    if (riding) {
      p.y = platform.y - p.h;              // stay glued to the top, up or down
      p.x += dx;
      for (const s of solids) if (!s.wall && overlap(p, s)) p.x -= dx;
      p.onGround = true; p.vy = 0;
    }
  }
}

function updateHillPuzzle(dt) {
  hillCrate.vy = Math.min(hillCrate.vy + GRAV * dt, MAX_FALL);
  if (moveBox(hillCrate, 0, hillCrate.vy * dt, solidList())) {
    if (hillCrate.vy > 300) crunch(0.2);
    hillCrate.vy = 0;
  }
  if (hillCrate.y > H + 80) Object.assign(hillCrate, { x: CRATE_HOME, y: GROUND - hillCrate.h, vy: 0 });
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
    if (o.curls && r() < o.curls) {
      g.lineWidth = Math.max(0.8, w * 0.8);
      curl(g, x2, y2, ang, len * 0.32 + 1.5, r() < 0.5 ? -1 : 1);
    }
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
function curl(g, x, y, ang, step, dir) {
  g.beginPath(); g.moveTo(x, y);
  for (let i = 0; i < 16; i++) { ang += dir * 0.5; step *= 0.86; x += Math.cos(ang) * step; y += Math.sin(ang) * step; g.lineTo(x, y); }
  g.stroke();
}
function glowSpot(g, x, y, r, col) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
}
function mushroom(g, x, y, s, col, r) {
  const lean = (r() - 0.5) * 0.25;
  g.save(); g.translate(x, y); g.rotate(lean); g.fillStyle = col;
  g.beginPath(); g.moveTo(-s * 0.16, 0);
  g.quadraticCurveTo(-s * 0.1, -s * 0.5, -s * 0.12, -s * 0.85);
  g.lineTo(s * 0.12, -s * 0.85); g.quadraticCurveTo(s * 0.2, -s * 0.5, s * 0.18, 0); g.fill();
  g.beginPath(); g.moveTo(-s * 0.6, -s * 0.8);
  g.quadraticCurveTo(-s * 0.55, -s * 1.45, 0, -s * 1.5);
  g.quadraticCurveTo(s * 0.55, -s * 1.45, s * 0.6, -s * 0.8);
  g.quadraticCurveTo(0, -s * 0.92, -s * 0.6, -s * 0.8); g.fill();
  for (let k = 0; k < 4; k++) {
    const sx = (r() - 0.5) * s * 0.8, sy = -s * (1.05 + r() * 0.3), sr = s * (0.05 + r() * 0.05);
    glowSpot(g, sx, sy, sr * 4, 'rgba(255,205,120,0.35)');
    g.fillStyle = '#ffd98f'; g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}
function cottage(g, x, y, s, col, r) {
  const tilt = (r() - 0.5) * 0.12;
  g.save(); g.translate(x, y); g.rotate(tilt); g.fillStyle = col;
  g.beginPath(); g.moveTo(-s * 0.5, 0); g.lineTo(-s * 0.46, -s * 0.7); g.lineTo(s * 0.48, -s * 0.74); g.lineTo(s * 0.52, 0); g.fill();
  g.beginPath(); g.moveTo(-s * 0.68, -s * 0.62);                       // crooked witch-hat roof
  g.quadraticCurveTo(-s * 0.1, -s * 0.9, -s * 0.02, -s * 1.55);
  g.quadraticCurveTo(s * 0.3, -s * 1.7, s * 0.42, -s * 1.5);
  g.quadraticCurveTo(s * 0.2, -s * 1.3, s * 0.7, -s * 0.66); g.closePath(); g.fill();
  g.fillRect(s * 0.22, -s * 1.28, s * 0.14, s * 0.4);                  // chimney
  const win = (wx, wy) => {
    glowSpot(g, wx, wy, s * 0.4, 'rgba(255,210,120,0.45)');
    g.fillStyle = '#ffd47a'; g.beginPath(); g.arc(wx, wy, s * 0.09, Math.PI, 0); g.lineTo(wx + s * 0.09, wy + s * 0.12); g.lineTo(wx - s * 0.09, wy + s * 0.12); g.fill();
  };
  win(-s * 0.2, -s * 0.42); win(s * 0.22, -s * 0.44);
  g.fillStyle = '#ffd47a'; g.beginPath(); g.arc(0, -s * 0.9, s * 0.07, 0, Math.PI * 2); g.fill();  // round attic window
  g.restore();
}
function softened(c, w, px) {
  // blur a tiling layer; draw it three times so the seam wraps cleanly
  const out = document.createElement('canvas');
  out.width = c.width; out.height = c.height;
  const g = out.getContext('2d');
  g.filter = `blur(${px}px)`;
  if (g.filter === 'none' || !px) return c;          // browser without canvas filters
  for (const dx of [-c.width, 0, c.width]) g.drawImage(c, dx, 0);
  return out;
}
function makeLayer(o) {
  const res = o.res || 1;
  const c = document.createElement('canvas');
  c.width = o.width * res; c.height = H * res;
  const g = c.getContext('2d'); g.scale(res, res);
  g.fillStyle = o.color; g.strokeStyle = o.color; g.lineCap = 'round'; g.lineJoin = 'round';
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
  for (let i = 0; i < (o.houses || 0); i++) {
    const x = 200 + r() * (o.width - 400);
    cottage(g, x, hill(x) + 6, 40 + r() * 14, o.color, r);
  }
  for (let i = 0; i < (o.mushrooms || 0); i++) {
    const x = 80 + r() * (o.width - 160);
    mushroom(g, x, hill(x) + 4, o.mushroomSize * (0.7 + r() * 0.6), o.color, r);
  }
  return { canvas: softened(c, o.width, (o.blur || 0) * res), w: o.width, factor: o.factor };
}
function makeForeground() {
  const width = 3200;
  const c = document.createElement('canvas');
  c.width = width * RES; c.height = H * RES;
  const g = c.getContext('2d'); g.scale(RES, RES);
  g.fillStyle = INK; g.strokeStyle = INK; g.lineCap = 'round';
  const r = rng(99), o = { color: INK };
  g.lineJoin = 'round';
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
  return { canvas: softened(c, width, 2.2 * RES), w: width, factor: 1.35 };
}

const layers = [
  makeLayer({ seed: 11, width: 2400, color: '#b45a33', base: 330, amp: 25, k1: 2, k2: 5, trees: 40, minH: 40, maxH: 80, depth: 5, factor: 0.12, curls: 0.2, houses: 3, blur: 1.4 }),
  makeLayer({ seed: 22, width: 2400, color: '#86391f', base: 370, amp: 22, k1: 3, k2: 7, trees: 30, minH: 80, maxH: 150, depth: 6, factor: 0.25, leafColor: '#a8441f', curls: 0.3, mushrooms: 6, mushroomSize: 22, blur: 1.1 }),
  makeLayer({ seed: 33, width: 2400, color: '#4f1f12', base: 410, amp: 16, k1: 2, k2: 9, trees: 22, minH: 150, maxH: 260, depth: 6, factor: 0.45, leafColor: '#7a2e14', res: RES, curls: 0.3, mushrooms: 5, mushroomSize: 34, blur: 0.8 }),
  makeLayer({ seed: 44, width: 2400, color: '#26110a', base: 445, amp: 12, k1: 4, k2: 11, trees: 12, minH: 260, maxH: 420, depth: 7, factor: 0.7, leafColor: '#45190b', res: RES, curls: 0.18, blur: 0.6 }),
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
const stars = Array.from({ length: 46 }, (_, i) => ({ x: hash(i + 50) * (W + 200), y: 12 + Math.pow(hash(i + 90), 1.6) * 190, s: 1.2 + hash(i + 130) * 2.6, tw: hash(i + 170) * 6 }));
const moonSprite = document.createElement('canvas');
moonSprite.width = moonSprite.height = 120;
{
  const g = moonSprite.getContext('2d');
  g.fillStyle = '#fff1c9'; g.beginPath(); g.arc(60, 60, 24, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.arc(72, 52, 21, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'destination-over';
  const gr = g.createRadialGradient(54, 66, 0, 54, 66, 58);
  gr.addColorStop(0, 'rgba(255,236,190,0.35)'); gr.addColorStop(1, 'rgba(255,236,190,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 120, 120);
}
function makeCloud(seed) {
  const r = rng(seed), c = document.createElement('canvas');
  c.width = 260; c.height = 110;
  const g = c.getContext('2d');
  g.fillStyle = '#ffcfa0';
  const bumps = [[64, 70, 26], [100, 54, 34], [148, 50, 32], [188, 68, 24], [126, 72, 28]];
  for (const [x, y, rr] of bumps) { g.beginPath(); g.arc(x, y, rr * (0.9 + r() * 0.2), 0, Math.PI * 2); g.fill(); }
  g.beginPath(); g.ellipse(126, 82, 88, 14, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#ffe8c6'; g.lineWidth = 2.2; g.lineCap = 'round';
  curl(g, 44, 84, Math.PI * 1.1, 9, 1);
  curl(g, 214, 82, -0.2, 9, -1);
  curl(g, 112, 28, Math.PI * 1.2, 7, 1);
  return c;
}
const clouds = [0, 1, 2, 3].map(i => ({ img: makeCloud(200 + i), x: i * 340 + hash(i) * 120, y: 40 + hash(i + 20) * 110, sc: 0.6 + hash(i + 40) * 0.5, spd: 4 + hash(i + 60) * 5 }));
const wisps = Array.from({ length: 22 }, (_, i) => ({ x: hash(i + 300) * (W + 100), y0: hash(i + 340) * H, spd: 10 + hash(i + 380) * 14, ph: hash(i + 420) * 6.28 }));
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
  // twinkling sparkle stars
  const span = W + 200;
  for (const st of stars) {
    const x = (((st.x - camX * 0.02) % span) + span) % span - 100;
    const a = (0.35 + 0.65 * Math.max(0, Math.sin(time * 1.6 + st.tw))) * (1 - st.y / 230);
    const s = st.s * (0.8 + 0.3 * Math.sin(time * 2.3 + st.tw));
    ctx.fillStyle = `rgba(255,240,200,${a})`; ctx.beginPath();
    ctx.moveTo(x, st.y - s * 2); ctx.quadraticCurveTo(x, st.y, x + s * 2, st.y);
    ctx.quadraticCurveTo(x, st.y, x, st.y + s * 2); ctx.quadraticCurveTo(x, st.y, x - s * 2, st.y);
    ctx.quadraticCurveTo(x, st.y, x, st.y - s * 2); ctx.fill();
  }
  ctx.drawImage(moonSprite, W * 0.18 - camX * 0.015 - 60, 30 + Math.sin(time * 0.5) * 2);
  // swirly storybook clouds
  const cspan = W + 600;
  for (const cl of clouds) {
    const x = (((cl.x - camX * 0.06 + time * cl.spd) % cspan) + cspan) % cspan - 300;
    ctx.globalAlpha = 0.55;
    ctx.drawImage(cl.img, x, cl.y + Math.sin(time * 0.6 + cl.x) * 3, 260 * cl.sc, 110 * cl.sc);
  }
  ctx.globalAlpha = 1;
}
function drawWisps() {
  ctx.save(); ctx.strokeStyle = 'rgba(255,236,190,0.7)'; ctx.lineWidth = 0.8;
  const span = W + 100;
  for (const w of wisps) {
    const x = (((w.x - camX * 0.8 + Math.sin(time * 0.8 + w.ph) * 18) % span) + span) % span - 50;
    const y = ((((w.y0 - time * w.spd) % (H + 40)) + H + 40) % (H + 40)) - 20;
    radial(x, y, 7, 'rgba(255,220,150,0.35)');
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2 + time * 0.6 + w.ph;
      ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 3.2, y + Math.sin(a) * 3.2);
    }
    ctx.stroke();
    ctx.fillStyle = '#fff0c8'; ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
function drawPuffs() {
  const span = W + 800;
  for (const p of puffs) {
    const sx = (((p.x - camX * 0.5 + time * p.spd) % span) + span) % span - 400;
    radial(sx, p.y, p.r, 'rgba(255,190,140,0.10)');
  }
}
function drawFireflies() {
  for (let i = 0; i < 16; i++) {
    const worldX = 520 + i * 137 + Math.sin(i * 8.3) * 90;
    const sx = worldX - camX * 0.72;
    if (sx < -20 || sx > W + 20) continue;
    const x = sx + Math.sin(time * (0.4 + i * 0.01) + i) * 14;
    const y = 175 + hash(i) * 230 + Math.cos(time * 0.7 + i * 1.7) * 8;
    const pulse = 0.35 + (Math.sin(time * 2 + i * 2.1) + 1) * 0.25;
    radial(x, y, 5 + pulse * 4, `rgba(255,214,112,${pulse * 0.65})`);
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
  ctx.strokeStyle = '#5a2818'; ctx.lineWidth = 1.4; ctx.beginPath();
  for (const s of solids) {
    if (s.wall || s.stump || s.x > x1 || s.x + s.w < x0) continue;
    const [rl, rr] = cornerRadii(s);
    const end = Math.min(s.x + s.w - 2, x1);
    for (let x = s.x + 2 + Math.max(0, Math.ceil((x0 - s.x) / 3) * 3); x < end; x += 3) {
      const base = surfaceY(s, x, rl, rr), drop = base - s.y;
      const h = (2 + hash(x) * 8) * (1 - drop / (CORNER_R * 1.6));   // shorter tufts as the edge curves away
      const lean = (hash(x + 0.5) - 0.5) * 5 + (0.15 + gust) * 3 * Math.sin(time * 3 + x * 0.05);
      ctx.moveTo(x, base + 1.5); ctx.lineTo(x + lean, base - h);
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
  drawHairBack();
  const cx = p.x + p.w / 2, by = p.y + p.h;
  const moving = p.onGround && Math.abs(p.vx) > 20;
  const ph = p.walk;
  ctx.save(); ctx.translate(cx, by); ctx.scale(p.face * 1.85, 1.85);
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

  const flutter = Math.sin(time * 6) * 1.2 + (Math.abs(p.vx) / RUN) * 3;

  // back arm (behind the body), swings opposite the legs
  const swing = moving ? Math.sin(ph) * 0.5 : (!p.onGround ? -0.6 : Math.sin(time * 2) * 0.05);
  ctx.strokeStyle = '#4a1f12'; ctx.lineWidth = 2.6;
  const bex = -1 + Math.sin(0.15 - swing) * 7, bey = -30 + Math.cos(0.15 - swing) * 7;
  const bhx = bex + Math.sin(0.35 - swing * 1.2) * 6.5, bhy = bey + Math.cos(0.35 - swing * 1.2) * 6.5;
  ctx.beginPath(); ctx.moveTo(-1, -30); ctx.lineTo(bex, bey); ctx.lineTo(bhx, bhy); ctx.stroke();
  ctx.fillStyle = '#4a1f12'; ctx.beginPath(); ctx.arc(bhx, bhy, 1.7, 0, Math.PI * 2); ctx.fill();

  // dress-like cloak: narrow shoulders, flared hem
  ctx.fillStyle = PLAYER_CLOAK;
  ctx.beginPath(); ctx.moveTo(-4, -33); ctx.lineTo(4, -33);
  ctx.quadraticCurveTo(6.5, -26, 5, -21);
  ctx.quadraticCurveTo(8, -16, 11, -11);
  ctx.quadraticCurveTo(4, -9.5 + Math.sin(time * 7) * 0.5, -3, -11);
  ctx.quadraticCurveTo(-8, -10 + Math.sin(time * 7), -11 - flutter, -12 + Math.sin(time * 7));
  ctx.quadraticCurveTo(-7, -18, -5, -23);
  ctx.quadraticCurveTo(-6, -28, -4, -33); ctx.fill();

  ctx.strokeStyle = PLAYER_RIM; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-4.5, -30); ctx.quadraticCurveTo(-5.5, -24, -9 - flutter * 0.8, -13); ctx.stroke();

  // folds, waist sash and shoulder clasp
  ctx.strokeStyle = '#a85a32'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-1, -20); ctx.quadraticCurveTo(-3, -15, -5, -11.5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(3, -20); ctx.quadraticCurveTo(5, -15, 7, -11.5); ctx.stroke();
  ctx.strokeStyle = '#d18b53'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-4.5, -22); ctx.quadraticCurveTo(0, -20.5, 5, -21.5); ctx.stroke();
  ctx.fillStyle = PLAYER_RIM;
  ctx.beginPath(); ctx.ellipse(2.5, -32, 1.8, 2.2, 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(2.5, -32, 0.7, 0, Math.PI * 2); ctx.fill();

  // front arm holding the lantern
  const lift = p.pushing ? 1 : 0;
  const ex = 4 + lift * 3, ey = -24 - lift * 2;
  const hx = 8 + lift * 4, hy = -19 - lift * 5;
  ctx.strokeStyle = PLAYER_CLOAK; ctx.lineWidth = 2.8;
  ctx.beginPath(); ctx.moveTo(1.5, -30); ctx.quadraticCurveTo(ex - 1, ey, hx, hy); ctx.stroke();
  ctx.fillStyle = INK; ctx.beginPath(); ctx.ellipse(hx + 0.4, hy, 1.5, 1.3, 0.3, 0, Math.PI * 2); ctx.fill();
  // lantern swings gently from the hand
  const lsw = Math.sin(time * 3) * 0.12 - (p.vx * p.face) / RUN * 0.25;
  ctx.save(); ctx.translate(hx + 0.4, hy + 0.6); ctx.rotate(lsw);
  ctx.strokeStyle = INK; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 3); ctx.stroke();
  ctx.fillStyle = INK; ctx.beginPath(); ctx.moveTo(-2.6, 3.8); ctx.lineTo(2.6, 3.8); ctx.lineTo(1.6, 2.6); ctx.lineTo(-1.6, 2.6); ctx.fill();
  ctx.fillStyle = PLAYER_LANTERN; ctx.beginPath(); ctx.ellipse(0, 7, 2.5, 3.3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff4cf'; ctx.beginPath(); ctx.ellipse(0, 7.3, 1, 1.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = INK; ctx.fillRect(-2.4, 10.1, 4.8, 1.2);
  ctx.restore();

  // head in side profile: forehead, prominent nose, lips, chin
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.moveTo(1.2, -33);
  ctx.lineTo(2, -35.4);
  ctx.quadraticCurveTo(5.2, -34.8, 5.9, -36.4);        // chin
  ctx.quadraticCurveTo(6.4, -37.4, 5.9, -37.9);
  ctx.quadraticCurveTo(6.9, -38.2, 6.6, -38.9);        // lower lip
  ctx.lineTo(6.1, -39.2);
  ctx.quadraticCurveTo(7.1, -39.5, 7.2, -40);          // upper lip
  ctx.quadraticCurveTo(8.4, -40.1, 9.6, -40.7);        // under the nose
  ctx.quadraticCurveTo(10.6, -41.2, 9.6, -42);         // rounded nose tip
  ctx.quadraticCurveTo(7.8, -43, 6.6, -44.4);          // nose bridge
  ctx.quadraticCurveTo(7.4, -48.6, 3, -50.2);          // forehead
  ctx.quadraticCurveTo(-3, -51.6, -6.2, -46.8);        // crown
  ctx.quadraticCurveTo(-8.6, -42, -5, -37.2);          // back of head
  ctx.lineTo(-2.6, -33); ctx.closePath(); ctx.fill();

  // single soft eye in profile
  ctx.fillStyle = '#f2c76f';
  ctx.beginPath(); ctx.arc(3.6, -43, 0.85, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  drawHairFront();
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
    const lx = player.x + player.w / 2 + player.face * 15.5, ly = player.y + player.h - 21;
    const fl = 0.85 + Math.sin(time * 9) * 0.05 + Math.sin(time * 23) * 0.04;
    radial(lx, ly, 165 * fl, 'rgba(255,170,80,0.30)');
    radial(lx, ly, 24, 'rgba(255,210,140,0.68)');
  }
  if (FIRE_X - camX < W + 400) {
    radial(FIRE_X, GROUND - 20, 260 + Math.sin(time * 8) * 10, 'rgba(255,140,50,0.35)');
    radial(FIRE_X + 151, GROUND - 54, 70, 'rgba(255,170,80,0.25)');
  }
  ctx.restore();
}
// rounded top corners, except where a neighbouring block continues at the same height or higher
const CORNER_R = 16;
function cornerRadii(s) {
  const joined = side => solids.some(o => o !== s && !o.wall && !o.stump && o.y <= s.y &&
    (side < 0 ? Math.abs(o.x + o.w - s.x) < 1 : Math.abs(o.x - (s.x + s.w)) < 1));
  return [joined(-1) ? 0 : CORNER_R, joined(1) ? 0 : CORNER_R];
}
// the top surface height at x, following the rounded corners (so grass sits on the curve)
function surfaceY(s, x, rl, rr) {
  const dl = x - s.x, dr = s.x + s.w - x;
  if (rl && dl < rl) { const t = Math.sqrt(Math.max(0, dl) / rl); return s.y + rl * (1 - t) * (1 - t); }
  if (rr && dr < rr) { const t = Math.sqrt(Math.max(0, dr) / rr); return s.y + rr * (1 - t) * (1 - t); }
  return s.y;
}
// earthy, uneven cliff side instead of a flat wall
const cliffWobble = (x, y) => (hash(x * 0.37 + y * 0.113) - 0.5) * 6 + Math.sin(y * 0.07 + x) * 4 + Math.sin(y * 0.23 + x * 2) * 2;
function softBlock(s) {
  const [rl, rr] = cornerRadii(s);
  const bottom = Math.min(s.y + s.h, H + 10);
  ctx.beginPath();
  if (rl) {
    ctx.moveTo(s.x + cliffWobble(s.x, bottom), bottom);
    for (let y = bottom - 10; y > s.y + rl; y -= 10) ctx.lineTo(s.x + cliffWobble(s.x, y), y);
    ctx.lineTo(s.x, s.y + rl);
  } else { ctx.moveTo(s.x, bottom); ctx.lineTo(s.x, s.y); }
  ctx.quadraticCurveTo(s.x, s.y, s.x + rl, s.y);
  ctx.lineTo(s.x + s.w - rr, s.y); ctx.quadraticCurveTo(s.x + s.w, s.y, s.x + s.w, s.y + rr);
  if (rr) {
    for (let y = s.y + rr + 10; y < bottom; y += 10) ctx.lineTo(s.x + s.w - cliffWobble(s.x + s.w, y), y);
    ctx.lineTo(s.x + s.w - cliffWobble(s.x + s.w, bottom), bottom);
  } else ctx.lineTo(s.x + s.w, bottom);
  ctx.closePath(); ctx.fill();
  if (rl) drawCliffRoots(s.x, s.y, bottom, -1);
  if (rr) drawCliffRoots(s.x + s.w, s.y, bottom, 1);
  ctx.fillStyle = INK;
}
// roots growing out of a cliff side (dir -1 = left side, +1 = right side), drooping and swaying
function drawCliffRoots(x, top, bottom, dir) {
  const seed = x * 0.71 + top * 0.13, maxY = Math.min(bottom, H + 10);
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // faint roots running down inside the wall, giving it an earthy texture
  ctx.strokeStyle = 'rgba(110,52,26,0.35)'; ctx.lineWidth = 1.2;
  for (let k = 0; k < 3; k++) {
    let px = x - dir * (5 + k * 7 + hash(seed + k) * 4), py = top + 10 + k * 6;
    ctx.beginPath(); ctx.moveTo(px, py);
    while (py < maxY) { py += 14; px += (hash(seed + py * 0.3 + k) - 0.5) * 6; ctx.lineTo(px, py); }
    ctx.stroke();
  }
  ctx.strokeStyle = INK;
  // roots poking out of the side and drooping down (drawn twice: a warm rim, then the dark root on top)
  const n = Math.max(3, Math.min(12, Math.floor((maxY - top) / 12)));
  const roots = [];
  for (let i = 0; i < n; i++) {
    const r1 = hash(seed + i * 3.1), r2 = hash(seed + i * 7.7), r3 = hash(seed + i * 1.9);
    const y0 = top + 4 + i * 12 + r1 * 8;
    if (y0 > maxY - 4) break;
    const big = i < 4 || r2 > 0.75;
    const len = big ? 34 + r2 * 40 : 14 + r2 * 20;
    const sway = Math.sin(time * 0.9 + i * 1.7 + seed) * (big ? 3 : 1.4);
    let px = x - dir * 2, py = y0, a = 0.25 + r3 * 0.55;
    const w0 = big ? 3.2 + r2 * 2.6 : 1.6 + r2 * 1.4, segs = 7, seg = len / segs;
    const pts = [[px, py]];
    for (let k = 0; k < segs; k++) {
      px += dir * Math.cos(a) * seg + (k > 2 ? sway * 0.22 : 0); py += Math.sin(a) * seg;
      pts.push([px, py]); a = Math.min(1.5, a + 0.2 + (r1 - 0.5) * 0.08);
    }
    roots.push({ pts, w0, r1, sway });
  }
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass ? INK : 'rgba(170,90,45,0.55)';
    for (const r of roots) {
      for (let k = 0; k < r.pts.length - 1; k++) {
        const [ax, ay] = r.pts[k], [bx, by] = r.pts[k + 1];
        ctx.lineWidth = Math.max(0.7, r.w0 * (1 - k / r.pts.length)) + (pass ? 0 : 1.2);
        ctx.beginPath(); ctx.moveTo(ax, ay - (pass ? 0 : 0.8)); ctx.lineTo(bx, by - (pass ? 0 : 0.8)); ctx.stroke();
      }
      if (pass && r.r1 > 0.35) {                         // a little side rootlet curling off
        const [mx, my] = r.pts[3];
        ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(mx, my);
        ctx.quadraticCurveTo(mx + dir * 6, my + 2, mx + dir * 9 + r.sway * 0.3, my + 9); ctx.stroke();
      }
    }
  }
  // a few long roots dangling from the top lip
  for (let j = 0; j < 3; j++) {
    const len = 30 + hash(seed + j * 11) * 44, sw = Math.sin(time * 1.1 + j * 2 + seed) * 3.5;
    const hx = x + dir * (1 + j * 5);
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass ? INK : 'rgba(170,90,45,0.5)';
      ctx.lineWidth = (2.2 - j * 0.5) + (pass ? 0 : 1.2);
      ctx.beginPath(); ctx.moveTo(x - dir * 4, top + 2);
      ctx.quadraticCurveTo(hx + dir * 6, top + len * 0.45, hx + dir * 3 + sw, top + len); ctx.stroke();
    }
  }
  ctx.restore();
}
function softRect(x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill();
}
function drawWorld() {
  const x0 = camX - 50, x1 = camX + W + 50;
  ctx.fillStyle = INK;
  for (const lp of leafPits) ctx.fillRect(lp.x, GROUND + 18, lp.w, H);   // darkness under the leaves
  for (const s of solids) {
    if (s.wall || s.stump || s.x > x1 || s.x + s.w < x0) continue;   // stumps draw themselves
    softBlock(s);
  }
  drawGrass(x0, x1);
  drawLeafClusters();
  for (const lp of leafPits) drawLeafPile(lp);
  drawPlate(); drawGate(); drawBrambles(); drawPumpkin();
  ctx.fillStyle = '#5a2a16';
  for (const platform of movingPlatforms) {
    drawMovingPlatform(platform);
  }
  for (const pad of bouncePads) {
    ctx.fillStyle = '#7a3516'; softRect(pad.x, pad.y + 4, pad.w, 8, 4);
    ctx.fillStyle = '#e09a48'; softRect(pad.x + 8, pad.y + 1, pad.w - 16, 5, 2.5);
  }
  ctx.fillStyle = INK;
  for (let x = lateBramble.x; x < lateBramble.x + lateBramble.w; x += 12) {
    ctx.beginPath(); ctx.moveTo(x - 5, GROUND); ctx.lineTo(x, lateBramble.y); ctx.lineTo(x + 5, GROUND); ctx.fill();
  }
  for (const c of crows) if (!c.gone) drawCrow(c);
  drawNewSections();
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
    updateMusic();
  }

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawSky();
  drawLayer(layers[0]); fogBand(0.10);
  drawLayer(layers[1]); fogBand(0.12);
  drawLayer(layers[2]); drawPuffs(); drawFireflies(); drawWisps();
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
  for (let i = 0; i < 280; i++) {
    const sx = i * 67 + r() * 48;
    const y = GROUND - 5 - r() * (i % 5 === 0 ? 46 : 12);
    const size = 4 + r() * 7, rot = r() * 6, flip = r() > 0.5 ? 1 : -1;
    if (sx < camX - 40 || sx > camX + W + 40) continue;
    drawLeaf(sx, y, size, rot, flip, colors[i % colors.length]);
  }
}

// ---------- extended level features ----------
// floating platforms only where there is a real hole underneath (the 7000-7500 chasm)
const movingPlatforms = [
  { x: 7020, y: 310, baseX: 7020, baseY: 310, w: 180, h: 22, phase: 2.1, ampX: 30, ampY: 24 },
  { x: 7300, y: 270, baseX: 7300, baseY: 270, w: 200, h: 22, phase: 4.2, ampX: 35, ampY: 20 },
];
const bouncePads = [];
const lateBramble = { x: 7900, y: GROUND - 126, w: 120, h: 126 };   // too tall to jump from the ground: climb the box

// ---------- test level (remove before final release) ----------
const testLevel = [
  { x: 60, y: GROUND, w: 200, h: 20 },
  { x: 300, y: GROUND, w: 200, h: 20 },
  { x: 540, y: GROUND - 100, w: 200, h: 20 },
  { x: 780, y: GROUND, w: 200, h: 20 },
  { x: 1020, y: GROUND - 50, w: 200, h: 20 },
  { x: 1260, y: GROUND, w: 200, h: 20 },
  { x: 1500, y: GROUND - 150, w: 200, h: 20 },
  { x: 1740, y: GROUND, w: 200, h: 20 },
  { x: 1980, y: GROUND - 70, w: 200, h: 20 },
  { x: 2220, y: GROUND, w: 200, h: 20 },
  { x: 2460, y: GROUND - 120, w: 200, h: 20 },
  { x: 2700, y: GROUND, w: 200, h: 20 },
  { x: 2940, y: GROUND - 90, w: 200, h: 20 },
  { x: 3180, y: GROUND, w: 200, h: 20 },
  { x: 3420, y: GROUND - 40, w: 200, h: 20 },
  { x: 3660, y: GROUND, w: 200, h: 20 },
  { x: 3900, y: GROUND - 110, w: 200, h: 20 },
  { x: 4140, y: GROUND, w: 200, h: 20 },
  { x: 4380, y: GROUND - 80, w: 200, h: 20 },
  { x: 4620, y: GROUND, w: 200, h: 20 },
  { x: 4860, y: GROUND - 130, w: 200, h: 20 },
  { x: 5100, y: GROUND, w: 200, h: 20 },
  { x: 5340, y: GROUND - 60, w: 200, h: 20 },
  { x: 5580, y: GROUND, w: 200, h: 20 },
  { x: 5820, y: GROUND - 150, w: 200, h: 20 },
  { x: 6060, y: GROUND, w: 200, h: 20 },
  { x: 6300, y: GROUND - 100, w: 200, h: 20 },
  { x: 6540, y: GROUND, w: 200, h: 20 },
  { x: 6780, y: GROUND - 50, w: 200, h: 20 },
  { x: 7020, y: GROUND, w: 200, h: 20 },
  { x: 7260, y: GROUND - 120, w: 200, h: 20 },
  { x: 7500, y: GROUND, w: 200, h: 20 },
  { x: 7740, y: GROUND - 90, w: 200, h: 20 },
  { x: 7980, y: GROUND, w: 200, h: 20 },
  { x: 8220, y: GROUND - 40, w: 200, h: 20 },
  { x: 8460, y: GROUND, w: 200, h: 20 },
  { x: 8700, y: GROUND - 110, w: 200, h: 20 },
  { x: 8940, y: GROUND, w: 200, h: 20 },
  { x: 9180, y: GROUND - 80, w: 200, h: 20 },
  { x: 9420, y: GROUND, w: 200, h: 20 },
  { x: 9660, y: GROUND - 130, w: 200, h: 20 },
  { x: 9900, y: GROUND, w: 200, h: 20 },
];
function drawMovingPlatform(platform) {
  const x = platform.x, y = platform.y, w = platform.w, h = platform.h, seed = platform.baseX;
  ctx.save();
  // hanging roots (behind the slab)
  ctx.strokeStyle = INK; ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const rx = x + w * (0.15 + i * 0.14) + (hash(seed + i) - 0.5) * 10, len = 8 + hash(seed + i * 3) * 18;
    const sway = Math.sin(time * 1.6 + i * 1.3) * 2.5;
    ctx.lineWidth = 1.2 + hash(seed + i * 7) * 1.2;
    ctx.beginPath(); ctx.moveTo(rx, y + h - 4);
    ctx.quadraticCurveTo(rx + sway * 0.5, y + h + len * 0.5, rx + sway, y + h + len); ctx.stroke();
  }
  // soft floating earth slab, flat on top so your feet sit exactly on it
  ctx.fillStyle = INK; ctx.beginPath();
  ctx.moveTo(x + 8, y);
  ctx.lineTo(x + w - 8, y);
  ctx.quadraticCurveTo(x + w, y, x + w - 1, y + 7);
  ctx.quadraticCurveTo(x + w * 0.8, y + h + 2, x + w * 0.55, y + h + 6);
  ctx.quadraticCurveTo(x + w * 0.3, y + h + 4, x + w * 0.12, y + h - 2);
  ctx.quadraticCurveTo(x, y + 9, x + 1, y + 7);
  ctx.quadraticCurveTo(x, y, x + 8, y);
  ctx.fill();
  ctx.fillStyle = 'rgba(160,80,40,0.35)';            // faint warm rim light on top
  softRect(x + 8, y, w - 16, 1.6, 0.8);
  // silhouette grass tufts along the top
  ctx.strokeStyle = INK; ctx.lineWidth = 1.3; ctx.beginPath();
  for (let gx = x + 12; gx < x + w - 12; gx += 3) {
    const k = gx - x, hgt = 2 + hash(seed + k) * 7 + (hash(seed + k * 0.37) > 0.85 ? 4 : 0);
    const lean = (hash(seed + k + 0.5) - 0.5) * 4 + (0.15 + gust) * 2.5 * Math.sin(time * 3 + k * 0.08);
    ctx.moveTo(gx, y + 1); ctx.quadraticCurveTo(gx + lean * 0.3, y - hgt * 0.6, gx + lean, y - hgt);
  }
  ctx.stroke();
  // two little decorative mushrooms near the ends (you walk right past them)
  for (const [fx, sc] of [[0.1, 1], [0.86, 0.8], [0.92, 0.6]]) {
    const mx = x + w * fx, ms = 10 * sc;
    ctx.fillStyle = INK;
    ctx.fillRect(mx - ms * 0.12, y - ms * 0.75, ms * 0.24, ms * 0.8);
    ctx.beginPath(); ctx.ellipse(mx, y - ms * 0.75, ms * 0.5, ms * 0.38, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = 'rgba(255,214,140,0.85)';
    ctx.beginPath(); ctx.arc(mx - ms * 0.18, y - ms * 0.92, ms * 0.07 + 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + ms * 0.16, y - ms * 0.84, ms * 0.06 + 0.3, 0, Math.PI * 2); ctx.fill();
    radial(mx, y - ms * 0.9, ms * 1.4, 'rgba(255,200,120,0.12)');
  }
  ctx.restore();
}


// =====================================================================
// ---------- new sections: sinking bridge, apple stairs, pumpkin hill ----------
// =====================================================================

// --- 1. the sinking bridge: three plank sections that sink into the hole in a wave ---
const BRIDGE = { x0: 11840, x1: 12310 };
const BRIDGE_PERIOD = 5;
const bridge = [0, 1, 2].map(i => {
  const w = (BRIDGE.x1 - BRIDGE.x0) / 3;
  return { x: BRIDGE.x0 + i * w, y: GROUND, w, h: 14, off: -i * 1.4, shake: 0 };
});
function bridgeHeight(t) {        // t in [0, period): 0 = level with the ground
  if (t < 2.4) return { y: 0, shake: 0 };
  if (t < 2.9) return { y: 0, shake: (t - 2.4) / 0.5 };              // warning wobble
  if (t < 3.6) { const k = (t - 2.9) / 0.7; return { y: k * k * 280, shake: 0.4 }; }
  if (t < 4.3) return { y: 280, shake: 0 };
  return { y: 280 * (1 - ease((t - 4.3) / 0.7)), shake: 0 };
}

// --- 2. the apple and the nest that raises the staircase ---
const APPLE_HOME = 12430;
const apple = { x: APPLE_HOME, y: GROUND - 46, w: 46, h: 46, vy: 0, roll: 0, latched: false };
const appleNest = { x: 12680, w: 80, glow: 0 };
const appleStairs = { open: 0, steps: [
  { x: 12780, w: 55, h: 46 }, { x: 12835, w: 55, h: 92 },
  { x: 12890, w: 55, h: 138 }, { x: 12945, w: 55, h: 184 },
] };
const stairRects = () => appleStairs.steps.map(st => ({ x: st.x, w: st.w, h: st.h, y: GROUND - st.h * appleStairs.open }));

// --- 3. pumpkin hill: pumpkins roll down the terraces; stumps stop them ---
const PUMPKIN_SPAWN = { x: 14840, y: GROUND - 180 };
const terraces = [
  { x0: 13500, x1: 13820, y: GROUND },
  { x0: 13820, x1: 14140, y: GROUND - 60 },
  { x0: 14140, x1: 14460, y: GROUND - 120 },
  { x0: 14460, x1: 14910, y: GROUND - 180 },
];
const rollers = [];
let rollerTimer = 1.5;

function newSectionSolids() {
  const list = bridge.map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
  if (appleStairs.open > 0.05) list.push(...stairRects());
  list.push(...archSegments());
  list.push(...lanternPosts());
  if (vineGate.open < 0.98) list.push(vineGateRect());
  return list;
}

function resetNewSections() {
  rollers.length = 0;
  rollerTimer = 1.5;
  if (!apple.latched) Object.assign(apple, { x: APPLE_HOME, y: GROUND - apple.h, vy: 0 });
  for (const it of archItems) if (!it.placed) Object.assign(it, { x: it.home, y: GROUND - it.h, vy: 0 });
  for (const c of yardCrates) Object.assign(c, { x: c.home, y: c.homeY, vy: 0 });
}

function updateNewSections(dt) {
  const p = player;
  // bridge: move each section and carry the player standing on it
  for (const b of bridge) {
    const t = (((time + b.off) % BRIDGE_PERIOD) + BRIDGE_PERIOD) % BRIDGE_PERIOD;
    const st = bridgeHeight(t);
    const ny = GROUND + st.y, dy = ny - b.y;
    const standing = !p.dead && p.onGround && p.x + p.w > b.x + 2 && p.x < b.x + b.w - 2 && Math.abs(p.y + p.h - b.y) < 3;
    b.y = ny; b.shake = st.shake;
    if (standing) p.y += dy;
  }

  // apple: gravity, falls back home if it drops into the hole, locks into the nest
  apple.vy = Math.min(apple.vy + GRAV * dt, MAX_FALL);
  if (moveBox(apple, 0, apple.vy * dt, solidList())) { if (apple.vy > 300) crunch(0.2); apple.vy = 0; }
  if (apple.y > H + 80) Object.assign(apple, { x: APPLE_HOME, y: GROUND - apple.h, vy: 0 });
  // the apple sits in the nest while it's there; push it out again and the toadstools sink away
  const ac = apple.x + apple.w / 2;
  const inNest = apple.y + apple.h >= GROUND - 1 && ac > appleNest.x + 10 && ac < appleNest.x + appleNest.w - 10;
  if (inNest && !apple.latched) {
    apple.latched = true; apple.sticky = true;
    apple.x = appleNest.x + appleNest.w / 2 - apple.w / 2;
    leafBurst(ac, GROUND - 10, 30, false); rumble();
  } else if (!inNest && apple.latched) {
    apple.latched = false; crunch(0.3); rumble();
  }
  releaseSticky(apple);
  appleNest.glow = approach(appleNest.glow, apple.latched ? 1 : 0, dt * 2);
  const stairsBefore = appleStairs.open;
  appleStairs.open = approach(appleStairs.open, apple.latched ? 1 : 0, dt * 0.7);
  if (appleStairs.open > stairsBefore)
    for (const r of stairRects()) if (overlap(p, r)) { p.y = r.y - p.h; p.vy = Math.min(p.vy, 0); }

  updateArchPuzzle(dt);
  updateLanternGlade(dt);
  updateCrateYard(dt);

  // pumpkins tumble from the pile while the player is on the hill
  const onHill = p.x > 13350 && p.x < PUMPKIN_SPAWN.x - 10 && !p.dead && !ended;
  if (onHill) {
    rollerTimer -= dt;
    if (rollerTimer <= 0) {
      rollerTimer = 3.1 + Math.random() * 0.4;          // steady rhythm you can learn
      // lob a pumpkin onto the far end of the player's terrace (sometimes the next one up)
      let ti = terraces.findIndex(t => p.x + p.w / 2 >= t.x0 && p.x + p.w / 2 < t.x1);
      if (ti < 0) ti = 0;
      if (ti < terraces.length - 1 && Math.random() < 0.3) ti++;
      const t = terraces[ti], sx = PUMPKIN_SPAWN.x, sy = PUMPKIN_SPAWN.y - 70;
      const r = { x: sx, y: sy, w: 32, h: 30, vx: 0, vy: 0, roll: 0, color: Math.random(), flight: 0 };
      if (ti === terraces.length - 1) { r.vx = -80; r.vy = -260; }     // top terrace: tumble straight off the pile
      else {
        const tx = t.x1 - 50, ty = t.y - r.h, T = 1.5 + (sx - tx) / 3000;   // high, steep lob
        r.vx = (tx - sx) / T; r.vy = (ty - sy - 0.5 * GRAV * T * T) / T;
        r.flight = T; r.tx = tx; r.ty = ty; r.T = T;
      }
      rollers.push(r);
    }
  }
  const solidsNow = solidList();
  for (let i = rollers.length - 1; i >= 0; i--) {
    const r = rollers[i];
    if (r.flight > 0) {                                  // in the air: follow the arc, ignore the ground
      r.flight -= dt;
      r.vy += GRAV * dt; r.x += r.vx * dt; r.y += r.vy * dt; r.roll += r.vx * dt * 0.5;
      if (r.flight <= 0) { r.x = r.tx; r.y = r.ty; r.vx = -150; r.vy = -160; crunch(0.15); leafBurst(r.x + r.w / 2, r.y + r.h, 10, false); }
      const falling = r.flight < r.T * 0.3;
      if (falling && !p.dead && p.x + p.w > r.x + 5 && p.x < r.x + r.w - 5 && p.y + p.h > r.y + 5 && p.y < r.y + r.h - 3) killPlayer(true);
      continue;
    }
    r.vx = approach(r.vx, -250, 500 * dt);
    r.vy = Math.min(r.vy + GRAV * dt, MAX_FALL);
    let smashed = false;
    r.x += r.vx * dt;
    for (const sd of solidsNow) if (overlap(r, sd)) { smashed = true; break; }
    if (!smashed && moveBox(r, 0, r.vy * dt, solidsNow)) {
      if (r.vy > 350) crunch(0.12);
      r.vy = r.vy > 350 ? -r.vy * 0.25 : 0;          // small bounce when it lands off a ledge
    }
    r.roll += r.vx * dt;
    if (smashed) {
      leafBurst(r.x + r.w / 2, r.y + r.h / 2, 26, false); thud();
      rollers.splice(i, 1); continue;
    }
    if (!p.dead && p.x + p.w > r.x + 5 && p.x < r.x + r.w - 5 && p.y + p.h > r.y + 5 && p.y < r.y + r.h - 3) killPlayer(true);
    if (r.y > H + 80 || r.x < 13000) rollers.splice(i, 1);
  }
}

// ---------- drawing for the new sections (plus the old hill-crate puzzle) ----------
function drawNewSections() {
  const x0 = camX - 100, x1 = camX + W + 100;

  // old crate puzzle near the hill: plate, crate and rising steps
  if (hillCrate.x - 60 < x1 && hillCrate.x + 60 > x0) {
    drawCrate(hillCrate);
  }

  // sinking bridge
  if (BRIDGE.x0 - 60 < x1 && BRIDGE.x1 + 60 > x0) {
    // the chasm: misty at the top, falling away into darkness, with root-hung cliff walls
    const g = ctx.createLinearGradient(0, GROUND - 10, 0, H);
    g.addColorStop(0, 'rgba(230,130,70,0)'); g.addColorStop(0.12, 'rgba(220,120,62,0.55)');
    g.addColorStop(0.45, 'rgba(90,36,16,0.75)'); g.addColorStop(1, 'rgba(10,3,1,0.97)');
    ctx.fillStyle = g; ctx.fillRect(BRIDGE.x0, GROUND - 10, BRIDGE.x1 - BRIDGE.x0, H - GROUND + 10);
    for (const px of [BRIDGE.x0 + 6, BRIDGE.x1 - 6]) {             // posts
      ctx.fillStyle = INK; softRect(px - 6, GROUND - 46, 12, 50, 4);
      ctx.fillStyle = '#a85a32'; softRect(px - 6, GROUND - 46, 12, 4, 2);
    }
    // rope rail sagging between the posts through each section
    ctx.strokeStyle = '#6a3a1e'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(BRIDGE.x0 + 6, GROUND - 42);
    for (const b of bridge) {
      const sx = Math.sin(time * 40) * b.shake * 1.5;
      ctx.quadraticCurveTo(b.x + b.w / 2 + sx, b.y - 14, b.x + b.w + sx, b.y - 26);
    }
    ctx.lineTo(BRIDGE.x1 - 6, GROUND - 42); ctx.stroke();
    for (const b of bridge) drawBridgeSection(b);
  }

  // apple meadow
  if (appleNest.x - 200 < x1 && 13000 > x0) {
    drawNest();
    if (appleStairs.open > 0.01) stairRects().forEach((r, i) => drawToadstoolStep(r, i));
    drawApple();
  }

  // treasure meadow and the arch bridge
  if (14900 < x1 && ARCH.x1 + 60 > x0) drawArchSection();
  if (15950 < x1 && 17300 > x0) { drawLanternGlade(); for (const c of yardCrates) drawCrate(c); }

  // pumpkin hill
  if (13500 < x1 && 15200 > x0) {
    for (const sd of solids) if (sd.stump && sd.x < x1 && sd.x + sd.w > x0) drawStump(sd);
    drawPumpkinPile(PUMPKIN_SPAWN.x + 10, PUMPKIN_SPAWN.y);
    for (const r of rollers) if (r.flight > 0) {          // landing shadow so you can see where it falls
      const k = 1 - r.flight / r.T;
      ctx.fillStyle = `rgba(30,10,4,${0.15 + k * 0.4})`;
      ctx.beginPath(); ctx.ellipse(r.tx + r.w / 2, r.ty + r.h, 8 + k * 12, 3 + k * 2, 0, 0, Math.PI * 2); ctx.fill();
    }
    for (const r of rollers) drawRoller(r);
  }
}


function drawCrate(c) {
  ctx.save(); ctx.translate(c.x + c.w / 2, c.y + c.h / 2);
  ctx.fillStyle = '#4a2414'; softRect(-c.w / 2, -c.h / 2, c.w, c.h, 6);
  ctx.strokeStyle = '#8a4a28'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(-c.w / 2 + 6, -c.h / 2 + 6); ctx.lineTo(c.w / 2 - 6, c.h / 2 - 6);
  ctx.moveTo(c.w / 2 - 6, -c.h / 2 + 6); ctx.lineTo(-c.w / 2 + 6, c.h / 2 - 6); ctx.stroke();
  ctx.strokeStyle = '#6a3a1e'; ctx.lineWidth = 2; ctx.strokeRect(-c.w / 2 + 3, -c.h / 2 + 3, c.w - 6, c.h - 6);
  ctx.restore();
}

function drawBridgeSection(b) {
  const sx = Math.sin(time * 40) * b.shake * 1.5, tilt = Math.sin(time * 33) * b.shake * 0.03;
  ctx.save(); ctx.translate(b.x + b.w / 2 + sx, b.y + b.h / 2); ctx.rotate(tilt);
  const n = 7, pw = b.w / n;
  for (let i = 0; i < n; i++) {
    const px = -b.w / 2 + i * pw;
    ctx.fillStyle = i % 2 ? '#5e2e18' : '#6b361c'; softRect(px + 1, -b.h / 2, pw - 2, b.h, 3);
    ctx.fillStyle = '#a0603a'; softRect(px + 3, -b.h / 2, pw - 6, 2, 1);
  }
  ctx.strokeStyle = '#3a1a0c'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-b.w / 2, 1); ctx.lineTo(b.w / 2, 1); ctx.stroke();
  ctx.restore();
}

function drawNest() {
  const n = appleNest, cx = n.x + n.w / 2;
  const pulse = 0.5 + Math.sin(time * 3) * 0.5;
  radial(cx, GROUND - 6, 70 + n.glow * 40 + pulse * 10 * (1 - n.glow), `rgba(255,205,120,${0.32 + pulse * 0.25 * (1 - n.glow) + n.glow * 0.3})`);
  if (!apple.latched) for (let i = 0; i < 3; i++) {     // little sparkles rising from the empty nest
    const t = (time * 0.5 + i / 3) % 1;
    ctx.fillStyle = `rgba(255,235,180,${(1 - t) * 0.8})`;
    ctx.beginPath(); ctx.arc(cx + Math.sin(i * 2.4 + time) * 18, GROUND - 10 - t * 50, 1.8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = INK; ctx.lineCap = 'round';
  const r = rng(321);
  for (let i = 0; i < 14; i++) {                       // woven twigs
    const a = r() * 0.5 - 0.25, x = n.x + r() * n.w, l = 14 + r() * 16;
    ctx.lineWidth = 2 + r() * 1.5;
    ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * l / 2, GROUND - 4 - r() * 8 + Math.sin(a) * l / 2);
    ctx.lineTo(x + Math.cos(a) * l / 2, GROUND - 4 - r() * 8 - Math.sin(a) * l / 2); ctx.stroke();
  }
  for (let i = 0; i < 4; i++) drawLeaf(n.x + 8 + i * 21, GROUND - 10 - (i % 2) * 4, 5, 0.3 * i - 0.4, 1, LEAF_COLORS[i]);
}

function drawApple() {
  const a = apple, cx = a.x + a.w / 2, cy = a.y + a.h / 2;
  const wob = a.latched ? 0 : Math.sin(time * 2.2) * 0.035;
  ctx.save(); ctx.translate(cx, cy + a.h * 0.5);
  ctx.rotate(a.latched ? 0 : (a.roll / (a.w / 2)) * 0.25 + Math.sin(time * 1.7) * 0.03);
  ctx.scale(1 + wob, 1 - wob); ctx.translate(0, -a.h * 0.5);
  const W2 = a.w / 2, H2 = a.h / 2;
  const body = () => {                                  // a slightly lopsided, hand-drawn apple
    ctx.beginPath();
    ctx.moveTo(-1, -H2 * 0.66);
    ctx.bezierCurveTo(W2 * 0.55, -H2 * 1.12, W2 * 1.22, -H2 * 0.45, W2 * 0.98, H2 * 0.28);
    ctx.bezierCurveTo(W2 * 0.82, H2 * 0.92, W2 * 0.3, H2 * 1.02, 2, H2 * 0.86);
    ctx.bezierCurveTo(-W2 * 0.3, H2 * 1.04, -W2 * 0.88, H2 * 0.86, -W2 * 1.0, H2 * 0.2);
    ctx.bezierCurveTo(-W2 * 1.18, -H2 * 0.5, -W2 * 0.55, -H2 * 1.08, -1, -H2 * 0.66);
    ctx.closePath();
  };
  body(); ctx.fillStyle = '#c4492a'; ctx.fill();
  ctx.save(); body(); ctx.clip();                        // flat painted shadow crescent
  ctx.fillStyle = '#8f2e16';
  ctx.beginPath(); ctx.ellipse(W2 * 0.55, H2 * 0.4, W2 * 0.75, H2 * 0.95, -0.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#d9662b';
  ctx.beginPath(); ctx.ellipse(-W2 * 0.25, -H2 * 0.2, W2 * 0.5, H2 * 0.55, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = INK; ctx.lineWidth = 2.6; ctx.lineJoin = 'round'; body(); ctx.stroke();
  ctx.strokeStyle = '#f6cf78'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';   // painted highlight swoosh
  ctx.beginPath(); ctx.arc(-W2 * 0.2, -H2 * 0.05, W2 * 0.55, Math.PI * 1.08, Math.PI * 1.42); ctx.stroke();
  ctx.fillStyle = '#f6cf78'; ctx.beginPath(); ctx.arc(-W2 * 0.68, H2 * 0.08, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 3;                // curly stem
  ctx.beginPath(); ctx.moveTo(0, -H2 * 0.6);
  ctx.bezierCurveTo(-2, -H2 * 0.95, 4, -H2 * 1.25, 8, -H2 * 1.12);
  ctx.bezierCurveTo(11, -H2 * 1.0, 9, -H2 * 0.88, 6.5, -H2 * 0.98); ctx.stroke();
  const flutter = Math.sin(time * 3) * 0.15;              // leaf with a vein, fluttering
  ctx.save(); ctx.translate(2, -H2 * 0.92); ctx.rotate(-0.5 + flutter);
  ctx.fillStyle = '#e8a03a'; ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-8, -8, -17, -3); ctx.quadraticCurveTo(-8, 4, 0, 0); ctx.fill(); ctx.stroke();
  ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-1, -0.5); ctx.quadraticCurveTo(-8, -3, -14, -2.6); ctx.stroke();
  ctx.restore();
  ctx.restore();
  if (!a.latched) for (let i = 0; i < 3; i++) {           // little magic sparkles around it
    const t = time * 1.3 + i * 2.1, k = (Math.sin(t * 1.7) + 1) / 2;
    sparkle(cx + Math.cos(t) * (a.w * 0.72), cy - a.h * 0.25 + Math.sin(t * 1.3) * a.h * 0.45, 1.5 + k * 2.4, 0.25 + k * 0.6);
  }
}
function sparkle(x, y, s, alpha) {
  ctx.fillStyle = `rgba(255,236,180,${alpha})`;
  ctx.beginPath();
  ctx.moveTo(x, y - s * 2); ctx.quadraticCurveTo(x, y, x + s * 2, y);
  ctx.quadraticCurveTo(x, y, x, y + s * 2); ctx.quadraticCurveTo(x, y, x - s * 2, y);
  ctx.quadraticCurveTo(x, y, x, y - s * 2); ctx.fill();
}

// giant toadstools that grow out of the ground as the apple-stairs
const TOAD_CAPS = ['#b8401f', '#d9662b', '#8f2e16', '#e8a03a'];
function drawToadstoolStep(r, i) {
  const h = GROUND - r.y;
  if (h < 1) return;
  const cx = r.x + r.w / 2, sway = Math.sin(time * 1.4 + i) * 0.6;
  ctx.save();
  // stem: a soft, slightly bulging curve, with a little frill under the cap
  const sw = r.w * 0.38;
  ctx.fillStyle = INK; ctx.beginPath();
  ctx.moveTo(cx - sw * 0.62, GROUND + 2);
  ctx.bezierCurveTo(cx - sw * 0.75, GROUND - h * 0.4, cx - sw * 0.35 + sway, r.y + 16, cx - sw * 0.42 + sway, r.y + 8);
  ctx.lineTo(cx + sw * 0.42 + sway, r.y + 8);
  ctx.bezierCurveTo(cx + sw * 0.35 + sway, r.y + 16, cx + sw * 0.75, GROUND - h * 0.4, cx + sw * 0.62, GROUND + 2);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(200,120,60,0.45)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(cx - sw * 0.5, GROUND - 4); ctx.quadraticCurveTo(cx - sw * 0.6, GROUND - h * 0.45, cx - sw * 0.3 + sway, r.y + 14); ctx.stroke();
  if (h > 30) {
    ctx.fillStyle = INK; ctx.beginPath();
    ctx.ellipse(cx + sway, r.y + 17, sw * 0.62, 3, 0, 0, Math.PI * 2); ctx.fill();
  }
  // cap: flat on top so feet sit right on it, rounded dome edges underneath
  const x0 = r.x - 5, x1 = r.x + r.w + 5;
  ctx.fillStyle = TOAD_CAPS[i % TOAD_CAPS.length]; ctx.strokeStyle = INK; ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(x0 + 8, r.y);
  ctx.lineTo(x1 - 8, r.y);
  ctx.quadraticCurveTo(x1 + 2, r.y + 1, x1, r.y + 10);
  ctx.quadraticCurveTo(cx, r.y + 17, x0, r.y + 10);
  ctx.quadraticCurveTo(x0 - 2, r.y + 1, x0 + 8, r.y);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';                     // darker underside band
  ctx.beginPath(); ctx.moveTo(x1 - 1, r.y + 8); ctx.quadraticCurveTo(cx, r.y + 15, x0 + 1, r.y + 8);
  ctx.quadraticCurveTo(cx, r.y + 11, x1 - 1, r.y + 8); ctx.fill();
  // glowing spots
  for (let k = 0; k < 4; k++) {
    const sx = x0 + 10 + k * ((x1 - x0 - 20) / 3) + (hash(i * 7 + k) - 0.5) * 6, sy = r.y + 4 + hash(i * 3 + k) * 3;
    const pulse = 0.6 + Math.sin(time * 2 + k + i) * 0.25;
    radial(sx, sy, 7, `rgba(255,220,150,${0.18 * pulse})`);
    ctx.fillStyle = '#ffe6b0'; ctx.beginPath(); ctx.ellipse(sx, sy, 2.2 + (k % 2), 1.5 + (k % 2) * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

const MOSS = ['#3f4220', '#4b4e27', '#565a2c', '#44471f'];
function drawStump(sd) {
  const x = sd.x, y = sd.y, w = sd.w, h = sd.h, seed = sd.x * 0.37;
  const r = k => hash(seed + k * 1.73);
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // roots flaring unevenly into the ground
  ctx.fillStyle = '#3a1a0c';
  for (const [side, len, lift] of [[-1, 10 + r(1) * 8, 6 + r(2) * 6], [1, 6 + r(3) * 12, 4 + r(4) * 8], [-1, 4 + r(5) * 5, 14]]) {
    const bx = side < 0 ? x + 4 : x + w - 4;
    ctx.beginPath(); ctx.moveTo(bx, y + h - lift - 6);
    ctx.quadraticCurveTo(bx + side * len * 0.5, y + h - lift * 0.4, bx + side * len, y + h + 1);
    ctx.lineTo(bx - side * 6, y + h + 1); ctx.closePath(); ctx.fill();
  }
  // trunk with a broken, jagged top (no neat circles)
  const top = [];
  const n = 7;
  for (let i = 0; i <= n; i++) {
    const tx = x + 1 + (w - 2) * i / n;
    let ty = y + 2 + r(10 + i) * 6;
    if (i === 2 + Math.floor(r(30) * 3)) ty = y - 4 - r(31) * 5;      // one tall splinter
    top.push([tx, ty]);
  }
  ctx.beginPath(); ctx.moveTo(x - 1, y + h);
  ctx.quadraticCurveTo(x + 1, y + h * 0.55, top[0][0], top[0][1] + 3);
  for (const [tx, ty] of top) ctx.lineTo(tx, ty);
  ctx.quadraticCurveTo(x + w - 1, y + h * 0.55, x + w + 1, y + h); ctx.closePath(); ctx.fill();
  // worn, uneven cut face: a partial warm sliver and a few broken ring fragments
  ctx.fillStyle = 'rgba(184,116,62,0.55)';
  ctx.beginPath(); ctx.moveTo(top[1][0], top[1][1] + 1.5);
  for (let i = 2; i < n - 1; i++) ctx.lineTo(top[i][0], Math.max(top[i][1], y + 1) + 1.5);
  ctx.lineTo(top[n - 2][0] - 2, y + 7); ctx.quadraticCurveTo(x + w * 0.45, y + 9 + r(40) * 2, top[1][0] + 2, y + 6); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(90,44,20,0.7)'; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.arc(x + w * (0.35 + r(41) * 0.2), y + 6, 4 + r(42) * 3, Math.PI * 1.05, Math.PI * (1.6 + r(43) * 0.3)); ctx.stroke();
  ctx.beginPath(); ctx.arc(x + w * (0.5 + r(44) * 0.15), y + 6.5, 8 + r(45) * 3, Math.PI * 1.2, Math.PI * 1.7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + w * 0.62, y + 3); ctx.lineTo(x + w * 0.7, y + 8); ctx.lineTo(x + w * 0.66, y + 13); ctx.stroke();   // crack
  // bark grooves
  ctx.strokeStyle = 'rgba(150,82,44,0.4)'; ctx.lineWidth = 1.1;
  for (let k = 0; k < 3; k++) {
    const gx = x + 6 + k * (w - 12) / 2 + (r(50 + k) - 0.5) * 4;
    ctx.beginPath(); ctx.moveTo(gx, y + 12 + r(53 + k) * 4);
    ctx.quadraticCurveTo(gx + (r(56 + k) - 0.5) * 6, y + h * 0.6, gx + (r(59 + k) - 0.5) * 4, y + h - 3); ctx.stroke();
  }
  // a dark knot hole... with something inside that blinks now and then
  const kx = x + w * (0.3 + r(60) * 0.35), ky = y + h * (0.52 + r(61) * 0.12);
  ctx.fillStyle = '#140804'; ctx.beginPath(); ctx.ellipse(kx, ky, 5, 6.5, (r(62) - 0.5) * 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(150,82,44,0.5)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.ellipse(kx, ky, 6.5, 8, (r(62) - 0.5) * 0.5, 0, Math.PI * 2); ctx.stroke();
  const cycle = (time * 0.35 + r(63) * 7) % 4;
  const open = cycle < 3.7 ? Math.min(1, cycle * 2) : 0;         // eyes appear, stay a while, then blink shut
  if (open > 0) {
    const ex = Math.sin(time * 0.6 + seed) * 0.8;
    radial(kx, ky, 8, `rgba(255,210,120,${0.2 * open})`);
    ctx.fillStyle = `rgba(255,226,150,${0.9 * open})`;
    ctx.beginPath(); ctx.ellipse(kx - 1.8 + ex, ky - 0.5, 1, open * 1.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(kx + 1.8 + ex, ky - 0.5, 1, open * 1.1, 0, 0, Math.PI * 2); ctx.fill();
  }
  // moss draped over one side of the top and dripping down
  const mossSide = r(70) < 0.5 ? 0 : 1;
  const mx0 = mossSide ? x + w * 0.35 : x - 2, mx1 = mossSide ? x + w + 2 : x + w * 0.65;
  for (let k = 0; k < 60; k++) {                                 // small soft tufts hugging the bark
    const t = r(80 + k);
    const mx = Math.max(x + 1.5, Math.min(x + w - 1.5, mx0 + (mx1 - mx0) * t));
    const edge = mossSide ? (mx > x + w - 9) : (mx < x + 9);
    const depth = edge ? r(110 + k) * h * 0.6 : r(110 + k) * r(115 + k) * 9;   // drips further down the side
    ctx.fillStyle = MOSS[k % MOSS.length];
    ctx.beginPath(); ctx.arc(mx, y + 3 + depth, 0.9 + r(140 + k) * 1.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = MOSS[0]; ctx.lineWidth = 0.9;                  // a few hanging moss strands
  for (let k = 0; k < 3; k++) {
    const hx = mossSide ? x + w - 1 + k * 1.5 : x + 1 - k * 1.5, hy = y + 4 + k * 5, len = 8 + r(170 + k) * 10;
    const sw = Math.sin(time * 1.3 + k + seed) * 1.5;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.quadraticCurveTo(hx + sw, hy + len * 0.6, hx + sw * 1.5, hy + len); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(170,175,110,0.3)';                          // dewy highlights on the moss
  for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.arc(mx0 + (mx1 - mx0) * r(190 + k), y + 1 + r(195 + k) * 3, 0.9, 0, Math.PI * 2); ctx.fill(); }
  // two tiny glowing mushrooms at the base, and a mote drifting up
  for (let k = 0; k < 2; k++) {
    const gx = (k ? x + w + 3 : x - 3) + (r(200 + k) - 0.5) * 4, gy = y + h, ms = 3 + r(205 + k) * 2;
    ctx.fillStyle = INK; ctx.fillRect(gx - 0.6, gy - ms, 1.2, ms);
    ctx.fillStyle = '#ffd98f'; ctx.beginPath(); ctx.ellipse(gx, gy - ms, ms * 0.6, ms * 0.4, 0, Math.PI, 0); ctx.fill();
    radial(gx, gy - ms, 6, 'rgba(255,210,130,0.25)');
  }
  const mt = (time * 0.25 + r(210)) % 1;
  ctx.fillStyle = `rgba(255,226,160,${(1 - mt) * 0.7})`;
  ctx.beginPath(); ctx.arc(x + w * 0.5 + Math.sin(time + seed) * 6, y - mt * 40, 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawPumpkinShape(cx, by, s, rot, body, rib) {
  ctx.save(); ctx.translate(cx, by - 21 * s); ctx.rotate(rot); ctx.scale(s, s);
  ctx.fillStyle = body; ctx.beginPath();
  ctx.ellipse(-10, 0, 12, 19, 0, 0, Math.PI * 2);
  ctx.ellipse(10, 0, 12, 19, 0, 0, Math.PI * 2);
  ctx.ellipse(0, -1, 14, 20, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = rib; ctx.lineWidth = 1.6;
  for (const [ox, rx] of [[-10, 12], [0, 14], [10, 12]]) { ctx.beginPath(); ctx.ellipse(ox, 0, rx - 1, 18, 0, -1.3, -0.3); ctx.stroke(); }
  ctx.strokeStyle = '#4a2a10'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -19); ctx.quadraticCurveTo(1, -26, 6, -28); ctx.stroke();
  ctx.restore();
}

function drawPumpkinPile(x, y) {
  drawPumpkinShape(x - 34, y, 0.9, -0.1, '#6a2a10', '#4a1c0a');
  drawPumpkinShape(x + 30, y, 1.0, 0.12, '#6a2a10', '#4a1c0a');
  drawPumpkinShape(x, y, 1.25, 0, '#7a3214', '#4a1c0a');
  drawPumpkinShape(x - 14, y - 36, 0.85, -0.2, '#8a3a16', '#5a220c');
  radial(x, y - 30, 70, 'rgba(255,150,60,0.12)');
}

function drawRoller(r) {
  const body = r.color < 0.5 ? '#d9662b' : '#e88a35';
  drawPumpkinShape(r.x + r.w / 2, r.y + r.h + 2, 0.78, r.roll / 16, body, '#9a3a14');
}


// ---------- semi-long bob with soft bangs ----------
// Three short strand chains (front, middle, back) hang from the head and swing with verlet physics,
// pulled gently back toward the bob's shape. They're drawn as one hair mass behind the head,
// with the bangs and a few strand lines drawn on top.
const PS = 1.85;   // must match the scale in drawPlayer
const BOB_LEN = 1.18;
const BOB_REST = (() => {
  const back = [[-8.6, -47], [-10.2, -43], [-10.8, -39], [-10.6, -35], [-9.4, -32.6]];
  const mid = [[-4, -49], [-5.6, -44], [-6.2, -39.5], [-6, -35], [-5.2, -32.4]];
  const front = [[0.8, -48], [0, -44], [-0.5, -40], [-0.4, -36], [0.4, -33.4]];
  const stretch = ch => ch.map(([x, y]) => [x, ch[0][1] + (y - ch[0][1]) * BOB_LEN]);
  return [stretch(front), stretch(mid), stretch(back)];
})();
const hairChains = BOB_REST.map(rest => ({ rest, pts: null, prev: null }));

function playerPoint(lx, ly) {
  const p = player, cx = p.x + p.w / 2, by = p.y + p.h;
  const moving = p.onGround && Math.abs(p.vx) > 20;
  const bob = moving ? -Math.abs(Math.sin(p.walk)) * 1.5 : Math.sin(time * 2) * 0.4;
  const lean = (Math.abs(p.vx) / RUN) * 0.07 + (p.pushing ? 0.2 : 0);
  const y1 = ly + 16;
  const rx = lx * Math.cos(lean) - y1 * Math.sin(lean);
  const ry = lx * Math.sin(lean) + y1 * Math.cos(lean) - 16 + bob;
  return [cx + p.face * PS * rx, by + PS * ry];
}

function updateHair(dt) {
  const p = player;
  const inWind = [WIND, WIND2, WIND3].some(z => p.x + p.w > z.x0 && p.x < z.x1);
  const breeze = Math.sin(time * 1.3) * 420 + Math.sin(time * 2.7 + 1) * 180 + 60;
  const ax = breeze + gust * (inWind ? 2600 : 380);
  const moving = p.onGround && Math.abs(p.vx) > 20;
  const stepBounce = moving ? Math.cos(p.walk * 2) * 900 : 0;
  for (const ch of hairChains) {
    const rest = ch.rest.map(([x, y]) => playerPoint(x, y)), n = rest.length;
    if (!ch.pts || Math.hypot(ch.pts[0][0] - rest[0][0], ch.pts[0][1] - rest[0][1]) > 40) {
      ch.pts = rest.map(q => [...q]); ch.prev = rest.map(q => [...q]);
    }
    ch.pts[0] = rest[0]; ch.prev[0] = rest[0];
    for (let i = 1; i < n; i++) {
      const q = ch.pts[i], o = ch.prev[i], f = i / (n - 1);
      const vx = (q[0] - o[0]) * 0.985, vy = (q[1] - o[1]) * 0.985;
      o[0] = q[0]; o[1] = q[1];
      q[0] += vx + ax * f * 0.7 * dt * dt;
      q[1] += vy + (900 + stepBounce * f) * dt * dt;
      const k = 0.14 * Math.pow(1 - f, 1.5) + 0.02;     // holds the bob shape, ends swing freely
      q[0] += (rest[i][0] - q[0]) * k; q[1] += (rest[i][1] - q[1]) * k;
    }
    for (let it = 0; it < 4; it++) for (let i = 1; i < n; i++) {
      const a = ch.pts[i - 1], b = ch.pts[i];
      const L = Math.hypot(rest[i][0] - rest[i - 1][0], rest[i][1] - rest[i - 1][1]);
      const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1, diff = (d - L) / d;
      if (i === 1) { b[0] -= dx * diff; b[1] -= dy * diff; }
      else { a[0] += dx * diff * 0.5; a[1] += dy * diff * 0.5; b[0] -= dx * diff * 0.5; b[1] -= dy * diff * 0.5; }
    }
  }
}

function drawHairBack() {
  if (!hairChains[0].pts) updateHair(0);
  const [fw, mid, bw] = hairChains.map(c => c.pts);
  const cap = [[4.6, -49.8], [2, -52.4], [-2.4, -53.6], [-6.6, -52], [-9.4, -48.4]].map(([x, y]) => playerPoint(x, y));
  const tipMid = mid[mid.length - 1], tipFront = fw[fw.length - 1];
  ctx.save(); ctx.fillStyle = INK; ctx.beginPath();
  ctx.moveTo(cap[0][0], cap[0][1]);
  for (let i = 1; i < cap.length; i++) {
    const a = cap[i - 1], b = cap[i];
    ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  const last = cap[cap.length - 1]; ctx.lineTo(last[0], last[1]);
  // down the back, puffing out a little for the bob's rounded volume
  const backPts = bw.slice(1).map((q, i, arr) => [q[0] - player.face * (i < arr.length - 1 ? 1.4 : 0.4) * PS, q[1]]);
  for (let i = 0; i < backPts.length; i++) {
    const q = backPts[i], nxt = backPts[i + 1];
    if (nxt) ctx.quadraticCurveTo(q[0], q[1], (q[0] + nxt[0]) / 2, (q[1] + nxt[1]) / 2); else ctx.lineTo(q[0], q[1]);
  }
  // soft ends that curve slightly under
  ctx.quadraticCurveTo(tipMid[0] - player.face * 2, tipMid[1] + 3, tipMid[0], tipMid[1] + 1);
  ctx.quadraticCurveTo((tipMid[0] + tipFront[0]) / 2, Math.max(tipMid[1], tipFront[1]) + 3, tipFront[0], tipFront[1]);
  // up the front piece by the ear
  for (let i = fw.length - 2; i >= 1; i--) {
    const q = fw[i], nxt = fw[i - 1];
    ctx.quadraticCurveTo(q[0], q[1], (q[0] + nxt[0]) / 2, (q[1] + nxt[1]) / 2);
  }
  ctx.lineTo(fw[0][0], fw[0][1]);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawHairFront() {
  if (player.hidden) return;
  const [, mid, bw] = hairChains.map(c => c.pts);
  ctx.save();
  // soft bangs over the forehead
  const pts = [[-1, -52.4], [4.2, -51.8], [7.2, -49.2], [7.9, -46], [7.4, -44.4], [6.4, -45.4], [5.6, -44.6], [4.6, -46], [3.2, -45.6], [2.4, -47]].map(([x, y]) => playerPoint(x, y));
  const sw = Math.sin(time * 2.2) * 0.6;
  ctx.fillStyle = INK; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] + (i > 2 && i < 8 ? sw * player.face : 0), pts[i][1]);
  ctx.closePath(); ctx.fill();
  // faint strand lines so the hair reads as hair against the dark head
  ctx.strokeStyle = 'rgba(150,80,44,0.26)'; ctx.lineWidth = 0.9; ctx.lineCap = 'round';
  for (const [ch, lx, off] of [[mid, -4, 0], [bw, -7.6, 1.4]]) {
    const top = playerPoint(lx, -50.6);
    ctx.beginPath(); ctx.moveTo(top[0], top[1]);
    for (let i = 1; i < ch.length - 1; i++) ctx.lineTo(ch[i][0] + player.face * off * 0.4, ch[i][1]);
    ctx.stroke();
  }
  ctx.restore();
}


// =====================================================================
// ---------- treasure meadow: push 3 treasures onto 3 sockets to grow an arch bridge ----------
// =====================================================================
const ARCH = { x0: 15500, x1: 15900, peak: 58, open: 0 };
const ARCH_SEGS = 40;
// treasures can't pass each other, so their order matters (push the pinecone before the toadstool).
// Placed treasures can be pushed out again, and then the bridge crumbles away.
const archItems = [
  { kind: 'acorn', home: 15040, w: 38, h: 44 },
  { kind: 'toadstool', home: 15120, w: 46, h: 44 },
  { kind: 'pinecone', home: 15230, w: 36, h: 48 },
].map(it => ({ ...it, x: it.home, y: GROUND - it.h, vy: 0, roll: 0, placed: false }));
const archSockets = [
  { kind: 'acorn', x: 14915, w: 80, glow: 0 },      // wide and against the cliff: it can't jam in the corner, and there's room to stand behind it
  { kind: 'toadstool', x: 15240, w: 60, glow: 0 },
  { kind: 'pinecone', x: 15425, w: 60, glow: 0 },
];

function pushables(list) {
  return [
    { b: pumpkin, blockers: list },
    { b: hillCrate, blockers: [...list, lateBramble] },     // the spikes stop the box
    { b: apple, blockers: list, locked: apple.sticky },
    ...archItems.map(it => ({ b: it, blockers: [...list, ...archItems.filter(o => o !== it)], locked: it.sticky })),
    ...yardCrates.map(c => ({ b: c, blockers: [...list, ...yardCrates.filter(o => o !== c)] })),
  ];
}

const archTopY = x => GROUND - ARCH.peak * Math.sin(Math.PI * (x - ARCH.x0) / (ARCH.x1 - ARCH.x0));
function archSegBuilt(i) { return ARCH.open >= Math.min(i, ARCH_SEGS - 1 - i) / ((ARCH_SEGS - 1) / 2); }
function archSegments() {
  if (ARCH.open <= 0) return [];
  const out = [], w = (ARCH.x1 - ARCH.x0) / ARCH_SEGS;
  for (let i = 0; i < ARCH_SEGS; i++) {
    if (!archSegBuilt(i)) continue;
    const x = ARCH.x0 + i * w;
    out.push({ x, y: Math.round(archTopY(x + w / 2)), w, h: 24, step: true });
  }
  return out;
}

function updateArchPuzzle(dt) {
  const list = solidList();
  const wasComplete = archItems.every(o => o.placed);
  for (const it of archItems) {
    it.vy = Math.min(it.vy + GRAV * dt, MAX_FALL);
    if (moveBox(it, 0, it.vy * dt, list)) { if (it.vy > 300) crunch(0.2); it.vy = 0; }
    if (it.y > H + 80) Object.assign(it, { x: it.home, y: GROUND - it.h, vy: 0 });
    const sock = archSockets.find(k => k.kind === it.kind), c = it.x + it.w / 2;
    const inSocket = it.y + it.h >= GROUND - 1 && c > sock.x + 10 && c < sock.x + sock.w - 10;
    if (inSocket && !it.placed) {
      it.placed = true; it.sticky = true; it.x = sock.x + sock.w / 2 - it.w / 2;
      leafBurst(sock.x + sock.w / 2, GROUND - 10, 24, false); crunch(0.3);
    } else if (!inSocket && it.placed) {
      it.placed = false; crunch(0.3);
    }
    releaseSticky(it);
  }
  const complete = archItems.every(o => o.placed);
  if (complete !== wasComplete) rumble();
  for (const k of archSockets) k.glow = approach(k.glow, archItems.some(it => it.placed && it.kind === k.kind) ? 1 : 0, dt * 2);
  const before = ARCH.open;
  ARCH.open = approach(ARCH.open, complete ? 1 : 0, dt * (complete ? 0.45 : 0.6));   // grows from the cliffs, crumbles from the middle
  if (ARCH.open > before) {
    const p = player;                                    // never grow a segment through the player
    for (const sg of archSegments()) if (overlap(p, sg)) { p.y = sg.y - p.h; p.vy = Math.min(p.vy, 0); }
  }
}
// A freshly placed object holds still until you let go of the arrow key, so you don't push it
// straight back out by accident. After that, pushing it again moves it out of its spot.
function releaseSticky(b) {
  if (!b.sticky) return;
  const p = player, towards = (b.x + b.w / 2) > (p.x + p.w / 2) ? holdR() : holdL();
  const far = Math.abs((b.x + b.w / 2) - (p.x + p.w / 2)) > 90;
  if (!towards || far || p.dead) b.sticky = false;
}

// ---- drawing ----
function drawTreasure(kind, cx, by, alpha, rot) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(cx, by); ctx.rotate(rot || 0);
  ctx.strokeStyle = INK; ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (kind === 'acorn') {
    ctx.fillStyle = '#b8401f';                           // nut
    ctx.beginPath(); ctx.moveTo(-15, -26);
    ctx.bezierCurveTo(-17, -8, -8, -1, 0, 0); ctx.bezierCurveTo(8, -1, 17, -8, 15, -26); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#8f2e16'; ctx.beginPath(); ctx.moveTo(6, -24); ctx.bezierCurveTo(12, -10, 6, -4, 0, -1.5); ctx.bezierCurveTo(8, -8, 9, -16, 6, -24); ctx.fill();
    ctx.strokeStyle = '#f6cf78'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(-4, -14, 7, Math.PI * 0.95, Math.PI * 1.3); ctx.stroke();
    ctx.fillStyle = INK; ctx.strokeStyle = INK; ctx.lineWidth = 2.4;    // cap
    ctx.beginPath(); ctx.moveTo(-19, -25); ctx.quadraticCurveTo(-18, -40, 0, -41); ctx.quadraticCurveTo(18, -40, 19, -25);
    ctx.quadraticCurveTo(0, -21, -19, -25); ctx.fill();
    ctx.strokeStyle = '#7a4220'; ctx.lineWidth = 1;
    for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(k * 7 - 6, -25); ctx.lineTo(k * 7 + 6, -38); ctx.moveTo(k * 7 + 6, -25); ctx.lineTo(k * 7 - 6, -38); ctx.stroke(); }
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -40); ctx.bezierCurveTo(1, -46, 6, -48, 7, -44); ctx.stroke();
  } else if (kind === 'toadstool') {
    ctx.fillStyle = '#e9c58e';                            // stem
    ctx.beginPath(); ctx.moveTo(-8, 0); ctx.bezierCurveTo(-10, -12, -6, -20, -7, -26); ctx.lineTo(7, -26); ctx.bezierCurveTo(6, -20, 10, -12, 8, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d9662b';                            // cap
    ctx.beginPath(); ctx.moveTo(-23, -24); ctx.bezierCurveTo(-22, -46, 22, -46, 23, -24); ctx.quadraticCurveTo(0, -19, -23, -24); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#8f2e16'; ctx.beginPath(); ctx.moveTo(10, -40); ctx.bezierCurveTo(20, -36, 22, -28, 21, -24.5); ctx.quadraticCurveTo(14, -27, 10, -40); ctx.fill();
    ctx.fillStyle = '#ffe6b0';
    for (const [sx, sy, r] of [[-12, -31, 3.4], [-1, -38, 2.6], [10, -32, 3], [3, -27.5, 2], [-17, -26.5, 1.8]]) { ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill(); }
  } else {
    ctx.fillStyle = '#5e2a14';                            // pinecone body
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-16, -6, -18, -34, 0, -46); ctx.bezierCurveTo(18, -34, 16, -6, 0, 0); ctx.fill(); ctx.stroke();
    for (let row = 0; row < 6; row++) {                    // scales with warm tips
      const y = -6 - row * 6.6, half = 12 * Math.sin(Math.PI * (row + 0.8) / 7.2);
      for (let k = -1; k <= 1; k++) {
        const sx = k * half * 0.62 + (row % 2 ? 3 : 0) * (k === 0 ? 1 : 0);
        ctx.fillStyle = '#8f2e16'; ctx.beginPath(); ctx.ellipse(sx, y, 4.4, 3.4, 0, 0, Math.PI); ctx.fill();
        ctx.strokeStyle = '#e8a03a'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(sx, y, 4.4, 3.4, 0, 0.2, Math.PI - 0.2); ctx.stroke();
      }
    }
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -45); ctx.quadraticCurveTo(-2, -50, 2, -52); ctx.stroke();
  }
  ctx.restore();
}

function drawArchSection() {
  // the chasm
  const g = ctx.createLinearGradient(0, GROUND - 10, 0, H);
  g.addColorStop(0, 'rgba(230,130,70,0)'); g.addColorStop(0.12, 'rgba(220,120,62,0.55)');
  g.addColorStop(0.45, 'rgba(90,36,16,0.75)'); g.addColorStop(1, 'rgba(10,3,1,0.97)');
  ctx.fillStyle = g; ctx.fillRect(ARCH.x0, GROUND - 10, ARCH.x1 - ARCH.x0, H - GROUND + 10);

  // sockets: flat stones with the glowing outline of the treasure that belongs there
  for (const k of archSockets) {
    const cx = k.x + k.w / 2, pulse = 0.5 + Math.sin(time * 2.4 + cx) * 0.5;
    radial(cx, GROUND - 14, 46 + k.glow * 30, `rgba(255,205,120,${0.14 + pulse * 0.1 * (1 - k.glow) + k.glow * 0.3})`);
    ctx.fillStyle = INK; softRect(k.x, GROUND - 5, k.w, 9, 4);
    ctx.fillStyle = k.glow > 0.5 ? '#ffd98f' : '#8a4a28'; softRect(k.x + 6, GROUND - 5, k.w - 12, 2, 1);
    if (k.glow < 1) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      drawTreasure(k.kind, cx, GROUND - 4, (0.16 + pulse * 0.12) * (1 - k.glow), 0);
      ctx.restore();
    }
  }
  for (const it of archItems) {
    const cx = it.x + it.w / 2;
    if (!it.placed) sparkle(cx + Math.sin(time * 1.6 + cx) * it.w * 0.7, it.y - 4 + Math.cos(time * 1.2 + cx) * 8, 1.6, 0.5 + Math.sin(time * 3 + cx) * 0.3);
    drawTreasure(it.kind, cx, it.y + it.h, 1, it.placed ? 0 : Math.sin(it.roll / 18) * 0.12);
  }

  // the arch bridge, growing from both cliffs to meet in the middle
  if (ARCH.open <= 0) return;
  const segW = (ARCH.x1 - ARCH.x0) / ARCH_SEGS;
  const built = [];
  for (let i = 0; i < ARCH_SEGS; i++) built.push(archSegBuilt(i));
  const runs = [];                                        // contiguous built runs (left part, right part)
  for (let i = 0; i < ARCH_SEGS; i++) if (built[i] && (i === 0 || !built[i - 1])) { let j = i; while (j + 1 < ARCH_SEGS && built[j + 1]) j++; runs.push([i, j]); }
  const under = x => {                                     // the arch's curved underside
    const u = (x - ARCH.x0) / (ARCH.x1 - ARCH.x0);
    return GROUND + 70 - (70 + ARCH.peak - 20) * Math.sin(Math.PI * u);
  };
  for (const [i0, i1] of runs) {
    const xa = ARCH.x0 + i0 * segW, xb = ARCH.x0 + (i1 + 1) * segW;
    ctx.fillStyle = INK; ctx.beginPath();
    ctx.moveTo(xa, archTopY(xa));
    for (let x = xa; x <= xb; x += 5) ctx.lineTo(x, archTopY(x));
    ctx.lineTo(xb, archTopY(xb));
    for (let x = xb; x >= xa; x -= 5) ctx.lineTo(x, Math.max(archTopY(x) + 16, under(x)));
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(217,148,69,0.6)'; ctx.lineWidth = 1.6;     // warm rim on the walking surface
    ctx.beginPath(); for (let x = xa; x <= xb; x += 5) { if (x === xa) ctx.moveTo(x, archTopY(x) + 1); else ctx.lineTo(x, archTopY(x) + 1); } ctx.stroke();
    // carved stones with glowing runes, and curly roots hanging underneath
    for (let x = xa + 20; x < xb - 6; x += 40) {
      const ty = archTopY(x) + 9, pulse = 0.55 + Math.sin(time * 2 + x * 0.05) * 0.3;
      ctx.strokeStyle = 'rgba(120,60,30,0.6)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x - 20, archTopY(x - 20) + 3); ctx.lineTo(x - 20, Math.max(archTopY(x - 20) + 16, under(x - 20)) - 2); ctx.stroke();
      radial(x, ty, 9, `rgba(255,205,120,${0.35 * pulse})`);
      ctx.fillStyle = `rgba(255,226,160,${0.6 + pulse * 0.3})`; ctx.beginPath(); ctx.arc(x, ty, 2, 0, Math.PI * 2); ctx.fill();
      const ux = x + 4, uy = Math.max(archTopY(ux) + 16, under(ux)) - 1, sw = Math.sin(time * 1.2 + x) * 2;
      ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(ux, uy); ctx.bezierCurveTo(ux + 3, uy + 8, ux - 5 + sw, uy + 14, ux + sw, uy + 18);
      ctx.bezierCurveTo(ux + 4 + sw, uy + 21, ux + 6 + sw, uy + 16, ux + 3 + sw, uy + 15); ctx.stroke();
    }
    // little leaves sprouting along the top
    for (let x = xa + 8; x < xb; x += 23) drawLeaf(x, archTopY(x) - 2, 4, Math.sin(time + x) * 0.3 - 0.6, 1, LEAF_COLORS[Math.floor(hash(x) * 5)]);
    // sparkles on the growing tips
    if (ARCH.open < 1) for (const tipX of [xa, xb]) if (tipX > ARCH.x0 + 2 && tipX < ARCH.x1 - 2) sparkle(tipX, archTopY(tipX) - 6 + Math.sin(time * 9) * 3, 2.5, 0.9);
  }
}


// =====================================================================
// ---------- the lantern glade: a little "lights out" logic puzzle ----------
// Landing on a lantern flips it AND its neighbours. All four must be lit to lower the vine wall.
// From all-dark, the answer is to touch the two outer lanterns (the middle ones only make a mess).
// =====================================================================
const lanterns = [16080, 16190, 16300, 16410].map(x => ({ x, w: 26, h: 40, lit: false, glow: 0, bump: 0 }));
const vineGate = { x: 16560, w: 34, h: 260, open: 0 };
let lanternPrevGround = false;
const lanternPosts = () => lanterns.map(l => ({ x: l.x, y: GROUND - l.h, w: l.w, h: l.h }));
const vineGateRect = () => ({ x: vineGate.x, y: GROUND - vineGate.h * (1 - vineGate.open), w: vineGate.w, h: vineGate.h });

function updateLanternGlade(dt) {
  const p = player;
  const landed = p.onGround && !lanternPrevGround;
  lanternPrevGround = p.onGround;
  if (landed && !p.dead) {
    const i = lanterns.findIndex(l => Math.abs(p.y + p.h - (GROUND - l.h)) < 2 && p.x + p.w > l.x + 2 && p.x < l.x + l.w - 2);
    if (i >= 0) {
      for (const j of [i - 1, i, i + 1]) if (lanterns[j]) { lanterns[j].lit = !lanterns[j].lit; lanterns[j].bump = 1; }
      noiseHit(lanterns[i].lit ? 1500 : 700, 6, 0.12, 0.5);   // a soft chime
      if (lanterns.every(l => l.lit)) rumble();
    }
  }
  for (const l of lanterns) { l.glow = approach(l.glow, l.lit ? 1 : 0, dt * 3); l.bump = Math.max(0, l.bump - dt * 3); }
  const before = vineGate.open;
  vineGate.open = approach(vineGate.open, lanterns.every(l => l.lit) ? 1 : 0, dt * 0.5);
  if (vineGate.open < before && overlap(p, vineGateRect())) p.x = vineGate.x - p.w;   // a closing wall never traps you
}

function drawLanternGlade() {
  // lanterns on little posts (you stand right on the lantern's cap)
  for (const l of lanterns) {
    const top = GROUND - l.h, cx = l.x + l.w / 2;
    ctx.fillStyle = INK; softRect(cx - 4, top + 16, 8, l.h - 16, 2);
    ctx.fillRect(cx - 9, GROUND - 4, 18, 4);
    if (l.glow > 0.01) radial(cx, top + 9, 26 + l.glow * 26, `rgba(255,190,100,${0.35 * l.glow})`);
    const sq = l.bump * 2;
    ctx.fillStyle = l.glow > 0.05 ? `rgba(255,${200 + 30 * l.glow},${120 + 40 * l.glow},${0.25 + 0.75 * l.glow})` : '#2a140b';
    softRect(l.x + 4, top + 3 + sq * 0.5, l.w - 8, 13 - sq * 0.5, 3);
    ctx.fillStyle = INK; softRect(l.x, top, l.w, 4, 2);                 // cap you stand on
    softRect(l.x + 3, top + 15, l.w - 6, 3, 1.5);
    ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(cx, top + 3); ctx.lineTo(cx, top + 16); ctx.stroke();
    if (l.glow > 0.3) sparkle(cx + Math.sin(time * 2 + l.x) * 10, top - 8 - Math.abs(Math.sin(time * 1.3 + l.x)) * 10, 1.4, 0.6 * l.glow);
  }
  // the thorny vine wall, sinking into the ground when every lantern is lit
  const r = vineGateRect();
  if (vineGate.open < 0.99) {
    ctx.save(); ctx.beginPath(); ctx.rect(r.x - 30, r.y - 30, r.w + 60, GROUND - r.y + 30); ctx.clip();
    ctx.strokeStyle = INK; ctx.lineCap = 'round';
    for (let k = 0; k < 6; k++) {                        // twisted vines
      ctx.lineWidth = 4 + (k % 3);
      ctx.beginPath();
      for (let y = GROUND; y >= r.y - 6; y -= 8) {
        const x = r.x + r.w / 2 + Math.sin(y * 0.05 + k * 1.1) * (r.w * 0.45) + Math.sin(time * 0.8 + k) * 0.8;
        if (y === GROUND) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = INK;                                 // thorns
    for (let y = GROUND - 10; y > r.y; y -= 13) for (const side of [-1, 1]) {
      const bx = r.x + r.w / 2 + side * (r.w * 0.42) + Math.sin(y * 0.05) * 4;
      ctx.beginPath(); ctx.moveTo(bx, y - 3); ctx.lineTo(bx + side * 9, y - 6 + hash(y) * 4); ctx.lineTo(bx, y + 3); ctx.fill();
    }
    for (let y = GROUND - 30; y > r.y; y -= 37) drawLeaf(r.x + r.w / 2 + Math.sin(y) * 8, y, 5, Math.sin(time + y) * 0.4, 1, LEAF_COLORS[Math.floor(hash(y * 3) * 5)]);
    ctx.restore();
  }
}

// =====================================================================
// ---------- the crate yard: stack two crates to climb the tall cliff ----------
// Push the ground crate under the ledge's edge, climb up and push the ledge crate off onto it,
// then duck under the ledge behind the stack and push the whole stack over to the cliff.
// =====================================================================
const yardCrates = [
  { home: 16790, homeY: GROUND - 100 - 60 },            // sits on the floating ledge
  { home: 17080, homeY: GROUND - 60 },                  // sits in the yard
].map(c => ({ ...c, x: c.home, y: c.homeY, w: 56, h: 60, vy: 0, roll: 0 }));

function updateCrateYard(dt) {
  const list = solidList();
  for (const c of yardCrates) {
    c.vy = Math.min(c.vy + GRAV * dt, MAX_FALL);
    if (moveBox(c, 0, c.vy * dt, [...list, ...yardCrates.filter(o => o !== c)])) { if (c.vy > 300) { crunch(0.25); thud(); } c.vy = 0; }
    if (c.y > H + 80) Object.assign(c, { x: c.home, y: c.homeY, vy: 0 });
  }
}
