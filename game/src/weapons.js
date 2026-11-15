// The armoury: three hitscan weapons, each with its own damage, fire rate,
// magazine, spread and price. The numbers are the balance: a headshot multiplies
// damage by four, spread grows with movement speed and shrinks when aiming down
// sights, and a rifle costs a round's winnings. One view model is built per
// weapon and swapped on switch; main.js owns the ray and the damage.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', kind: 'pistol', price: 0,
    damage: 34, headMult: 4, magSize: 12, reserve: 48,
    fireGap: 0.16, reloadTime: 1.3, auto: false,
    spreadStill: 0.003, spreadMoving: 0.03, recoil: 0.011,
  },
  smg: {
    id: 'smg', name: 'K9 Hornet', kind: 'smg', price: 1500,
    damage: 26, headMult: 4, magSize: 32, reserve: 96,
    fireGap: 0.072, reloadTime: 1.6, auto: true,
    spreadStill: 0.004, spreadMoving: 0.034, recoil: 0.007,
  },
  rifle: {
    id: 'rifle', name: 'VK-47 Longshore', kind: 'rifle', price: 2700,
    damage: 33, headMult: 4, magSize: 30, reserve: 90,
    fireGap: 0.096, reloadTime: 1.9, auto: true,
    spreadStill: 0.0022, spreadMoving: 0.028, recoil: 0.012,
  },
};

const MUZZLE_TIME = 0.06;
const MOVE_REFERENCE = 5.2;
const ADS_SPREAD = 0.45; // aiming down sights cuts spread by more than half
const ADS_FOV = 58; // narrowed field of view while aiming

function buildViewModel(def) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });
  const model = new THREE.Group();
  if (def.kind === 'pistol') {
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.24), body);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.16, 0.07), grip);
    handle.position.set(0, -0.09, 0.08);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.02), accent);
    sight.position.set(0, 0.05, -0.1);
    model.add(slide, handle, sight);
    model.position.set(0.22, -0.22, -0.38);
  } else if (def.kind === 'smg') {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.34), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.3), grip);
    barrel.position.set(0, 0.02, -0.3);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.06), grip);
    mag.position.set(0, -0.12, -0.02);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.16), grip);
    stock.position.set(0, -0.01, 0.24);
    model.add(receiver, barrel, mag, stock);
    model.position.set(0.23, -0.2, -0.4);
  } else {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), grip);
    barrel.position.set(0, 0.025, -0.38);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.3);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.06), accent);
    sight.position.set(0, 0.075, -0.05);
    model.add(receiver, barrel, stock, sight);
    model.position.set(0.24, -0.2, -0.42);
  }
  return model;
}

export function createWeapon(camera) {
  const models = {};
  for (const def of Object.values(WEAPONS)) {
    models[def.id] = buildViewModel(def);
    models[def.id].visible = false;
    models[def.id].userData.baseZ = models[def.id].position.z;
    camera.add(models[def.id]);
  }

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const state = {
    current: 'pistol', mag: 12, reserve: 48,
    cooldown: 0, reloadLeft: 0, flash: 0, kick: 0,
    owned: { pistol: true, smg: false, rifle: false },
    ammo: { pistol: { mag: 12, reserve: 48 }, smg: { mag: 0, reserve: 0 }, rifle: { mag: 0, reserve: 0 } },
    aiming: false,
  };
  let model = models.pistol;
  model.visible = true;

  function def() {
    return WEAPONS[state.current];
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = model.userData.baseZ ?? -0.42;
    model.position.z += state.kick;
    model.rotation.x = state.kick * 2.2;
    // Aiming pulls the view model toward the centre of the screen.
    const aimX = state.aiming ? 0.11 : 0;
    const aimY = state.aiming ? 0.06 : 0;
    const baseX = state.current === 'pistol' ? 0.22 : state.current === 'smg' ? 0.23 : 0.24;
    const baseY = state.current === 'pistol' ? -0.22 : -0.2;
    model.position.x += (baseX - aimX - model.position.x) * Math.min(1, dt * 12);
    model.position.y += (baseY + aimY - model.position.y) * Math.min(1, dt * 12);
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def().reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const d = def();
        const need = d.magSize - state.ammo[state.current].mag;
        const take = Math.min(need, state.ammo[state.current].reserve);
        state.ammo[state.current].mag += take;
        state.ammo[state.current].reserve -= take;
        sync();
      }
    }
  }

  function sync() {
    state.mag = state.ammo[state.current].mag;
    state.reserve = state.ammo[state.current].reserve;
  }

  function switchTo(id) {
    if (!state.owned[id] || id === state.current) return false;
    model.visible = false;
    state.current = id;
    model = models[id];
    if (model.userData.baseZ === undefined) model.userData.baseZ = model.position.z;
    model.visible = true;
    state.reloadLeft = 0;
    state.cooldown = 0.12;
    sync();
    return true;
  }

  function buy(id) {
    if (state.owned[id]) return switchTo(id) ? 'switched' : 'none';
    state.owned[id] = true;
    const d = WEAPONS[id];
    state.ammo[id] = { mag: d.magSize, reserve: d.reserve };
    switchTo(id);
    return 'bought';
  }

  function resetRound() {
    for (const id of Object.keys(state.ammo)) {
      const d = WEAPONS[id];
      if (state.owned[id]) state.ammo[id] = { mag: d.magSize, reserve: d.reserve };
    }
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.flash = 0;
    state.kick = 0;
    sync();
  }

  return {
    state,
    def,
    step,
    switchTo,
    buy,
    resetRound,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def().fireGap;
      state.flash = MUZZLE_TIME;
      state.kick = 0.055;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.ammo[state.current].mag -= 1;
      state.mag -= 1;
      return true;
    },
    reload() {
      const d = def();
      if (state.reloadLeft > 0 || state.mag === d.magSize || state.reserve === 0) return false;
      state.reloadLeft = d.reloadTime;
      return true;
    },
    spread(speed) {
      const d = def();
      const base = d.spreadStill + Math.min(1, speed / MOVE_REFERENCE) * d.spreadMoving;
      return state.aiming ? base * ADS_SPREAD : base;
    },
    adsFov() {
      return ADS_FOV;
    },
  };
}
