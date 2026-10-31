import type { EventBus } from '../core/EventBus';
import { CONFIG } from '../core/config';

export class ComboSystem {
  score = 0;
  multiplier = 0;
  bestMultiplier = 0;
  private trickScore = 0;
  private names: string[] = [];
  private groundedTime = 0;

  constructor(private readonly events: EventBus) {}

  addTrick(name: string, baseScore: number, icon: string): void {
    this.names.push(name);
    this.multiplier++;
    this.bestMultiplier = Math.max(this.bestMultiplier, this.multiplier);
    this.trickScore += baseScore;
    this.groundedTime = 0;
    this.events.emit('trick', { name, icon });
    this.publish();
  }

  addPoints(points: number): void {
    if (this.multiplier === 0) {
      this.score += points;
    } else {
      this.trickScore += points;
      this.publish();
    }
  }

  update(dt: number, grounded: boolean, canBank: boolean): void {
    if (this.multiplier === 0) return;
    if (grounded && canBank) this.groundedTime += dt;
    else this.groundedTime = 0;
    if (this.groundedTime >= CONFIG.combo.bankDelay) this.bank();
  }

  // Only banked points survive: bailing clears the chain before this multiplier is applied.
  private bank(): void {
    const points = Math.round(this.trickScore * this.multiplier);
    this.score += points;
    this.events.emit('bank', { points });
    this.clearChain();
    this.publish();
  }

  bail(): void { this.clearChain(); this.publish(); }

  private clearChain(): void {
    this.names = [];
    this.trickScore = 0;
    this.multiplier = 0;
    this.groundedTime = 0;
  }

  reset(): void {
    this.score = 0;
    this.bestMultiplier = 0;
    this.clearChain();
    this.publish();
  }

  private publish(): void {
    const chain = this.names.length ? `${this.names.join(' + ')} x${this.multiplier}` : '';
    this.events.emit('score', { score: Math.round(this.score), chain, multiplier: this.multiplier, pending: Math.round(this.trickScore * this.multiplier) });
  }
}
