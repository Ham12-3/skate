import { CONFIG } from './config';

export class GameLoop {
  private accumulator = 0;
  private previousTime = 0;
  private animationFrame = 0;
  private running = false;
  timeScale = 1;

  constructor(
    private readonly fixedUpdate: (dt: number) => void,
    private readonly render: (alpha: number, frameDelta: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.previousTime = performance.now() / 1000;
    const tick = (milliseconds: number): void => {
      if (!this.running) return;
      const now = milliseconds / 1000;
      const frameDelta = Math.min(CONFIG.physics.maxFrameDelta, Math.max(0, now - this.previousTime));
      this.previousTime = now;
      this.accumulator += frameDelta * this.timeScale;
      while (this.accumulator >= CONFIG.physics.fixedStep) {
        this.fixedUpdate(CONFIG.physics.fixedStep);
        this.accumulator -= CONFIG.physics.fixedStep;
      }
      this.render(this.accumulator / CONFIG.physics.fixedStep, frameDelta);
      this.animationFrame = requestAnimationFrame(tick);
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
  }
}
