import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import type { PhysicsWorld } from '../core/PhysicsWorld';

export interface Grindable {
  start: THREE.Vector3;
  end: THREE.Vector3;
  material: 'metal' | 'concrete';
}

export interface Pedestrian {
  root: THREE.Group;
  mixer?: THREE.AnimationMixer;
  start: THREE.Vector3;
  end: THREE.Vector3;
  speed: number;
  progress: number;
  direction: number;
}

export interface LevelBuildResult {
  grindables: Grindable[];
  pedestrians: Pedestrian[];
  spawn: THREE.Vector3;
}

export interface BuildContext {
  group: THREE.Group;
  physics: PhysicsWorld;
  assets: AssetLoader;
}

export interface LightingSettings {
  sunColor: number;
  sunIntensity: number;
  ambientColor: number;
  ambientIntensity: number;
  fogColor: number;
  sunPosition: [number, number, number];
}

export interface LevelDefinition {
  id: number;
  name: string;
  description: string;
  spawn: [number, number, number];
  yaw: number;
  timeLimit: number;
  scoreTarget: number;
  skyFile: string;
  introVideoFile: string;
  musicFile: string;
  surface: 'concrete' | 'wood';
  lighting: LightingSettings;
  checkpoints: [number, number, number][];
  build(context: BuildContext): LevelBuildResult;
}
