// Smoke grenades: a thrown canister with gravity and a bounce, which blooms
// into a grey cloud that blocks bot line of sight for twelve seconds. The cloud
// is a cluster of transparent spheres, cheap to draw and honest about its
// radius: bots check the same spheres main.js renders, so what the player sees
// is what the AI sees.
import * as THREE from 'three';

const GRAVITY = 12;
const CLOUD_SECONDS = 12;
const CLOUD_RADIUS = 3.2;
const PUFFS = 9;

export function createGrenades(scene, colliders) {
  const grenades = [];
  const clouds = [];
  const puffGeometry = new THREE.SphereGeometry(1, 10, 8);
  const puffMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#9aa2ab'), transparent: true, opacity: 0.42,
    roughness: 1, metalness: 0, depthWrite: false,
  });
  const canisterGeometry = new THREE.SphereGeometry(0.09, 10, 8);
  const canisterMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color('#d8b13a'), roughness: 0.5, metalness: 0.3 });
  const probe = new THREE.Box3();

  function throwGrenade(origin, direction, random) {
    const mesh = new THREE.Mesh(canisterGeometry, canisterMaterial);
    mesh.position.copy(origin);
    scene.add(mesh);
    grenades.push({
      mesh,
      velocity: direction.clone().multiplyScalar(11).add(new THREE.Vector3(0, 4.5, 0)),
      fuse: 1.6,
      bounced: false,
    });
    return true;
  }

  function bloom(position, random) {
    const group = new THREE.Group();
    for (let i = 0; i < PUFFS; i += 1) {
      const puff = new THREE.Mesh(puffGeometry, puffMaterial);
      const angle = random() * Math.PI * 2;
      const radius = random() * CLOUD_RADIUS * 0.55;
      puff.position.set(Math.cos(angle) * radius, 0.6 + random() * 1.6, Math.sin(angle) * radius);
      const scale = 1.1 + random() * 1.3;
      puff.scale.setScalar(scale);
      group.add(puff);
    }
    group.position.copy(position);
    group.position.y = 0;
    scene.add(group);
    clouds.push({ group, center: new THREE.Vector3(position.x, 1.2, position.z), left: CLOUD_SECONDS });
  }

  function step(dt, random) {
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const grenade = grenades[i];
      grenade.fuse -= dt;
      grenade.velocity.y -= GRAVITY * dt;
      grenade.mesh.position.addScaledVector(grenade.velocity, dt);
      const p = grenade.mesh.position;
      probe.min.set(p.x - 0.09, p.y - 0.09, p.z - 0.09);
      probe.max.set(p.x + 0.09, p.y + 0.09, p.z + 0.09);
      let hit = false;
      for (const collider of colliders) {
        if (probe.intersectsBox(collider)) { hit = true; break; }
      }
      if (hit && !grenade.bounced) {
        grenade.velocity.multiplyScalar(0.45);
        grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.4 + 1.5;
        grenade.bounced = true;
      }
      if (p.y < 0.09) {
        p.y = 0.09;
        grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.35;
        grenade.velocity.x *= 0.7;
        grenade.velocity.z *= 0.7;
      }
      if (grenade.fuse <= 0) {
        bloom(grenade.mesh.position, random);
        scene.remove(grenade.mesh);
        grenades.splice(i, 1);
      }
    }
    for (let i = clouds.length - 1; i >= 0; i -= 1) {
      const cloud = clouds[i];
      cloud.left -= dt;
      const fade = Math.min(1, cloud.left / 2);
      cloud.group.traverse((mesh) => {
        if (mesh.isMesh) mesh.material.opacity = 0.42 * fade;
      });
      if (cloud.left <= 0) {
        scene.remove(cloud.group);
        clouds.splice(i, 1);
      }
    }
  }

  // A segment is smoke-blocked when it passes within the cloud's radius of its
  // centre. The same test answers for the player's eyes and the bots' eyes.
  function blocksSight(from, to) {
    for (const cloud of clouds) {
      const c = cloud.center;
      const abx = to.x - from.x;
      const aby = to.y - from.y;
      const abz = to.z - from.z;
      const acx = c.x - from.x;
      const acy = c.y - from.y;
      const acz = c.z - from.z;
      const lengthSq = abx * abx + aby * aby + abz * abz || 1;
      let t = (acx * abx + acy * aby + acz * abz) / lengthSq;
      t = Math.max(0, Math.min(1, t));
      const dx = from.x + abx * t - c.x;
      const dy = from.y + aby * t - c.y;
      const dz = from.z + abz * t - c.z;
      if (dx * dx + dy * dy + dz * dz < CLOUD_RADIUS * CLOUD_RADIUS) return true;
    }
    return false;
  }

  function reset() {
    for (const grenade of grenades) scene.remove(grenade.mesh);
    for (const cloud of clouds) scene.remove(cloud.group);
    grenades.length = 0;
    clouds.length = 0;
  }

  return { throwGrenade, step, blocksSight, reset, clouds };
}
