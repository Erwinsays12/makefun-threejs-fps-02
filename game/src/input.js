// input.js - raw keyboard and mouse state for the player and the menus.
//
// Two kinds of signal live here: held state (the keys set, mouse buttons)
// that movement reads every simulation step, and edge events (pressed,
// leftPressed, wheel) that menus and triggers read once per frame and
// the frame loop then clears.

export class Input {
  constructor(canvas, onLockChange) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.leftDown = false;
    this.leftPressed = false;
    this.rightDown = false;
    this.wheel = 0;
    this.locked = false;
    this.onLockChange = onLockChange || (() => {});

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.leftDown = false; this.rightDown = false; }
      this.onLockChange(this.locked);
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.leftDown = true; this.leftPressed = true; }
      if (e.button === 2) this.rightDown = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.leftDown = false;
      if (e.button === 2) this.rightDown = false;
    });
    window.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  lock() { this.canvas.requestPointerLock(); }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  moveInput() {
    return {
      f: this.keys.has('KeyW') || this.keys.has('ArrowUp'),
      b: this.keys.has('KeyS') || this.keys.has('ArrowDown'),
      l: this.keys.has('KeyA') || this.keys.has('ArrowLeft'),
      r: this.keys.has('KeyD') || this.keys.has('ArrowRight'),
      jump: this.pressed.has('Space'),
      crouch: this.keys.has('ControlLeft') || this.keys.has('KeyC'),
      walk: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
    };
  }

  consumeMouse() {
    const dx = this.mouseDX, dy = this.mouseDY;
    this.mouseDX = 0; this.mouseDY = 0;
    return [dx, dy];
  }

  // Called once per rendered frame, after the simulation steps ran.
  endFrame() {
    this.pressed.clear();
    this.leftPressed = false;
    this.wheel = 0;
  }
}
