import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { EventBus } from '../core/EventBus';
import type { InputManager } from '../core/InputManager';
import type { Grindable } from '../levels/LevelTypes';
import type { ComboSystem } from './ComboSystem';

export class GrindSystem {
  active = false;
  balance = 0;
  rail?: Grindable;
  private elapsed = 0;
  private noiseTimer = 0;
  private noise = 0;
  private direction = 1;
  private boardslide = false;
  private scoreRemainder = 0;

  constructor(private readonly combo: ComboSystem, private readonly events: EventBus) {}

  // Snap to the closest point on a tagged edge, then preserve travel direction along its axis.
  tryStart(position: THREE.Vector3, boardYaw: number, velocity: THREE.Vector3, grindables: Grindable[]): boolean {
    const horizontalVelocity = new THREE.Vector3(velocity.x, 0, velocity.z);
    const speed = horizontalVelocity.length();
    if (this.active || speed < CONFIG.grind.minimumSpeed) return false;
    let best: { rail: Grindable; point: THREE.Vector3; distance: number } | undefined;
    const closest = new THREE.Vector3();
    for (const rail of grindables) {
      const segment = new THREE.Vector3().subVectors(rail.end, rail.start);
      // You can't lock onto a rail you are crossing rather than travelling along.
      if (Math.abs(horizontalVelocity.dot(segment.clone().normalize())) < speed * CONFIG.grind.minimumAlignment) continue;
      const t = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(position, rail.start).dot(segment) / segment.lengthSq(), 0, 1);
      closest.copy(rail.start).addScaledVector(segment, t);
      const horizontal = Math.hypot(position.x - closest.x, position.z - closest.z);
      const vertical = position.y - closest.y;
      const distance = horizontal + Math.abs(vertical) * .4;
      if (horizontal <= CONFIG.grind.snapHorizontalDistance && vertical >= -.2 && vertical <= CONFIG.grind.snapVerticalDistance && (!best || distance < best.distance)) {
        best = { rail, point: closest.clone(), distance };
      }
    }
    if (!best) return false;
    position.copy(best.point).add(new THREE.Vector3(0,.12,0));
    this.rail = best.rail;
    const railDirection = new THREE.Vector3().subVectors(best.rail.end, best.rail.start).normalize();
    const forward = new THREE.Vector3(Math.sin(boardYaw),0,Math.cos(boardYaw));
    this.direction = horizontalVelocity.dot(railDirection) >= 0 ? 1 : -1;
    this.active = true;
    this.balance = 0;
    this.elapsed = 0;
    this.noiseTimer = 0;
    this.scoreRemainder = 0;
    const alignment = Math.abs(forward.dot(railDirection));
    this.boardslide = alignment <= .7;
    const name = this.boardslide ? 'Boardslide' : '50-50';
    this.combo.addTrick(name, 0, 'grind');
    this.events.emit('grind', { active: true, balance: 0, material: best.rail.material });
    return true;
  }

  update(dt: number, input: InputManager, position: THREE.Vector3, speed: number): { exit: boolean; bail: boolean; yaw: number; speed: number; direction: THREE.Vector3 } {
    if (!this.rail) return { exit: true, bail: false, yaw: 0, speed, direction: new THREE.Vector3() };
    this.elapsed += dt;
    this.noiseTimer -= dt;
    if (this.noiseTimer <= 0) {
      this.noiseTimer = CONFIG.grind.balanceNoiseInterval;
      this.noise = (Math.random() * 2 - 1) * CONFIG.grind.balanceDrift;
    }
    const correction = ((input.isHeld('right') ? 1 : 0) - (input.isHeld('left') ? 1 : 0)) * CONFIG.grind.balanceCorrection;
    this.balance += (this.noise * (1 + this.elapsed * CONFIG.grind.balanceDurationRamp * 10) + correction * -1) * dt;
    this.balance = THREE.MathUtils.clamp(this.balance, -1, 1);
    this.scoreRemainder += CONFIG.grind.scorePerSecond * dt;
    if (this.scoreRemainder >= 1) {
      const points = Math.floor(this.scoreRemainder);
      this.combo.addPoints(points);
      this.scoreRemainder -= points;
    }
    const railDirection = new THREE.Vector3().subVectors(this.rail.end, this.rail.start).normalize();
    const direction = railDirection.clone().multiplyScalar(this.direction);
    // Sliding friction always slows the grind; gravity speeds it up down a slope and drains it going up.
    const friction = (this.rail.material === 'metal' ? CONFIG.grind.metalFriction : CONFIG.grind.concreteFriction) * (this.boardslide ? CONFIG.grind.boardslideFrictionScale : 1);
    const nextSpeed = Math.max(0, Math.abs(speed) + CONFIG.physics.gravity * (direction.y + friction) * dt);
    position.addScaledVector(direction, nextSpeed * dt);
    const segment = new THREE.Vector3().subVectors(this.rail.end, this.rail.start);
    const t = new THREE.Vector3().subVectors(position, this.rail.start).dot(segment) / segment.lengthSq();
    const exit = t <= 0 || t >= 1 || input.wasPressed('ollie') || nextSpeed < CONFIG.grind.stallSpeed;
    const bail = Math.abs(this.balance) >= .99;
    const travelYaw = Math.atan2(railDirection.x * this.direction, railDirection.z * this.direction);
    const yaw = travelYaw + (!exit && this.boardslide ? Math.PI / 2 : 0);
    this.events.emit('grind', { active: true, balance: this.balance, material: this.rail.material });
    if (exit || bail) this.stop();
    return { exit, bail, yaw, speed: nextSpeed, direction };
  }

  stop(): void {
    this.active = false;
    this.rail = undefined;
    this.events.emit('grind', { active: false, balance: 0, material: 'metal' });
  }

  reset(): void { this.stop(); this.balance = 0; this.elapsed = 0; }
}
