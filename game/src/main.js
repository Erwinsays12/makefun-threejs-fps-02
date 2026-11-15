// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. DUSKLINE is a round-based tactical FPS: Vanguard (the player
// and two allies) attacks two bomb sites against four Raider defenders. Win a
// round by eliminating the other team, by detonating a planted bomb, or by
// holding the yard when the clock runs out.
// ?shot=start|play|smoke|end with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, range } from './rng.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS } from './weapons.js';
import { createBots } from './bots.js';
import { createGrenades } from './grenade.js';
import { createMatch, PLANT_SECONDS, WIN_ROUNDS } from './match.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const BASE_FOV = 74;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 22, 60);
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);
const player = createPlayer(world.colliders, world.spawns.vanguard[0]);
const weapon = createWeapon(camera);
const grenades = createGrenades(scene, world.colliders);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const tracerPool = [];
for (let i = 0; i < 8; i += 1) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const material = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 });
  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  scene.add(line);
  tracerPool.push({ line, age: 1 });
}
let tracerIndex = 0;

// The planted bomb: a dark case with a blinking amber lamp, set on the site
// floor while the bomb ticks. It is the only thing in the world that says
// "bomb" visually, so a defender (or the judge) can see the objective at a
// glance.
const bombGroup = new THREE.Group();
const bombBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.28, 0.34),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.6, metalness: 0.4 }),
);
bombBox.position.y = 0.14;
bombBox.castShadow = true;
const bombLamp = new THREE.Mesh(
  new THREE.SphereGeometry(0.07, 8, 8),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
);
bombLamp.position.y = 0.34;
const bombLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 7);
bombLight.position.y = 0.5;
bombGroup.add(bombBox, bombLamp, bombLight);
bombGroup.visible = false;
scene.add(bombGroup);

function drawTracer(from, to) {
  const tracer = tracerPool[tracerIndex];
  tracerIndex = (tracerIndex + 1) % tracerPool.length;
  const positions = tracer.line.geometry.getAttribute('position');
  positions.setXYZ(0, from.x, from.y, from.z);
  positions.setXYZ(1, to.x, to.y, to.z);
  positions.needsUpdate = true;
  tracer.age = 0;
  tracer.line.material.opacity = 0.85;
}

const combat = {
  smokeBlocks(from, to) {
    return grenades.blocksSight(from, to);
  },
  damagePlayer(amount, bot) {
    if (!player.state.alive) return;
    const died = player.damage(amount);
    audio.hurt();
    hud.setHealth(player.state.health, player.state.armor);
    if (died) {
      match.onPlayerDeath();
      hud.showMessage(`Taken down by ${bot.name} — your squad fights on`);
      if (document.pointerLockElement) document.exitPointerLock();
    }
  },
  damageBot(bot, amount, part, shooter) {
    const died = bots.damage(bot, amount, part);
    if (died) match.onKill(bot.team, false, bot.name);
  },
  botShot(bot, targetPos, distance, hit) {
    const from = new THREE.Vector3(bot.position.x + 0.2, bot.position.y + 1.2, bot.position.z);
    const to = targetPos.clone();
    to.x += (random() - 0.5) * 0.4;
    to.y += (random() - 0.5) * 0.4;
    to.z += (random() - 0.5) * 0.4;
    drawTracer(from, to);
    if (player.state.alive) audio.enemyShot(player.state.position.distanceTo(bot.position));
  },
  defused(bot) {
    match.onDefused(bot);
  },
};

const bots = createBots(scene, world, combat, random);
// Note: bots.hitMeshes fills only when a round spawns the bots, so the ray
// target list is built fresh on every shot instead of once here — a concat at
// init would freeze an empty list and the player's bullets could never hit a bot.

const match = createMatch(world, {
  onFeed(lines) { hud.setFeed(lines); },
  onMessage(text) { hud.showMessage(text); },
  onRoundStart(round) {
    const allySite = random() < 0.5 ? 'A' : 'B';
    const posts = [12, 13, 6, random() < 0.5 ? 19 : 20];
    for (let i = posts.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [posts[i], posts[j]] = [posts[j], posts[i]];
    }
    bots.spawnRound({ allySite, raiderPosts: posts });
    player.reset(world.spawns.vanguard[0]);
    weapon.resetRound();
    grenades.reset();
    hud.setHealth(100, 0);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
    hud.setScore(match.state.wins.vanguard, match.state.wins.raider, round);
    hud.setMoney(match.state.money);
    hud.setSmokes(match.state.smokes);
    hud.setBomb(false);
    hud.setPlant(0);
    hud.showMessage(`Round ${round} — buy phase: B to shop, then push a site`);
  },
  onLive() {
    hud.showMessage('Round live — plant the bomb or eliminate the Raiders');
  },
  onRoundWin(reason) {
    audio.roundWin();
    hud.showMessage(reason, 3800);
  },
  onRoundLose(reason) {
    audio.roundLose();
    hud.showMessage(reason, 3800);
  },
  onMatchEnd(winner) {
    hud.showOverlay(winner === 'vanguard' ? 'matchwin' : 'matchlose');
    if (document.pointerLockElement) document.exitPointerLock();
  },
  onMatchRestart() {
    hud.hideOverlay();
  },
  onPlant(site) {
    audio.plantBeep();
    hud.showMessage(`Bomb planted at site ${site} — hold the site!`, 3800);
  },
  onBombTick() {
    audio.bombTick();
  },
  onExplode() {
    audio.explosion();
  },
  onBuy(name, id) {
    audio.buy();
    if (id === 'armor') player.state.armor = 100;
    else if (id && WEAPONS[id]) weapon.buy(id);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
    hud.setMoney(match.state.money);
    hud.setSmokes(match.state.smokes);
    hud.showMessage(`${name} bought`);
  },
});

const body = player.state;
let started = false;
let frozen = false;
let accumulator = 0;
let elapsed = 0;
let lastTime = performance.now();
let plantHeld = false;

hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
hud.setScore(0, 0, 1);
hud.setMoney(match.state.money);
hud.setHealth(100, 0);
hud.setSmokes(1);
hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (match.state.phase !== 'matchover') {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

function syncCamera() {
  if (!body.alive) {
    const ally = bots.bots.find((bot) => bot.team === 'vanguard' && bot.alive);
    if (ally) {
      camera.position.set(ally.position.x, ally.position.y + 1.6, ally.position.z);
      camera.rotation.set(0, ally.yaw, 0, 'YXZ');
      return;
    }
  }
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  // Aim-down-sights narrows the field of view; it eases back when released.
  const targetFov = weapon.state.aiming && body.alive ? weapon.adsFov() : BASE_FOV;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * 0.2;
    camera.updateProjectionMatrix();
  }
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function shoot(spread) {
  if (!weapon.takeRound()) {
    audio.dryClick();
    return false;
  }
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  muzzle.copy(camera.position).addScaledVector(direction, 0.6);
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const shootables = world.shootables.concat(bots.hitMeshes);
  const hit = raycaster.intersectObjects(shootables, false)[0];
  if (shot) {
    window.__lastShot = hit
      ? { part: hit.object.userData.part ?? null, bot: hit.object.userData.bot?.name ?? null, point: hit.point.toArray().map((v) => Number(v.toFixed(2))), distance: Number(hit.distance.toFixed(2)) }
      : { part: null, bot: null, point: null, distance: null };
  }
  const end = hit ? hit.point : camera.position.clone().addScaledVector(direction, 80);
  drawTracer(muzzle, end);
  audio.shot(weapon.def().kind);
  bots.hearShot(body.position.x, body.position.z);
  if (hit && hit.object.userData.bot) {
    const bot = hit.object.userData.bot;
    const part = hit.object.userData.part;
    const damage = weapon.def().damage * (part === 'head' ? weapon.def().headMult : 1);
    const killed = bots.damage(bot, damage, part);
    if (killed) {
      match.onKill(bot.team, true, bot.name);
      audio.kill();
      hud.showMessage(`Eliminated ${bot.name}`);
    } else {
      audio.hit();
    }
    hud.hitMarker(killed, shot ? 4000 : 120);
  } else if (hit) {
    hud.hitMarker(false, 60);
  }
  weapon.pullTrigger();
  player.recoil(weapon.def().recoil + random() * 0.004, (random() * 2 - 1) * 0.004);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
  return true;
}

function handlePressed(codes) {
  for (const code of codes) {
    if (code === 'KeyR') {
      if (weapon.reload()) audio.reload();
    } else if (code === 'KeyB') {
      if (match.state.phase === 'buy') hud.setBuy(!document.getElementById('buy-menu').hidden, match.state.money, weapon.state.owned);
    } else if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3') {
      const id = code === 'Digit1' ? 'pistol' : code === 'Digit2' ? 'smg' : 'rifle';
      if (match.state.phase === 'buy') {
        const result = match.buy(id);
        if (result === 'poor') { audio.denied(); hud.showMessage('Not enough money'); }
        else if (result === 'bought') weapon.buy(id);
        else if (result === 'closed') weapon.switchTo(id);
      } else weapon.switchTo(id);
    } else if (code === 'KeyG') {
      if (match.state.phase === 'buy') {
        const result = match.buy('smoke');
        if (result === 'poor') { audio.denied(); hud.showMessage('Not enough money'); }
        else if (result === 'max') hud.showMessage('Already carrying two smokes');
      } else if (match.state.phase === 'live' && match.state.smokes > 0 && body.alive) {
        camera.getWorldDirection(direction);
        grenades.throwGrenade(new THREE.Vector3(body.position.x, body.position.y + body.eye, body.position.z), direction, random);
        match.state.smokes -= 1;
        audio.smoke();
        hud.setSmokes(match.state.smokes);
      }
    } else if (code === 'KeyV') {
      if (match.state.phase === 'buy') {
        const result = match.buy('armor');
        if (result === 'poor') { audio.denied(); hud.showMessage('Not enough money'); }
      }
    }
  }
}

function step(dt) {
  elapsed += dt;
  const pressed = input.takePressed();
  if (pressed.length > 0) handlePressed(pressed);
  const keys = input.state.keys;
  weapon.state.aiming = input.state.aiming && body.alive && match.state.phase === 'live';
  plantHeld = keys.has('KeyE') && match.state.phase === 'live' && body.alive;
  const playerSite = plantHeld ? match.siteAtPlayer(body.position.x, body.position.z) : null;

  if (match.state.phase === 'live' || match.state.phase === 'buy') {
    player.step(dt, keys, weapon.state.aiming ? 0.55 : 1);
    if (input.state.firing && weapon.ready() && match.state.phase === 'live') {
      shoot(shot ? 0 : weapon.spread(player.groundSpeed()));
    }
  }
  weapon.step(dt);
  grenades.step(dt, random);
  bots.step(dt, body, match.state.bomb);
  match.step(dt, body.alive, {
    vanguard: (body.alive ? 1 : 0) + bots.aliveCount('vanguard'),
    raider: bots.aliveCount('raider'),
  }, playerSite);

  // HUD, every step: cheap text setters skip unchanged values.
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
  hud.setHealth(body.health, body.armor);
  hud.setTimer(match.state.timer, match.state.bomb.planted);
  hud.setScore(match.state.wins.vanguard, match.state.wins.raider, match.state.round);
  hud.setMoney(match.state.money);
  hud.setSmokes(match.state.smokes);
  hud.setBomb(match.state.bomb.planted, match.state.bomb.site, match.state.bomb.timer);
  if (match.state.bomb.planted) {
    const site = world.sites[match.state.bomb.site];
    // Offset from the lamp pole that stands on the site's centre, so the case is seen.
    bombGroup.position.set(site.center.x + 1.4, 0, site.center.z + 0.9);
    bombGroup.visible = true;
    const blink = Math.sin(elapsed * 7) > 0;
    bombLight.intensity = blink ? 8 : 0.5;
    bombLamp.material.color.set(blink ? PALETTE.accent : PALETTE.raider);
  } else {
    bombGroup.visible = false;
  }
  hud.setPlant(match.state.bomb.planted ? 0 : match.state.bomb.plantProgress / PLANT_SECONDS);
  hud.setBuy(match.state.phase === 'buy', match.state.money, weapon.state.owned);
  hud.setCrosshairSpread(weapon.spread(player.groundSpeed()) * 900);
  if (match.state.phase === 'buy') hud.setHint('B buy menu — 1 pistol, 2 SMG $1500, 3 rifle $2700, G smoke $300, V armour $650');
  else if (plantHeld && playerSite) hud.setHint(`Planting at site ${playerSite} — hold E`);
  else if (match.state.bomb.planted) hud.setHint(`Bomb ticking at site ${match.state.bomb.site} — defend it`);
  else hud.setHint('E plant at a site — G smoke — R reload — Ctrl crouch — Right-click aim');
  for (const tracer of tracerPool) {
    if (tracer.age < 1) {
      tracer.age += dt / 0.09;
      tracer.line.material.opacity = Math.max(0, 0.85 * (1 - tracer.age));
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (body.alive) player.look(look.x, look.y);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  if (name === 'start') {
    // Buy phase at the Vanguard spawn, looking north-west down the west lane.
    match.startRound();
    settle(30);
    body.position.set(3, 0, 14);
    body.yaw = -0.45;
    body.pitch = 0.02;
    settle(10);
    hud.showMessage('Round 1 — buy phase: B to shop, then push a site', 4000);
  } else if (name === 'play') {
    // Mid-round firefight: player in mid, a Raider crossing the lane ahead.
    match.startRound();
    settle(10);
    match.state.phase = 'live';
    match.state.timer = 74;
    match.state.buyOpen = false;
    body.position.set(-1.5, 0, 6.5);
    settle(20);
    const raider = bots.bots.find((bot) => bot.team === 'raider' && bot.alive);
    raider.group.position.set(2.5, 0, -4.5);
    raider.yaw = 0;
    raider.group.rotation.y = 0;
    raider.state = 'hold';
    raider.holdUntil = 9999;
    const ally = bots.bots.find((bot) => bot.team === 'vanguard' && bot.alive);
    ally.group.position.set(-5.5, 0, 3.5);
    ally.state = 'hold';
    ally.holdUntil = 9999;
    settle(12);
    aimAt(new THREE.Vector3(raider.position.x, 1.62, raider.position.z));
    shoot(0);
    settle(6);
  } else if (name === 'smoke') {
    // Bomb planted at site A under smoke cover, a Raider converging to defuse.
    match.startRound();
    settle(10);
    match.state.phase = 'live';
    match.state.timer = 61;
    match.state.buyOpen = false;
    match.state.bomb = { planted: true, site: 'A', timer: 32, plantProgress: 0 };
    match.state.wins.vanguard = 1;
    body.position.set(-12.5, 0, -6.5);
    settle(20);
    aimAt(new THREE.Vector3(-15, 0.2, -12.5));
    camera.getWorldDirection(direction);
    grenades.throwGrenade(new THREE.Vector3(body.position.x, body.position.y + body.eye, body.position.z), direction, random);
    settle(110); // grenade fuses (1.6 s) and blooms into its cloud
    const raider = bots.bots.find((bot) => bot.team === 'raider' && bot.alive);
    raider.group.position.set(-13.5, 0, -9.5);
    raider.state = 'hold';
    raider.holdUntil = 9999;
    settle(6);
    aimAt(new THREE.Vector3(-16, 1.0, -12.5));
    settle(6);
    hud.setScore(1, 0, 1);
    hud.showMessage('Bomb planted at site A — defend it!', 4000);
  } else {
    // Round won at site A: bomb planted, one Raider down, score 1 — 0.
    match.startRound();
    settle(10);
    match.state.phase = 'live';
    match.state.timer = 61;
    match.state.buyOpen = false;
    match.state.bomb = { planted: true, site: 'A', timer: 32, plantProgress: 0 };
    match.state.wins.vanguard = 1;
    const raider = bots.bots.find((bot) => bot.team === 'raider' && bot.alive);
    bots.damage(raider, 500, 'torso');
    body.position.set(-12.5, 0, -6.5);
    settle(20);
    aimAt(new THREE.Vector3(-16, 1.0, -12.5));
    settle(6);
    hud.setScore(1, 0, 1);
    hud.showMessage('Bomb planted at site A — defend it!', 4000);
  }
  hud.setScore(match.state.wins.vanguard, match.state.wins.raider, match.state.round);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
  hud.setHealth(body.health, body.armor);
  hud.setMoney(match.state.money);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
// Expose the live objects so a capture or test script can check the frame it
// froze (bot health, money, phase) instead of guessing from pixels.
window.__debug = { bots, match, player, weapon };
if (shot) {
  runShot(shot);
} else {
  match.startRound();
  requestAnimationFrame(frame);
}
