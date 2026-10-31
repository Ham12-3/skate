import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { PhysicsWorld } from '../core/PhysicsWorld';

// 'fisheye' and 'longlens' film the rider the way skate videos do; 'chase' is the classic game camera.
export type CameraMode = 'fisheye' | 'longlens' | 'chase';
export const CAMERA_MODES: CameraMode[] = ['fisheye', 'longlens', 'chase'];

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'fisheye';
  distance:number = CONFIG.camera.distance;
  private lookTarget = new THREE.Vector3();
  private shake = 0;
  private time = 0;
  // Filmer state: where they are, which way they are heading, and the ground they are riding on.
  private readonly filmer = new THREE.Vector3();
  private filmerHeading = 0;
  private groundY = 0;
  private readonly lastTarget = new THREE.Vector3();
  private readonly targetVelocity = new THREE.Vector3();

  constructor(private readonly physics: PhysicsWorld) {
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.baseFov, innerWidth / innerHeight, .08, 700);
    window.addEventListener('resize', this.resize);
  }

  snap(position: THREE.Vector3, yaw: number): void {
    const forward = new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw));
    this.filmerHeading = yaw;
    this.groundY = this.groundBelow(position) ?? position.y;
    this.lastTarget.copy(position);
    this.targetVelocity.set(0, 0, 0);
    if (this.mode === 'chase') {
      this.camera.position.copy(position).addScaledVector(forward, -this.distance).add(new THREE.Vector3(0,CONFIG.camera.height,0));
    } else {
      this.filmer.copy(this.filmerTarget(position, 0));
      this.camera.position.copy(this.filmer);
    }
    this.lookTarget.copy(position).add(new THREE.Vector3(0,1,0));
    this.camera.lookAt(this.lookTarget);
  }

  update(dt: number, position: THREE.Vector3, yaw: number, speed: number): void {
    if (dt <= 0) return;
    this.time += dt;
    this.targetVelocity.lerp(position.clone().sub(this.lastTarget).divideScalar(dt), damp(8, dt));
    this.lastTarget.copy(position);
    if (this.mode === 'chase') this.updateChase(dt, position, yaw, speed);
    else this.updateFilmer(dt, position, yaw, speed);
  }

  private updateChase(dt: number, position: THREE.Vector3, yaw: number, speed: number): void {
    const normalizedSpeed = Math.min(Math.abs(speed) / CONFIG.movement.feedbackSpeed, 1);
    const forward = new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw));
    const target = position.clone().add(new THREE.Vector3(0,1.05,0));
    const desiredDistance = this.distance + normalizedSpeed * CONFIG.camera.speedPullback;
    const desired = target.clone().addScaledVector(forward, -desiredDistance).add(new THREE.Vector3(0,CONFIG.camera.height,0));
    this.avoidWalls(target, desired);
    this.camera.position.lerp(desired, damp(CONFIG.camera.smoothing, dt));
    this.lookTarget.lerp(target, damp(CONFIG.camera.lookSmoothing, dt));
    this.applyShake(dt);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, CONFIG.camera.baseFov + normalizedSpeed * CONFIG.camera.speedFovBoost, .08);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.lookTarget);
  }

  // A filmer skating with the rider: behind and off to one side, holding the camera low, following the
  // line rather than every wiggle, and staying on the ground (tilting up) while the rider is in the air.
  private updateFilmer(dt: number, position: THREE.Vector3, yaw: number, speed: number): void {
    const rig = CONFIG.camera[this.mode as 'fisheye' | 'longlens'];
    const ground = this.groundBelow(position);
    if (ground !== undefined) this.groundY = THREE.MathUtils.lerp(this.groundY, ground, damp(CONFIG.camera.groundLag, dt));
    const horizontal = Math.hypot(this.targetVelocity.x, this.targetVelocity.z);
    const travelYaw = horizontal > 1 ? Math.atan2(this.targetVelocity.x, this.targetVelocity.z) : yaw;
    this.filmerHeading += wrapAngle(travelYaw - this.filmerHeading) * damp(rig.lag, dt);
    const desired = this.filmerTarget(position, Math.abs(speed));
    const target = position.clone().addScaledVector(UP, .8).addScaledVector(this.targetVelocity, .12);
    this.avoidWalls(target, desired);
    this.filmer.lerp(desired, damp(rig.follow, dt));
    // Never let the lens dip into the ground the filmer is standing on.
    const floor = this.groundBelow(this.filmer);
    if (floor !== undefined) this.filmer.y = Math.max(this.filmer.y, floor + .3);
    // Handheld: slow sway that never quite settles, plus a little bob from the filmer's own pushing.
    const t = this.time, sway = rig.handheld;
    const bob = Math.sin(t * 7.3) * .008 * Math.min(Math.abs(speed) / 6, 1) * sway;
    this.camera.position.copy(this.filmer).add(new THREE.Vector3(
      (Math.sin(t * 1.3 + 1.7) * .012 + Math.sin(t * 2.9) * .006) * sway,
      (Math.sin(t * 1.7 + .4) * .01 + Math.sin(t * 3.7 + 2.1) * .005) * sway + bob,
      (Math.sin(t * 1.1 + 3.1) * .012) * sway));
    this.lookTarget.lerp(target, damp(rig.look, dt));
    this.applyShake(dt);
    const speedRatio = Math.min(Math.abs(speed) / CONFIG.movement.feedbackSpeed, 1);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, rig.fov + speedRatio * rig.speedFov, damp(4, dt));
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.lookTarget);
    this.camera.rotateZ((Math.sin(t * .9 + .6) * .006 + Math.sin(t * 2.3) * .003) * sway);
  }

  private filmerTarget(position: THREE.Vector3, speed: number): THREE.Vector3 {
    const rig = CONFIG.camera[this.mode === 'longlens' ? 'longlens' : 'fisheye'];
    const forward = new THREE.Vector3(Math.sin(this.filmerHeading), 0, Math.cos(this.filmerHeading));
    const side = new THREE.Vector3().crossVectors(forward, UP);
    // At speed the filmer can't keep quite as close.
    const behind = rig.behind * (1 + Math.min(speed, 15) * .025);
    return position.clone().addScaledVector(forward, -behind).addScaledVector(side, rig.side).setY(this.groundY + rig.height);
  }

  private groundBelow(position: THREE.Vector3): number | undefined {
    return this.physics.ray(position.clone().addScaledVector(UP, .5), DOWN, 40)?.point.y;
  }

  // Pull the camera in front of anything between it and the rider.
  private avoidWalls(target: THREE.Vector3, desired: THREE.Vector3): void {
    const direction = desired.clone().sub(target);
    const length = direction.length();
    if (length < 1e-3) return;
    direction.divideScalar(length);
    const hit = this.physics.ray(target, direction, length);
    if (hit) desired.copy(target).addScaledVector(direction, Math.max(Math.min(CONFIG.camera.minDistance, length), hit.distance - CONFIG.camera.collisionPadding));
  }

  private applyShake(dt: number): void {
    if (this.shake <= .001) return;
    this.camera.position.add(new THREE.Vector3((Math.random()-.5)*this.shake,(Math.random()-.5)*this.shake,(Math.random()-.5)*this.shake));
    this.shake *= Math.exp(-CONFIG.camera.shakeDecay * dt);
  }

  addShake(amount: number): void { this.shake = Math.max(this.shake, amount); }

  private resize = (): void => {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  };

  dispose(): void { window.removeEventListener('resize', this.resize); }
}
