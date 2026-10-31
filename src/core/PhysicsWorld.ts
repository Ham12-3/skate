import type * as RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from './config';

// Interaction groups pack (membership << 16) | filter. Level geometry keeps Rapier's default (all bits).
const groups = (membership: number, filter: number): number => (membership << 16) | filter;
// Ragdoll limbs and the loose board collide with the level but not each other, and gameplay rays ignore them.
export const RAGDOLL_GROUPS = groups(0x0002, 0x0001);
export const BOARD_GROUPS = groups(0x0004, 0x0001);
const QUERY_GROUPS = groups(0x0001, 0x0001);

export interface RayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  surface: 'concrete' | 'wood';
  rollingResistance: number;
  collider: RAPIER.Collider;
}

export class PhysicsWorld {
  world!: RAPIER.World;
  // Bumped on every reset so bodies created before it know they have already been removed.
  generation = 0;
  private rapier!: typeof RAPIER;
  private surfaces = new Map<number, 'concrete' | 'wood'>();
  private rollingResistance = new Map<number, number>();
  // Rapier only refreshes its ray-query structures when the world steps; colliders added since then
  // (a level being built) are invisible to rays until we refresh by hand.
  private queriesStale = false;

  async initialize(): Promise<void> {
    this.rapier = await import('@dimforge/rapier3d-compat');
    await this.rapier.init();
    this.world = new this.rapier.World({ x: 0, y: CONFIG.physics.gravity, z: 0 });
    this.world.timestep = CONFIG.physics.fixedStep;
  }

  reset(): void {
    this.world.colliders.getAll().forEach((collider) => this.world.removeCollider(collider, false));
    this.world.bodies.getAll().forEach((body) => this.world.removeRigidBody(body));
    this.surfaces.clear();
    this.rollingResistance.clear();
    this.generation++;
  }

  get lib(): typeof RAPIER { return this.rapier; }

  step(): void { this.world.step(); this.queriesStale = false; }

  addBox(position: THREE.Vector3, size: THREE.Vector3, rotation = new THREE.Quaternion(), surface: 'concrete' | 'wood' = 'concrete', rollingResistance: number = CONFIG.surfaces.concrete): RAPIER.Collider {
    const collider = this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
        .setTranslation(position.x, position.y, position.z)
        .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w })
        .setFriction(0.7),
    );
    this.surfaces.set(collider.handle, surface);
    this.rollingResistance.set(collider.handle, rollingResistance);
    this.queriesStale = true;
    return collider;
  }

  addMesh(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, surface: 'concrete' | 'wood' = 'concrete', rollingResistance: number = CONFIG.surfaces.concrete): RAPIER.Collider {
    const transformed = geometry.clone().applyMatrix4(matrix);
    const positions = transformed.getAttribute('position');
    const vertices = new Float32Array(positions.array);
    const sourceIndex = transformed.getIndex();
    const indices = sourceIndex ? new Uint32Array(sourceIndex.array) : new Uint32Array(Array.from({ length: positions.count }, (_, i) => i));
    const collider = this.world.createCollider(this.rapier.ColliderDesc.trimesh(vertices, indices).setFriction(0.7));
    this.surfaces.set(collider.handle, surface);
    this.rollingResistance.set(collider.handle, rollingResistance);
    this.queriesStale = true;
    transformed.dispose();
    return collider;
  }

  ray(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): RayHit | null {
    if (this.queriesStale) { this.world.updateSceneQueries(); this.queriesStale = false; }
    const ray = new this.rapier.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: direction.x, y: direction.y, z: direction.z },
    );
    const hit = this.world.castRayAndGetNormal(ray, maxDistance, true, undefined, QUERY_GROUPS);
    if (!hit) return null;
    const point = ray.pointAt(hit.timeOfImpact);
    return {
      point: new THREE.Vector3(point.x, point.y, point.z),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z).normalize(),
      distance: hit.timeOfImpact,
      surface: this.surfaces.get(hit.collider.handle) ?? 'concrete',
      rollingResistance: this.rollingResistance.get(hit.collider.handle) ?? CONFIG.surfaces.concrete,
      collider: hit.collider,
    };
  }
}
