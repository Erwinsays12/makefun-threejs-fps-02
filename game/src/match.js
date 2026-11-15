// match.js - the match itself: phases, rounds, the bomb and the money.
//
// One Match owns every fighter (you, two attacking bots, four defending
// bots), the round state machine (buy -> live -> planted -> over), the
// economy, and all damage. Rendering and effects live elsewhere: this
// module reports through the fx and audio callbacks it is handed, so the
// simulation would run identically with no renderer at all.

import * as THREE from 'three';
import { Bot, ATK_NAMES, DEF_NAMES } from './bots.js';
import { WEAPONS, ARMOR_PRICE, SMOKE_PRICE, Gun, spreadDegrees, fireHitscan } from './weapons.js';
import { SPAWNS, SITES, HOLD_POSTS } from './world.js';

export const BUY_TIME = 8;
export const ROUND_TIME = 100;
export const BOMB_TIME = 40;
export const OVER_TIME = 4.5;
export const WIN_SCORE = 5;
export const MAX_ROUNDS = 9;

const _origin = new THREE.Vector3(), _dir = new THREE.Vector3(), _aim = new THREE.Vector3();
const _muzzle = new THREE.Vector3(), _hit = { kind: 'none', x: 0, y: 0, z: 0, target: null, damage: 0, dist: 0 };

export class Match {
  constructor(ctx) {
    this.world = ctx.world;
    this.smokes = ctx.smokes;
    this.rng = ctx.rng;
    this.hud = ctx.hud;
    this.audio = ctx.audio;
    this.fx = ctx.fx;
    this.player = ctx.player;
    this.onRecoil = null;        // set by main: camera kick per shot
    this.onPlayerDeath = null;   // set by main: death camera

    this.bots = [];
    ATK_NAMES.forEach((n, i) => {
      const b = new Bot('atk', n, 0.58 + i * 0.09, ctx.scene);
      b.money = 800;
      this.bots.push(b);
    });
    DEF_NAMES.forEach((n, i) => {
      const b = new Bot('def', n, 0.47 + i * 0.06, ctx.scene);
      b.money = 800;
      this.bots.push(b);
    });
    this.fighters = [this.player, ...this.bots];
    for (const f of this.fighters) f.lastShotAt = -9;

    this.phase = 'idle';
    this.phaseT = 0;
    this.time = 0;
    this.round = 0;
    this.score = { atk: 0, def: 0 };
    this.targetSite = 'A';
    this.bomb = { state: 'none', carrier: null, pos: new THREE.Vector3(), site: null, planter: null, mesh: ctx.bombMesh };
    this.playerChannel = 0;
    this.beepT = 0;
    this.pops = [];
    this.aiCtx = {
      world: this.world, smokes: this.smokes, fighters: this.fighters, rng: this.rng,
      time: 0, phase: 'idle', bombState: 'none', bombPos: this.bomb.pos, bombSite: null,
      targetSite: 'A', bombCarrier: null, defuser: null,
      shoot: (bot) => this.botShoot(bot),
    };
  }

  // --- flow ---------------------------------------------------------------

  start() {
    this.score = { atk: 0, def: 0 };
    this.round = 0;
    for (const f of this.fighters) { f.money = 800; f.kills = 0; f.deaths = 0; }
    this.nextRound();
  }

  nextRound() {
    this.round++;
    const rng = this.rng;
    this.targetSite = rng.chance(0.5) ? 'A' : 'B';
    // Fighters back to spawn, healed, dead men's guns lost.
    this.player.reset(SPAWNS.atk[2][0], SPAWNS.atk[2][1], -Math.PI / 2);
    if (this.playerDied) { this.player.gun = new Gun(); this.player.armor = false; this.player.smokes = 0; }
    this.playerDied = false;
    let ai = 0, di = 0;
    for (const b of this.bots) {
      if (b.team === 'atk') { b.reset(SPAWNS.atk[ai][0], SPAWNS.atk[ai][1], -Math.PI / 2); ai++; }
      else { b.reset(SPAWNS.def[di][0], SPAWNS.def[di][1], Math.PI / 2); di++; }
      if (b.deadLastRound) { b.gun = new Gun(); b.armor = false; }
      b.deadLastRound = false;
      b.guardNode = null;
      this.botBuy(b);
    }
    // Defender posts: the two sites and mid are always manned.
    const posts = [HOLD_POSTS[0], HOLD_POSTS[1], HOLD_POSTS[2], rng.pick([HOLD_POSTS[3], HOLD_POSTS[4]])];
    let pi = 0;
    for (const b of this.bots) if (b.team === 'def') b.post = posts[pi++];
    // The bomb goes to a random attacker - sometimes you.
    const attackers = this.fighters.filter(f => f.team === 'atk');
    const carrier = rng.pick(attackers);
    carrier.hasBomb = true;
    this.bomb.state = 'carried';
    this.bomb.carrier = carrier;
    this.bomb.site = null;
    this.bomb.planter = null;
    this.playerChannel = 0;
    this.phase = 'buy';
    this.phaseT = BUY_TIME;
    this.hud.banner('ROUND ' + this.round, carrier === this.player ? 'You have the bomb - plant at ' + this.targetSite : 'Plant at site ' + this.targetSite, '', 2.4);
    this.syncHud();
  }

  botBuy(b) {
    if (!b.gun.owned.rifle && b.money >= 2700 + 650) { b.gun.give('rifle'); b.money -= 2700; b.gun.select('rifle'); }
    else if (!b.gun.owned.smg && !b.gun.owned.rifle && b.money >= 1100 + 650) { b.gun.give('smg'); b.money -= 1100; b.gun.select('smg'); }
    if (!b.armor && b.money >= 650) { b.armor = true; b.money -= 650; }
    else if (b.gun.owned.rifle) b.gun.select('rifle');
    else if (b.gun.owned.smg) b.gun.select('smg');
  }

  buy(item) {
    const p = this.player;
    if (this.phase !== 'buy' || !p.alive) return false;
    let ok = false;
    if (item === 'smg' && !p.gun.owned.smg && p.money >= WEAPONS.smg.price) {
      p.money -= WEAPONS.smg.price; p.gun.give('smg'); p.gun.select('smg'); ok = true;
    } else if (item === 'rifle' && !p.gun.owned.rifle && p.money >= WEAPONS.rifle.price) {
      p.money -= WEAPONS.rifle.price; p.gun.give('rifle'); p.gun.select('rifle'); ok = true;
    } else if (item === 'armor' && !p.armor && p.money >= ARMOR_PRICE) {
      p.money -= ARMOR_PRICE; p.armor = true; ok = true;
    } else if (item === 'smoke' && p.smokes < 2 && p.money >= SMOKE_PRICE) {
      p.money -= SMOKE_PRICE; p.smokes++; ok = true;
    }
    if (ok) this.audio.buy(); else this.audio.denied();
    this.syncHud();
    return ok;
  }

  // --- per-step update ------------------------------------------------------

  update(dt, input, view) {
    this.time += dt;
    this.aiCtx.time = this.time;
    this.aiCtx.phase = this.phase;
    this.aiCtx.bombState = this.bomb.state;
    this.aiCtx.bombSite = this.bomb.site;
    this.aiCtx.targetSite = this.targetSite;
    this.aiCtx.defuser = this.bots.find(b => b.channel && b.channel.kind === 'defuse') || null;
    this.aiCtx.bombCarrier = this.bomb.state === 'dropped' ? this.nearestAttackerBot(this.bomb.pos) : null;

    if (this.phase === 'buy' || this.phase === 'live' || this.phase === 'planted') {
      this.updatePlayer(dt, input, view);
    }
    if (this.phase === 'live' || this.phase === 'planted') {
      for (const b of this.bots) b.update(dt, this.aiCtx);
      this.checkChannels();
      this.checkBombPickup();
    } else {
      for (const b of this.bots) b.syncBody(0);
    }
    this.updateBombMesh();

    // Scheduled smoke pops.
    for (let i = this.pops.length - 1; i >= 0; i--) {
      if (this.time >= this.pops[i]) { this.audio.smokePop(); this.pops.splice(i, 1); }
    }

    this.phaseT -= dt;
    if (this.phase === 'buy' && this.phaseT <= 0) {
      this.phase = 'live';
      this.phaseT = ROUND_TIME;
      this.hud.centerMsg(null);
    } else if (this.phase === 'live') {
      if (this.checkElimination()) return;
      if (this.phaseT <= 0) return this.endRound('def', 'Time expired');
    } else if (this.phase === 'planted') {
      this.beepT -= dt;
      if (this.beepT <= 0) {
        this.beepT = Math.max(0.12, this.phaseT / BOMB_TIME * 0.9);
        this.audio.plantBeep(this.phaseT < 3);
      }
      if (this.aliveCount('def') === 0) return this.endRound('atk', 'Squad eliminated');
      if (this.phaseT <= 0) return this.detonate();
    } else if (this.phase === 'over' && this.phaseT <= 0) {
      if (this.score.atk >= WIN_SCORE || this.score.def >= WIN_SCORE || this.round >= MAX_ROUNDS) {
        this.phase = 'matchover';
        const won = this.score.atk >= this.score.def;
        this.hud.banner(won ? 'MATCH WON' : 'MATCH LOST',
          'Ember ' + this.score.atk + ' - ' + this.score.def + ' Slate · click to play again', won ? 'win' : 'lose', 60);
        this.hud.scoreboard(true, this.standings());
      } else {
        this.nextRound();
      }
    }
    this.syncHud();
  }

  updatePlayer(dt, input, view) {
    const p = this.player;
    const wasAlive = p.alive;
    p.update(dt, input.move, this.world, { footstep: () => this.audio.footstep(p.speed2d > 3.4) });
    if (!wasAlive || !p.alive) return;
    p.ads = input.ads && !p.gun.reloading;

    // Weapon switching (the buy keys own the number row during buy phase).
    if (this.phase !== 'buy') {
      if (input.pressed.has('Digit1')) {
        if (p.gun.owned.rifle) p.gun.select('rifle');
        else if (p.gun.owned.smg) p.gun.select('smg');
      }
      if (input.pressed.has('Digit2')) p.gun.select('pistol');
      if (input.wheel > 0) p.gun.select(p.gun.current === 'pistol' ? (p.gun.owned.rifle ? 'rifle' : 'smg') : 'pistol');
    }

    if (this.phase === 'buy') return;

    // Reload and fire.
    if (input.pressed.has('KeyR') && p.gun.startReload()) this.audio.reload();
    const want = p.gun.def.auto ? input.fire : input.firePressed;
    if (want) {
      const res = p.gun.trigger();
      if (res === 'fire') this.resolveShot(p, view.origin, view.dir);
      else if (res === 'dry') { this.audio.dryFire(); if (p.gun.startReload()) this.audio.reload(); }
    }
    // Smoke throw.
    if (input.pressed.has('KeyG') && p.smokes > 0) {
      p.smokes--;
      p.eye(_origin);
      _origin.addScaledVector(view.dir, 0.4);
      this.smokes.throwFrom(_origin, view.dir);
      this.audio.throwWhoosh();
      this.pops.push(this.time + 1.15);
    }
    // Planting: hold E inside a site while carrying.
    if (p.hasBomb && input.use) {
      const site = this.world.siteAt(p.pos.x, p.pos.z);
      if (site) {
        this.playerChannel += dt;
        this.hud.plantBar(this.playerChannel / 3, 'PLANTING AT ' + site);
        if (this.playerChannel >= 3) {
          this.hud.plantBar(null);
          this.plantBomb(p, site);
        }
      } else {
        this.playerChannel = 0;
        this.hud.plantBar(null);
      }
    } else if (this.playerChannel > 0) {
      this.playerChannel = 0;
      this.hud.plantBar(null);
    }
  }

  checkChannels() {
    for (const b of this.bots) {
      if (!b.channel || b.channel.t < b.channel.dur) continue;
      const kind = b.channel.kind;
      b.channel = null;
      if (kind === 'plant' && b.hasBomb && this.phase === 'live') {
        const site = this.world.siteAt(b.pos.x, b.pos.z);
        if (site) this.plantBomb(b, site);
      } else if (kind === 'defuse' && this.phase === 'planted') {
        return this.endRound('def', 'Bomb defused');
      }
    }
  }

  checkBombPickup() {
    if (this.bomb.state !== 'dropped') return;
    for (const f of this.fighters) {
      if (!f.alive || f.team !== 'atk' || f.hasBomb) continue;
      if (Math.hypot(f.pos.x - this.bomb.pos.x, f.pos.z - this.bomb.pos.z) < 1.15) {
        f.hasBomb = true;
        this.bomb.state = 'carried';
        this.bomb.carrier = f;
        if (f.isPlayer) this.hud.centerMsg('Bomb picked up');
        return;
      }
    }
  }

  plantBomb(planter, site) {
    planter.hasBomb = false;
    this.bomb.state = 'planted';
    this.bomb.site = site;
    this.bomb.planter = planter;
    this.bomb.pos.set(planter.pos.x, 0, planter.pos.z);
    this.phase = 'planted';
    this.phaseT = BOMB_TIME;
    this.beepT = 0;
    this.hud.banner('BOMB PLANTED', 'Site ' + site + ' - 40 seconds', 'planted', 2.2);
    this.audio.plantBeep(true);
    for (const b of this.bots) { b.path = null; b.guardNode = null; }
  }

  detonate() {
    this.fx.explosion(this.bomb.pos);
    this.audio.explosion(this.player.pos.distanceTo(this.bomb.pos));
    this.fx.shake(0.7);
    // The blast itself can finish nearby fighters.
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const d = Math.hypot(f.pos.x - this.bomb.pos.x, f.pos.z - this.bomb.pos.z);
      if (d < 9) {
        _aim.copy(this.bomb.pos); _aim.y = 1.1;
        _origin.set(f.pos.x, 1.1, f.pos.z);
        if (!this.world.losBlocked(_aim, _origin)) {
          this.damage(f, 95 * (1 - d / 10), 'body', this.bomb.planter, 'BOMB');
        }
      }
    }
    this.endRound('atk', 'Bomb detonated');
  }

  // --- combat ---------------------------------------------------------------

  stanceOf(f) {
    if (f.isPlayer) return f.stance();
    return { speed: f.speed2d, onGround: true, crouch: f.crouch, ads: false, bloom: f.gun.bloom };
  }

  botShoot(bot) {
    if (this.phase !== 'live' && this.phase !== 'planted') return false;
    if (!bot.target || !bot.target.alive) return false;
    const res = bot.gun.trigger();
    if (res === 'dry') { if (bot.gun.startReload()) this.audio.reload(); return false; }
    if (res !== 'fire') return false;
    bot.eye(_origin);
    const t = bot.target;
    const headAim = this.rng.chance(bot.skill * 0.45);
    _aim.set(t.pos.x, (t.crouch ? 1.1 : headAim ? 1.52 : 1.22), t.pos.z);
    _dir.subVectors(_aim, _origin).normalize();
    this.resolveShot(bot, _origin, _dir);
    return true;
  }

  resolveShot(shooter, origin, dir) {
    const spread = spreadDegrees(shooter.gun.def, this.stanceOf(shooter)) + (shooter.isPlayer ? 0 : shooter.aimErr);
    fireHitscan(this.world, this.smokes.clouds, this.fighters, shooter, origin, dir, spread, this.rng, _hit);
    shooter.lastShotAt = this.time;
    const distToPlayer = shooter.isPlayer ? 0 : shooter.pos.distanceTo(this.player.pos);
    this.audio.shot(shooter.gun.def.report, distToPlayer);
    // Tracer + muzzle from the gun's mouth, not the eye.
    if (shooter.isPlayer) _muzzle.copy(origin).addScaledVector(dir, 0.55);
    else shooter.muzzlePos(_muzzle);
    _muzzle.y -= shooter.isPlayer ? 0.14 : 0;
    this.fx.tracer(_muzzle, _hit);
    this.fx.muzzle(shooter);
    if (_hit.kind === 'world' || _hit.kind === 'smoke') {
      this.fx.impact(_hit.x, _hit.y, _hit.z, _hit.kind);
    }
    if (_hit.target) {
      const killed = this.damage(_hit.target, _hit.damage, _hit.kind, shooter, shooter.gun.def.name);
      if (shooter.isPlayer) {
        this.hud.hitmarker(killed);
        this.audio.hitmark(killed);
      }
    }
    if (shooter.isPlayer && this.onRecoil) this.onRecoil(shooter.gun.def.kick);
  }

  // Returns true when the damage killed.
  damage(target, dmg, part, attacker, weaponName) {
    if (!target.alive || this.phase === 'over' || this.phase === 'matchover') return false;
    if (target.armor) dmg *= 0.55;
    target.health -= dmg;
    if (target.isPlayer) {
      this.hud.damageFlash();
      this.audio.hurt();
      this.fx.shake(0.18);
    }
    if (target.health > 0) return false;
    target.health = 0;
    target.alive = false;
    target.deaths++;
    target.deadLastRound = true;
    if (target.isPlayer) this.playerDied = true;
    if (target.channel) target.channel = null;
    if (attacker && attacker !== target) {
      attacker.kills++;
      attacker.money = (attacker.money || 0) + 300;
      this.hud.feed(attacker.name, target.name, part === 'head', weaponName || 'RIFLE');
    }
    if (target.hasBomb) {
      target.hasBomb = false;
      this.bomb.state = 'dropped';
      this.bomb.carrier = null;
      this.bomb.pos.set(target.pos.x, 0, target.pos.z);
    }
    if (!target.isPlayer) target.die();
    if (target.isPlayer && this.onPlayerDeath) this.onPlayerDeath();
    return true;
  }

  checkElimination() {
    const atk = this.aliveCount('atk'), def = this.aliveCount('def');
    if (atk === 0) { this.endRound('def', 'Squad eliminated'); return true; }
    if (def === 0) { this.endRound('atk', 'Squad eliminated'); return true; }
    return false;
  }

  aliveCount(team) {
    let n = 0;
    for (const f of this.fighters) if (f.alive && f.team === team) n++;
    return n;
  }

  endRound(winner, reason) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.phaseT = OVER_TIME;
    this.score[winner]++;
    const plantedBonus = this.bomb.state === 'planted' || reason === 'Bomb detonated';
    for (const f of this.fighters) {
      if (f.team === winner) f.money = (f.money || 0) + 3250;
      else {
        f.money = (f.money || 0) + 1900;
        if (plantedBonus && f.team === 'atk') f.money += 800;
      }
    }
    this.bomb.state = 'none';
    const won = (winner === 'atk') === (this.player.team === 'atk');
    this.hud.banner(won ? 'ROUND SECURED' : 'ROUND LOST', reason + ' · Ember ' + this.score.atk + ' - ' + this.score.def + ' Slate', won ? 'win' : 'lose', 3.4);
    if (won) this.audio.roundWin(); else this.audio.roundLose();
    this.hud.plantBar(null);
    this.hud.bombTag(null);
  }

  // --- presentation sync ------------------------------------------------------

  updateBombMesh() {
    const mesh = this.bomb.mesh;
    if (!mesh) return;
    if (this.bomb.state === 'carried' && this.bomb.carrier) {
      const c = this.bomb.carrier;
      mesh.visible = true;
      mesh.position.set(c.pos.x - Math.sin(c.yaw || 0) * -0.3, 1.05, c.pos.z - Math.cos(c.yaw || 0) * -0.3);
    } else if (this.bomb.state === 'dropped' || this.bomb.state === 'planted') {
      mesh.visible = true;
      mesh.position.set(this.bomb.pos.x, 0.14, this.bomb.pos.z);
    } else {
      mesh.visible = false;
    }
  }

  nearestAttackerBot(pos) {
    let best = null, bd = Infinity;
    for (const b of this.bots) {
      if (!b.alive || b.team !== 'atk') continue;
      const d = Math.hypot(b.pos.x - pos.x, b.pos.z - pos.z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  standings() {
    return [...this.fighters]
      .sort((a, b) => b.kills - a.kills)
      .map(f => ({ name: f.name, team: f.team, k: f.kills, d: f.deaths, money: f.money || 0 }));
  }

  syncHud() {
    const p = this.player;
    this.hud.setHealth(p.health, p.armor);
    this.hud.setAmmo(p.gun.def.name, p.gun.mag, p.gun.reserve, p.gun.reloading);
    this.hud.setMoney(p.money || 0);
    this.hud.setScore(this.score.atk, this.score.def, Math.max(1, this.round), 'EMBER', 'SLATE');
    if (this.phase === 'buy') {
      this.hud.setClock(this.phaseT, false);
      this.hud.centerMsg('BUY PHASE - weapons with 1-4');
      this.hud.buyMenu(true, { money: p.money, owned: p.gun.owned, armor: p.armor, smokes: p.smokes });
    } else {
      this.hud.buyMenu(false);
      if (this.phase === 'live') this.hud.setClock(this.phaseT, this.phaseT < 10);
      else if (this.phase === 'planted') this.hud.setClock(this.phaseT, true);
      else this.hud.setClock(0, false);
      if (this.phase !== 'buy') this.hud.centerMsg(null);
    }
    if (this.phase === 'planted') this.hud.bombTag('⚠ BOMB PLANTED - SITE ' + this.bomb.site);
    else if (p.hasBomb && (this.phase === 'live')) this.hud.bombTag('YOU HAVE THE BOMB - HOLD E AT A SITE');
    else if (this.bomb.state === 'dropped' && this.phase === 'live') this.hud.bombTag('BOMB DROPPED');
    else this.hud.bombTag(null);
    // Crosshair gap follows the live spread cone.
    const spread = spreadDegrees(p.gun.def, p.stance());
    this.hud.crosshair(6 + spread * 7);
  }
}
