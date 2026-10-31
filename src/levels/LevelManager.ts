import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import type { PhysicsWorld } from '../core/PhysicsWorld';
import { CONFIG } from '../core/config';
import { analyzeSky, type SkyLight } from '../effects/SkyAnalysis';
import type { LevelBuildResult, LevelDefinition, Pedestrian } from './LevelTypes';

export class LevelManager {
  readonly group = new THREE.Group();
  definition?: LevelDefinition;
  buildResult?: LevelBuildResult;
  sky?: SkyLight;

  constructor(private readonly scene: THREE.Scene, private readonly physics: PhysicsWorld, private readonly assets: AssetLoader) {
    this.scene.add(this.group);
  }

  async load(definition: LevelDefinition): Promise<void> {
    this.unload();
    this.definition=definition;
    this.physics.reset();
    const [background,environment]=await Promise.all([
      this.assets.loadSky(definition.skyFile),
      this.assets.loadEnvironment(definition.id),
    ]);
    background.mapping=THREE.EquirectangularReflectionMapping;
    this.sky=environment&&definition.lighting.skyLighting!==false?analyzeSky(environment):undefined;
    const photographedSky=Boolean(environment&&this.sky?.daylight&&CONFIG.rendering.hdriBackground);
    this.scene.background=photographedSky?environment:background;
    this.scene.backgroundIntensity=photographedSky?CONFIG.rendering.backgroundIntensity:1;
    this.scene.environment=environment??background;
    this.scene.environmentIntensity=definition.lighting.environmentIntensity??CONFIG.rendering.environmentIntensity;
    // Exponential haze in the horizon's own colour, so distant geometry fades into the sky behind it.
    const fog=new THREE.FogExp2(definition.lighting.fogColor,CONFIG.rendering.fogDensity);
    if(photographedSky)fog.color.copy(this.sky!.horizonColor).multiplyScalar(CONFIG.rendering.backgroundIntensity);
    this.scene.fog=fog;
    this.buildResult=definition.build({group:this.group,physics:this.physics,assets:this.assets});
  }

  update(dt: number): void {
    this.buildResult?.pedestrians.forEach((pedestrian)=>this.updatePedestrian(pedestrian,dt));
  }

  private updatePedestrian(pedestrian: Pedestrian,dt: number): void {
    const length=pedestrian.start.distanceTo(pedestrian.end);
    pedestrian.progress+=pedestrian.direction*pedestrian.speed*dt/Math.max(length,.01);
    if(pedestrian.progress>=1){pedestrian.progress=1;pedestrian.direction=-1;}
    if(pedestrian.progress<=0){pedestrian.progress=0;pedestrian.direction=1;}
    pedestrian.root.position.lerpVectors(pedestrian.start,pedestrian.end,pedestrian.progress);
    const direction=pedestrian.end.clone().sub(pedestrian.start).multiplyScalar(pedestrian.direction);
    pedestrian.root.rotation.y=Math.atan2(direction.x,direction.z);
    pedestrian.mixer?.update(dt);
  }

  unload(): void {
    this.physics.reset();
    const geometries=new Set<THREE.BufferGeometry>();
    const materials=new Set<THREE.Material>();
    const textures=new Set<THREE.Texture>();
    this.group.traverse((object)=>{
      if(object instanceof THREE.Mesh&&!(object instanceof THREE.InstancedMesh)){
        let parent:THREE.Object3D|null=object;let shared=false;
        while(parent){if(parent.userData.sharedAsset){shared=true;break;}parent=parent.parent;}
        if(!shared){
          geometries.add(object.geometry);
          (Array.isArray(object.material)?object.material:[object.material]).forEach((material)=>materials.add(material));
        }
      }
    });
    materials.forEach((material)=>{
      const standard=material as THREE.MeshStandardMaterial;
      if(standard.map&&standard.map.userData.levelClone)textures.add(standard.map);
      material.dispose();
    });
    geometries.forEach((geometry)=>geometry.dispose());
    textures.forEach((texture)=>texture.dispose());
    this.group.clear();
    this.buildResult=undefined;
    this.definition=undefined;
    this.sky=undefined;
  }
}
