// world.js - the Foundry Yard: DUSKLINE's one original map.
//
// A derelict smelting yard at dusk, 48 m by 36 m. Three lanes run west to
// east - a north lane, a broken mid around the old smelter block, and a
// south lane - ending at two plant sites against the east wall. Every
// solid is an axis-aligned box: the same list drives the visible meshes,
// movement collision, bullet raycasts and bot line-of-sight, so what you
// see is exactly what blocks you.

import * as THREE from 'three';
import { COLORS, mat } from './palette.js';

export const MAP = { halfX: 24, halfZ: 18 };

// Boxes: cx, cz, w, d, h, colour key, solid (visual-only when false).
const BOXES = [
  // The smelter: mid's centrepiece, splits the middle lane in two.
  [0, 0, 7, 6, 5.0, 'metal'],
  [1.5, -1, 1.6, 1.6, 9.0, 'metalDark', false],        // chimney, visual only
  [-3.6, 0, 0.3, 2.5, 2.9, 'metal', false],           // furnace door frame
  [-3.72, -0.98, 0.26, 0.34, 2.9, 'metal', false],    // door jambs
  [-3.72, 0.98, 0.26, 0.34, 2.9, 'metal', false],
  [-3.8, 0, 0.14, 1.45, 1.85, 'emberGlow', false],    // the glowing mouth itself
  // Lane dividers between mid and the side lanes (gaps at both ends).
  [-3.5, -9.5, 13, 1, 3.0, 'concreteDark'],
  [-3.5, 9.5, 13, 1, 3.0, 'concreteDark'],
  // North lane cover.
  [-10, -14.5, 2.4, 2, 1.6, 'crate'],
  [6, -12.8, 2, 2, 1.1, 'concrete'],
  [12, -14.8, 3, 2.2, 2.2, 'crateDark'],
  [-1, -13.8, 2.2, 0.9, 1.1, 'concrete'],
  // South lane cover.
  [-10, 14.5, 2.4, 2, 1.6, 'crate'],
  [6, 12.8, 2, 2, 1.1, 'concrete'],
  [12, 14.8, 3, 2.2, 2.2, 'crateDark'],
  [-1, 13.8, 2.2, 0.9, 1.1, 'concrete'],
  // Mid cover, staggered so the two mid passages play differently.
  [-8, -5.2, 2.6, 2.2, 1.6, 'crate'],
  [8, 5.2, 2.6, 2.2, 1.6, 'crate'],
  [-2.5, -7.5, 2, 0.9, 1.1, 'concrete'],
  [2.5, 7.5, 2, 0.9, 1.1, 'concrete'],
  // East mid anchor, the defenders' mid strongpoint.
  [12, 0, 4, 3.4, 3.4, 'concrete'],
  [16, -3.5, 2, 2, 1.6, 'crate'],
  [16, 3.5, 2, 2, 1.6, 'crate'],
  // Site A (north-east): furnace hall, crates, a low wall on the plant.
  [19.5, -13.5, 6, 5, 5.5, 'metal'],
  [15.5, -9, 2.2, 2.2, 1.6, 'crate'],
  [16.5, -15.8, 3, 0.8, 1.1, 'concrete'],
  // Site B (south-east): rust tank hall and its cover.
  [19.5, 13.5, 6, 5, 4.6, 'rustDark'],
  [15.5, 9, 2.2, 2.2, 1.6, 'crate'],
  [16.5, 15.8, 3, 0.8, 1.1, 'concrete'],
  // Spawn cover, both ends.
  [-19, -5, 2, 2, 1.6, 'crateDark'],
  [-19, 5, 2, 2, 1.6, 'crateDark'],
  [-16.5, 0, 2.4, 1, 1.1, 'concrete'],
];

const COLOR_OF = {
  metal: COLORS.metal, metalDark: COLORS.metalLight, concrete: COLORS.concrete,
  concreteDark: COLORS.concreteDark, crate: COLORS.crate, crateDark: COLORS.crateDark,
  rustDark: COLORS.rustDark, emberGlow: COLORS.ember,
};

// Plant zones: a carrier inside one of these may plant.
export const SITES = {
  A: { minX: 12.8, maxX: 17.2, minZ: -15.2, maxZ: -8.8, x: 15.2, z: -11.8, color: COLORS.siteA },
  B: { minX: 12.8, maxX: 17.2, minZ: 8.8, maxZ: 15.2, x: 15.2, z: 11.8, color: COLORS.siteB },
};

export const SPAWNS = {
  atk: [[-20.5, -3], [-20.5, 3], [-20.5, 0]],
  def: [[21, -2.2], [21, 2.2], [21, -5.2], [21, 5.2]],
};

// Waypoint graph: bots walk node to node; edges are hand-checked lanes.
export const NODES = [
  [-20, -3], [-20, 3], [-14, -13.5], [-14, 0], [-14, 13.5],
  [-6, -13.5], [3, -13.2], [10.5, -13], [-6, 13.5], [3, 13.2], [10.5, 13],
  [-8, -5.5], [6, -5.8], [-8, 5.5], [5, 4.6], [-1, -7.6], [-1, 7.6],
  [7, 0], [16.5, 0], [13.5, -11], [16, -11.8], [21.5, -8.6],
  [13.5, 11], [16, 11.8], [21.5, 8.6], [21, 0], [19.5, -6.6], [19.5, 6.6],
];
const EDGES = [
  [0, 2], [0, 3], [1, 3], [1, 4], [2, 3], [3, 4],
  [2, 5], [5, 6], [6, 7], [4, 8], [8, 9], [9, 10],
  [2, 11], [11, 12], [12, 7], [4, 13], [13, 14], [14, 10],
  [11, 13], [11, 15], [15, 12], [13, 16], [16, 14],
  [6, 12], [9, 14], [12, 17], [14, 17], [17, 18],
  [18, 25], [18, 26], [18, 27], [7, 19], [12, 19], [19, 20], [20, 21],
  [21, 26], [26, 25], [10, 22], [14, 22], [22, 23], [23, 24],
  [24, 27], [27, 25],
];
// Defender posts: node index + the yaw (radians, 0 = +x) they watch.
export const HOLD_POSTS = [
  { node: 21, face: Math.PI }, { node: 24, face: Math.PI },
  { node: 18, face: Math.PI }, { node: 7, face: Math.PI },
  { node: 10, face: Math.PI }, { node: 26, face: Math.PI * 0.85 },
  { node: 27, face: Math.PI * 1.15 },
];

export class World {
  constructor(scene) {
    this.colliders = [];   // {minX,maxX,minZ,maxZ,h}
    this.buildScene(scene);
    // The perimeter walls are built in buildScene; register them for
    // raycasts as well so shots and sightlines stop at the yard's edge.
    this.colliders.push(
      { minX: -25.5, maxX: 25.5, minZ: -19, maxZ: -18, h: 5 },
      { minX: -25.5, maxX: 25.5, minZ: 18, maxZ: 19, h: 5 },
      { minX: -25, maxX: -24, minZ: -19, maxZ: 19, h: 5 },
      { minX: 24, maxX: 25, minZ: -19, maxZ: 19, h: 5 }
    );
    this.adj = NODES.map(() => []);
    for (const [a, b] of EDGES) { this.adj[a].push(b); this.adj[b].push(a); }
  }

  buildScene(scene) {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP.halfX * 2, MAP.halfZ * 2),
      mat(COLORS.ground, { rough: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      mat(COLORS.groundDark, { rough: 1 })
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.05;
    scene.add(apron);

    // Perimeter walls.
    const wallGeoH = new THREE.BoxGeometry(MAP.halfX * 2 + 2, 5, 1);
    const wallGeoV = new THREE.BoxGeometry(1, 5, MAP.halfZ * 2 + 2);
    for (const [geo, x, z] of [
      [wallGeoH, 0, -MAP.halfZ - 0.5], [wallGeoH, 0, MAP.halfZ + 0.5],
      [wallGeoV, -MAP.halfX - 0.5, 0], [wallGeoV, MAP.halfX + 0.5, 0],
    ]) {
      const w = new THREE.Mesh(geo, mat(COLORS.concreteDark));
      w.position.set(x, 2.5, z);
      w.castShadow = true; w.receiveShadow = true;
      scene.add(w);
    }
    // Ember window strips on the west and east walls: the yard is lived-in.
    for (const z of [-12, -4, 5, 13]) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.7, 2.6),
        mat(COLORS.ember, { emissive: COLORS.ember, emissiveIntensity: 1.6, flat: true })
      );
      strip.position.set(-MAP.halfX - 0.95, 3.4, z);
      scene.add(strip);
    }

    for (const [cx, cz, w, d, h, kind, solid] of BOXES) {
      const isGlow = kind === 'emberGlow';
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        isGlow
          ? mat(COLORS.ember, { emissive: COLORS.ember, emissiveIntensity: 1.25, flat: true })
          : mat(COLOR_OF[kind])
      );
      mesh.position.set(cx, h / 2, cz);
      mesh.castShadow = true; mesh.receiveShadow = true;
      scene.add(mesh);
      if (solid !== false) {
        this.colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h });
      }
    }

    this.paintMarkings(scene);
    this.buildSkyline(scene);
  }

  paintMarkings(scene) {
    const lineMat = mat(0x9a917e, { flat: true, rough: 1 });
    const line = (x, z, w, d) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), lineMat);
      m.position.set(x, 0.012, z);
      m.receiveShadow = true;
      scene.add(m);
    };
    line(0, -13.4, 44, 0.18); line(0, 13.4, 44, 0.18);   // side lanes
    line(-14, 0, 0.18, 27); line(16.5, 0, 0.18, 13);     // connectors
    for (const site of [SITES.A, SITES.B]) {
      const zone = new THREE.Mesh(
        new THREE.BoxGeometry(site.maxX - site.minX, 0.02, site.maxZ - site.minZ),
        new THREE.MeshBasicMaterial({ color: site.color, transparent: true, opacity: 0.16, depthWrite: false })
      );
      zone.position.set((site.minX + site.maxX) / 2, 0.014, (site.minZ + site.maxZ) / 2);
      scene.add(zone);
      this.siteSign(scene, site);
    }
  }

  siteSign(scene, site) {
    const letter = site === SITES.A ? 'A' : 'B';
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const g = canvas.getContext('2d');
    g.fillStyle = '#191411'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#f2ead9'; g.lineWidth = 6; g.strokeRect(8, 8, 112, 112);
    g.fillStyle = '#' + site.color.toString(16).padStart(6, '0');
    g.font = 'bold 84px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(letter, 64, 70);
    const tex = new THREE.CanvasTexture(canvas);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 1.7),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
    );
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 0.12), mat(COLORS.metal));
    const x = site.minX - 0.7, z = (site.minZ + site.maxZ) / 2;
    post.position.set(x, 1.2, z);
    sign.position.set(x, 2.9, z);
    sign.rotation.y = -Math.PI / 2;
    scene.add(post); scene.add(sign);
  }

  buildSkyline(scene) {
    // Dead foundry silhouettes outside the walls, against the dusk.
    const dark = mat(0x271c30, { flat: true, rough: 1 });
    const spots = [
      [-38, -22, 10, 16], [-34, 8, 8, 11], [36, -16, 12, 14], [40, 14, 9, 18],
      [-8, -34, 16, 12], [14, 33, 12, 9], [30, 30, 8, 13], [-30, 28, 10, 10],
    ];
    for (const [x, z, w, h] of spots) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.7), dark);
      m.position.set(x, h / 2 - 0.1, z);
      scene.add(m);
    }
    // Two gantry beams over mid with warm work lamps.
    for (const x of [-6, 9]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 15), mat(COLORS.metal));
      beam.position.set(x, 6.4, 0);
      scene.add(beam);
      for (const z of [-5.5, 5.5]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 6.4, 0.35), mat(COLORS.metal));
        post.position.set(x, 3.2, z + (z < 0 ? -1.5 : 1.5));
        scene.add(post);
        const lamp = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.18, 0.5),
          mat(COLORS.ember, { emissive: COLORS.ember, emissiveIntensity: 2.4, flat: true })
        );
        lamp.position.set(x, 6.1, z);
        scene.add(lamp);
        const light = new THREE.PointLight(0xffb257, 60, 20, 2);
        light.position.set(x, 5.8, z);
        scene.add(light);
      }
    }
  }

  // Pushes a circle (x, z, radius) out of every collider and the bounds.
  moveCircle(pos, radius) {
    pos.x = Math.max(-MAP.halfX + radius, Math.min(MAP.halfX - radius, pos.x));
    pos.z = Math.max(-MAP.halfZ + radius, Math.min(MAP.halfZ - radius, pos.z));
    for (const c of this.colliders) {
      const nx = Math.max(c.minX, Math.min(c.maxX, pos.x));
      const nz = Math.max(c.minZ, Math.min(c.maxZ, pos.z));
      let dx = pos.x - nx, dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 > radius * radius) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * radius;
        pos.z = nz + (dz / d) * radius;
      } else {
        // Centre inside the box: leave by the shallowest face.
        const left = pos.x - c.minX, right = c.maxX - pos.x;
        const near = pos.z - c.minZ, far = c.maxZ - pos.z;
        const m = Math.min(left, right, near, far);
        if (m === left) pos.x = c.minX - radius;
        else if (m === right) pos.x = c.maxX + radius;
        else if (m === near) pos.z = c.minZ - radius;
        else pos.z = c.maxZ + radius;
      }
    }
  }

  // Nearest hit distance of a 3D ray against colliders and the ground,
  // or Infinity. dir must be normalised.
  rayHit(ox, oy, oz, dx, dy, dz, maxT) {
    let best = maxT;
    for (const c of this.colliders) {
      let t0 = 0, t1 = best;
      // X slab
      if (Math.abs(dx) < 1e-9) { if (ox < c.minX || ox > c.maxX) continue; }
      else {
        let ta = (c.minX - ox) / dx, tb = (c.maxX - ox) / dx;
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) continue;
      }
      // Y slab (boxes stand on the ground)
      if (Math.abs(dy) < 1e-9) { if (oy < 0 || oy > c.h) continue; }
      else {
        let ta = (0 - oy) / dy, tb = (c.h - oy) / dy;
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) continue;
      }
      // Z slab
      if (Math.abs(dz) < 1e-9) { if (oz < c.minZ || oz > c.maxZ) continue; }
      else {
        let ta = (c.minZ - oz) / dz, tb = (c.maxZ - oz) / dz;
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) continue;
      }
      if (t0 < best && t0 >= 0) best = t0;
    }
    if (dy < -1e-9) {
      const tg = -oy / dy;
      if (tg >= 0 && tg < best) best = tg;
    }
    return best;
  }

  // Is the straight segment a->b (Vector3s) blocked by world geometry?
  losBlocked(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return false;
    const t = this.rayHit(a.x, a.y, a.z, dx / len, dy / len, dz / len, len);
    return t < len - 0.05;
  }

  siteAt(x, z) {
    for (const key of ['A', 'B']) {
      const s = SITES[key];
      if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) return key;
    }
    return null;
  }

  nearestNode(x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < NODES.length; i++) {
      const dx = NODES[i][0] - x, dz = NODES[i][1] - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // Breadth-first route between two node indices, as a list of indices.
  findPath(from, to) {
    if (from === to) return [from];
    const prev = new Array(NODES.length).fill(-1);
    const queue = [from];
    prev[from] = from;
    while (queue.length) {
      const cur = queue.shift();
      for (const nb of this.adj[cur]) {
        if (prev[nb] === -1) {
          prev[nb] = cur;
          if (nb === to) {
            const path = [to];
            let p = to;
            while (p !== from) { p = prev[p]; path.push(p); }
            return path.reverse();
          }
          queue.push(nb);
        }
      }
    }
    return [from];
  }

  // Route between two ground positions, through their nearest nodes.
  pathBetween(ax, az, bx, bz) {
    const idx = this.findPath(this.nearestNode(ax, az), this.nearestNode(bx, bz));
    return idx.map(i => NODES[i]);
  }
}
