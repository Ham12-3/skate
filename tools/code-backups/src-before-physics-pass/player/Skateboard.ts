import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { AssetLoader } from '../core/AssetLoader';
import { CONFIG, type DeckChoice } from '../core/config';

export class Skateboard {
  readonly root = new THREE.Group();
  private readonly wheels: THREE.Object3D[] = [];
  private flipAngle = 0;
  private shoveAngle = 0;

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

  update(dt: number, speed: number, steering: number, grounded: boolean): void {
    this.wheels.forEach((wheel) => { wheel.rotation.y -= speed * dt / CONFIG.movement.wheelRadius; });
    this.root.rotation.x = THREE.MathUtils.lerp(this.root.rotation.x, grounded ? -steering * CONFIG.movement.boardSteerTilt : 0, .15);
    this.root.rotation.z = this.flipAngle;
    this.root.rotation.y = this.shoveAngle;
  }

  setFlipProgress(axis: 'roll' | 'yaw', radians: number): void {
    if (axis === 'roll') this.flipAngle = radians;
    else this.shoveAngle = radians;
  }

  resetTrickRotation(): void {
    this.flipAngle = 0;
    this.shoveAngle = 0;
    this.root.rotation.set(0,0,0);
  }
}
