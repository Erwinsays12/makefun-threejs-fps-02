// bots.js - the fighters who are not you: bodies, senses and tactics.
//
// Each bot walks the waypoint graph with breadth-first routes, holds a
// post, pushes a lane, investigates noises, and fights in bursts with
// strafes. Perception is honest: a vision cone plus line-of-sight that
// smoke and walls both block, and hearing that only carries gunfire and
// running feet. A bot that sees you still needs its reaction time before
// the first shot, and its aim is worse while it moves - the same rules
// the player's spread cone follows.

import * as THREE from 'three';
import { Gun, WEAPONS } from './weapons.js';
import { NODES, HOLD_POSTS, SITES } from './world.js';
import { COLORS, mat } from './palette.js';

export const ATK_NAMES = ['VEX', 'MARA'];
export const DEF_NAMES = ['ORIN', 'SABLE', 'RUE', 'KOBALT'];

const _eye = new THREE.Vector3(), _tgt = new THREE.Vector3(), _tmp = new THREE.Vector3();

function buildBody(team) {
  const main = team === 'atk' ? COLORS.teamAtk : COLORS.teamDef;
  const dark = team === 'atk' ? COLORS.teamAtkDark : COLORS.teamDefDark;
  const group = new THREE.Group();
  const rig = new THREE.Group();
  group.add(rig);
  const add = (w, h, d, x, y, z, material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    m.castShadow = true;
    rig.add(m);
    return m;
  };
  const pants = mat(0x2e2a26), top = mat(main), vest = mat(dark);
  const legL = add(0.2, 0.8, 0.24, -0.12, 0.4, 0, pants);
  const legR = add(0.2, 0.8, 0.24, 0.12, 0.4, 0, pants);
  add(0.52, 0.62, 0.3, 0, 1.11, 0, top);
  add(0.56, 0.4, 0.36, 0, 1.15, 0, vest);
  add(0.3, 0.32, 0.3, 0, 1.58, 0, mat(COLORS.skin));
  add(0.37, 0.15, 0.37, 0, 1.79, 0, vest);
  add(0.16, 0.1, 0.16, 0.3, 1.47, 0, mat(main, { emissive: main, emissiveIntensity: 0.7, flat: true }));
  const armL = add(0.14, 0.52, 0.14, -0.34, 1.12, -0.05, top);
  const armR = add(0.14, 0.14, 0.52, 0.3, 1.36, -0.28, top);
  const gunMesh = add(0.09, 0.17, 0.78, 0.3, 1.4, -0.55, mat(COLORS.metal));
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0.3, 1.42, -0.98);
  rig.add(muzzle);
  return { group, rig, legL, legR, armL, armR, gunMesh, muzzle };
}

export class Bot {
  constructor(team, name, skill, scene) {
    this.isPlayer = false;
    this.team = team;
    this.name = name;
    this.skill = skill;
    this.pos = new THREE.Vector3();
    this.yaw = team === 'atk' ? -Math.PI / 2 : Math.PI / 2;
    this.crouch = false;
    this.alive = true;
    this.health = 100;
    this.armor = false;
    this.gun = new Gun();
    this.smokes = 0;
    this.hasBomb = false;
    this.kills = 0;
    this.deaths = 0;
    this.speed2d = 0;
    this.noise = 0;
    this.aimErr = (1 - skill) * 2.1;
    this.reaction = 0.3 + (1 - skill) * 0.3;
    // Tactics state.
    this.role = team === 'atk' ? 'push' : 'hold';
    this.post = null;              // HOLD_POSTS entry for defenders
    this.path = null;
    this.pathI = 0;
    this.target = null;            // fighter currently visible
    this.seenAt = -9;              // ctx.time when the target was first seen
    this.lastSeen = null;          // {x, z, t}
    this.heard = null;             // {x, z, t}
    this.thinkT = Math.random() * 0.12;
    this.burstLeft = 0;
    this.burstPauseT = 0;
    this.strafeT = 0;
    this.strafeDir = 1;
    this.holdPhase = Math.random() * 6;
    this.channel = null;           // {kind: 'plant'|'defuse', t, dur}
    this.walkPhase = 0;
    this.deathT = 0;
    this.defuseClaim = false;
    const body = buildBody(team);
    this.body = body;
    scene.add(body.group);
  }

  eyeHeight() { return this.crouch ? 1.18 : 1.62; }
  eye(out) { return out.set(this.pos.x, this.eyeHeight(), this.pos.z); }
  muzzlePos(out) { return this.body.muzzle.getWorldPosition(out); }

  reset(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.health = 100;
    this.alive = true;
    this.crouch = false;
    this.hasBomb = false;
    this.target = null;
    this.lastSeen = null;
    this.heard = null;
    this.path = null;
    this.channel = null;
    this.deathT = 0;
    this.defuseClaim = false;
    this.body.group.rotation.set(0, yaw, 0);
    this.body.rig.position.y = 0;
    this.syncBody(0);
  }

  setPath(world, x, z) {
    this.path = world.pathBetween(this.pos.x, this.pos.z, x, z);
    this.pathI = 0;
  }

  // --- senses ------------------------------------------------------------
  perceive(ctx) {
    const now = ctx.time;
    this.eye(_eye);
    let best = null, bestD = Infinity;
    for (const f of ctx.fighters) {
      if (f === this || !f.alive || f.team === this.team) continue;
      const dx = f.pos.x - this.pos.x, dz = f.pos.z - this.pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      // Hearing: running feet carry by their noise radius, and a shot
      // fired in the last fraction of a second carries much further.
      const heardR = Math.max(f.noise || 0, (now - (f.lastShotAt ?? -9)) < 0.4 ? 26 : 0);
      if (heardR > 0 && dist < heardR) {
        this.heard = { x: f.pos.x, z: f.pos.z, t: now };
        if (dist < 3.2) this.lastSeen = { x: f.pos.x, z: f.pos.z, t: now };
      }
      if (dist > 42) continue;
      // Vision cone (wide at point blank), then honest line-of-sight.
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const dot = (dx * fx + dz * fz) / (dist || 1);
      if (dist > 2.6 && dot < 0.26) continue;
      f.eye ? f.eye(_tgt) : _tgt.set(f.pos.x, 1.4, f.pos.z);
      if (ctx.world.losBlocked(_eye, _tgt)) continue;
      if (ctx.smokes.segmentBlocked(_eye, _tgt)) continue;
      if (dist < bestD) { bestD = dist; best = f; }
    }
    if (best) {
      if (this.target !== best) this.seenAt = now;
      this.target = best;
      this.lastSeen = { x: best.pos.x, z: best.pos.z, t: now };
    } else {
      this.target = null;
    }
  }

  // --- movement ------------------------------------------------------------
  moveAlong(dt, ctx, speed) {
    if (!this.path || this.pathI >= this.path.length) return true;
    const [tx, tz] = this.path[this.pathI];
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.75) { this.pathI++; return this.moveAlong(dt, ctx, speed); }
    this.stepToward(dt, ctx, tx, tz, speed);
    return false;
  }

  stepToward(dt, ctx, tx, tz, speed) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    let mx = (dx / dist) * speed, mz = (dz / dist) * speed;
    // Gentle separation so bots never stack inside each other.
    for (const f of ctx.fighters) {
      if (f === this || !f.alive) continue;
      const sx = this.pos.x - f.pos.x, sz = this.pos.z - f.pos.z;
      const sd = Math.sqrt(sx * sx + sz * sz);
      if (sd > 0.01 && sd < 0.8) { mx += (sx / sd) * 1.4; mz += (sz / sd) * 1.4; }
    }
    this.pos.x += mx * dt;
    this.pos.z += mz * dt;
    ctx.world.moveCircle(this.pos, 0.35);
    this.speed2d = Math.sqrt(mx * mx + mz * mz);
    this.faceToward(dt, Math.atan2(-mx, -mz), 6.5);
  }

  faceToward(dt, wantYaw, rate) {
    let d = wantYaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const turn = Math.max(-rate * dt, Math.min(rate * dt, d));
    this.yaw += turn;
  }

  // --- main update -----------------------------------------------------------
  update(dt, ctx) {
    if (!this.alive) {
      if (this.deathT < 0.45) {
        this.deathT += dt;
        const k = Math.min(1, this.deathT / 0.45);
        this.body.group.rotation.x = -Math.PI / 2 * k * this.fallDir;
      }
      return;
    }
    this.gun.update(dt);
    this.speed2d = 0;
    this.noise = 0;
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 0.12; this.perceive(ctx); }

    // A channel (plant/defuse) roots the bot in place.
    if (this.channel) {
      this.crouch = true;
      this.channel.t += dt;
      this.syncBody(dt);
      return;
    }
    this.crouch = false;

    if (this.target) this.engage(dt, ctx);
    else this.doctrine(dt, ctx);

    if (this.speed2d > 3.4) this.noise = 11;
    this.syncBody(dt);
  }

  engage(dt, ctx) {
    const t = this.target;
    const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    this.faceToward(dt, Math.atan2(-dx, -dz), 11);
    // Strafe while fighting; pause the strafe to shoot in bursts.
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeT = ctx.rng.range(0.6, 1.3);
      this.strafeDir = ctx.rng.chance(0.5) ? 1 : -1;
      if (ctx.rng.chance(0.3)) this.strafeDir = 0;
    }
    if (this.strafeDir !== 0 && dist > 3) {
      const px = (-dz / dist) * this.strafeDir, pz = (dx / dist) * this.strafeDir;
      this.stepToward(dt, ctx, this.pos.x + px * 2, this.pos.z + pz * 2, 2.5);
      // stepToward re-faces movement; re-face the target after strafing.
      this.faceToward(dt, Math.atan2(-dx, -dz), 11);
    }
    if (dist > 26 && this.role !== 'hold') {
      this.stepToward(dt, ctx, t.pos.x, t.pos.z, 3.6);
    }
    // Fire discipline: reaction time first, then bursts with pauses.
    if (ctx.time - this.seenAt < this.reaction) return;
    if (this.burstPauseT > 0) { this.burstPauseT -= dt; return; }
    if (this.burstLeft <= 0) this.burstLeft = ctx.rng.int(2, 5);
    if (ctx.shoot(this)) {
      this.burstLeft--;
      if (this.burstLeft <= 0) this.burstPauseT = ctx.rng.range(0.24, 0.5);
    }
  }

  doctrine(dt, ctx) {
    const now = ctx.time;
    // Fresh information beats standing orders.
    if (this.lastSeen && now - this.lastSeen.t < 2.5) {
      this.faceToward(dt, Math.atan2(-(this.lastSeen.x - this.pos.x), -(this.lastSeen.z - this.pos.z)), 8);
      return;
    }
    if (this.heard && now - this.heard.t < 4 && this.role !== 'hold') {
      if (this.moveAlong(dt, ctx, 3.5)) this.heard = null;
      return;
    }
    if (ctx.bombState === 'planted') { this.afterPlant(dt, ctx); return; }

    if (this.team === 'atk') {
      if (this.hasBomb) {
        const site = SITES[ctx.targetSite];
        if (ctx.world.siteAt(this.pos.x, this.pos.z) === ctx.targetSite) {
          this.channel = { kind: 'plant', t: 0, dur: 3.0 };
          return;
        }
        if (!this.path || this.pathI >= this.path.length) this.setPath(ctx.world, site.x, site.z);
        this.moveAlong(dt, ctx, 3.9);
      } else if (ctx.bombState === 'dropped' && ctx.bombCarrier === this) {
        if (!this.path || this.pathI >= this.path.length) this.setPath(ctx.world, ctx.bombPos.x, ctx.bombPos.z);
        this.moveAlong(dt, ctx, 4.0);
      } else if (ctx.bombState === 'carried') {
        // Lurk the other site's entry until the plant or a call to rotate.
        const other = ctx.targetSite === 'A' ? 'B' : 'A';
        const node = other === 'A' ? 19 : 22;
        const [nx, nz] = NODES[node];
        const d = Math.hypot(nx - this.pos.x, nz - this.pos.z);
        if (d > 1.2) {
          if (!this.path || this.pathI >= this.path.length) this.setPath(ctx.world, nx, nz);
          this.moveAlong(dt, ctx, 3.7);
        } else {
          this.holdAt(dt, ctx, nx, nz, Math.PI / 2);
        }
      } else {
        // Bomb is down and a teammate is fetching it: cover the drop.
        const d = Math.hypot(ctx.bombPos.x - this.pos.x, ctx.bombPos.z - this.pos.z);
        if (d > 3.2) {
          if (!this.path || this.pathI >= this.path.length) this.setPath(ctx.world, ctx.bombPos.x, ctx.bombPos.z);
          this.moveAlong(dt, ctx, 3.8);
        } else {
          this.faceToward(dt, this.yaw + Math.sin(ctx.time * 0.5 + this.holdPhase) * 0.03, 2);
        }
      }
      return;
    }

    // Defenders: to your post, then hold it with small peeks.
    if (this.post) {
      const [nx, nz] = NODES[this.post.node];
      const d = Math.hypot(nx - this.pos.x, nz - this.pos.z);
      if (d > 0.9) {
        if (!this.path || this.pathI >= this.path.length) this.setPath(ctx.world, nx, nz);
        this.moveAlong(dt, ctx, 3.8);
      } else {
        this.holdAt(dt, ctx, nx, nz, this.post.face);
      }
    }
  }

  afterPlant(dt, ctx) {
    const site = SITES[ctx.bombSite];
    if (this.team === 'atk') {
      // Guard the planted bomb from the nearest cover nodes.
      if (this.guardNode == null) {
        let best = -1, bd = Infinity;
        for (let i = 0; i < NODES.length; i++) {
          const d = Math.hypot(NODES[i][0] - site.x, NODES[i][1] - site.z);
          if (d < bd && d > 2.5) { bd = d; best = i; }
        }
        this.guardNode = best;
      }
      const [nx, nz] = NODES[this.guardNode];
      const d = Math.hypot(nx - this.pos.x, nz - this.pos.z);
      if (d > 1.0) {
        if (!this.path || this.pathI >= this.path.length) this.setPath(ctx.world, nx, nz);
        this.moveAlong(dt, ctx, 3.9);
      } else {
        this.crouch = this.skill > 0.5;
        this.faceToward(dt, Math.atan2(-(site.x - this.pos.x), -(site.z - this.pos.z)) + Math.PI, 5);
      }
      return;
    }
    // Defenders retake: one defuses, the rest cover the approaches.
    const dBomb = Math.hypot(ctx.bombPos.x - this.pos.x, ctx.bombPos.z - this.pos.z);
    if (dBomb < 1.7 && (ctx.defuser === this || !ctx.defuser)) {
      this.channel = { kind: 'defuse', t: 0, dur: 5.0 };
      return;
    }
    if (dBomb >= 1.7) {
      if (!this.path || this.pathI >= this.path.length) this.setPath(ctx.world, ctx.bombPos.x, ctx.bombPos.z);
      this.moveAlong(dt, ctx, 4.1);
    } else {
      this.faceToward(dt, this.yaw + Math.sin(ctx.time * 0.7 + this.holdPhase) * 0.02, 2);
    }
  }

  holdAt(dt, ctx, nx, nz, faceYaw) {
    // Small lateral peeks around the post so a held angle is not a statue.
    this.holdPhase += dt;
    const cyc = this.holdPhase % 3.4;
    const off = cyc < 0.6 ? (cyc / 0.6) * 0.55 : cyc < 1.7 ? 0.55 : cyc < 2.3 ? 0.55 - ((cyc - 1.7) / 0.6) * 0.55 : 0;
    const px = Math.cos(faceYaw) * off, pz = -Math.sin(faceYaw) * off;
    const tx = nx + px, tz = nz + pz;
    const d = Math.hypot(tx - this.pos.x, tz - this.pos.z);
    if (d > 0.15) this.stepToward(dt, ctx, tx, tz, 1.6);
    this.faceToward(dt, faceYaw + Math.sin(ctx.time * 0.4 + this.holdPhase) * 0.35, 4);
    this.crouch = this.skill > 0.62 && cyc > 2.3;
  }

  die() {
    this.alive = false;
    this.deathT = 0;
    this.channel = null;
    this.fallDir = Math.random() < 0.5 ? 1 : -1;
  }

  syncBody(dt) {
    const g = this.body.group;
    g.position.copy(this.pos);
    g.rotation.y = this.yaw;
    if (this.alive) {
      this.walkPhase += dt * (2 + this.speed2d * 1.9);
      const swing = Math.sin(this.walkPhase) * Math.min(0.6, this.speed2d * 0.16);
      this.body.legL.rotation.x = swing;
      this.body.legR.rotation.x = -swing;
      this.body.rig.position.y = Math.abs(Math.cos(this.walkPhase)) * 0.045 * Math.min(1, this.speed2d);
      this.body.rig.position.y += this.crouch ? -0.4 : 0;
      this.body.legL.rotation.x += this.crouch ? -0.9 : 0;
      this.body.legR.rotation.x += this.crouch ? 0.35 : 0;
    }
    // The carried gun stretches with its class: rifle longest, pistol stub.
    this.body.gunMesh.scale.z = this.gun.current === 'rifle' ? 1.3 : this.gun.current === 'smg' ? 0.9 : 0.62;
    this.body.armR.rotation.x = this.channel ? -0.5 : 0;
  }
}
