// player.js - the human fighter: movement, stance, and the shared
// combatant shape the gunplay solver reads (pos, crouch, team, health).
//
// Movement is acceleration-based with ground friction, so a running
// player takes a moment to stop - and that moment is exactly when their
// spread cone is wide. Crouching and aiming down sights trade speed for
// accuracy; jumping trades all of it.

import * as THREE from 'three';
import { Gun } from './weapons.js';

export const RUN_SPEED = 4.6;

export class Player {
  constructor() {
    this.isPlayer = true;
    this.team = 'atk';
    this.name = 'YOU';
    this.pos = new THREE.Vector3(-20.5, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = -Math.PI / 2;      // facing east, toward the sites
    this.pitch = 0;
    this.crouch = false;
    this.onGround = true;
    this.alive = true;
    this.health = 100;
    this.armor = false;
    this.money = 800;
    this.gun = new Gun();
    this.smokes = 0;
    this.hasBomb = false;
    this.ads = false;
    this.speed2d = 0;
    this.noise = 0;               // hearing radius currently given away
    this.stepAcc = 0;
    this.kills = 0;
    this.deaths = 0;
    this._eye = new THREE.Vector3();
    this._dir = new THREE.Vector3();
  }

  eyeHeight() { return this.crouch ? 1.18 : 1.62; }
  eye(out) { return out.set(this.pos.x, this.pos.y + this.eyeHeight(), this.pos.z); }
  lookDir(out) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }
  stance() {
    return { speed: this.speed2d, onGround: this.onGround, crouch: this.crouch, ads: this.ads, bloom: this.gun.bloom };
  }

  reset(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.health = 100;
    this.alive = true;
    this.crouch = false;
    this.ads = false;
    this.hasBomb = false;
    this.noise = 0;
  }

  // input: {f, b, l, r, jump, crouch, walk} booleans for this step.
  // fx.footstep() is called at a distance-based cadence.
  update(dt, input, world, fx) {
    if (!this.alive) return;
    this.crouch = !!input.crouch;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = (-sy) * (input.f ? 1 : 0) + (-sy) * (input.b ? -1 : 0) + cy * (input.r ? 1 : 0) + cy * (input.l ? -1 : 0);
    let wz = (-cy) * (input.f ? 1 : 0) + (-cy) * (input.b ? -1 : 0) + (-sy) * (input.r ? 1 : 0) + (-sy) * (input.l ? -1 : 0);
    const wl = Math.sqrt(wx * wx + wz * wz);
    if (wl > 0) { wx /= wl; wz /= wl; }

    let maxSpeed = RUN_SPEED;
    if (this.crouch) maxSpeed = 2.3;
    else if (input.walk) maxSpeed = 2.5;
    if (this.ads) maxSpeed *= 0.55;

    const rate = this.onGround ? 11 : 1.1;
    const blend = Math.min(1, rate * dt);
    this.vel.x += (wx * maxSpeed - this.vel.x) * blend;
    this.vel.z += (wz * maxSpeed - this.vel.z) * blend;

    if (input.jump && this.onGround) {
      this.vel.y = 4.8;
      this.onGround = false;
    }
    this.vel.y -= 13 * dt;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;
    world.moveCircle(this.pos, 0.35);
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      this.vel.y = 0;
      this.onGround = true;
    }

    this.speed2d = Math.sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z);
    // Noise given away: running is loud, walking and crouching are not.
    this.noise = (this.onGround && this.speed2d > 3.4) ? 11 : 0;
    if (this.onGround && this.speed2d > 0.6) {
      this.stepAcc += this.speed2d * dt;
      if (this.stepAcc > 2.3) {
        this.stepAcc = 0;
        if (fx && fx.footstep) fx.footstep();
      }
    }
    this.gun.update(dt);
  }
}
