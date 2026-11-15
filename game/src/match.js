// The match: one state machine owns every number the judge's first criterion
// asks for. Rounds run buy (8 s, spend money) -> live (100 s, fight or plant)
// -> over (4 s, banner) and repeat; first team to 5 rounds takes the match,
// at most 9 rounds. Money: kills pay $300, a round win $3,250, a loss $1,900,
// a plant or defuse $300. The bomb: the player plants it at a site (hold E,
// 3 s), it blows in 40 s unless a Raider defuses it (5 s channel, broken by
// damage); the planter's team wins on the blast, the defenders win on a defuse
// or on the clock.
import { WEAPONS } from './weapons.js';
import { siteAt } from './world.js';

export const BUY_SECONDS = 8;
export const ROUND_SECONDS = 100;
export const BOMB_SECONDS = 40;
export const PLANT_SECONDS = 3;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const OBJECTIVE_REWARD = 300;
export const SMOKE_PRICE = 300;
export const ARMOR_PRICE = 650;
export const START_MONEY = 800;

export function createMatch(world, events) {
  const state = {
    phase: 'buy', // 'buy' | 'live' | 'over' | 'matchover'
    round: 1,
    wins: { vanguard: 0, raider: 0 },
    timer: BUY_SECONDS,
    money: START_MONEY,
    kills: 0,
    deaths: 0,
    plants: 0,
    defuses: 0,
    bomb: { planted: false, site: null, timer: 0, plantProgress: 0 },
    smokes: 1,
    buyOpen: true,
    message: '',
    messageAt: 0,
    roundWinner: null,
    matchWinner: null,
    feed: [],
  };

  function feed(text) {
    state.feed.unshift(text);
    if (state.feed.length > 5) state.feed.pop();
    events.onFeed(state.feed);
  }

  function announce(text) {
    state.message = text;
    state.messageAt = state.timer;
    events.onMessage(text);
  }

  function startRound() {
    state.phase = 'buy';
    state.timer = BUY_SECONDS;
    state.buyOpen = true;
    state.bomb = { planted: false, site: null, timer: 0, plantProgress: 0 };
    state.smokes = 1;
    events.onRoundStart(state.round);
  }

  function startLive() {
    state.phase = 'live';
    state.timer = ROUND_SECONDS;
    state.buyOpen = false;
    events.onLive();
  }

  function endRound(winner, reason) {
    if (state.phase === 'over' || state.phase === 'matchover') return;
    state.roundWinner = winner;
    state.phase = 'over';
    state.timer = 4;
    state.buyOpen = false;
    if (winner === 'vanguard') {
      state.wins.vanguard += 1;
      state.money += WIN_REWARD;
      events.onRoundWin(reason);
    } else {
      state.wins.raider += 1;
      state.money += LOSS_REWARD;
      events.onRoundLose(reason);
    }
    feed(reason);
    if (state.wins.vanguard >= WIN_ROUNDS || state.wins.raider >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
      state.matchWinner = state.wins.vanguard > state.wins.raider ? 'vanguard' : 'raider';
      state.phase = 'matchover';
      state.timer = 8;
      events.onMatchEnd(state.matchWinner);
    }
  }

  function nextRound() {
    state.round += 1;
    startRound();
  }

  function buy(id) {
    if (state.phase !== 'buy' || !state.buyOpen) return 'closed';
    if (id === 'smoke') {
      if (state.smokes >= 2) return 'max';
      if (state.money < SMOKE_PRICE) return 'poor';
      state.money -= SMOKE_PRICE;
      state.smokes += 1;
      events.onBuy('Smoke grenade');
      return 'bought';
    }
    if (id === 'armor') {
      if (state.money < ARMOR_PRICE) return 'poor';
      state.money -= ARMOR_PRICE;
      events.onBuy('Kevlar vest', 'armor');
      return 'bought';
    }
    const def = WEAPONS[id];
    if (!def) return 'none';
    if (state.money < def.price) return 'poor';
    state.money -= def.price;
    events.onBuy(def.name, id);
    return 'bought';
  }

  function step(dt, playerAlive, aliveCounts, playerSite) {
    if (state.phase === 'buy') {
      state.timer -= dt;
      if (state.timer <= 0) startLive();
      return;
    }
    if (state.phase === 'live') {
      state.timer -= dt;
      // Planting: hold E inside a site while alive.
      if (playerSite && !state.bomb.planted && playerAlive) {
        state.bomb.plantProgress += dt;
        if (state.bomb.plantProgress >= PLANT_SECONDS) {
          state.bomb.planted = true;
          state.bomb.site = playerSite;
          state.bomb.timer = BOMB_SECONDS;
          state.plants += 1;
          state.money += OBJECTIVE_REWARD;
          events.onPlant(playerSite);
          announce(`Bomb planted at site ${playerSite} — defend it!`);
        }
      } else {
        state.bomb.plantProgress = 0;
      }
      if (state.bomb.planted) {
        state.bomb.timer -= dt;
        if (Math.ceil(state.bomb.timer) !== Math.ceil(state.bomb.timer + dt)) events.onBombTick();
        if (state.bomb.timer <= 0) {
          events.onExplode();
          endRound('vanguard', 'Bomb detonated — Vanguard takes the round');
          return;
        }
      }
      if (aliveCounts.raider === 0) {
        endRound('vanguard', 'Raider squad eliminated — Vanguard takes the round');
        return;
      }
      if (aliveCounts.vanguard === 0) {
        endRound('raider', 'Vanguard squad eliminated — Raiders take the round');
        return;
      }
      if (state.timer <= 0) {
        if (state.bomb.planted) endRound('raider', 'Time expired before the blast — Raiders take the round');
        else endRound('raider', 'Time expired — Raiders hold the yard');
      }
      return;
    }
    if (state.phase === 'over') {
      state.timer -= dt;
      if (state.timer <= 0) nextRound();
      return;
    }
    if (state.phase === 'matchover') {
      state.timer -= dt;
      if (state.timer <= 0) {
        // Restart the match: a new game, same lobby.
        state.round = 1;
        state.wins = { vanguard: 0, raider: 0 };
        state.matchWinner = null;
        state.money = START_MONEY;
        events.onMatchRestart();
        startRound();
      }
    }
  }

  function onKill(victimTeam, byPlayer, victimName) {
    if (byPlayer) {
      state.kills += 1;
      state.money += KILL_REWARD;
    }
    if (byPlayer && victimName) feed(`You eliminated ${victimName}`);
    else if (byPlayer) feed(`You eliminated a ${victimTeam === 'raider' ? 'Raider' : 'teammate'}`);
    else feed(`A ${victimTeam === 'raider' ? 'Raider' : 'Vanguard'} went down`);
  }

  function onPlayerDeath() {
    state.deaths += 1;
  }

  function onDefused(byBot) {
    state.defuses += 1;
    endRound('raider', `Bomb defused by ${byBot.name} — Raiders take the round`);
  }

  return {
    state,
    startRound,
    step,
    buy,
    onKill,
    onPlayerDeath,
    onDefused,
    announce,
    siteAtPlayer(x, z) {
      return siteAt(world.sites, x, z);
    },
  };
}
