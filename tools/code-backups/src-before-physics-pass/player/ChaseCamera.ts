import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { PhysicsWorld } from '../core/PhysicsWorld';

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private lookTarget = new THREE.Vector3();
  private shake = 0;
  distance:number = CONFIG.camera.distance;

  constructor(private readonly physics: PhysicsWorld) {
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.baseFov, innerWidth / innerHeight, .08, 700);
    window.addEventListener('resize', this.resize);
  }

  snap(position: THREE.Vector3, yaw: number): void {
    const forward = new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw));
    this.camera.position.copy(position).addScaledVector(forward, -this.distance).add(new THREE.Vector3(0,CONFIG.camera.height,0));
    this.lookTarget.copy(position).add(new THREE.Vector3(0,1,0));
    this.camera.lookAt(this.lookTarget);
  }

  update(dt: number, position: THREE.Vector3, yaw: number, speed: number): void {
    const normalizedSpeed = Math.min(Math.abs(speed) / CONFIG.movement.absoluteMaxSpeed, 1);
    const forward = new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw));
    const target = position.clone().add(new THREE.Vector3(0,1.05,0));
    const desiredDistance = this.distance + normalizedSpeed * CONFIG.camera.speedPullback;
    const desired = target.clone().addScaledVector(forward, -desiredDistance).add(new THREE.Vector3(0,CONFIG.camera.height,0));
    const rayDirection = desired.clone().sub(target);
    const length = rayDirection.length();
    rayDirection.normalize();
    const hit = this.physics.ray(target, rayDirection, length);
    if (hit) desired.copy(target).addScaledVector(rayDirection, Math.max(CONFIG.camera.minDistance, hit.distance - CONFIG.camera.collisionPadding));
    const positionAlpha = 1 - Math.exp(-CONFIG.camera.smoothing * dt);
    const lookAlpha = 1 - Math.exp(-CONFIG.camera.lookSmoothing * dt);
    this.camera.position.lerp(desired, positionAlpha);
    this.lookTarget.lerp(target, lookAlpha);
    if (this.shake > .001) {
      this.camera.position.add(new THREE.Vector3((Math.random()-.5)*this.shake,(Math.random()-.5)*this.shake,(Math.random()-.5)*this.shake));
      this.shake *= Math.exp(-CONFIG.camera.shakeDecay * dt);
    }
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, CONFIG.camera.baseFov + normalizedSpeed * CONFIG.camera.speedFovBoost, .08);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.lookTarget);
  }

  addShake(amount: number): void { this.shake = Math.max(this.shake, amount); }

  private resize = (): void => {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  };

  dispose(): void { window.removeEventListener('resize', this.resize); }
}
