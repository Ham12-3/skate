import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { AssetLoader } from '../core/AssetLoader';
import { CONFIG, type DeckChoice } from '../core/config';
import type { FlipType } from './TrickSystem';

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
// Underside of the tail tip: the point the board pivots on when the tail snaps the ground.
const TAIL_PIVOT = new THREE.Vector3(0, .03, -.4);
// Flips spin around the deck's long axis, not the wheel contact line.
const ROLL_CENTER = new THREE.Vector3(0, .12, 0);
const DECK_HALF_LENGTH = .4;
const DECK_SAMPLES = 41;

const smooth = (t: number): number => { const x = THREE.MathUtils.clamp(t, 0, 1); return x * x * (3 - 2 * x); };

export class Skateboard {
  readonly root = new THREE.Group();
  private readonly wheels: THREE.Object3D[] = [];
  private readonly deckProfile: number[] = [];
  private flipAngle = 0;
  private shoveAngle = 0;
  private flipLift = 0;
  private tilt = 0;
  private popTime = -1;
  private grabbing = false;
  private grabLift = 0;

  constructor(private readonly assets: AssetLoader) {
    const model = clone(assets.model('skateboard').scene);
    model.rotation.y = Math.PI / 2;
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        if (object.name.startsWith('wheel_')) this.wheels.push(object);
      }
    });
    this.root.add(model);
    this.sampleDeck();
  }

  // Deck top height along the board, so feet sit in the concave and up on the kicktail.
  deckHeight(z: number): number {
    const t = THREE.MathUtils.clamp((z + DECK_HALF_LENGTH) / (2 * DECK_HALF_LENGTH), 0, 1) * (DECK_SAMPLES - 1);
    const index = Math.floor(t);
    const next = Math.min(index + 1, DECK_SAMPLES - 1);
    return THREE.MathUtils.lerp(this.deckProfile[index]!, this.deckProfile[next]!, t - index);
  }

  private sampleDeck(): void {
    this.root.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    let last = .165;
    for (let i = 0; i < DECK_SAMPLES; i++) {
      const z = -DECK_HALF_LENGTH + i / (DECK_SAMPLES - 1) * DECK_HALF_LENGTH * 2;
      raycaster.set(new THREE.Vector3(0, 1, z), new THREE.Vector3(0, -1, 0));
      const hit = raycaster.intersectObject(this.root, true)[0];
      if (hit && hit.point.y > .08) last = hit.point.y;
      this.deckProfile.push(last);
    }
  }

  setDeck(choice: DeckChoice): void {
    const texture = this.assets.texture(`deck${choice}`);
    texture.repeat.set(1,1);
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh && (object.name === 'deck' || object.name === 'deck_top')) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((old) => old.dispose());
        object.material = new THREE.MeshStandardMaterial({ map: texture, roughness: .7 });
      }
    });
  }

  pop(): void { this.popTime = 0; }

  setGrab(active: boolean): void { this.grabbing = active; }

  update(dt: number, speed: number, steering: number, grounded: boolean): void {
    this.wheels.forEach((wheel) => { wheel.rotation.y -= speed * dt / CONFIG.movement.wheelRadius; });
    // Leaning on the trucks rolls the deck toward the inside of the turn.
    this.tilt = THREE.MathUtils.lerp(this.tilt, grounded ? -steering * CONFIG.movement.boardSteerTilt : 0, 1 - Math.exp(-10 * dt));
    this.grabLift = THREE.MathUtils.lerp(this.grabLift, this.grabbing ? CONFIG.animation.grabLift : 0, 1 - Math.exp(-12 * dt));
    let pitch = 0;
    if (this.popTime >= 0) {
      this.popTime += dt;
      const { popPitch, popRiseTime, popLevelTime } = CONFIG.animation;
      pitch = this.popTime < popRiseTime ? popPitch * smooth(this.popTime / popRiseTime) : popPitch * (1 - smooth((this.popTime - popRiseTime) / (popLevelTime - popRiseTime)));
      if (this.popTime >= popLevelTime) this.popTime = -1;
    }
    const yaw = new THREE.Quaternion().setFromAxisAngle(Y, this.shoveAngle);
    const pitchQ = new THREE.Quaternion().setFromAxisAngle(X, -pitch);
    const roll = new THREE.Quaternion().setFromAxisAngle(Z, this.flipAngle + this.tilt);
    this.root.quaternion.copy(yaw).multiply(pitchQ).multiply(roll);
    // Roll about the deck centre, pitch about the tail, yaw about the board's own vertical axis.
    const offset = ROLL_CENTER.clone().sub(ROLL_CENTER.clone().applyQuaternion(roll)).applyQuaternion(pitchQ)
      .add(TAIL_PIVOT).sub(TAIL_PIVOT.clone().applyQuaternion(pitchQ)).applyQuaternion(yaw);
    this.root.position.copy(offset).setY(offset.y + this.flipLift + this.grabLift);
  }

  // Fast flick, slow catch: the board decelerates as the feet come back down onto it.
  setFlip(type: FlipType, progress: number): void {
    const eased = 1 - (1 - progress) ** 2.2;
    if (type === 'shoveit') this.shoveAngle = eased * Math.PI;
    else this.flipAngle = eased * Math.PI * 2 * (type === 'kickflip' ? -1 : 1);
    this.flipLift = Math.sin(progress * Math.PI) * CONFIG.animation.flipLift;
  }

  resetTrickRotation(): void {
    this.flipAngle = 0;
    this.shoveAngle = 0;
    this.flipLift = 0;
  }
}
