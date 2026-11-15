// weapons.js - DUSKLINE's gunplay: the weapon table, per-fighter gun
// state, and the hitscan shot solver everyone (player and bots) shares.
//
// Accuracy is the game's promise: standing still is tight, crouching is
// tighter, aiming down sights is tightest, and running or jumping throws
// the cone wide open - so stopping to shoot always pays. Damage falls
// off with range, and heads take a multiplier, checked against a capsule
// body and a sphere head with plain analytic ray tests (no allocations:
// the solver writes into a caller-owned result object).

import * as THREE from 'three';

export const WEAPONS = {
  pistol: {
    name: 'P9 Sidearm', price: 0, damage: 26, headMult: 3.4, rpm: 380,
    mag: 12, reserve: 60, reload: 1.5, auto: false,
    spread: 0.5, kick: 0.65, fallStart: 16, fallEnd: 40, fallMin: 0.5,
    tracer: 0xffd9a0, report: 'pistol',
  },
  smg: {
    name: 'Kestrel SMG', price: 1100, damage: 24, headMult: 3.0, rpm: 780,
    mag: 30, reserve: 90, reload: 2.3, auto: true,
    spread: 0.95, kick: 0.42, fallStart: 12, fallEnd: 34, fallMin: 0.45,
    tracer: 0xffe9b0, report: 'smg',
  },
  rifle: {
    name: 'Longbow Rifle', price: 2700, damage: 36, headMult: 3.9, rpm: 620,
    mag: 25, reserve: 75, reload: 2.6, auto: true,
    spread: 0.62, kick: 0.85, fallStart: 24, fallEnd: 60, fallMin: 0.7,
    tracer: 0xffc98a, report: 'rifle',
  },
};
export const ARMOR_PRICE = 650;
export const SMOKE_PRICE = 300;

const DEG = Math.PI / 180;

// The spread cone, in degrees, for a fighter in a given stance. speed is
// horizontal m/s; runSpeed is the fighter's full run speed.
export function spreadDegrees(def, st) {
  let s = def.spread;
  if (st.crouch) s *= 0.6;
  if (st.ads) s *= 0.4;
  const move = Math.min(1, st.speed / 4.6);
  s += move * move * 3.1;
  if (!st.onGround) s += 5.0;
  s += st.bloom || 0;
  return s;
}

export class Gun {
  constructor() {
    this.owned = { pistol: true, smg: false, rifle: false };
    this.ammo = {
      pistol: { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve },
      smg: { mag: 0, reserve: 0 },
      rifle: { mag: 0, reserve: 0 },
    };
    this.current = 'pistol';
    this.cd = 0;            // seconds until the next shot may fire
    this.reloadT = 0;       // > 0 while a reload is running
    this.bloom = 0;         // extra spread from sustained fire, degrees
  }
  get def() { return WEAPONS[this.current]; }
  get mag() { return this.ammo[this.current].mag; }
  get reserve() { return this.ammo[this.current].reserve; }
  get reloading() { return this.reloadT > 0; }

  give(key) {
    this.owned[key] = true;
    this.ammo[key].mag = WEAPONS[key].mag;
    this.ammo[key].reserve = WEAPONS[key].reserve;
  }
  select(key) {
    if (!this.owned[key] || key === this.current) return false;
    this.current = key;
    this.reloadT = 0;
    this.cd = Math.max(this.cd, 0.28);
    return true;
  }
  update(dt) {
    if (this.cd > 0) this.cd -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 2.6);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const a = this.ammo[this.current], def = this.def;
        const take = Math.min(def.mag - a.mag, a.reserve);
        a.mag += take; a.reserve -= take;
      }
    }
  }
  // Consumes a round if the gun may fire now. Returns 'fire', 'dry' or null.
  trigger() {
    if (this.cd > 0 || this.reloading) return null;
    const a = this.ammo[this.current];
    if (a.mag <= 0) { this.cd = 0.3; return 'dry'; }
    a.mag -= 1;
    this.cd = 60 / this.def.rpm;
    this.bloom = Math.min(1.5, this.bloom + 0.16);
    return 'fire';
  }
  startReload() {
    const a = this.ammo[this.current];
    if (this.reloading || a.mag >= this.def.mag || a.reserve <= 0) return false;
    this.reloadT = this.def.reload;
    return true;
  }
}

// --- shot solving -------------------------------------------------------

const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _d = new THREE.Vector3();

// Distance from a ray to a vertical body capsule; writes the ray param
// of the closest approach into out.t. Returns the miss distance.
// Closest points between the ray and the capsule's spine segment
// (Ericson's segment/segment solution, the ray side unclamped above 0).
function rayCapsule(ox, oy, oz, dx, dy, dz, fx, fz, y0, y1, out) {
  const h = y1 - y0;
  const rx = ox - fx, ry = oy - y0, rz = oz - fz;
  const e = h * h;                       // spine direction (0,h,0), squared
  const f = h * ry;                      // spine . (origin - spine base)
  const c = dx * rx + dy * ry + dz * rz; // ray dir . (origin - spine base)
  const b = dy * h;                      // ray dir . spine direction
  const denom = e - b * b;               // ray dir is normalised
  let s, t;
  if (denom > 1e-9) s = Math.max(0, (b * f - c * e) / denom);
  else s = Math.max(0, -c);
  t = (b * s + f) / e;
  if (t < 0) { t = 0; s = Math.max(0, -c); }
  else if (t > 1) { t = 1; s = Math.max(0, b - c); }
  const px = ox + dx * s, py = oy + dy * s, pz = oz + dz * s;
  const qy = y0 + h * t;
  const mx = px - fx, my = py - qy, mz = pz - fz;
  out.t = s;
  return Math.sqrt(mx * mx + my * my + mz * mz);
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  const thc = Math.sqrt(r2 - d2);
  const t = tca - thc;
  return t >= 0 ? t : (tca + thc >= 0 ? 0 : -1);
}

const _cap = { t: 0 };

// Solves one shot. origin/baseDir are Vector3s; the actual direction is
// scattered inside the spread cone. out receives:
// { kind: 'world'|'smoke'|'body'|'head'|'none', x,y,z, target, damage, dist }
export function fireHitscan(world, smokes, fighters, shooter, origin, baseDir, spreadDeg, rng, out) {
  _d.copy(baseDir);
  if (spreadDeg > 0.001) {
    _u.set(1, 0, 0);
    if (Math.abs(_d.x) > 0.9) _u.set(0, 0, 1);
    _v.crossVectors(_d, _u).normalize();
    _u.crossVectors(_v, _d).normalize();
    const ang = spreadDeg * DEG * Math.sqrt(rng.float());
    const rot = rng.float() * Math.PI * 2;
    const k = Math.tan(ang);
    _d.addScaledVector(_u, Math.cos(rot) * k).addScaledVector(_v, Math.sin(rot) * k).normalize();
  }
  const def = shooter.gun.def;
  let bestT = world.rayHit(origin.x, origin.y, origin.z, _d.x, _d.y, _d.z, 90);
  let kind = bestT < 90 ? 'world' : 'none';
  let target = null, part = null;

  // Smoke swallows anything behind it.
  for (const s of smokes) {
    if (!s.active) continue;
    const t = raySphere(origin.x, origin.y, origin.z, _d.x, _d.y, _d.z, s.x, s.y, s.z, s.r);
    if (t >= 0 && t < bestT) { bestT = t + 0.4; kind = 'smoke'; target = null; }
  }

  for (const f of fighters) {
    if (f === shooter || !f.alive || f.team === shooter.team) continue;
    const crouch = f.crouch;
    const y0 = 0.15, y1 = crouch ? 0.92 : 1.3;
    const miss = rayCapsule(origin.x, origin.y, origin.z, _d.x, _d.y, _d.z,
      f.pos.x, f.pos.z, y0, y1, _cap);
    let tHit = -1, hitPart = 'body';
    if (miss <= 0.37 && _cap.t >= 0) tHit = _cap.t;
    const headY = crouch ? 1.12 : 1.58;
    const th = raySphere(origin.x, origin.y, origin.z, _d.x, _d.y, _d.z,
      f.pos.x, headY, f.pos.z, 0.25);
    if (th >= 0 && (tHit < 0 || th < tHit)) { tHit = th; hitPart = 'head'; }
    if (tHit >= 0 && tHit < bestT) {
      bestT = tHit; kind = hitPart; target = f; part = hitPart;
    }
  }

  out.kind = kind;
  out.target = target;
  out.dist = bestT;
  out.x = origin.x + _d.x * bestT;
  out.y = origin.y + _d.y * bestT;
  out.z = origin.z + _d.z * bestT;
  out.dirX = _d.x; out.dirY = _d.y; out.dirZ = _d.z;
  if (target) {
    const fall = bestT <= def.fallStart ? 1
      : bestT >= def.fallEnd ? def.fallMin
      : 1 - (1 - def.fallMin) * (bestT - def.fallStart) / (def.fallEnd - def.fallStart);
    out.damage = def.damage * (part === 'head' ? def.headMult : 1) * fall;
  } else {
    out.damage = 0;
  }
  return out;
}
