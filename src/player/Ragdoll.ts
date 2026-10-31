import type * as RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../core/config';
import { BOARD_GROUPS, RAGDOLL_GROUPS, type PhysicsWorld } from '../core/PhysicsWorld';

const UP = new THREE.Vector3(0, 1, 0);
// Board-root space centre of the deck, where the loose board's box collider sits.
const DECK_CENTRE = new THREE.Vector3(0, .1, 0);

export interface RagdollSegment {
  from: THREE.Vector3;
  to: THREE.Vector3;
  radius: number;
  // Bones that ride rigidly on this segment, parents before children.
  bones: THREE.Object3D[];
  velocityScale?: number;
}

export interface RagdollJoint {
  a: number;
  b: number;
  at: THREE.Vector3;
  // Knees and elbows: bend about `axis` from the current angle `bend` up to `maxBend`, never past straight.
  hinge?: { axis: THREE.Vector3; bend: number; maxBend: number };
  // Ball joints: how far (radians, per axis) they may rotate from the starting pose.
  range?: number;
}

// The JS wrapper only exposes limits on single-axis joints, but the solver also limits each angular axis of
// a ball joint. Every body starts unrotated, so the joint axes are world X/Y/Z at the moment of the bail.
const ANGULAR_AXES = [3, 4, 5];
function limitBall(joint: RAPIER.ImpulseJoint, range: number): void {
  const raw = (joint as unknown as { rawSet?: { jointSetLimits?(handle: number, axis: number, min: number, max: number): void } }).rawSet;
  for (const axis of ANGULAR_AXES) raw?.jointSetLimits?.(joint.handle, axis, -range, range);
}

interface Binding { bone: THREE.Object3D; body: RAPIER.RigidBody; rest: THREE.Quaternion }

// Physics-driven slam: capsules joined at the skeleton's joints, built from the pose at the moment of the bail.
export class Ragdoll {
  private readonly bodies: RAPIER.RigidBody[] = [];
  private readonly bindings: Binding[] = [];
  private readonly root: { bone: THREE.Object3D; body: RAPIER.RigidBody; offset: THREE.Vector3 };
  private readonly board?: { object: THREE.Object3D; body: RAPIER.RigidBody };
  private readonly generation: number;

  constructor(private readonly physics: PhysicsWorld, segments: RagdollSegment[], joints: RagdollJoint[], velocity: THREE.Vector3, board?: THREE.Object3D) {
    const R = physics.lib, world = physics.world, config = CONFIG.ragdoll;
    this.generation = physics.generation;
    // Every body starts unrotated (the capsule shape is turned instead), so joint axes and limits are
    // expressed in world space and measured from the pose the rider was in when they bailed.
    for (const segment of segments) {
      const centre = segment.from.clone().add(segment.to).multiplyScalar(.5);
      const length = segment.from.distanceTo(segment.to);
      const direction = segment.to.clone().sub(segment.from).normalize();
      const v = velocity.clone().multiplyScalar(segment.velocityScale ?? 1);
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(centre.x, centre.y, centre.z).setLinvel(v.x, v.y, v.z)
        .setLinearDamping(config.linearDamping).setAngularDamping(config.angularDamping).setCcdEnabled(true));
      const rotation = new THREE.Quaternion().setFromUnitVectors(UP, direction);
      world.createCollider(R.ColliderDesc.capsule(Math.max(.01, length / 2 - segment.radius * .5), segment.radius)
        .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w })
        .setDensity(config.density).setFriction(config.friction).setRestitution(config.restitution).setCollisionGroups(RAGDOLL_GROUPS), body);
      this.bodies.push(body);
      for (const bone of segment.bones) this.bindings.push({ bone, body, rest: bone.getWorldQuaternion(new THREE.Quaternion()) });
    }
    for (const joint of joints) {
      const a = this.bodies[joint.a]!, b = this.bodies[joint.b]!;
      const anchorA = joint.at.clone().sub(this.vector(a.translation()));
      const anchorB = joint.at.clone().sub(this.vector(b.translation()));
      if (joint.hinge) {
        // Limits set on JointData are ignored by this Rapier build; they only take effect on the created joint.
        const hinge = world.createImpulseJoint(R.JointData.revolute(anchorA, anchorB, joint.hinge.axis), a, b, true) as RAPIER.RevoluteImpulseJoint;
        hinge.setLimits(-joint.hinge.bend + .03, joint.hinge.maxBend - joint.hinge.bend);
      } else {
        const ball = world.createImpulseJoint(R.JointData.spherical(anchorA, anchorB), a, b, true);
        if (joint.range !== undefined) limitBall(ball, joint.range);
      }
    }
    const first = this.bindings[0]!;
    this.root = { bone: first.bone, body: first.body, offset: first.bone.getWorldPosition(new THREE.Vector3()).sub(this.vector(first.body.translation())) };
    if (board) {
      board.updateMatrixWorld(true);
      const quaternion = board.getWorldQuaternion(new THREE.Quaternion());
      const centre = board.localToWorld(DECK_CENTRE.clone());
      // The board shoots out from under the rider with a bit of roll, like a real slam.
      const spin = new THREE.Vector3(0, 0, config.boardSpin * (Math.random() - .5)).applyQuaternion(quaternion);
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(centre.x, centre.y, centre.z)
        .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w })
        .setLinvel(velocity.x, velocity.y, velocity.z).setAngvel(spin).setCcdEnabled(true));
      world.createCollider(R.ColliderDesc.cuboid(.11, .025, .4).setDensity(config.boardDensity).setFriction(.6).setRestitution(.3).setCollisionGroups(BOARD_GROUPS), body);
      this.bodies.push(body);
      this.board = { object: board, body };
    }
  }

  private get alive(): boolean { return this.physics.generation === this.generation; }

  // Copy the simulated bodies onto the skeleton (and board) after each physics step.
  sync(): void {
    if (!this.alive) return;
    const rootBody = this.root.body;
    const rootRotation = this.quaternion(rootBody);
    const rootPosition = this.vector(rootBody.translation()).add(this.root.offset.clone().applyQuaternion(rootRotation));
    this.root.bone.position.copy(this.root.bone.parent!.worldToLocal(rootPosition));
    for (const binding of this.bindings) {
      const world = this.quaternion(binding.body).multiply(binding.rest);
      binding.bone.quaternion.copy(binding.bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
      binding.bone.updateMatrixWorld(true);
    }
    if (this.board) {
      const { object, body } = this.board;
      const rotation = this.quaternion(body);
      const position = this.vector(body.translation()).sub(DECK_CENTRE.clone().applyQuaternion(rotation));
      object.position.copy(object.parent!.worldToLocal(position));
      object.quaternion.copy(object.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
    }
  }

  focus(target: THREE.Vector3): void {
    if (this.alive) target.copy(this.vector(this.root.body.translation()));
  }

  dispose(): void {
    if (this.alive) this.bodies.forEach((body) => this.physics.world.removeRigidBody(body));
    this.bodies.length = 0;
  }

  private vector(v: RAPIER.Vector): THREE.Vector3 { return new THREE.Vector3(v.x, v.y, v.z); }
  private quaternion(body: RAPIER.RigidBody): THREE.Quaternion { const r = body.rotation(); return new THREE.Quaternion(r.x, r.y, r.z, r.w); }
}
