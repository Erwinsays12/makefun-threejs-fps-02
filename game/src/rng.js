// rng.js - deterministic seeded randomness for DUSKLINE.
//
// One generator per match. The seed comes from the URL (or the clock for a
// live game), so a staged scene can reproduce the exact same round twice:
// same bot picks, same spread rolls, same screenshot.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) {
    this.next = mulberry32(seed === undefined ? 1 : seed);
  }
  float() { return this.next(); }
  range(min, max) { return min + (max - min) * this.next(); }
  int(min, max) { return Math.floor(this.range(min, max + 1)); }
  pick(list) { return list[Math.floor(this.next() * list.length)]; }
  chance(p) { return this.next() < p; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    }
    return list;
  }
}
