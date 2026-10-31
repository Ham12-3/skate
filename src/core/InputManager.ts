export type InputAction = 'push' | 'brake' | 'left' | 'right' | 'ollie' | 'kickflip' | 'heelflip' | 'shoveit' | 'grab' | 'spinLeft' | 'spinRight' | 'pause' | 'restart' | 'fps' | 'camera';

const KEY_MAP: Record<string, InputAction> = {
  KeyW: 'push', ArrowUp: 'push', KeyS: 'brake', ArrowDown: 'brake',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'ollie', KeyJ: 'kickflip', KeyK: 'heelflip', KeyL: 'shoveit',
  ShiftLeft: 'grab', ShiftRight: 'grab', KeyQ: 'spinLeft', KeyE: 'spinRight',
  Escape: 'pause', KeyR: 'restart', F3: 'fps', KeyC: 'camera',
};

export class InputManager {
  private held = new Set<InputAction>();
  private pressed = new Set<InputAction>();
  private released = new Set<InputAction>();
  private previousGamepad = new Set<InputAction>();
  private enabled = true;
  // Demo playback: scripted input drives the game, and any real key or click asks to stop it.
  private scripted = false;
  onInterrupt?: () => void;

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
    window.addEventListener('pointerdown', this.onPointerDown);
  }

  private onPointerDown = (): void => {
    if (this.scripted) this.onInterrupt?.();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.scripted) { event.preventDefault(); this.onInterrupt?.(); return; }
    const action = KEY_MAP[event.code];
    if (!action || !this.enabled) return;
    event.preventDefault();
    if (!this.held.has(action)) this.pressed.add(action);
    this.held.add(action);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (this.scripted) return;
    const action = KEY_MAP[event.code];
    if (!action || !this.enabled) return;
    event.preventDefault();
    const wasHeld = this.held.has(action);
    this.held.delete(action);
    if (wasHeld) this.released.add(action);
  };

  private clear = (): void => {
    this.held.clear();
    this.pressed.clear();
    this.released.clear();
  };

  private pollGamepad(): void {
    const gamepad = navigator.getGamepads?.()[0];
    const current = new Set<InputAction>();
    if (gamepad && this.enabled) {
      if (gamepad.buttons[0]?.pressed) current.add('ollie');
      if (gamepad.buttons[2]?.pressed) current.add('kickflip');
      if (gamepad.buttons[3]?.pressed) current.add('heelflip');
      if (gamepad.buttons[1]?.pressed) current.add('shoveit');
      if (gamepad.buttons[5]?.pressed) current.add('grab');
      if ((gamepad.buttons[6]?.value ?? 0) > 0.25) current.add('spinLeft');
      if ((gamepad.buttons[7]?.value ?? 0) > 0.25) current.add('spinRight');
      if (gamepad.buttons[9]?.pressed) current.add('pause');
      const x = gamepad.axes[0] ?? 0;
      const y = gamepad.axes[1] ?? 0;
      if (x < -0.2) current.add('left');
      if (x > 0.2) current.add('right');
      if (y < -0.35) current.add('push');
      if (y > 0.35) current.add('brake');
    }
    current.forEach((action) => {
      if (!this.previousGamepad.has(action)) this.pressed.add(action);
      this.held.add(action);
    });
    this.previousGamepad.forEach((action) => {
      if (!current.has(action) && !this.isKeyboardHeld(action)) {
        this.held.delete(action);
        this.released.add(action);
      }
    });
    this.previousGamepad = current;
  }

  private isKeyboardHeld(action: InputAction): boolean {
    return Object.entries(KEY_MAP).some(([, mapped]) => mapped === action) && this.held.has(action) && !this.previousGamepad.has(action);
  }

  update(): void { if (!this.scripted) this.pollGamepad(); }

  setScripted(scripted: boolean): void {
    this.scripted = scripted;
    this.clear();
  }

  // Scripted presses behave exactly like keys: hold/release set the edge flags, tap is a press and release in one step.
  hold(action: InputAction): void {
    if (!this.held.has(action)) this.pressed.add(action);
    this.held.add(action);
  }

  release(action: InputAction): void {
    if (this.held.delete(action)) this.released.add(action);
  }

  tap(action: InputAction): void {
    this.pressed.add(action);
    this.released.add(action);
  }
  isHeld(action: InputAction): boolean { return this.held.has(action); }
  wasPressed(action: InputAction): boolean { return this.pressed.has(action); }
  wasReleased(action: InputAction): boolean { return this.released.has(action); }
  endStep(): void { this.pressed.clear(); this.released.clear(); }
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.clear();
  }
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clear);
    window.removeEventListener('pointerdown', this.onPointerDown);
  }
}
