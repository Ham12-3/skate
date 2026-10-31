import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { AssetLoader } from '../core/AssetLoader';
import { CONFIG } from '../core/config';

export type CharacterPose = 'idle' | 'roll' | 'push' | 'crouch' | 'air' | 'grab' | 'grind' | 'land' | 'bail';

export interface CharacterModel {
  readonly root: THREE.Group;
  setPose(pose: CharacterPose): void;
  update(dt: number, speed: number, balance: number, steering: number, lean: number): void;
}

class GeneratedCharacter implements CharacterModel {
  readonly root: THREE.Group;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current?: THREE.AnimationAction;
  private pose: CharacterPose = 'idle';

  constructor(assets: AssetLoader) {
    const gltf = assets.model('skater');
    this.root = new THREE.Group();
    const model = clone(gltf.scene);
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    gltf.animations.forEach((clip) => this.actions.set(clip.name, this.mixer.clipAction(clip)));
    this.setPose('idle');
  }

  setPose(pose: CharacterPose): void {
    if (pose === this.pose && this.current) return;
    this.pose = pose;
    const next = this.actions.get(pose) ?? this.actions.get('idle');
    if (!next) return;
    next.reset().setLoop(pose === 'land' || pose === 'bail' ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = true;
    next.fadeIn(CONFIG.character.animationBlend).play();
    if (this.current && this.current !== next) this.current.fadeOut(CONFIG.character.animationBlend);
    this.current = next;
  }

  update(dt: number, speed: number, balance: number, steering: number, lean: number): void {
    this.mixer.update(dt);
    const speedRatio = Math.min(speed / CONFIG.movement.absoluteMaxSpeed, 1);
    const chest = this.root.getObjectByName('chest');
    if (chest) {
      chest.rotation.x += lean;
      chest.rotation.z += this.pose === 'grind' ? balance * 0.22 : -steering * CONFIG.character.steeringLean * speedRatio;
    }
    const hips = this.root.getObjectByName('hips');
    if (hips && this.pose === 'roll') {
      hips.position.y = 0.92 - speedRatio * 0.08;
      hips.rotation.z -= steering * CONFIG.character.steeringLean * speedRatio * .35;
    }
  }
}

class FallbackCharacter implements CharacterModel {
  readonly root = new THREE.Group();
  private readonly bones = new Map<string, THREE.Object3D>();
  private readonly targets = new Map<string, THREE.Quaternion>();
  private pose: CharacterPose = 'idle';
  private time = 0;

  constructor() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xb97952 });
    const hoodie = new THREE.MeshStandardMaterial({ color: 0xf26923 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c222d });
    const hips = this.bone('hips', new THREE.Vector3(0,.92,0));
    const chest = this.bone('chest', new THREE.Vector3(0,.34,0), hips);
    const head = this.bone('head', new THREE.Vector3(0,.35,0), chest);
    this.part(chest, new THREE.BoxGeometry(.43,.43,.26), hoodie, new THREE.Vector3(0,-.06,0));
    this.part(head, new THREE.SphereGeometry(.15,12,8), skin, new THREE.Vector3());
    this.part(head, new THREE.SphereGeometry(.155,12,6,0,Math.PI*2,0,Math.PI/2), dark, new THREE.Vector3(0,.08,0));
    for (const [side, sign] of [['l',-1],['r',1]] as const) {
      const arm = this.bone(`upper_arm_${side}`, new THREE.Vector3(sign*.3,.1,0), chest);
      this.part(arm, new THREE.CapsuleGeometry(.075,.3,4,8), hoodie, new THREE.Vector3(0,-.18,0));
      const thigh = this.bone(`thigh_${side}`, new THREE.Vector3(sign*.12,-.04,0), hips);
      this.part(thigh, new THREE.CapsuleGeometry(.11,.55,4,8), dark, new THREE.Vector3(0,-.32,0));
      this.part(thigh, new THREE.BoxGeometry(.18,.12,.32), new THREE.MeshStandardMaterial({ color: 0xf0ead3 }), new THREE.Vector3(0,-.73,.08));
    }
    this.root.add(hips);
    this.root.traverse((object) => { if (object instanceof THREE.Mesh) object.castShadow = true; });
  }

  private bone(name: string, position: THREE.Vector3, parent?: THREE.Object3D): THREE.Object3D {
    const bone = new THREE.Object3D(); bone.name = name; bone.position.copy(position);
    parent?.add(bone); this.bones.set(name, bone); this.targets.set(name, new THREE.Quaternion()); return bone;
  }

  private part(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, position: THREE.Vector3): void {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.copy(position); parent.add(mesh);
  }

  setPose(pose: CharacterPose): void {
    this.pose = pose;
    const rotations: Partial<Record<CharacterPose, Record<string, number>>> = {
      crouch: { thigh_l: -.65, thigh_r: -.65 },
      air: { thigh_l: -.45, thigh_r: -.45 },
      grab: { upper_arm_r: -1.4, thigh_r: -.8 },
      grind: { thigh_l: -.3, thigh_r: -.3 },
      land: { thigh_l: -.8, thigh_r: -.8 },
      bail: { hips: 1.2 },
    };
    this.bones.forEach((bone, name) => {
      const x = rotations[pose]?.[name] ?? 0;
      const z = pose === 'grind' && name.startsWith('upper_arm') ? (name.endsWith('l') ? -1.35 : 1.35) : 0;
      this.targets.get(name)?.setFromEuler(new THREE.Euler(x,0,z));
      if (pose === 'push' && name === 'thigh_r') this.targets.get(name)?.setFromEuler(new THREE.Euler(-.6,0,0));
      if (!bone.parent) bone.quaternion.copy(this.targets.get(name)!);
    });
  }

  update(dt: number, _speed: number, balance: number): void {
    this.time += dt;
    const alpha = 1 - Math.exp(-dt / CONFIG.character.animationBlend);
    this.bones.forEach((bone, name) => bone.quaternion.slerp(this.targets.get(name)!, alpha));
    const chest = this.bones.get('chest')!;
    chest.scale.y = 1 + Math.sin(this.time * CONFIG.character.breathingSpeed) * .012;
    if (this.pose === 'grind') chest.rotation.z = balance * .22;
  }
}

export function createCharacter(assets: AssetLoader): CharacterModel {
  const source = assets.model('skater');
  return source.scene.getObjectByName('hips') ? new GeneratedCharacter(assets) : new FallbackCharacter();
}
