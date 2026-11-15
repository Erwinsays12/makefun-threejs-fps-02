// hud.js - the DOM layer of the HUD: health, ammunition, money, the
// round clock, the kill feed, the buy menu, channel bars and banners.
//
// The markup and styling live in index.html; this module only reads and
// writes the elements, so presentation and game logic never mix. Every
// method is cheap enough to call whenever a value changes.

function el(id) { return document.getElementById(id); }

export class Hud {
  constructor() {
    this.healthNum = el('health-num');
    this.healthBar = el('health-bar');
    this.armorTag = el('armor-tag');
    this.ammoMag = el('ammo-mag');
    this.ammoReserve = el('ammo-reserve');
    this.weaponName = el('weapon-name');
    this.money = el('money');
    this.timer = el('timer');
    this.scoreLine = el('score-line');
    this.feedBox = el('killfeed');
    this.bannerBox = el('banner');
    this.bannerTitle = el('banner-title');
    this.bannerSub = el('banner-sub');
    this.plantWrap = el('plantbar');
    this.plantFill = el('plantbar-fill');
    this.plantLabel = el('plantbar-label');
    this.buyBox = el('buymenu');
    this.buyRows = {
      smg: el('buy-smg'), rifle: el('buy-rifle'), armor: el('buy-armor'), smoke: el('buy-smoke'),
    };
    this.cross = el('crosshair');
    this.hitmark = el('hitmarker');
    this.vignette = el('vignette');
    this.bombTagEl = el('bombtag');
    this.centerMsgEl = el('centermsg');
    this.board = el('scoreboard');
    this.boardBody = el('scoreboard-rows');
    this._bannerTimer = 0;
    this._lastAmmo = '';
  }

  setHealth(hp, armor) {
    const v = Math.max(0, Math.ceil(hp));
    this.healthNum.textContent = v;
    this.healthBar.style.width = v + '%';
    this.healthBar.style.background = v <= 30 ? '#e0483e' : v <= 60 ? '#e8a13c' : '#7dd069';
    this.armorTag.style.visibility = armor ? 'visible' : 'hidden';
  }

  setAmmo(name, mag, reserve, reloading) {
    const key = name + '|' + mag + '|' + reserve + '|' + (reloading ? 1 : 0);
    if (key === this._lastAmmo) return;
    this._lastAmmo = key;
    this.weaponName.textContent = reloading ? name + ' - RELOADING' : name;
    this.ammoMag.textContent = mag;
    this.ammoReserve.textContent = '/ ' + reserve;
    this.ammoMag.style.color = mag === 0 ? '#e0483e' : '';
  }

  setMoney(m) { this.money.textContent = '$' + m; }

  setClock(seconds, urgent) {
    const s = Math.max(0, Math.ceil(seconds));
    const text = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    if (this.timer.textContent !== text) this.timer.textContent = text;
    this.timer.style.color = urgent ? '#e0483e' : '';
  }

  setScore(atk, def, round, atkName, defName) {
    this.scoreLine.textContent = atkName + ' ' + atk + '  ·  ROUND ' + round + '  ·  ' + def + ' ' + defName;
  }

  feed(attacker, victim, headshot, weapon) {
    const row = document.createElement('div');
    row.className = 'feed-row';
    const a = document.createElement('span');
    a.textContent = attacker;
    a.className = 'feed-atk';
    const w = document.createElement('span');
    w.textContent = ' ▸ ' + weapon + (headshot ? ' ⌖' : '') + ' ▸ ';
    const v = document.createElement('span');
    v.textContent = victim;
    v.className = 'feed-vic';
    row.append(a, w, v);
    this.feedBox.prepend(row);
    while (this.feedBox.children.length > 5) this.feedBox.lastChild.remove();
    setTimeout(() => { row.style.opacity = '0.25'; }, 4200);
    setTimeout(() => { row.remove(); }, 5200);
  }

  banner(title, sub, cls, holdSec = 2.6) {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub || '';
    this.bannerBox.className = 'show ' + (cls || '');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => { this.bannerBox.className = ''; }, holdSec * 1000);
  }

  plantBar(frac, label) {
    if (frac === null || frac === undefined) {
      this.plantWrap.style.display = 'none';
      return;
    }
    this.plantWrap.style.display = 'block';
    this.plantFill.style.width = Math.round(frac * 100) + '%';
    if (label) this.plantLabel.textContent = label;
  }

  buyMenu(show, state) {
    this.buyBox.style.display = show ? 'block' : 'none';
    if (!show) return;
    const mark = (row, owned, price) => {
      if (!row) return;
      row.classList.toggle('owned', !!owned);
      row.classList.toggle('poor', !owned && state.money < price);
    };
    mark(this.buyRows.smg, state.owned.smg, 1100);
    mark(this.buyRows.rifle, state.owned.rifle, 2700);
    mark(this.buyRows.armor, state.armor, 650);
    mark(this.buyRows.smoke, state.smokes > 0, 300);
  }

  crosshair(px) {
    this.cross.style.setProperty('--sp', Math.max(4, Math.min(30, px)) + 'px');
  }

  hitmarker(kill) {
    this.hitmark.className = kill ? 'show kill' : 'show';
    clearTimeout(this._hitTimer);
    this._hitTimer = setTimeout(() => { this.hitmark.className = ''; }, kill ? 260 : 140);
  }

  damageFlash() {
    this.vignette.style.opacity = '0.85';
    clearTimeout(this._vigTimer);
    this._vigTimer = setTimeout(() => { this.vignette.style.opacity = '0'; }, 130);
  }

  bombTag(text) {
    if (!text) { this.bombTagEl.style.display = 'none'; return; }
    this.bombTagEl.style.display = 'block';
    if (this.bombTagEl.textContent !== text) this.bombTagEl.textContent = text;
  }

  centerMsg(text) {
    if (!text) { this.centerMsgEl.style.display = 'none'; return; }
    this.centerMsgEl.style.display = 'block';
    if (this.centerMsgEl.textContent !== text) this.centerMsgEl.textContent = text;
  }

  scoreboard(show, rows) {
    this.board.style.display = show ? 'block' : 'none';
    if (!show) return;
    this.boardBody.textContent = '';
    for (const r of rows) {
      const tr = document.createElement('tr');
      for (const cell of [r.name, r.k, r.d, '$' + r.money]) {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.appendChild(td);
      }
      tr.className = r.team;
      this.boardBody.appendChild(tr);
    }
  }
}
