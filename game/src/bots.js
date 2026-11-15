// The bots: two Vanguard allies and four Raider defenders, each a small state
// machine over the waypoint graph. They walk routes, hold positions, sweep their
// view, react to what they see and hear, and shoot back with a reaction time
// and an accuracy that falls off with distance, target speed and crouching.
// Smoke blocks their sight exactly as it blocks the player's. One module, one
// job: decide what each bot does; main.js owns the player's bullets and the
// round's verdicts.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { findPath } from './world.js';
import { pick, range } from './rng.js';

const BOT_RADIUS = 0.34;
const BOT_HEIGHT = 1.72;
const WALK_SPEED = 3.4;
const RUN_SPEED = 4.4;
const REACTION_MIN = 0.35;
const REACTION_MAX = 0.75;
const DEFUSE_SECONDS = 5;
const HEAR_RADIUS = 28;
const LOS_CHECK_EVERY = 0.15;

const NAMES = {
  vanguard: ['ASH', 'REX', 'JUNO'],
  raider: ['VOLT', 'GRIM', 'HAVOC', 'DUSK'],
};

function buildBotMesh(team) {
  const group = new THREE.Group();
  const bodyColour = team === 'vanguard' ? PALETTE.vanguard : PALETTE.raider;
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(bodyColour), roughness: 0.65, metalness: 0.05 });
  const headMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.6, metalness: 0.05 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.8 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.82, 0.32), bodyMat);
  torso.position.y = 1.02;
  torso.userData.part = 'torso';
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), headMat);
  head.position.y = 1.62;
  head.userData.part = 'head';
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.05), darkMat);
  visor.position.set(0, 1.64, -0.15);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 0.26), darkMat);
  legs.position.y = 0.3;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), darkMat);
  gun.position.set(0.2, 1.15, -0.3);
  group.add(torso, head, visor, legs, gun);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return { group, torso, head };
}

export function createBots(scene, world, combat, random) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const probe = new THREE.Box3();
  const bots = [];
  const hitMeshes = [];
  let time = 0;

  function makeBot(team, name, spawn) {
    const { group, torso, head } = buildBotMesh(team);
    group.position.set(spawn.x, 0, spawn.z);
    scene.add(group);
    const bot = {
      team, name, group, torso, head,
      position: group.position,
      yaw: team === 'vanguard' ? Math.PI : 0,
      health: 100, alive: true,
      state: 'hold', path: [], pathIndex: 0, goalNode: -1,
      holdUntil: 0, scanPhase: random() * Math.PI * 2,
      target: null, lastSeen: new THREE.Vector3(), loseSightAt: 0,
      reactionUntil: 0, burstLeft: 0, shotAt: 0, pauseUntil: 0,
      defuseProgress: 0, defuseGoal: null,
      investigateAt: new THREE.Vector3(), investigating: false,
      losAt: -1, hasLos: false, strafeDir: 1, strafeUntil: 0,
      posts: [],
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - BOT_RADIUS, y + lift, z - BOT_RADIUS);
    probe.max.set(x + BOT_RADIUS, y + height - lift, z + BOT_RADIUS);
    for (const collider of world.colliders) if (probe.intersectsBox(collider)) return true;
    return false;
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < world.waypoints.nodes.length; i += 1) {
      const dx = world.waypoints.nodes[i][0] - x;
      const dz = world.waypoints.nodes[i][1] - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function setRoute(bot, toX, toZ) {
    bot.path = findPath(world.waypoints, bot.position.x, bot.position.z, toX, toZ);
    bot.pathIndex = 0;
    bot.state = 'route';
  }

  function routeStep(bot, dt, speed) {
    if (bot.pathIndex >= bot.path.length) return true;
    const node = world.waypoints.nodes[bot.path[bot.pathIndex]];
    const dx = node[0] - bot.position.x;
    const dz = node[1] - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.5) {
      bot.pathIndex += 1;
      return bot.pathIndex >= bot.path.length;
    }
    const step = Math.min(dist, speed * dt);
    const nx = bot.position.x + (dx / dist) * step;
    const nz = bot.position.z + (dz / dist) * step;
    if (!overlaps(nx, bot.position.y, bot.position.z, BOT_HEIGHT, 0.04)) bot.position.x = nx;
    if (!overlaps(bot.position.x, bot.position.y, nz, BOT_HEIGHT, 0.04)) bot.position.z = nz;
    bot.yaw = Math.atan2(-dx, -dz);
    bot.group.rotation.y = bot.yaw;
    return false;
  }

  function hasLineOfSight(bot, targetPos) {
    from.set(bot.position.x, bot.position.y + 1.55, bot.position.z);
    to.copy(targetPos);
    dir.copy(to).sub(from);
    const dist = dir.length();
    if (dist > 28) return false; // beyond this a bot holds fire: no spawn-to-spawn duels
    dir.normalize();
    raycaster.set(from, dir);
    raycaster.far = dist;
    const hit = raycaster.intersectObjects(world.shootables, false)[0];
    if (hit) return false;
    if (combat.smokeBlocks(from, to)) return false;
    return true;
  }

  function visibleEnemies(bot, playerState) {
    const enemies = [];
    if (bot.team === 'raider' && playerState.alive) {
      enemies.push({
        kind: 'player',
        pos: new THREE.Vector3(playerState.position.x, playerState.position.y + 1.2, playerState.position.z),
        speed: Math.hypot(playerState.velocity.x, playerState.velocity.z),
        crouching: playerState.crouching,
      });
    }
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      enemies.push({ kind: 'bot', bot: other, pos: new THREE.Vector3(other.position.x, other.position.y + 1.2, other.position.z), speed: 0, crouching: false });
    }
    return enemies;
  }

  function scan(bot, dt, playerState) {
    if (time - bot.losAt < LOS_CHECK_EVERY) return;
    bot.losAt = time;
    bot.hasLos = false;
    for (const enemy of visibleEnemies(bot, playerState)) {
      if (hasLineOfSight(bot, enemy.pos)) {
        bot.hasLos = true;
        bot.target = enemy;
        bot.lastSeen.copy(enemy.pos);
        bot.loseSightAt = time + 1.5;
        if (bot.reactionUntil < time) bot.reactionUntil = time + range(random, REACTION_MIN, REACTION_MAX);
        return;
      }
    }
    if (bot.target && time > bot.loseSightAt) bot.target = null;
  }

  function shootAt(bot, dt) {
    if (time < bot.reactionUntil || time < bot.pauseUntil) return;
    if (bot.burstLeft <= 0) {
      bot.burstLeft = 3 + Math.floor(random() * 3);
      bot.pauseUntil = time + 0.85 + random() * 0.5;
    }
    if (time - bot.shotAt < 0.13) return;
    bot.shotAt = time;
    bot.burstLeft -= 1;
    const target = bot.target;
    if (!target) return;
    const dist = bot.position.distanceTo(target.pos);
    let chance = 0.5 - dist * 0.009;
    if (target.speed > 3) chance -= 0.16;
    if (target.crouching) chance -= 0.1;
    chance = Math.max(0.06, Math.min(0.6, chance));
    const hit = random() < chance;
    const head = hit && random() < 0.12;
    if (hit) {
      if (target.kind === 'player') combat.damagePlayer(range(random, 9, 17) * (head ? 2 : 1), bot);
      else combat.damageBot(target.bot, range(random, 22, 32) * (head ? 2 : 1), head ? 'head' : 'torso', bot);
    }
    combat.botShot(bot, target.pos, dist, hit);
    if (bot.burstLeft <= 0) bot.pauseUntil = time + 0.7 + random() * 0.6;
  }

  function stepBot(bot, dt, playerState, bomb) {
    if (!bot.alive) return;
    // The bomb overrides everything for defenders: converge and defuse.
    if (bomb.planted && bot.team === 'raider') {
      const site = world.sites[bomb.site];
      const dx = site.center.x - bot.position.x;
      const dz = site.center.z - bot.position.z;
      if (Math.hypot(dx, dz) > 2.5) {
        if (bot.defuseGoal !== bomb.site) {
          bot.defuseGoal = bomb.site;
          setRoute(bot, site.center.x, site.center.z);
        }
        routeStep(bot, dt, RUN_SPEED);
        bot.defuseProgress = 0;
      } else {
        bot.state = 'defuse';
        bot.defuseProgress += dt;
        bot.yaw += dt * 0.4;
        bot.group.rotation.y = bot.yaw;
        if (bot.defuseProgress >= DEFUSE_SECONDS) combat.defused(bot);
      }
      scan(bot, dt, playerState);
      if (bot.target && time >= bot.reactionUntil) shootAt(bot, dt);
      return;
    }

    scan(bot, dt, playerState);
    if (bot.target) {
      bot.state = 'engage';
      bot.investigating = false;
      const target = bot.target;
      const dx = target.pos.x - bot.position.x;
      const dz = target.pos.z - bot.position.z;
      bot.yaw = Math.atan2(-dx, -dz);
      bot.group.rotation.y = bot.yaw;
      // Strafe sideways while firing, flipping direction every second or so.
      if (time > bot.strafeUntil) {
        bot.strafeDir = random() < 0.5 ? -1 : 1;
        bot.strafeUntil = time + 0.7 + random() * 0.8;
      }
      const sx = Math.cos(bot.yaw) * bot.strafeDir;
      const sz = -Math.sin(bot.yaw) * bot.strafeDir;
      const nx = bot.position.x + sx * 1.6 * dt;
      const nz = bot.position.z + sz * 1.6 * dt;
      if (!overlaps(nx, bot.position.y, bot.position.z, BOT_HEIGHT, 0.04)) bot.position.x = nx;
      if (!overlaps(bot.position.x, bot.position.y, nz, BOT_HEIGHT, 0.04)) bot.position.z = nz;
      shootAt(bot, dt);
      return;
    }

    if (bot.investigating) {
      const dx = bot.investigateAt.x - bot.position.x;
      const dz = bot.investigateAt.z - bot.position.z;
      if (Math.hypot(dx, dz) < 1.2) {
        bot.investigating = false;
        bot.state = 'hold';
        bot.holdUntil = time + 2;
      } else {
        if (bot.state !== 'investigate-route') setRoute(bot, bot.investigateAt.x, bot.investigateAt.z);
        routeStep(bot, dt, RUN_SPEED);
      }
      return;
    }

    if (bot.state === 'route') {
      if (routeStep(bot, dt, WALK_SPEED)) {
        bot.state = 'hold';
        bot.holdUntil = time + range(random, 2, 5);
      }
      return;
    }

    // Hold: sweep the view, then pick a new post after a while.
    bot.scanPhase += dt * 0.7;
    bot.group.rotation.y = bot.yaw + Math.sin(bot.scanPhase) * 0.9;
    if (time > bot.holdUntil) {
      const post = pick(random, bot.posts);
      const node = world.waypoints.nodes[post];
      setRoute(bot, node[0], node[1]);
    }
  }

  function spawnRound(plan) {
    // plan: { allySite: 'A' | 'B', raiderPosts: [node, node, node, node] }
    let index = 0;
    for (const spawn of world.spawns.vanguard) {
      let bot = bots[index];
      if (!bot) bot = makeBot('vanguard', NAMES.vanguard[index], spawn);
      index += 1;
      resetBot(bot, spawn, 0);
      const site = world.sites[plan.allySite];
      bot.posts = [nearestNode(site.center.x, site.center.z), nearestNode(site.center.x + 4, site.center.z + 4)];
      setRoute(bot, site.center.x + range(random, -3, 3), site.center.z + range(random, -2, 2));
    }
    for (let i = 0; i < world.spawns.raider.length; i += 1) {
      const spawn = world.spawns.raider[i];
      let bot = bots[index];
      if (!bot) bot = makeBot('raider', NAMES.raider[i], spawn);
      index += 1;
      resetBot(bot, spawn, Math.PI);
      const post = plan.raiderPosts[i];
      bot.posts = [post, nearestNode(world.sites.A.center.x, world.sites.A.center.z), nearestNode(world.sites.B.center.x, world.sites.B.center.z)];
      const node = world.waypoints.nodes[post];
      setRoute(bot, node[0], node[1]);
    }
  }

  function resetBot(bot, spawn, yaw) {
    bot.group.position.set(spawn.x, 0, spawn.z);
    bot.group.rotation.set(0, yaw, 0);
    bot.yaw = yaw;
    bot.health = 100;
    bot.alive = true;
    bot.group.visible = true;
    bot.target = null;
    bot.defuseProgress = 0;
    bot.defuseGoal = null;
    bot.investigating = false;
    bot.burstLeft = 0;
    bot.reactionUntil = 0;
    bot.pauseUntil = 0;
    bot.losAt = -1;
  }

  function damage(bot, amount, part) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health > 0) {
      // Being shot at interrupts a defuse and draws attention to the shooter.
      bot.defuseProgress = 0;
      return false;
    }
    bot.health = 0;
    bot.alive = false;
    bot.target = null;
    bot.group.rotation.x = -Math.PI / 2;
    bot.group.position.y = 0.25;
    return true;
  }

  function hearShot(x, z) {
    for (const bot of bots) {
      if (!bot.alive || bot.target) continue;
      const dx = bot.position.x - x;
      const dz = bot.position.z - z;
      if (dx * dx + dz * dz < HEAR_RADIUS * HEAR_RADIUS) {
        bot.investigateAt.set(x, 0, z);
        bot.investigating = true;
      }
    }
  }

  return {
    bots,
    hitMeshes,
    spawnRound,
    damage,
    hearShot,
    step(dt, playerState, bomb) {
      time += dt;
      for (const bot of bots) stepBot(bot, dt, playerState, bomb);
    },
    aliveCount(team) {
      return bots.filter((bot) => bot.team === team && bot.alive).length;
    },
    reset() {
      for (const bot of bots) {
        scene.remove(bot.group);
      }
      bots.length = 0;
      hitMeshes.length = 0;
      time = 0;
    },
  };
}
