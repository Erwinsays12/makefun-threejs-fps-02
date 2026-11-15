// The DOM HUD: crosshair, hit marker, health, ammo, timer, score, money, kill
// feed, buy menu and the one overlay panel. It never touches the simulation;
// main.js pushes numbers in and reads the play callback out. Buy keys
// (1/2/3, G smoke, V armour) are read by main.js from the input queue, not by
// the DOM.
import { WEAPONS } from './weapons.js';
import { SMOKE_PRICE, ARMOR_PRICE } from './match.js';

const COPY = {
  start: {
    title: 'DUSKLINE',
    copy: 'A tactical round-based shooter in Foundry Yard. Plant the bomb at A or B, or eliminate the Raider squad. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'DUSKLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  roundwin: {
    title: 'Round won',
    copy: '',
    action: 'Next round',
  },
  roundlose: {
    title: 'Round lost',
    copy: '',
    action: 'Next round',
  },
  matchwin: {
    title: 'Match won',
    copy: 'Vanguard takes Foundry Yard.',
    action: 'Play again',
  },
  matchlose: {
    title: 'Match lost',
    copy: 'The Raiders hold Foundry Yard.',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const healthFill = $('health-fill');
  const healthValue = $('health-value');
  const armorValue = $('armor-value');
  const timerValue = $('timer');
  const scoreVanguard = document.querySelector('#score .v');
  const scoreRaider = document.querySelector('#score .r');
  const roundValue = $('round-label');
  const moneyValue = $('money');
  const hitmarker = $('hitmarker');
  const crosshair = $('crosshair');
  const feedList = $('feed');
  const messageBanner = $('message');
  const bombBanner = $('bomb-banner');
  const plantBar = $('plant-bar');
  const plantFill = $('plant-fill');
  const buyMenu = $('buy-menu');
  const buyMoney = $('buy-money');
  const smokesValue = $('smokes-value');
  const hint = $('hint');
  let hitTimer = 0;
  let messageTimer = 0;
  let last = {};

  function setText(el, value, key) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  return {
    setAmmo(mag, reserve, name) {
      setText(ammoMag, String(mag), 'mag');
      setText(ammoReserve, `/ ${reserve}`, 'reserve');
      setText(weaponName, name, 'weapon');
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setHealth(health, armor) {
      healthFill.style.width = `${Math.max(0, health)}%`;
      setText(healthValue, String(Math.ceil(health)), 'health');
      setText(armorValue, armor > 0 ? `ARMOR ${armor}` : '', 'armor');
      $('health').classList.toggle('low', health <= 30);
    },
    setTimer(seconds, planted) {
      const value = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
      setText(timerValue, text, 'timer');
      $('timer').classList.toggle('planted', planted);
    },
    setScore(vanguard, raider, round) {
      setText(scoreVanguard, String(vanguard), 'score-v');
      setText(scoreRaider, String(raider), 'score-r');
      setText(roundValue, `ROUND ${round}`, 'round');
    },
    setMoney(money) {
      setText(moneyValue, `$${money}`, 'money');
      setText(buyMoney, `$${money}`, 'buymoney');
    },
    setSmokes(count) {
      setText(smokesValue, `SMOKE x${count}`, 'smokes');
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.25)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    setCrosshairSpread(spreadPx) {
      const gap = Math.round(4 + spreadPx);
      crosshair.style.setProperty('--gap', `${gap}px`);
    },
    setFeed(lines) {
      feedList.innerHTML = lines.map((line) => `<li>${line}</li>`).join('');
    },
    showMessage(text, holdMs = 2600) {
      messageBanner.textContent = text;
      messageBanner.hidden = false;
      clearTimeout(messageTimer);
      messageTimer = setTimeout(() => { messageBanner.hidden = true; }, holdMs);
    },
    setBomb(planted, site, seconds) {
      if (!planted) {
        bombBanner.hidden = true;
        return;
      }
      bombBanner.hidden = false;
      bombBanner.textContent = `BOMB AT SITE ${site} — ${Math.ceil(seconds)}s`;
    },
    setPlant(progress) {
      if (progress <= 0) {
        plantBar.hidden = true;
        return;
      }
      plantBar.hidden = false;
      plantFill.style.width = `${Math.min(100, progress * 100)}%`;
    },
    setBuy(open, money, owned) {
      buyMenu.hidden = !open;
      if (!open) return;
      setText(buyMoney, `$${money}`, 'buymoney');
      for (const id of Object.keys(WEAPONS)) {
        const row = $(`buy-${id}`);
        if (!row) continue;
        const def = WEAPONS[id];
        row.querySelector('.buy-price').textContent = owned[id] ? 'OWNED' : `$${def.price}`;
        row.classList.toggle('owned', Boolean(owned[id]));
        row.classList.toggle('poor', !owned[id] && money < def.price);
      }
      const smokeRow = $('buy-smoke');
      smokeRow.querySelector('.buy-price').textContent = `$${SMOKE_PRICE}`;
      smokeRow.classList.toggle('poor', money < SMOKE_PRICE);
      const armorRow = $('buy-armor');
      armorRow.querySelector('.buy-price').textContent = `$${ARMOR_PRICE}`;
      armorRow.classList.toggle('poor', money < ARMOR_PRICE);
    },
    setHint(text) {
      setText(hint, text, 'hint');
    },
    showOverlay(mode, detail) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = mode === 'roundwin' || mode === 'roundlose' ? detail : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
