// The map: "Foundry Yard", an original 48 x 36 m industrial yard at dusk.
// North is the Raider side, south is the Vanguard spawn. Two bomb sites —
// A FOUNDRY in the north-west, B SILO in the north-east — are joined by a west
// lane, a mid corridor and an east lane. Every box is both a movement collider
// and a surface a bullet stops on. A waypoint graph rides on top of the
// geometry: bots walk the graph, never the raw map.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint graph: [x, z] nodes, edges by index pair. Bots pathfind with BFS.
const NODES = [
  [0, 15], // 0 vanguard spawn
  [-3, 15], // 1 ally spawn
  [3, 15], // 2 ally spawn
  [0, 8], // 3 mid south
  [-16, 10], // 4 west south
  [16, 10], // 5 east south
  [0, 0], // 6 mid
  [-18, 0], // 7 west mid
  [18, 0], // 8 east mid
  [0, -8], // 9 mid north
  [-16, -8], // 10 west north
  [16, -8], // 11 east north
  [-16, -12.5], // 12 site A
  [16, -12.5], // 13 site B
  [0, -15], // 14 raider spawn
  [-8, -12], // 15 A link
  [8, -12], // 16 B link
  [-9, 4], // 17 west connector
  [9, 4], // 18 east connector
  [-20, -13], // 19 A corner hold
  [20, -13], // 20 B corner hold
];
const EDGES = [
  [0, 3], [1, 4], [2, 5], [3, 6], [4, 7], [5, 8], [6, 9], [7, 10], [8, 11],
  [9, 10], [9, 11], [10, 12], [11, 13], [12, 15], [13, 16], [15, 9], [16, 9],
  [14, 15], [14, 16], [3, 17], [3, 18], [17, 7], [18, 8], [17, 6], [18, 6],
  [12, 19], [13, 20], [10, 19], [11, 20], [4, 17], [5, 18],
];

export const SITES = {
  A: { name: 'FOUNDRY', center: { x: -16, z: -12.5 }, minX: -21, maxX: -11, minZ: -16, maxZ: -9 },
  B: { name: 'SILO', center: { x: 16, z: -12.5 }, minX: 11, maxX: 21, minZ: -16, maxZ: -9 },
};

export const SPAWNS = {
  vanguard: [{ x: 0, z: 15 }, { x: -3, z: 15 }, { x: 3, z: 15 }],
  raider: [{ x: -6, z: -15 }, { x: 0, z: -15 }, { x: 6, z: -15 }, { x: -12, z: -14 }],
};

function letterTexture(letter, colour) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = colour;
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, 228, 228);
  ctx.fillStyle = colour;
  ctx.font = 'bold 150px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 136);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }
  // Emissive lamp glass: the only material that glows.
  const lampMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent),
    emissive: new THREE.Color(PALETTE.accent),
    emissiveIntensity: 1.6,
    roughness: 0.4,
  });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Floor and perimeter: 48 x 36 m, 4.5 m walls.
  box(48.4, 0.4, 36.4, 0, -0.2, 0, 'canvas');
  box(0.4, 4.5, 36.4, -24.2, 2.25, 0, 'surface');
  box(0.4, 4.5, 36.4, 24.2, 2.25, 0, 'surface');
  box(48.4, 4.5, 0.4, 0, 2.25, -18.2, 'surface');
  box(48.4, 4.5, 0.4, 0, 2.25, 18.2, 'surface');

  // Site floor plates and letter decals, painted on the ground, never colliders.
  for (const key of ['A', 'B']) {
    const site = SITES[key];
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 6.4),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.9, transparent: true, opacity: 0.16 }),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(site.center.x, 0.02, site.center.z);
    plate.receiveShadow = true;
    group.add(plate);
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 4.4),
      new THREE.MeshBasicMaterial({ map: letterTexture(key, PALETTE.accent), transparent: true, opacity: 0.85, depthWrite: false }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(site.center.x, 0.03, site.center.z);
    group.add(decal);
  }

  // Site A FOUNDRY: furnace block, crates, a low wall to plant behind.
  box(4.0, 2.8, 2.2, -19.5, 1.4, -15.5, 'hairline');
  box(1.4, 1.1, 1.4, -13.2, 0.55, -15.2, 'hazard');
  box(1.4, 1.1, 1.4, -13.2, 0.55, -13.4, 'surface');
  box(2.6, 1.0, 1.2, -18.2, 0.5, -10.2, 'surface');
  box(1.2, 2.4, 1.2, -11.6, 1.2, -10.6, 'hairline');

  // Site B SILO: a round tank (cylinder, also a collider via its bounding box),
  // pipes and crates.
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 3.4, 20), materials.surface);
  tank.position.set(18.6, 1.7, -15.2);
  tank.castShadow = true;
  tank.receiveShadow = true;
  group.add(tank);
  colliders.push(new THREE.Box3().setFromObject(tank));
  shootables.push(tank);
  box(1.4, 1.1, 1.4, 12.8, 0.55, -14.8, 'hazard');
  box(1.4, 1.1, 1.4, 12.8, 0.55, -13.0, 'surface');
  box(2.6, 1.0, 1.2, 18.4, 0.5, -10.4, 'surface');

  // Mid corridor: two container walls leave a 2.4 m gap at the centre, with a
  // crate in it, so mid is a duel lane, not a shooting gallery.
  box(6.0, 2.6, 1.2, -6.2, 1.3, -2.0, 'surface');
  box(6.0, 2.6, 1.2, 6.2, 1.3, -2.0, 'surface');
  box(1.4, 1.1, 1.4, 0, 0.55, 2.2, 'hazard');
  box(1.2, 2.6, 1.2, -3.4, 1.3, 3.4, 'hairline');
  box(1.2, 2.6, 1.2, 3.4, 1.3, 3.4, 'hairline');

  // West lane cover: a long crate run and a pillar; east lane mirrors it.
  box(3.4, 1.1, 1.2, -17.5, 0.55, 4.5, 'surface');
  box(1.2, 1.1, 3.4, -20.5, 0.55, -3.5, 'surface');
  box(1.4, 3.0, 1.4, -13.0, 1.5, -4.5, 'hairline');
  box(3.4, 1.1, 1.2, 17.5, 0.55, 4.5, 'surface');
  box(1.2, 1.1, 3.4, 20.5, 0.55, -3.5, 'surface');
  box(1.4, 3.0, 1.4, 13.0, 1.5, -4.5, 'hairline');

  // South cover near the Vanguard spawn, and a raised platform to shoot over.
  box(2.4, 0.9, 1.2, -5.0, 0.45, 11.5, 'surface');
  box(2.4, 0.9, 1.2, 5.0, 0.45, 11.5, 'surface');
  box(5.0, 0.5, 2.6, 0, 0.25, 13.5, 'hairline');

  // Lamp posts: poles (colliders) with a glowing head and a warm point light each.
  const lampPositions = [[-8, 6], [8, 6], [-8, -6], [8, -6], [-16, -12.5], [16, -12.5]];
  const lampLights = [];
  for (const [x, z] of lampPositions) {
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.18, 4.2, 0.18), materials.hairline);
    pole.position.set(x, 2.1, z);
    pole.castShadow = true;
    group.add(pole);
    colliders.push(new THREE.Box3().setFromObject(pole));
    shootables.push(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.5), lampMaterial);
    head.position.set(x, 4.3, z);
    group.add(head);
    const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 22, 20, 1.6);
    light.position.set(x, 4.1, z);
    scene.add(light);
    lampLights.push(light);
  }

  // Light: a low amber dusk sun from the west, a cool fill from the east, a dim sky.
  // Bright enough that lanes and sightlines read at a glance, dark enough to stay dusk.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.surface), new THREE.Color(PALETTE.canvas), 2.2);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color(PALETTE.accent), 4.2);
  sun.position.set(-18, 12, 8);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -28;
  sun.shadow.camera.right = 28;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 1.3);
  fill.position.set(14, 10, 12);
  scene.add(fill);

  // Waypoint adjacency, built once from the edge list.
  const adjacency = NODES.map(() => []);
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  return {
    colliders,
    shootables,
    group,
    lampLights,
    waypoints: { nodes: NODES, adjacency },
    sites: SITES,
    spawns: SPAWNS,
  };
}

// Breadth-first path over the waypoint graph, from the node nearest (x, z) to
// the node nearest the target. Returns node indices, excluding the start node.
export function findPath(waypoints, fromX, fromZ, toX, toZ) {
  const { nodes, adjacency } = waypoints;
  let start = 0;
  let goal = 0;
  let bestStart = Infinity;
  let bestGoal = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const dx = nodes[i][0] - fromX;
    const dz = nodes[i][1] - fromZ;
    const d = dx * dx + dz * dz;
    if (d < bestStart) { bestStart = d; start = i; }
    const gx = nodes[i][0] - toX;
    const gz = nodes[i][1] - toZ;
    const gd = gx * gx + gz * gz;
    if (gd < bestGoal) { bestGoal = gd; goal = i; }
  }
  if (start === goal) return [goal];
  const prev = new Array(nodes.length).fill(-1);
  const queue = [start];
  prev[start] = start;
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === goal) break;
    for (const next of adjacency[current]) {
      if (prev[next] === -1) {
        prev[next] = current;
        queue.push(next);
      }
    }
  }
  if (prev[goal] === -1) return [goal];
  const path = [];
  let node = goal;
  while (node !== start) {
    path.unshift(node);
    node = prev[node];
  }
  return path;
}

export function siteAt(sites, x, z) {
  for (const key of Object.keys(sites)) {
    const site = sites[key];
    if (x >= site.minX && x <= site.maxX && z >= site.minZ && z <= site.maxZ) return key;
  }
  return null;
}
