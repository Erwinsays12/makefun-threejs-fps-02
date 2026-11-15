// main.js - bootstrap and rendering for DUSKLINE.
//
// Owns the renderer, the camera and its recoil spring, the weapon
// viewmodel, the transient effects (tracers, impacts, muzzle light, the
// explosion), and the fixed-step loop that drives the simulation in
// match.js at 60 Hz whatever the display does. It also stages the four
// screenshot scenes (?shot=start|play|smoke|end) by posing a real match
// and freezing it, so every screenshot is the game's own render.

import * as THREE from 'three';
import { Rng } from './rng.js';
import { buildSky, COLORS, mat } from './palette.js';
import { World, SITES } from './world.js';
import { Player } from './player.js';
import { SmokeSystem } from './grenade.js';
import { Match } from './match.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { SoundFX } from './audio.js';

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot');
const seed = parseInt(params.get('seed') || '1', 10) || 1;
const rng = new Rng(seed * 7919 + 13);
const STEP = 1 / 60;

// --- renderer / scene ------------------------------------------------------

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
buildSky(scene);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 320);
camera.rotation.order = 'YXZ';
scene.add(camera);
// A faint warm fill rides with the camera so the viewmodel and whatever
// you are standing next to never fall to pure black at dusk.
const fill = new THREE.PointLight(0xffd9b0, 3.2, 8, 2);
fill.position.set(0.25, -0.05, 0.3);
camera.add(fill);

const world = new World(scene);
const smokes = new SmokeSystem(scene);
const player = new Player();
const audio = new SoundFX();
const hud = new Hud();

// The bomb prop: a dark charge with a blinking tell.
const bombMesh = new THREE.Group();
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.27), mat(COLORS.metal));
  body.position.y = 0.02;
  bombMesh.add(body);
  const tip = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.05, 0.08),
    mat(0xe0483e, { emissive: 0xe0483e, emissiveIntensity: 2.4, flat: true })
  );
  tip.position.set(0.08, 0.14, 0);
  tip.name = 'tip';
  bombMesh.add(tip);
  bombMesh.visible = false;
  scene.add(bombMesh);
}

// --- transient effects -------------------------------------------------------

class Fx {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.puffs = [];
    this.light = new THREE.PointLight(0xffc46b, 0, 11, 2);
    scene.add(this.light);
    this.lightT = 0;
    this.shakeAmp = 0;
    this.blast = null;
  }
  tracer(from, hit, color = 0xffd9a0) {
    let t = this.tracers.find(x => x.life <= 0);
    if (!t) {
      if (this.tracers.length >= 28) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      line.frustumCulled = false;
      this.scene.add(line);
      t = { line, life: 0 };
      this.tracers.push(t);
    }
    const p = t.line.geometry.attributes.position.array;
    p[0] = from.x; p[1] = from.y; p[2] = from.z;
    p[3] = hit.x; p[4] = hit.y; p[5] = hit.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.setHex(color);
    t.life = 0.07;
    t.line.visible = true;
    return t;
  }
  impact(x, y, z, kind) {
    let p = this.puffs.find(q => q.life <= 0);
    if (!p) {
      if (this.puffs.length >= 40) return;
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.09, 0),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false })
      );
      this.scene.add(mesh);
      p = { mesh, life: 0, max: 0.3, grow: 1 };
      this.puffs.push(p);
    }
    p.mesh.position.set(x, y, z);
    if (kind === 'smoke') { p.mesh.material.color.setHex(0xb9bdc4); p.max = 0.5; p.grow = 2.4; }
    else if (kind === 'flash') { p.mesh.material.color.setHex(0xffc46b); p.max = 0.06; p.grow = 3.2; }
    else { p.mesh.material.color.setHex(0xd8c9a8); p.max = 0.3; p.grow = 1.6; }
    p.life = p.max;
    p.mesh.visible = true;
    return p;
  }
  muzzle(fighter) {
    if (fighter.isPlayer) {
      vm.flashT = 0.05;
      this.light.position.copy(camera.position).addScaledVector(_fwd, 0.7);
    } else {
      fighter.muzzlePos(_tmpV);
      this.impact(_tmpV.x, _tmpV.y, _tmpV.z, 'flash');
      this.light.position.copy(_tmpV);
    }
    this.light.intensity = 26;
    this.lightT = 0.05;
  }
  explosion(pos) {
    if (!this.blast) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 20, 14),
        new THREE.MeshBasicMaterial({ color: 0xffa03c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      this.scene.add(mesh);
      this.blast = { mesh, life: 0 };
    }
    this.blast.mesh.position.set(pos.x, 1.2, pos.z);
    this.blast.life = 0.7;
    this.light.position.set(pos.x, 2, pos.z);
    this.light.intensity = 320;
    this.lightT = 0.5;
    for (let i = 0; i < 7; i++) {
      this.impact(pos.x + (rng.float() - 0.5) * 3, 0.6 + rng.float() * 1.6, pos.z + (rng.float() - 0.5) * 3, 'smoke');
    }
  }
  shake(n) { this.shakeAmp = Math.min(0.8, this.shakeAmp + n); }
  update(dt) {
    for (const t of this.tracers) {
      if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.line.visible = false; }
    }
    for (const p of this.puffs) {
      if (p.life > 0) {
        p.life -= dt;
        const k = Math.max(0, p.life / p.max);
        p.mesh.scale.setScalar(0.4 + (1 - k) * p.grow);
        p.mesh.material.opacity = 0.85 * k;
        if (p.life <= 0) p.mesh.visible = false;
      }
    }
    if (this.lightT > 0) { this.lightT -= dt; if (this.lightT <= 0) this.light.intensity = 0; }
    if (this.blast && this.blast.life > 0) {
      this.blast.life -= dt;
      const k = Math.max(0, this.blast.life / 0.7);
      this.blast.mesh.scale.setScalar(1 + (1 - k) * 9);
      this.blast.mesh.material.opacity = 0.75 * k;
      if (this.blast.life <= 0) this.blast.mesh.visible = false;
      else this.blast.mesh.visible = true;
    }
    this.shakeAmp = Math.max(0, this.shakeAmp - dt * 1.7);
  }
}

const _fwd = new THREE.Vector3(), _tmpV = new THREE.Vector3();
const fx = new Fx(scene);

// --- weapon viewmodel ----------------------------------------------------------

function buildViewmodel(kind) {
  const g = new THREE.Group();
  const dark = mat(0x23262b, { rough: 0.55 });
  const accent = mat(COLORS.rust, { rough: 0.6 });
  const add = (w, h, d, x, y, z, m = dark) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  if (kind === 'pistol') {
    add(0.07, 0.11, 0.26, 0, 0, -0.1);
    add(0.05, 0.05, 0.14, 0, 0.045, -0.28);
    add(0.06, 0.16, 0.09, 0, -0.12, 0.02).rotation.x = 0.25;
  } else if (kind === 'smg') {
    add(0.08, 0.13, 0.44, 0, 0, -0.16);
    add(0.05, 0.05, 0.2, 0, 0.03, -0.46);
    add(0.06, 0.2, 0.08, 0, -0.15, -0.12, accent).rotation.x = 0.15;
    add(0.07, 0.09, 0.16, 0, 0.01, 0.1);
  } else {
    add(0.08, 0.12, 0.6, 0, 0, -0.24);
    add(0.045, 0.045, 0.34, 0, 0.02, -0.68);
    add(0.06, 0.22, 0.09, 0, -0.16, -0.18, accent).rotation.x = 0.12;
    add(0.05, 0.07, 0.14, 0, 0.1, -0.3);
    add(0.02, 0.05, 0.02, 0, 0.16, -0.3, accent);
  }
  const tip = new THREE.Object3D();
  tip.position.set(0, 0.03, kind === 'rifle' ? -0.86 : kind === 'smg' ? -0.58 : -0.36);
  g.add(tip);
  g.userData.tip = tip;
  // Muzzle flash quad, shown for a frame on each shot.
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: 0xffcf7a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  flash.position.copy(tip.position);
  g.add(flash);
  g.userData.flash = flash;
  return g;
}

const vm = {
  group: new THREE.Group(),
  models: { pistol: buildViewmodel('pistol'), smg: buildViewmodel('smg'), rifle: buildViewmodel('rifle') },
  flashT: 0, kick: 0, bobPhase: 0, adsK: 0,
};
for (const k of Object.keys(vm.models)) { vm.group.add(vm.models[k]); vm.models[k].visible = false; }
vm.group.position.set(0.23, -0.21, -0.42);
camera.add(vm.group);

// --- match wiring ---------------------------------------------------------------

const match = new Match({ scene, world, smokes, rng, hud, audio, fx, player, bombMesh });
let recoil = 0, recoilVel = 0;
match.onRecoil = (kick) => { recoilVel += kick * 0.016; vm.kick = Math.min(0.07, vm.kick + 0.028); };
let deathCamY = null;
match.onPlayerDeath = () => { deathCamY = camera.position.y; };

const input = new Input(canvas, (locked) => {
  if (shotMode) return;
  if (locked) overlay.style.display = 'none';
  else if (match.phase !== 'idle' && match.phase !== 'matchover') showOverlay('PAUSED', 'Click to keep playing');
});
const overlay = document.getElementById('overlay');
const ovTitle = document.getElementById('ov-title');
const ovSub = document.getElementById('ov-sub');
function showOverlay(title, sub) {
  ovTitle.textContent = title;
  ovSub.textContent = sub;
  overlay.style.display = 'flex';
}
overlay.addEventListener('click', () => {
  audio.init();
  input.lock();
  if (match.phase === 'idle' || match.phase === 'matchover') {
    hud.scoreboard(false);
    match.start();
  }
});
canvas.addEventListener('click', () => {
  if (shotMode || input.locked) return;
  audio.init();
  input.lock();
  if (match.phase === 'matchover') { hud.scoreboard(false); match.start(); }
});

// --- screenshot staging ---------------------------------------------------------

function stageShot(name) {
  match.start();
  const P = player;
  if (name === 'start') {
    match.phaseT = 6.4;
    P.yaw = -Math.PI / 2 + 0.1;
    P.pitch = 0.015;
  } else if (name === 'play') {
    match.phase = 'live'; match.phaseT = 63;
    P.pos.set(-2.6, 0, -5.4); P.yaw = -Math.PI / 2 + 0.06; P.pitch = -0.01;
    P.health = 72; P.money = 1450;
    P.gun.give('rifle'); P.gun.select('rifle'); P.gun.ammo.rifle.mag = 17;
    const foe = match.bots[3];                     // SABLE, caught crossing mid-north
    foe.pos.set(2.4, 0, -6.3); foe.yaw = Math.PI / 2 + 0.4; foe.walkPhase = 1.3; foe.speed2d = 3.2; foe.syncBody(0);
    const mate = match.bots[0];                    // VEX already up by the divider gap
    mate.pos.set(0.2, 0, -9.6); mate.yaw = -Math.PI / 2; mate.walkPhase = 2.2; mate.speed2d = 3.2; mate.syncBody(0);
    const deadDef = match.bots[2];                 // ORIN is down by the smelter
    deadDef.pos.set(1.8, 0, -3.9); deadDef.die(); deadDef.deathT = 0.45; deadDef.syncBody(0);
    deadDef.body.group.rotation.x = -Math.PI / 2;
    const deadMate = match.bots[1];                // MARA fell in the west link
    deadMate.pos.set(-9.5, 0, -6.8); deadMate.die(); deadMate.deathT = 0.45; deadMate.syncBody(0);
    deadMate.body.group.rotation.x = Math.PI / 2;
    hud.feed('VEX', 'ORIN', false, 'Longbow Rifle');
    hud.feed('SABLE', 'MARA', true, 'Kestrel SMG');
    // A tracer and muzzle flash, frozen from the shot you just fired:
    // the tracer starts at the viewmodel's muzzle, not at the eye.
    const eye = new THREE.Vector3(); P.eye(eye);
    const dir = new THREE.Vector3(); P.lookDir(dir);
    const right = new THREE.Vector3(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
    const from = eye.addScaledVector(dir, 0.5).addScaledVector(right, 0.22);
    from.y -= 0.16;
    const to = new THREE.Vector3(foe.pos.x, 1.25, foe.pos.z);
    fx.tracer(from, { x: to.x, y: to.y, z: to.z }, 0xffc98a).life = 9999;
    const puff = fx.impact(from.x, from.y, from.z, 'flash');
    puff.max = 9999; puff.life = 9999;
  } else if (name === 'smoke') {
    match.phase = 'live'; match.phaseT = 47;
    P.pos.set(-7.2, 0, -3.2); P.yaw = -Math.PI / 2 - 0.05; P.pitch = 0;
    P.health = 88; P.money = 2140;
    P.gun.give('smg'); P.gun.select('smg'); P.gun.ammo.smg.mag = 24;
    smokes.spawnCloud(-3.4, -5.4);
    smokes.spawnCloud(-0.8, -4.2);
    const foe = match.bots[4];                     // RUE, a silhouette at the far edge
    foe.pos.set(1.8, 0, -7.6); foe.yaw = Math.PI / 2; foe.syncBody(0);
    const mate = match.bots[1];
    mate.pos.set(-4.8, 0, -1.6); mate.yaw = -Math.PI / 2; mate.crouch = true; mate.syncBody(0);
  } else if (name === 'end') {
    match.phase = 'over'; match.phaseT = 99;
    match.score.atk = 3; match.score.def = 1; match.round = 4;
    P.pos.set(12.6, 0, -8.2);
    P.yaw = Math.atan2(-(SITES.A.x - P.pos.x), -(SITES.A.z - P.pos.z));
    P.pitch = -0.03; P.health = 41; P.money = 3900;
    P.gun.give('rifle'); P.gun.select('rifle'); P.gun.ammo.rifle.mag = 9;
    const deadDef = match.bots[5];                 // KOBALT died defending the site
    deadDef.pos.set(16.8, 0, -10.2); deadDef.die(); deadDef.deathT = 0.45; deadDef.syncBody(0);
    deadDef.body.group.rotation.x = -Math.PI / 2;
    smokes.spawnCloud(SITES.A.x + 1.5, SITES.A.z + 1);
    const scorch = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 24),
      new THREE.MeshBasicMaterial({ color: 0x17110c, transparent: true, opacity: 0.85, depthWrite: false })
    );
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.set(SITES.A.x, 0.02, SITES.A.z);
    scene.add(scorch);
    const glow = new THREE.PointLight(0xff7a30, 40, 12, 2);
    glow.position.set(SITES.A.x, 1.1, SITES.A.z);
    scene.add(glow);
    hud.banner('ROUND SECURED', 'Bomb detonated · Ember 3 - 1 Slate', 'win', 9999);
  }
  match.syncHud();
  hud.crosshair(name === 'start' ? 8 : 12);
}

// --- the loop ---------------------------------------------------------------------

const view = { origin: new THREE.Vector3(), dir: new THREE.Vector3() };
const stepInput = { move: null, fire: false, firePressed: false, ads: false, use: false, pressed: null, wheel: 0 };
let last = performance.now();
let acc = 0;
let staged = false;
let smokeFrames = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (shotMode && !staged) { stageShot(shotMode); staged = true; }
  const running = shotMode ? false : (input.locked || match.phase === 'idle' || match.phase === 'matchover');

  // Mouse look is per-frame; the simulation steps then use this view.
  if (!shotMode && input.locked && player.alive) {
    const [dx, dy] = input.consumeMouse();
    player.yaw -= dx * 0.0021;
    player.pitch -= dy * 0.0021;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch));
  }
  // Recoil spring: shots kick it, it settles back over ~0.25 s.
  recoilVel += (-recoil * 110 - recoilVel * 13) * dt;
  recoil += recoilVel * dt;

  player.eye(view.origin);
  const cp = Math.cos(player.pitch + recoil);
  view.dir.set(-Math.sin(player.yaw) * cp, Math.sin(player.pitch + recoil), -Math.cos(player.yaw) * cp);

  if (running && match.phase !== 'idle') {
    stepInput.move = input.moveInput();
    stepInput.fire = input.leftDown;
    stepInput.firePressed = input.leftPressed;
    stepInput.ads = input.rightDown;
    stepInput.use = input.keys.has('KeyE');
    stepInput.pressed = input.pressed;
    stepInput.wheel = input.wheel;
    // Buy keys are frame-level, handled against the live phase.
    if (match.phase === 'buy') {
      if (input.pressed.has('Digit1')) match.buy('smg');
      if (input.pressed.has('Digit2')) match.buy('rifle');
      if (input.pressed.has('Digit3')) match.buy('armor');
      if (input.pressed.has('Digit4')) match.buy('smoke');
    }
    acc += dt;
    while (acc >= STEP) {
      match.update(STEP, stepInput, view);
      smokes.update(STEP, world);
      acc -= STEP;
    }
  } else if ((shotMode === 'smoke' || shotMode === 'end') && smokeFrames < 40) {
    smokes.update(0.06, world);
    smokeFrames++;
  }

  // Bomb tell blinks faster as the timer runs down.
  const tip = bombMesh.getObjectByName('tip');
  if (tip) tip.visible = match.phase !== 'planted' || (now % 500) < 320;

  updateCamera(dt);
  updateViewmodel(dt);
  fx.update(dt);
  if (match.phase !== 'matchover') hud.scoreboard(input.keys.has('Tab'), match.standings());
  renderer.render(scene, camera);
  input.endFrame();
}

function updateCamera(dt) {
  if (player.alive) {
    deathCamY = null;
    player.eye(camera.position);
    camera.rotation.set(player.pitch + recoil, player.yaw, 0);
  } else {
    if (deathCamY === null) deathCamY = camera.position.y;
    deathCamY = Math.max(player.pos.y + 0.42, deathCamY - dt * 1.4);
    camera.position.set(player.pos.x, deathCamY, player.pos.z);
    camera.rotation.set(-0.25 + recoil, player.yaw, 0.55);
  }
  if (fx.shakeAmp > 0.003) {
    camera.position.x += (Math.random() - 0.5) * fx.shakeAmp * 0.06;
    camera.position.y += (Math.random() - 0.5) * fx.shakeAmp * 0.06;
    camera.rotation.z += (Math.random() - 0.5) * fx.shakeAmp * 0.03;
  }
  // Aim-down-sights narrows the field of view and centres the gun.
  const wantFov = player.ads && player.alive ? 62 : 75;
  if (Math.abs(camera.fov - wantFov) > 0.05) {
    camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 11);
    camera.updateProjectionMatrix();
  }
}

function updateViewmodel(dt) {
  const kind = player.gun.current;
  for (const k of Object.keys(vm.models)) vm.models[k].visible = k === kind;
  vm.adsK += ((player.ads ? 1 : 0) - vm.adsK) * Math.min(1, dt * 12);
  if (player.alive && player.speed2d > 0.4 && player.onGround) vm.bobPhase += dt * player.speed2d * 1.7;
  const bobX = Math.sin(vm.bobPhase * 2) * 0.012, bobY = -Math.abs(Math.cos(vm.bobPhase)) * 0.014;
  vm.kick = Math.max(0, vm.kick - dt * 0.35);
  const hip = { x: 0.23, y: -0.21, z: -0.42 };
  const ads = { x: 0, y: -0.148, z: -0.38 };
  vm.group.position.set(
    hip.x + (ads.x - hip.x) * vm.adsK + bobX * (1 - vm.adsK),
    hip.y + (ads.y - hip.y) * vm.adsK + bobY * (1 - vm.adsK),
    hip.z + (ads.z - hip.z) * vm.adsK + vm.kick
  );
  vm.group.rotation.x = vm.kick * 1.6;
  vm.flashT = Math.max(0, vm.flashT - dt);
  const flash = vm.models[kind].userData.flash;
  flash.material.opacity = vm.flashT > 0 ? 0.9 : 0;
  flash.rotation.z = Math.random() * Math.PI;
  const fs = 0.8 + Math.random() * 0.5;
  flash.scale.set(fs, fs, 1);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

if (shotMode) {
  overlay.style.display = 'none';
} else {
  showOverlay('DUSKLINE', 'Click to play - first to 5 rounds takes the yard');
}
requestAnimationFrame(frame);
