import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { AssetLoader } from '../core/AssetLoader';
import { CONFIG } from '../core/config';
import type { PhysicsWorld } from '../core/PhysicsWorld';
import { Ragdoll, type RagdollJoint, type RagdollSegment } from './Ragdoll';
import type { Skateboard } from './Skateboard';
import type { FlipType } from './TrickSystem';

export type CharacterPose = 'idle' | 'roll' | 'push' | 'crouch' | 'air' | 'grab' | 'grind' | 'land' | 'bail';
export type Stance = 'regular' | 'goofy';

export interface SkaterMotion {
  speed: number;
  // Signed carve load (lateral acceleration / grip limit); positive turns toward board +x.
  carve: number;
  lean: number;
  balance: number;
  crouch: number;
  // 0..1 through a push stroke, -1 when not pushing.
  pushPhase: number;
  airTime: number;
  verticalSpeed: number;
  flip?: { type: FlipType; progress: number };
  grabbing: boolean;
}

export interface CharacterModel {
  readonly root: THREE.Group;
  setPose(pose: CharacterPose): void;
  setStance(stance: Stance): void;
  resetRoot(): void;
  land(impact: number): void;
  update(dt: number, motion: SkaterMotion): void;
  // Hand the body (and board) to physics for a bail; returns false if this model can't ragdoll.
  startRagdoll(physics: PhysicsWorld, velocity: THREE.Vector3, tripped: boolean): boolean;
  stopRagdoll(): void;
  ragdollFocus(target: THREE.Vector3): boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const damp = (current: number, target: number, rate: number, dt: number): number => THREE.MathUtils.lerp(current, target, 1 - Math.exp(-rate * dt));
const smooth = (t: number): number => { const x = THREE.MathUtils.clamp(t, 0, 1); return x * x * (3 - 2 * x); };
// Rises over [start, peak] and falls back to zero by end.
const bump = (t: number, start: number, peak: number, end: number): number => t < peak ? smooth((t - start) / (peak - start)) : 1 - smooth((t - peak) / (end - peak));

interface Limb {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  end: THREE.Object3D;
  upperLength: number;
  lowerLength: number;
  // Which side of the model the limb is on (+1 = model +x).
  side: number;
  front: boolean;
}

interface Leg extends Limb {
  // Ankle joint to the bottom centre of the sole, in model space at rest.
  soleOffset: THREE.Vector3;
}

// Procedural skater: every frame the pose is rebuilt from the rest pose, driven by the physics state,
// with two-bone IK keeping the feet on the deck and reaching the hands for grabs.
class ProceduralSkater implements CharacterModel {
  readonly root = new THREE.Group();
  private readonly model: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly bailAction?: THREE.AnimationAction;
  private readonly rest = new Map<THREE.Object3D, { position: THREE.Vector3; quaternion: THREE.Quaternion }>();
  private readonly restModelQuaternion = new Map<THREE.Object3D, THREE.Quaternion>();
  private readonly hips: THREE.Object3D;
  private readonly spine: THREE.Object3D;
  private readonly chest: THREE.Object3D;
  private readonly neck: THREE.Object3D;
  private readonly head: THREE.Object3D;
  private readonly legs: Leg[];
  private readonly arms: Limb[];
  private stanceAngle = -Math.PI / 2;
  private pose: CharacterPose = 'idle';
  private time = 0;
  private crouch = 0;
  private setup = 0;
  private tuck = 0;
  private push = 0;
  private grind = 0;
  private grab = 0;
  private armRaise = .22;
  private armSwing = .08;
  private armBend = .35;
  private compression = 0;
  private compressionVelocity = 0;
  private ragdoll?: Ragdoll;
  private readonly clips = new Map<CharacterPose, THREE.AnimationAction>();
  private activeClip?: THREE.AnimationAction;

  constructor(assets: AssetLoader, private readonly board: Skateboard) {
    const gltf = assets.model('skater');
    this.model = clone(gltf.scene);
    this.model.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        // The procedural pose moves limbs well away from the bind-pose bounds.
        object.frustumCulled = false;
      }
    });
    this.root.add(this.model);
    this.root.updateMatrixWorld(true);
    this.attachLooseParts();
    this.model.traverse((object) => {
      if ((object as THREE.Bone).isBone) {
        this.rest.set(object, { position: object.position.clone(), quaternion: object.quaternion.clone() });
        this.restModelQuaternion.set(object, object.getWorldQuaternion(new THREE.Quaternion()));
      }
    });
    const bone = (name: string): THREE.Object3D => {
      const found = this.model.getObjectByName(name);
      if (!found) throw new Error(`Skater bone missing: ${name}`);
      return found;
    };
    this.hips = bone('hips'); this.spine = bone('spine'); this.chest = bone('chest'); this.neck = bone('neck'); this.head = bone('head');
    const limb = (upper: string, lower: string, end: string): Limb => {
      const upperBone = bone(upper), lowerBone = bone(lower), endBone = bone(end);
      return {
        upper: upperBone, lower: lowerBone, end: endBone,
        upperLength: lowerBone.position.length(), lowerLength: endBone.position.length(),
        side: Math.sign(upperBone.getWorldPosition(new THREE.Vector3()).x), front: false,
      };
    };
    this.legs = (['l', 'r'] as const).map((side) => {
      const leg = limb(`thigh_${side}`, `shin_${side}`, `foot_${side}`);
      return { ...leg, soleOffset: this.measureSole(leg.end, leg.side) };
    });
    this.arms = (['l', 'r'] as const).map((side) => limb(`upper_arm_${side}`, `forearm_${side}`, `hand_${side}`));
    this.mixer = new THREE.AnimationMixer(this.model);
    const bail = gltf.animations.find((clip) => clip.name === 'bail');
    if (bail) {
      this.bailAction = this.mixer.clipAction(bail);
      this.bailAction.setLoop(THREE.LoopOnce, 1);
      this.bailAction.clampWhenFinished = true;
    }
    this.loadMocap(assets.mocapClips);
    this.setStance('regular');
  }

  private loadMocap(sources: THREE.AnimationClip[]): void {
    const poses: CharacterPose[] = ['idle', 'roll', 'push', 'crouch', 'air', 'grab', 'grind', 'land'];
    for (const source of sources) {
      const pose = source.name as CharacterPose;
      if (!poses.includes(pose)) continue;
      // Rotations only: the game places the hips over the board itself.
      const clip = new THREE.AnimationClip(source.name, source.duration, source.tracks.filter((track) => track.name.endsWith('.quaternion')));
      const action = this.mixer.clipAction(clip);
      action.setLoop(pose === 'land' ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = true;
      this.clips.set(pose, action);
    }
  }

  // Recorded motion for the current state drives the hips' twist, spine, head and arms; the hips'
  // placement, carve lean, feet on the deck and grabs still come from the physics. False if no clip.
  private playMocap(dt: number, pushPhase: number): boolean {
    const clip = this.clips.get(this.pose);
    if (clip !== this.activeClip) {
      if (clip) {
        clip.reset().play();
        if (this.activeClip) clip.crossFadeFrom(this.activeClip, CONFIG.character.animationBlend, false);
      } else this.activeClip?.stop();
      this.activeClip = clip;
    }
    if (!clip) return false;
    // A push clip follows the actual push stroke, so the foot plant lines up with the speed boost.
    if (this.pose === 'push' && pushPhase >= 0) { clip.timeScale = 0; clip.time = pushPhase * clip.getClip().duration; }
    this.mixer.update(dt);
    return true;
  }

  // Some accessory meshes (toes, laces, eyes, pockets) were exported without skin weights and would
  // stay frozen in the rest pose; pin each one to the bone it belongs to.
  private attachLooseParts(): void {
    const loose: THREE.Mesh[] = [];
    this.model.traverse((object) => { if (object instanceof THREE.Mesh && !(object as THREE.SkinnedMesh).isSkinnedMesh) loose.push(object); });
    for (const mesh of loose) {
      const side = /_([lr])\d*$/.exec(mesh.name)?.[1];
      const bone = /iris|nose|lip|eye|brow|ear|cap/i.test(mesh.name) ? 'head'
        : side && /toe|lace|trainer|sole/i.test(mesh.name) ? `foot_${side}`
        : side && /pocket/i.test(mesh.name) ? `thigh_${side}`
        : /kangaroo/i.test(mesh.name) ? 'spine' : 'chest';
      this.model.getObjectByName(bone)?.attach(mesh);
    }
  }

  private measureSole(foot: THREE.Object3D, side: number): THREE.Vector3 {
    const ankle = foot.getWorldPosition(new THREE.Vector3());
    const bounds = new THREE.Box3();
    this.model.traverse((object) => {
      if (object instanceof THREE.Mesh && /sole/i.test(object.name)) {
        const box = new THREE.Box3().setFromBufferAttribute(object.geometry.getAttribute('position') as THREE.BufferAttribute).applyMatrix4(object.matrixWorld);
        if (Math.sign(box.getCenter(new THREE.Vector3()).x) === side) bounds.union(box);
      }
    });
    if (bounds.isEmpty()) return new THREE.Vector3(0, -.11, .065);
    const centre = bounds.getCenter(new THREE.Vector3());
    return new THREE.Vector3(centre.x, bounds.min.y, centre.z).sub(ankle);
  }

  // Skaters ride sideways: regular leads with the left foot, goofy with the right.
  setStance(stance: Stance): void {
    this.stanceAngle = stance === 'regular' ? -Math.PI / 2 : Math.PI / 2;
    // Model +x maps to board z = -x·sin(stance); the limb that ends up toward the nose leads.
    for (const limb of [...this.legs, ...this.arms]) limb.front = -limb.side * Math.sin(this.stanceAngle) > 0;
    if (this.pose !== 'bail') this.resetRoot();
  }

  resetRoot(): void {
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, this.stanceAngle, 0);
  }

  setPose(pose: CharacterPose): void {
    if (pose === this.pose) return;
    const previous = this.pose;
    this.pose = pose;
    if (pose === 'bail') { this.activeClip?.stop(); this.activeClip = undefined; this.bailAction?.reset().play(); }
    else if (previous === 'bail') this.bailAction?.stop();
  }

  land(impact: number): void {
    this.compressionVelocity += impact * CONFIG.animation.landingImpactScale;
  }

  update(dt: number, motion: SkaterMotion): void {
    this.time += dt;
    if (this.pose === 'bail') {
      if (this.ragdoll) this.ragdoll.sync();
      else this.mixer.update(dt);
      return;
    }
    const frame = this.root.parent;
    if (!frame) return;
    const A = CONFIG.animation;
    const airborne = this.pose === 'air' || this.pose === 'grab';
    const grinding = this.pose === 'grind';
    const pushing = motion.pushPhase >= 0;

    this.crouch = damp(this.crouch, motion.crouch, 14, dt);
    this.setup = damp(this.setup, motion.crouch > 0 || airborne ? 1 : 0, 12, dt);
    // Legs drive the pop, tuck up at the top of the air, then reach for the landing.
    this.tuck = damp(this.tuck, airborne ? motion.airTime < .06 ? 0 : motion.verticalSpeed > -2.5 ? 1 : .45 : 0, 12, dt);
    this.push = damp(this.push, pushing ? 1 : 0, 12, dt);
    this.grind = damp(this.grind, grinding ? 1 : 0, 10, dt);
    this.grab = damp(this.grab, motion.grabbing && airborne ? 1 : 0, 14, dt);
    const stiffness = A.landingStiffness, damping = 2 * Math.sqrt(stiffness) * A.landingDamping;
    this.compressionVelocity += (-stiffness * this.compression - damping * this.compressionVelocity) * dt;
    this.compression = THREE.MathUtils.clamp(this.compression + this.compressionVelocity * dt, -.05, A.maxCompression);
    let raise = airborne ? .85 : grinding ? 1.3 : .22, swing = airborne ? .15 : grinding ? 0 : .08, bend = airborne ? .45 : grinding ? .25 : .35;
    raise += this.crouch * .15; swing += this.crouch * .45; bend += this.crouch * .4;
    this.armRaise = damp(this.armRaise, raise, 8, dt); this.armSwing = damp(this.armSwing, swing, 8, dt); this.armBend = damp(this.armBend, bend, 8, dt);

    this.rest.forEach((rest, bone) => { bone.position.copy(rest.position); bone.quaternion.copy(rest.quaternion); });
    const mocap = this.playMocap(dt, motion.pushPhase);
    frame.updateMatrixWorld(true);
    const frameQuaternion = frame.getWorldQuaternion(new THREE.Quaternion());
    const boardQuaternion = this.board.root.getWorldQuaternion(new THREE.Quaternion());
    const up = UP.clone().applyQuaternion(frameQuaternion);
    const forward = FORWARD.clone().applyQuaternion(frameQuaternion);
    const toeLocal = new THREE.Vector3(Math.sin(this.stanceAngle), 0, Math.cos(this.stanceAngle));
    const toe = toeLocal.clone().applyQuaternion(frameQuaternion);
    // Rotating the chest from the toe side toward the nose is +yaw for regular, -yaw for goofy.
    const openSign = this.stanceAngle < 0 ? 1 : -1;

    // --- Feet targets (board space): where each sole should be and which way the toes point.
    const pushPhase = Math.max(0, motion.pushPhase);
    const slide = airborne ? A.ollieSlide * bump(motion.airTime, .04, .16, .38) : 0;
    const frontZ = THREE.MathUtils.lerp(A.frontFootZ, A.ollieFrontFootZ, this.setup) + slide;
    const backZ = THREE.MathUtils.lerp(A.backFootZ, A.ollieBackFootZ, this.setup);
    const flip = motion.flip;
    const flipDetach = flip ? smooth(flip.progress / .22) * (1 - smooth((flip.progress - .72) / .24)) : 0;
    const pushContact = pushing ? bump(pushPhase, A.pushContactStart * .5, (A.pushContactStart + A.pushContactEnd) / 2, A.pushContactEnd + .2) : 0;
    const deckCentre = this.board.deckHeight(0);

    // --- Hips: ride height, folding at the waist, and leaning into the carve over the feet.
    const speedFactor = THREE.MathUtils.clamp(motion.speed / 4, 0, 1);
    const height = THREE.MathUtils.lerp(A.standHeight, A.rideHeight, speedFactor) - THREE.MathUtils.clamp((motion.speed - 8) / 8, 0, 1) * A.speedTuck
      - this.crouch * A.crouchDrop - this.tuck * A.tuckDrop - pushContact * A.pushDrop * this.push - this.compression - this.grab * .08;
    const fold = .12 + this.crouch * .45 + this.tuck * .35 + this.push * .15 + Math.max(0, this.compression) * 1.2 + this.grab * .3;
    const lean = motion.carve * A.maxCarveLean * (airborne ? 0 : 1) * (1 - this.grind) + motion.balance * .35 * this.grind;
    const hipLocal = new THREE.Vector3(Math.sin(lean) * height, deckCentre + height * Math.cos(lean), (frontZ + backZ) / 2 + this.push * .08)
      .addScaledVector(toeLocal, -(.03 + fold * .12));
    this.hips.position.copy(this.hips.parent!.worldToLocal(frame.localToWorld(hipLocal)));
    this.hips.updateMatrixWorld(true);
    const hipYaw = A.hipOpen + this.push * A.pushOpen * .6;
    const chestYaw = A.shoulderOpen - A.hipOpen + this.push * A.pushOpen * .4;
    this.rotate(this.hips, forward, -lean);
    if (!mocap) {
      this.rotate(this.hips, up, openSign * hipYaw);
      const facing = toe.clone().applyAxisAngle(up, openSign * hipYaw);
      const foldAxis = new THREE.Vector3().crossVectors(up, facing).normalize();
      this.rotate(this.hips, foldAxis, fold * .35);
      this.rotate(this.spine, foldAxis, fold * .35);
      this.rotate(this.chest, up, openSign * chestYaw);
      this.rotate(this.chest, foldAxis, fold * .3 + Math.sin(this.time * CONFIG.character.breathingSpeed) * .015);
      // Accelerating pitches the chest toward the nose, braking rocks it back.
      this.rotate(this.chest, new THREE.Vector3().crossVectors(up, forward).normalize(), motion.lean);
      // Head turns to watch the line, and tips back up so the eyes stay level as the body folds.
      const headYaw = openSign * (Math.PI / 2 - hipYaw - chestYaw) * A.headLook;
      this.rotate(this.neck, up, headYaw * .35);
      this.rotate(this.neck, foldAxis, -fold * .5);
      this.rotate(this.head, up, headYaw * .65);
    }

    // --- Legs.
    for (const leg of this.legs) {
      const z = leg.front ? frontZ : backZ;
      let footAngle = THREE.MathUtils.degToRad(leg.front ? A.frontFootAngle : A.backFootAngle);
      const attached = this.board.root.localToWorld(new THREE.Vector3(0, this.board.deckHeight(z), z));
      let sole = attached;
      let detach = 0;
      if (flipDetach > 0) {
        // Kickflips flick off the heel edge, heelflips off the toe edge; shove-its just jump the board.
        const flick = flip!.type === 'kickflip' ? -1 : flip!.type === 'heelflip' ? 1 : 0;
        const free = frame.localToWorld(new THREE.Vector3(0, deckCentre + (leg.front ? .3 : .27), z + (leg.front ? .05 : .04)).addScaledVector(toeLocal, leg.front ? flick * .2 : 0));
        sole = attached.clone().lerp(free, flipDetach);
        detach = flipDetach;
      }
      if (leg.front) footAngle = THREE.MathUtils.lerp(footAngle, THREE.MathUtils.degToRad(75), this.push);
      else if (this.push > .001) {
        const path = this.pushFootPath(pushPhase, backZ, toeLocal);
        sole = sole.clone().lerp(frame.localToWorld(path), this.push);
        const onGround = pushPhase > .05 && pushPhase < .9 ? this.push : 0;
        footAngle = THREE.MathUtils.lerp(footAngle, THREE.MathUtils.degToRad(60), onGround);
        detach = Math.max(detach, onGround);
      }
      const footDirection = toeLocal.clone().multiplyScalar(Math.cos(footAngle)).addScaledVector(FORWARD, Math.sin(footAngle));
      const footYaw = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(footDirection.x, footDirection.z));
      const restFoot = this.restModelQuaternion.get(leg.end)!;
      const footFrame = boardQuaternion.clone().slerp(frameQuaternion, detach).multiply(footYaw);
      const footWorld = footFrame.clone().multiply(restFoot);
      const ankle = sole.clone().sub(leg.soleOffset.clone().applyQuaternion(footFrame));
      // Knees point out over the toes and slightly toward the nose.
      const pole = toe.clone().addScaledVector(forward, leg.front ? .5 : .3);
      this.solveTwoBone(leg, ankle, pole);
      this.setWorldQuaternion(leg.end, footWorld);
    }

    // --- Arms, laid out in the chest's frame after the spine has been posed.
    const { facing: chestFacing, up: chestUp, side: chestSide } = this.chestFrame();
    for (const arm of this.arms) {
      const side = chestSide.clone().multiplyScalar(arm.side);
      const seesaw = arm.front ? 1 : -1;
      const armRaise = this.armRaise + motion.balance * .35 * seesaw * this.grind + (airborne && arm.front ? .2 : 0);
      const armSwing = this.armSwing + this.push * Math.sin(pushPhase * Math.PI * 2) * .5 * seesaw;
      const shoulder = arm.upper.getWorldPosition(new THREE.Vector3());
      const upperDirection = chestUp.clone().multiplyScalar(-Math.cos(armRaise)).addScaledVector(side, Math.sin(armRaise)).normalize();
      upperDirection.multiplyScalar(Math.cos(armSwing)).addScaledVector(chestFacing, Math.sin(armSwing)).normalize();
      const foreDirection = upperDirection.clone().multiplyScalar(Math.cos(this.armBend)).addScaledVector(chestFacing, Math.sin(this.armBend)).normalize();
      const elbow = shoulder.clone().addScaledVector(upperDirection, arm.upperLength);
      let wrist = elbow.clone().addScaledVector(foreDirection, arm.lowerLength);
      if (!arm.front && this.grab > .01) {
        // Indy grab: the trailing hand reaches down to the toe edge between the feet.
        const edge = new THREE.Vector3(0, this.board.deckHeight(-.04) + .06, -.04).addScaledVector(toeLocal, .12);
        wrist = wrist.lerp(this.board.root.localToWorld(edge), this.grab);
        this.solveTwoBone(arm, wrist, side.clone().addScaledVector(chestFacing, -.3));
      } else if (!mocap) {
        this.aim(arm.upper, arm.lower.getWorldPosition(new THREE.Vector3()), elbow);
        this.aim(arm.lower, arm.end.getWorldPosition(new THREE.Vector3()), wrist);
      }
    }
  }

  // The chest's facing, up and model-+x side directions in world space, as currently posed.
  private chestFrame(): { facing: THREE.Vector3; up: THREE.Vector3; side: THREE.Vector3 } {
    const model = this.model.getWorldQuaternion(new THREE.Quaternion());
    const delta = this.chest.getWorldQuaternion(new THREE.Quaternion()).multiply(model.clone().multiply(this.restModelQuaternion.get(this.chest)!).invert());
    const axis = (v: THREE.Vector3): THREE.Vector3 => v.clone().applyQuaternion(model).applyQuaternion(delta);
    return { facing: axis(FORWARD), up: axis(UP), side: axis(new THREE.Vector3(1, 0, 0)) };
  }

  startRagdoll(physics: PhysicsWorld, velocity: THREE.Vector3, tripped: boolean): boolean {
    this.stopRagdoll();
    this.root.parent?.updateMatrixWorld(true);
    this.bailAction?.stop();
    const at = (bone: THREE.Object3D): THREE.Vector3 => bone.getWorldPosition(new THREE.Vector3());
    const bone = (name: string): THREE.Object3D => this.model.getObjectByName(name)!;
    const headTop = at(this.head).add(at(this.head).sub(at(this.neck)).normalize().multiplyScalar(.2));
    const segments: RagdollSegment[] = [
      { from: at(this.hips), to: at(this.spine), radius: .12, bones: [this.hips] },
      { from: at(this.spine), to: at(this.neck), radius: .14, bones: [this.spine, this.chest, bone('shoulder_l'), bone('shoulder_r')] },
      { from: at(this.neck), to: headTop, radius: .11, bones: [this.neck, this.head] },
    ];
    const range = CONFIG.ragdoll;
    const joints: RagdollJoint[] = [{ a: 0, b: 1, at: at(this.spine), range: range.waistRange }, { a: 1, b: 2, at: at(this.neck), range: range.neckRange }];
    // A hinge bends about the axis it is already bent around; straight limbs fall back to the way they fold.
    const hinge = (upper: THREE.Object3D, middle: THREE.Object3D, end: THREE.Vector3, fold: THREE.Vector3, maxBend: number): RagdollJoint['hinge'] => {
      const first = at(middle).sub(at(upper)).normalize(), second = end.clone().sub(at(middle)).normalize();
      const axis = new THREE.Vector3().crossVectors(first, second);
      if (axis.length() < .1) axis.crossVectors(first, fold);
      return { axis: axis.normalize(), bend: first.angleTo(second), maxBend };
    };
    const { facing } = this.chestFrame();
    for (const arm of this.arms) {
      const hand = at(arm.end).add(at(arm.end).sub(at(arm.lower)).normalize().multiplyScalar(.1));
      const upper = segments.push({ from: at(arm.upper), to: at(arm.lower), radius: .065, bones: [arm.upper] }) - 1;
      segments.push({ from: at(arm.lower), to: hand, radius: .055, bones: [arm.lower, arm.end] });
      joints.push({ a: 1, b: upper, at: at(arm.upper), range: range.shoulderRange });
      joints.push({ a: upper, b: upper + 1, at: at(arm.lower), hinge: hinge(arm.upper, arm.lower, at(arm.end), facing, CONFIG.ragdoll.elbowMaxBend) });
    }
    const frameQuaternion = this.root.parent!.getWorldQuaternion(new THREE.Quaternion());
    const heel = new THREE.Vector3(-Math.sin(this.stanceAngle), 0, -Math.cos(this.stanceAngle)).applyQuaternion(frameQuaternion);
    const legSpeed = tripped ? CONFIG.ragdoll.tripLegSpeed : 1;
    for (const leg of this.legs) {
      const thigh = segments.push({ from: at(leg.upper), to: at(leg.lower), radius: .085, bones: [leg.upper], velocityScale: (1 + legSpeed) / 2 }) - 1;
      segments.push({ from: at(leg.lower), to: at(leg.end), radius: .07, bones: [leg.lower, leg.end], velocityScale: legSpeed });
      joints.push({ a: 0, b: thigh, at: at(leg.upper), range: range.hipRange });
      joints.push({ a: thigh, b: thigh + 1, at: at(leg.lower), hinge: hinge(leg.upper, leg.lower, at(leg.end), heel, CONFIG.ragdoll.kneeMaxBend) });
    }
    this.ragdoll = new Ragdoll(physics, segments, joints, velocity, this.board.root);
    return true;
  }

  stopRagdoll(): void {
    this.ragdoll?.dispose();
    this.ragdoll = undefined;
  }

  ragdollFocus(target: THREE.Vector3): boolean {
    if (!this.ragdoll) return false;
    this.ragdoll.focus(target);
    return true;
  }

  // Back foot during a push: step off the tail, plant beside the board, drive back, return to the tail.
  private pushFootPath(phase: number, tailZ: number, toeLocal: THREE.Vector3): THREE.Vector3 {
    const A = CONFIG.animation;
    const tail = new THREE.Vector3(0, this.board.deckHeight(tailZ), tailZ);
    const plant = new THREE.Vector3(0, 0, .1).addScaledVector(toeLocal, A.pushFootSide);
    const drive = plant.clone().setZ(.1 - A.pushStride);
    const settle = .88;
    if (phase < A.pushContactStart) {
      const t = smooth(phase / A.pushContactStart);
      return tail.clone().lerp(plant, t).setY(THREE.MathUtils.lerp(tail.y, 0, t) + Math.sin(Math.PI * t) * .1);
    }
    if (phase < A.pushContactEnd) return plant.clone().lerp(drive, (phase - A.pushContactStart) / (A.pushContactEnd - A.pushContactStart));
    if (phase < settle) {
      const t = smooth((phase - A.pushContactEnd) / (settle - A.pushContactEnd));
      return drive.clone().lerp(tail, t).setY(THREE.MathUtils.lerp(0, tail.y, t) + Math.sin(Math.PI * t) * .14);
    }
    return tail;
  }

  // Analytic two-bone IK: place the middle joint on the pole side, then aim each bone at the next joint.
  private solveTwoBone(limb: Limb, target: THREE.Vector3, pole: THREE.Vector3): void {
    const root = limb.upper.getWorldPosition(new THREE.Vector3());
    const toTarget = target.clone().sub(root);
    const direction = toTarget.clone().normalize();
    const { upperLength: a, lowerLength: b } = limb;
    const distance = THREE.MathUtils.clamp(toTarget.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
    const cosine = (a * a + distance * distance - b * b) / (2 * a * distance);
    const bendDirection = pole.clone().addScaledVector(direction, -pole.dot(direction)).normalize();
    const joint = root.clone().addScaledVector(direction, a * cosine).addScaledVector(bendDirection, a * Math.sqrt(Math.max(0, 1 - cosine * cosine)));
    this.aim(limb.upper, limb.lower.getWorldPosition(new THREE.Vector3()), joint);
    this.aim(limb.lower, limb.end.getWorldPosition(new THREE.Vector3()), root.addScaledVector(direction, distance));
  }

  private aim(bone: THREE.Object3D, child: THREE.Vector3, target: THREE.Vector3): void {
    const origin = bone.getWorldPosition(new THREE.Vector3());
    const from = child.sub(origin).normalize();
    const to = target.clone().sub(origin).normalize();
    this.rotateBy(bone, new THREE.Quaternion().setFromUnitVectors(from, to));
  }

  private rotate(bone: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
    if (angle !== 0) this.rotateBy(bone, new THREE.Quaternion().setFromAxisAngle(axis, angle));
  }

  // Apply a world-space rotation to a bone about its own pivot.
  private rotateBy(bone: THREE.Object3D, delta: THREE.Quaternion): void {
    this.setWorldQuaternion(bone, delta.multiply(bone.getWorldQuaternion(new THREE.Quaternion())));
  }

  private setWorldQuaternion(bone: THREE.Object3D, world: THREE.Quaternion): void {
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
    bone.updateMatrixWorld(true);
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
    this.resetRoot();
  }

  private bone(name: string, position: THREE.Vector3, parent?: THREE.Object3D): THREE.Object3D {
    const bone = new THREE.Object3D(); bone.name = name; bone.position.copy(position);
    parent?.add(bone); this.bones.set(name, bone); this.targets.set(name, new THREE.Quaternion()); return bone;
  }

  private part(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, position: THREE.Vector3): void {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.copy(position); parent.add(mesh);
  }

  setStance(): void {}
  land(): void {}
  startRagdoll(): boolean { return false; }
  stopRagdoll(): void {}
  ragdollFocus(): boolean { return false; }
  resetRoot(): void { this.root.position.set(0,.17,0); this.root.rotation.set(0,0,0); }

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

  update(dt: number, motion: SkaterMotion): void {
    this.time += dt;
    const alpha = 1 - Math.exp(-dt / CONFIG.character.animationBlend);
    this.bones.forEach((bone, name) => bone.quaternion.slerp(this.targets.get(name)!, alpha));
    const chest = this.bones.get('chest')!;
    chest.scale.y = 1 + Math.sin(this.time * CONFIG.character.breathingSpeed) * .012;
    if (this.pose === 'grind') chest.rotation.z = motion.balance * .22;
  }
}

export function createCharacter(assets: AssetLoader, board: Skateboard): CharacterModel {
  const source = assets.model('skater');
  return source.scene.getObjectByName('hips') ? new ProceduralSkater(assets, board) : new FallbackCharacter();
}
