// grenade.js - thrown smoke: the arc, the bounce, and the cloud.
//
// A smoke grenade is the one utility in DUSKLINE. Thrown, it arcs,
// bounces off the yard's boxes, pops, and grows into a grey cloud that
// lasts about sixteen seconds. The cloud is a sphere for every system
// that cares: bot vision stops at it, and bullets fired through it hit
// nothing behind it.

import * as THREE from 'three';
import { mat, COLORS } from './palette.js';

const CLOUD_R = 3.1;
const CLOUD_TTL = 16;
const PUFF_OFFSETS = [
  [0, 0, 0], [1.25, 0.3, 0.4], [-1.15, 0.2, -0.5], [0.4, 0.55, -1.15],
  [-0.5, 0.4, 1.1], [0.95, -0.25, -0.9], [-0.95, -0.15, 0.85], [0.1, 0.8, 0.2],
];

export class SmokeSystem {
  constructor(scene) {
    this.scene = scene;
    this.clouds = [];        // {x,y,z,r,active,age,group,material}
    this.projectiles = [];   // {pos,vel,mesh,age}
    this.cloudGeo = new THREE.IcosahedronGeometry(1.55, 1);
    this.projGeo = new THREE.SphereGeometry(0.09, 10, 8);
    this.projMat = mat(0x44503c, { rough: 0.6 });
  }

  throwFrom(origin, dir, power = 13) {
    const mesh = new THREE.Mesh(this.projGeo, this.projMat);
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.projectiles.push({
      pos: origin.clone(),
      vel: new THREE.Vector3(dir.x * power, dir.y * power + 2.2, dir.z * power),
      mesh, age: 0,
    });
  }

  spawnCloud(x, z) {
    let cloud = this.clouds.find(c => !c.active);
    if (!cloud) {
      if (this.clouds.length >= 6) return;
      const material = new THREE.MeshLambertMaterial({
        color: 0xc9ccd2, transparent: true, opacity: 0, depthWrite: false,
      });
      const group = new THREE.Group();
      for (const [ox, oy, oz] of PUFF_OFFSETS) {
        const puff = new THREE.Mesh(this.cloudGeo, material);
        puff.position.set(ox, oy, oz);
        group.add(puff);
      }
      group.visible = false;
      this.scene.add(group);
      cloud = { x: 0, y: 0, z: 0, r: 0, active: false, age: 0, group, material };
      this.clouds.push(cloud);
    }
    cloud.x = x; cloud.y = 1.15; cloud.z = z;
    cloud.r = 0.4; cloud.age = 0; cloud.active = true;
    cloud.group.position.set(x, 1.15, z);
    cloud.group.visible = true;
  }

  update(dt, world) {
    // Projectiles in flight.
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      p.vel.y -= 13.5 * dt;
      p.pos.addScaledVector(p.vel, dt);
      // Bounce off the ground.
      if (p.pos.y < 0.1) {
        p.pos.y = 0.1;
        p.vel.y = Math.abs(p.vel.y) * 0.35;
        p.vel.x *= 0.7; p.vel.z *= 0.7;
        if (Math.abs(p.vel.y) < 0.7) p.vel.y = 0;
      }
      // Bounce off boxes: push out along the shallowest axis.
      for (const c of world.colliders) {
        if (p.pos.x > c.minX - 0.1 && p.pos.x < c.maxX + 0.1 &&
            p.pos.z > c.minZ - 0.1 && p.pos.z < c.maxZ + 0.1 && p.pos.y < c.h) {
          const left = p.pos.x - (c.minX - 0.1), right = (c.maxX + 0.1) - p.pos.x;
          const near = p.pos.z - (c.minZ - 0.1), far = (c.maxZ + 0.1) - p.pos.z;
          const m = Math.min(left, right, near, far);
          if (m === left) { p.pos.x = c.minX - 0.1; p.vel.x = -Math.abs(p.vel.x) * 0.35; }
          else if (m === right) { p.pos.x = c.maxX + 0.1; p.vel.x = Math.abs(p.vel.x) * 0.35; }
          else if (m === near) { p.pos.z = c.minZ - 0.1; p.vel.z = -Math.abs(p.vel.z) * 0.35; }
          else { p.pos.z = c.maxZ + 0.1; p.vel.z = Math.abs(p.vel.z) * 0.35; }
        }
      }
      p.mesh.position.copy(p.pos);
      const settled = p.vel.lengthSq() < 0.5 && p.pos.y <= 0.11;
      if (settled || p.age > 2.2) {
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
        this.spawnCloud(p.pos.x, p.pos.z);
      }
    }
    // Clouds grow, hold, then thin out.
    for (const c of this.clouds) {
      if (!c.active) continue;
      c.age += dt;
      const grow = Math.min(1, c.age / 1.3);
      c.r = 0.4 + (CLOUD_R - 0.4) * grow;
      const fade = c.age > CLOUD_TTL - 2.5 ? Math.max(0, (CLOUD_TTL - c.age) / 2.5) : 1;
      c.material.opacity = 0.6 * grow * fade;
      const s = 0.35 + 0.65 * grow;
      c.group.scale.set(s, s * 0.82, s);
      if (c.age >= CLOUD_TTL) { c.active = false; c.group.visible = false; }
    }
  }

  // Does the segment a->b pass through any live cloud?
  segmentBlocked(a, b) {
    for (const c of this.clouds) {
      if (!c.active || c.r < 1.2) continue;
      // Closest distance from the cloud centre to the segment.
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const len2 = abx * abx + aby * aby + abz * abz;
      let t = 0;
      if (len2 > 1e-9) {
        t = ((c.x - a.x) * abx + (c.y - a.y) * aby + (c.z - a.z) * abz) / len2;
        t = Math.max(0, Math.min(1, t));
      }
      const dx = a.x + abx * t - c.x, dy = a.y + aby * t - c.y, dz = a.z + abz * t - c.z;
      if (dx * dx + dy * dy + dz * dz < c.r * c.r) return true;
    }
    return false;
  }

  reset() {
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles.length = 0;
    for (const c of this.clouds) { c.active = false; c.group.visible = false; }
  }
}
