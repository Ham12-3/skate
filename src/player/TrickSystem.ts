import { CONFIG } from '../core/config';
import type { InputManager } from '../core/InputManager';
import type { ComboSystem } from './ComboSystem';
import type { Skateboard } from './Skateboard';

export type FlipType = 'kickflip' | 'heelflip' | 'shoveit';

export class TrickSystem {
  private flip?: { type: FlipType; elapsed: number; duration: number };
  private spinRadians = 0;
  private grabTime = 0;
  private grabRegistered = false;
  grabbing = false;

  constructor(private readonly board: Skateboard, private readonly combo: ComboSystem) {}

  start(input: InputManager): void {
    this.checkFlipInput(input);
    this.grabbing = input.isHeld('grab');
    this.spinRadians = 0;
    this.grabTime = 0;
    this.grabRegistered = false;
  }

  private checkFlipInput(input: InputManager): void {
    if (this.flip) return;
    if (input.wasPressed('kickflip')) this.beginFlip('kickflip', CONFIG.tricks.kickflipDuration, CONFIG.tricks.kickflipScore);
    else if (input.wasPressed('heelflip')) this.beginFlip('heelflip', CONFIG.tricks.heelflipDuration, CONFIG.tricks.heelflipScore);
    else if (input.wasPressed('shoveit')) this.beginFlip('shoveit', CONFIG.tricks.shoveitDuration, CONFIG.tricks.shoveitScore);
  }

  private beginFlip(type: FlipType, duration: number, score: number): void {
    this.flip = { type, duration, elapsed: 0 };
    const label = type === 'shoveit' ? 'Pop Shove-It' : type === 'kickflip' ? 'Kickflip' : 'Heelflip';
    this.combo.addTrick(label, score, type);
  }

  update(dt: number, input: InputManager): void {
    this.checkFlipInput(input);
    if (this.flip) {
      this.flip.elapsed += dt;
      const progress = Math.min(1, this.flip.elapsed / this.flip.duration);
      this.board.setFlip(this.flip.type, progress);
      if (progress >= 1) {
        this.flip = undefined;
        this.board.resetTrickRotation();
      }
    }
    const spin = (input.isHeld('spinRight') ? 1 : 0) - (input.isHeld('spinLeft') ? 1 : 0);
    this.spinRadians += spin * THREE_SPIN_RATE * dt;
    this.grabbing = input.isHeld('grab');
    if (this.grabbing) {
      this.grabTime += dt;
      if (this.grabTime >= CONFIG.tricks.grabTickDuration) {
        this.grabTime -= CONFIG.tricks.grabTickDuration;
        if (!this.grabRegistered) {
          this.combo.addTrick('Grab', CONFIG.tricks.grabTickScore, 'grab');
          this.grabRegistered = true;
        } else this.combo.addPoints(CONFIG.tricks.grabTickScore);
      }
    }
  }

  get spinAngle(): number { return this.spinRadians; }
  get isFlipping(): boolean { return Boolean(this.flip); }
  get flipState(): { type: FlipType; progress: number } | undefined {
    return this.flip ? { type: this.flip.type, progress: Math.min(1, this.flip.elapsed / this.flip.duration) } : undefined;
  }

  land(): { valid: boolean; reason: string } {
    if (this.flip) return { valid: false, reason: 'Trick incomplete' };
    if (this.grabbing) return { valid: false, reason: 'Grab held on landing' };
    const degrees = Math.abs(THREE_RAD_TO_DEG * this.spinRadians);
    const spins = [540,360,180].find((amount) => degrees >= amount - 25);
    if (spins) {
      const score = spins === 540 ? CONFIG.tricks.spin540Score : spins === 360 ? CONFIG.tricks.spin360Score : CONFIG.tricks.spin180Score;
      this.combo.addTrick(`${spins} Spin`, score, 'spin');
    }
    this.reset();
    return { valid: true, reason: '' };
  }

  reset(): void {
    this.flip = undefined;
    this.spinRadians = 0;
    this.grabTime = 0;
    this.grabRegistered = false;
    this.grabbing = false;
    this.board.resetTrickRotation();
  }
}

const THREE_SPIN_RATE = CONFIG.tricks.spinDegreesPerSecond * Math.PI / 180;
const THREE_RAD_TO_DEG = 180 / Math.PI;
