import type { InputManager } from '../core/InputManager';
import type { CameraMode } from '../player/ChaseCamera';
import type { PlayerController } from '../player/PlayerController';

type ShotState = Record<string, number>;

export interface DemoShot {
  level: number;
  caption: string;
  camera: CameraMode;
  // Longest the shot runs; step() can end it sooner by returning true.
  duration: number;
  start?: { position: [number, number, number]; yaw: number };
  // Called every physics step with the time into the shot. Drives the controls the way a player would.
  step(t: number, player: PlayerController, input: InputManager, state: ShotState): boolean | void;
}

// Ollie a lip: push in, crouch from `crouchAt`, pop as the board reaches `popAt` (positions along -z),
// then optionally flip just after leaving the ground. Records the pop and landing times in state.
function lineUp(t: number, p: PlayerController, input: InputManager, s: ShotState, crouchAt: number, popAt: number, flip?: 'kickflip' | 'heelflip'): void {
  if (!s.popped) {
    if (p.position.z > crouchAt) input.hold('push');
    else { input.release('push'); input.hold('ollie'); }
    if (p.position.z < popAt && p.grounded) { input.release('ollie'); s.popped = t; }
    return;
  }
  if (flip && !s.flipped && !p.grounded && t - s.popped > .04) { input.tap(flip); s.flipped = 1; }
  if (!s.landed && p.grounded && t - s.popped > .2) s.landed = t;
}

// Grab while rising and through the top of the air, letting go well before touching down.
function grab(p: PlayerController, input: InputManager, rising: number, letGo: number): void {
  if (!p.grounded && p.verticalVelocity > rising) input.hold('grab');
  if (p.grounded || p.verticalVelocity < letGo) input.release('grab');
}

export const DEMO_SHOTS: DemoShot[] = [
  {
    level: 0, caption: 'KICKFLIP OFF THE STREET KICKER', camera: 'fisheye', duration: 9, start: { position: [0, .02, -14], yaw: Math.PI },
    step(t, p, input, s) {
      lineUp(t, p, input, s, -27.6, -33.35, 'kickflip');
      if (s.landed) input.hold('push');
      return s.landed > 0 && t - s.landed > 2.2;
    },
  },
  {
    level: 0, caption: '50-50 DOWN THE RAIL', camera: 'longlens', duration: 9, start: { position: [-2, .02, -40], yaw: Math.PI },
    step(t, p, input, s) {
      lineUp(t, p, input, s, -48.5, -53.5);
      if (p.grinds.active) s.grinding = 1;
      if (s.grinding && !p.grinds.active && p.grounded) { input.hold('push'); s.rolled ??= t; }
      return s.rolled !== undefined && t - s.rolled > 1.5;
    },
  },
  {
    level: 1, caption: 'VERT AIR · GRAB · REVERT', camera: 'fisheye', duration: 6.5, start: { position: [-30, 0, -12], yaw: Math.PI },
    step(t, p, input, s) {
      // Carry in the speed a few pumps would have built.
      if (!s.boosted && p.grounded && t > .4) { p.speed = 9.6; s.boosted = 1; }
      if (s.boosted) grab(p, input, 1.5, -.5);
    },
  },
  {
    level: 2, caption: 'PLAZA KICKFLIP', camera: 'longlens', duration: 9,
    step(t, p, input, s) {
      lineUp(t, p, input, s, 19.2, 13.45, 'kickflip');
      return s.landed > 0 && t - s.landed > .9;
    },
  },
  {
    level: 3, caption: 'ROOFTOP GAP', camera: 'fisheye', duration: 9,
    step(t, p, input, s) {
      lineUp(t, p, input, s, -15.8, -17.75);
      if (s.landed) input.hold('push');
      return s.landed > 0 && t - s.landed > 1.6;
    },
  },
  {
    level: 4, caption: 'MEGA RAMP · INDY GRAB', camera: 'longlens', duration: 14,
    step(t, p, input, s) {
      if (p.position.z < -14 && !s.popped && !input.isHeld('ollie')) input.hold('ollie');
      if (input.isHeld('ollie') && p.position.z < -22.7 && p.grounded) { input.release('ollie'); s.popped = t; }
      if (s.popped) grab(p, input, 1, -3);
      if (s.popped && !s.landed && p.grounded && t - s.popped > .5) s.landed = t;
      return s.landed > 0 && t - s.landed > 2.5;
    },
  },
];

// Plays the shots in a loop, feeding each one's scripted controls into the game.
export class DemoDirector {
  index = -1;
  private time = 0;
  private state: ShotState = {};

  get shot(): DemoShot { return DEMO_SHOTS[this.index]!; }

  next(): DemoShot {
    this.index = (this.index + 1) % DEMO_SHOTS.length;
    this.time = 0;
    this.state = {};
    return this.shot;
  }

  // Returns true when the current shot is over.
  step(dt: number, player: PlayerController, input: InputManager): boolean {
    this.time += dt;
    const finished = this.shot.step(this.time, player, input, this.state) === true;
    return finished || this.time >= this.shot.duration;
  }
}
