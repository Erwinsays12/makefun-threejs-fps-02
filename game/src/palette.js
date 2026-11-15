// palette.js - the dusk-foundry look of DUSKLINE, in one place.
//
// A low sun, violet shadows and ember-orange highlights, with cool slate
// and teal as the counterweight. Every material in the game comes from
// here, cached and shared, so the whole map renders with a handful of
// programs and one consistent grade.

import * as THREE from 'three';

export const COLORS = {
  sky: 0x2e2138,          // dusk zenith, also the fog colour
  horizon: 0xff9a3c,      // ember band at the horizon
  sun: 0xffb257,
  ground: 0x4a4038,       // ash concrete
  groundDark: 0x3a332c,
  concrete: 0x8a7d6d,
  concreteDark: 0x655a4e,
  metal: 0x3d4148,
  metalLight: 0x596069,
  rust: 0xb5542d,
  rustDark: 0x84401f,
  crate: 0x9c7a48,
  crateDark: 0x77572f,
  ember: 0xffc46b,        // emissive windows, furnace glow
  teamAtk: 0xc4502f,      // rust red - attackers
  teamAtkDark: 0x7e2f1a,
  teamDef: 0x3f6d8e,      // slate blue - defenders
  teamDefDark: 0x27465c,
  skin: 0xc9976f,
  siteA: 0xffb340,        // amber marks site A
  siteB: 0x4fd8e8,        // cyan marks site B
  white: 0xf2ead9,
  black: 0x14100d,
};

const materialCache = new Map();

export function mat(color, opts = {}) {
  const key = color + '|' + (opts.emissive || 0) + '|' + (opts.flat ? 1 : 0) +
    '|' + (opts.rough === undefined ? '' : opts.rough);
  let m = materialCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough === undefined ? 0.92 : opts.rough,
      metalness: opts.flat ? 0.0 : 0.08,
    });
    if (opts.emissive) {
      m.emissive = new THREE.Color(opts.emissive);
      m.emissiveIntensity = opts.emissiveIntensity || 1.0;
    }
    materialCache.set(key, m);
  }
  return m;
}

export function basicMat(color, opacity) {
  const key = 'b' + color + '|' + opacity;
  let m = materialCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color });
    if (opacity !== undefined && opacity < 1) {
      m.transparent = true;
      m.opacity = opacity;
      m.depthWrite = false;
    }
    materialCache.set(key, m);
  }
  return m;
}

// Builds the sky, fog and the two-light dusk rig (low warm sun + violet
// hemisphere fill) into a scene. Returns the sun so callers can aim it.
export function buildSky(scene) {
  scene.background = new THREE.Color(COLORS.sky);
  scene.fog = new THREE.Fog(COLORS.sky, 55, 140);

  const hemi = new THREE.HemisphereLight(0xffd9a6, 0x352636, 1.1);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(COLORS.sun, 2.9);
  sun.position.set(-38, 26, -20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -36;
  sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 36;
  sun.shadow.camera.bottom = -36;
  sun.shadow.camera.near = 5;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);

  // The low sun disc itself, hung past the west wall.
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(7, 32),
    new THREE.MeshBasicMaterial({ color: COLORS.horizon, fog: false })
  );
  disc.position.set(-95, 13, -48);
  disc.lookAt(0, 10, 0);
  scene.add(disc);

  // A thin ember band behind the skyline so the horizon glows.
  const band = new THREE.Mesh(
    new THREE.PlaneGeometry(260, 10),
    new THREE.MeshBasicMaterial({ color: 0xd96f2e, fog: false, transparent: true, opacity: 0.55 })
  );
  band.position.set(-100, 4, -50);
  band.lookAt(0, 4, 0);
  scene.add(band);

  return sun;
}
