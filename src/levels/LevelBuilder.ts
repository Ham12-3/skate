import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { CONFIG } from '../core/config';
import { createDecals, seededRandom, type DecalKind, type DecalPlacement } from '../effects/Decals';
import { addSurfaceVariation } from '../effects/SurfaceDetail';
import type { BuildContext, Grindable, Pedestrian } from './LevelTypes';

export interface Transform {
  position: [number, number, number];
  yaw?: number;
  scale?: number;
}

const COLLIDER_SIZES: Record<string, [number,number,number]> = {
  house_1: [6,4,5], house_2: [6,4,5], house_3: [6,4,5], tree: [1,4,1], car: [3.5,2,1.7],
  bench: [2,1.2,.7], planter: [1.2,1.7,1.2], lamp_post: [.35,4,.35], ac_unit: [1.5,1,1.2],
  roof_vent: [.7,1.2,.7], desert_rock: [4,4,3],
};

// How strongly each surface breaks up its tiling with world-space colour/roughness variation.
const SURFACE_VARIATION: Record<string, number> = {
  grass: .22, asphalt: .16, concrete: .14, stone_plaza: .12, sand: .18, gravel: .15, brick: .1, wood_ramp: .08, metal_rail: .06,
};
// Real edges are never perfectly sharp; a small bevel catches a highlight along every corner.
const BEVEL_RADIUS = .025;
// Size ranges (metres) for scattered grime: [min width, max width, length / width].
const DECAL_SIZES: Record<DecalKind, [number, number, number]> = { oil: [.7, 2.2, 1.3], skid: [.25, .6, 6], crack: [1, 2.8, 1], gum: [.6, 1.4, 1] };

export class LevelBuilder {
  readonly grindables: Grindable[] = [];
  readonly pedestrians: Pedestrian[] = [];
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();

  constructor(private readonly context: BuildContext) {}

  material(texture: string, repeatX = 4, repeatY = 4, color = 0xffffff): THREE.MeshStandardMaterial {
    const key = `${texture}:${repeatX}:${repeatY}:${color}`;
    const cached = this.materials.get(key);
    if (cached) return cached;
    const cloneMap = (source: THREE.Texture): THREE.Texture => {
      const map = source.clone();
      map.userData.levelClone = true;
      map.needsUpdate = true;
      map.repeat.set(repeatX, repeatY);
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.anisotropy = 8;
      return map;
    };
    const colorTexture = this.context.assets.optionalTexture(`${texture}_color`) ?? this.context.assets.texture(texture);
    const material = new THREE.MeshStandardMaterial({ map: cloneMap(colorTexture), color: texture === 'wood_ramp' ? 0xc4e9ff : color, roughness: .86 });
    const normal = this.context.assets.optionalTexture(`${texture}_normal`);
    const roughness = this.context.assets.optionalTexture(`${texture}_roughness`);
    const ao = this.context.assets.optionalTexture(`${texture}_ao`);
    if (normal) {
      material.normalMap = cloneMap(normal);
      material.normalScale.set(.65,.65);
    }
    if (roughness) material.roughnessMap = cloneMap(roughness);
    if (ao) {
      material.aoMap = cloneMap(ao);
      material.aoMapIntensity = .8;
    }
    addSurfaceVariation(material, SURFACE_VARIATION[texture] ?? .1);
    this.materials.set(key, material);
    return material;
  }

  private surface(texture: string): 'concrete' | 'wood' { return texture === 'wood_ramp' ? 'wood' : 'concrete'; }

  private rolling(texture: string): number {
    return CONFIG.surfaces[texture as keyof typeof CONFIG.surfaces] ?? CONFIG.surfaces.concrete;
  }

  box(position: THREE.Vector3, size: THREE.Vector3, material: THREE.Material, collide = true, surface: 'concrete' | 'wood' = 'concrete', yaw = 0, rollingResistance?: number): THREE.Mesh {
    const radius = Math.min(BEVEL_RADIUS, Math.min(size.x, size.y, size.z) * .3);
    const geometry = radius > .004 ? new RoundedBoxGeometry(size.x,size.y,size.z,2,radius) : new THREE.BoxGeometry(size.x,size.y,size.z);
    const mesh = new THREE.Mesh(geometry,material);
    mesh.position.copy(position);
    mesh.rotation.y = yaw;
    mesh.receiveShadow = true;
    mesh.castShadow = size.y > .25;
    this.context.group.add(mesh);
    if (collide) this.context.physics.addBox(position,size,new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw),surface,rollingResistance);
    return mesh;
  }

  // Finish arch over a checkered line across the course. Posts reach down to `floor` (for decks over drops).
  finishLine(position: THREE.Vector3, width: number, floor = position.y): void {
    const checker = (columns: number, rows: number, scale: number): THREE.CanvasTexture => {
      const canvas = document.createElement('canvas');
      canvas.width = columns * scale; canvas.height = rows * scale;
      const context = canvas.getContext('2d')!;
      for (let x = 0; x < columns; x++) for (let y = 0; y < rows; y++) { context.fillStyle = (x + y) % 2 ? '#111' : '#f4f1e8'; context.fillRect(x * scale, y * scale, scale, scale); }
      const texture = Object.assign(new THREE.CanvasTexture(canvas), { colorSpace: THREE.SRGBColorSpace, anisotropy: 8 });
      texture.userData.levelClone = true;
      return texture;
    };
    const line = new THREE.Mesh(new THREE.PlaneGeometry(width, .8).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: checker(Math.round(width / .4), 2, 32), roughness: .8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const ground = this.context.physics.ray(position.clone().setY(position.y + 5), new THREE.Vector3(0, -1, 0), 20);
    line.position.copy(position).setY((ground?.point.y ?? position.y) + .006);
    line.receiveShadow = true;
    this.context.group.add(line);
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2f36, metalness: .6, roughness: .4 });
    const top = position.y + 3.4;
    for (const side of [-1, 1]) this.cylinderBetween(new THREE.Vector3(position.x + side * width / 2, floor, position.z), new THREE.Vector3(position.x + side * width / 2, top, position.z), .09, postMaterial, true);
    // Banner canvas matches the banner's real proportions (1 m tall) so the lettering isn't stretched.
    const bannerHeight = 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width / bannerHeight * 128); canvas.height = 128;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#e8541c'; context.fillRect(0, 0, canvas.width, 128);
    for (let x = 0; x < canvas.width / 16; x++) for (let y = 0; y < 2; y++) { context.fillStyle = (x + y) % 2 ? '#111' : '#f4f1e8'; context.fillRect(x * 16, y * 16, 16, 16); context.fillRect(x * 16, 96 + y * 16, 16, 16); }
    context.fillStyle = '#fff'; context.font = '900 64px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText('FINISH', canvas.width / 2, 66);
    const bannerMap = Object.assign(new THREE.CanvasTexture(canvas), { colorSpace: THREE.SRGBColorSpace, anisotropy: 8 });
    bannerMap.userData.levelClone = true;
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(width, bannerHeight), new THREE.MeshStandardMaterial({ map: bannerMap, roughness: .7, side: THREE.DoubleSide }));
    banner.position.set(position.x, top - bannerHeight / 2, position.z);
    banner.castShadow = true;
    this.context.group.add(banner);
  }

  // Invisible fence just outside a play area, so riders can't roll off the edge of the world.
  bounds(x: number, z: number, width: number, depth: number, height = 1.5): void {
    const thickness = .5;
    for (const [cx, cz, sx, sz] of [
      [x, z - depth / 2 - thickness / 2, width + thickness * 2, thickness], [x, z + depth / 2 + thickness / 2, width + thickness * 2, thickness],
      [x - width / 2 - thickness / 2, z, thickness, depth], [x + width / 2 + thickness / 2, z, thickness, depth],
    ] as const) this.context.physics.addBox(new THREE.Vector3(cx, height / 2, cz), new THREE.Vector3(sx, height, sz));
  }

  ground(x: number, z: number, width: number, depth: number, texture: string, y = 0): THREE.Mesh {
    return this.box(new THREE.Vector3(x,y-.25,z),new THREE.Vector3(width,.5,depth),this.material(texture,width/8,depth/8),true,this.surface(texture),0,this.rolling(texture));
  }

  kicker(position: THREE.Vector3, width: number, height: number, length: number, yaw = 0, texture = 'wood_ramp'): THREE.Mesh {
    const x=width/2, z=length/2;
    const vertices = new Float32Array([
      -x,0,z, x,0,z, x,height,-z, -x,height,-z,
      -x,0,-z, x,0,-z,
    ]);
    const indices = [0,1,2,0,2,3, 0,3,4, 1,5,2, 4,3,2,4,2,5, 0,4,5,0,5,1];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(vertices,3));
    geometry.setAttribute('uv',new THREE.BufferAttribute(new Float32Array([0,0,1,0,1,1,0,1,0,0,1,0]),2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry,this.material(texture,width/3,length/3));
    mesh.position.copy(position); mesh.rotation.y=yaw; mesh.castShadow=true;mesh.receiveShadow=true;
    this.context.group.add(mesh); mesh.updateMatrixWorld(true);
    this.context.physics.addMesh(geometry,mesh.matrixWorld,this.surface(texture),this.rolling(texture));
    this.addKickerDetails(position,width,height,length,yaw);
    return mesh;
  }

  private addKickerDetails(position:THREE.Vector3,width:number,height:number,length:number,yaw:number):void{
    const transform=(local:THREE.Vector3):THREE.Vector3=>local.applyAxisAngle(new THREE.Vector3(0,1,0),yaw).add(position);
    for(const side of [-1,1]){
      const x=side*width/2+side*.006;
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute([x,0,length/2,x,0,-length/2,x,height,-length/2],3));
      geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,0,1,1,1],2));geometry.computeVertexNormals();
      const panel=new THREE.Mesh(geometry,this.streetArtMaterial());panel.position.copy(position);panel.rotation.y=yaw;panel.castShadow=true;this.context.group.add(panel);
    }
    const stripeMaterial=new THREE.MeshStandardMaterial({color:0xf5b93c,roughness:.65});
    const angle=Math.atan2(height,length);
    for(const t of [.28,.52,.76]){
      const stripe=new THREE.Mesh(new THREE.BoxGeometry(width*.92,.025,.16),stripeMaterial);
      stripe.position.copy(transform(new THREE.Vector3(0,height*t+.035,length/2-length*t)));
      stripe.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),angle));
      this.context.group.add(stripe);
    }
    this.cylinderBetween(transform(new THREE.Vector3(-width/2,height+.035,-length/2)),transform(new THREE.Vector3(width/2,height+.035,-length/2)),.055,new THREE.MeshStandardMaterial({color:0xb7c3c8,metalness:.75,roughness:.28}),true);
    for(const x of [-width*.35,width*.35])this.box(transform(new THREE.Vector3(x,height/2,-length/2+.22)),new THREE.Vector3(.12,height,.12),new THREE.MeshStandardMaterial({color:0x46515b}),false,'wood',yaw);
  }

  private streetArtMaterial():THREE.MeshStandardMaterial{
    if(this.streetArt)return this.streetArt;
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;
    const context=canvas.getContext('2d')!;context.fillStyle='#202b3a';context.fillRect(0,0,512,512);
    context.lineWidth=34;context.lineCap='round';
    for(const [color,points] of [['#ff7628',[40,390,180,90,450,280]],['#39c6e8',[20,180,240,430,490,80]],['#f057a5',[80,500,350,20,500,190]]] as const){
      context.strokeStyle=color;context.beginPath();context.moveTo(points[0],points[1]);context.lineTo(points[2],points[3]);context.lineTo(points[4],points[5]);context.stroke();
    }
    context.fillStyle='#f8f4e8';context.font='900 170px sans-serif';context.textAlign='center';context.fillText('KC',256,310);
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.userData.levelClone=true;
    this.streetArt=new THREE.MeshStandardMaterial({map,roughness:.72,side:THREE.DoubleSide});
    return this.streetArt;
  }

  private streetArt?:THREE.MeshStandardMaterial;

  quarterPipe(position: THREE.Vector3, width: number, radius: number, yaw = 0, texture = 'concrete'): THREE.Mesh {
    const segments=24, vertices:number[]=[], uvs:number[]=[], indices:number[]=[];
    for(let i=0;i<=segments;i++){
      const theta=i/segments*Math.PI/2;
      const z=radius/2-radius*Math.sin(theta);
      const y=radius*(1-Math.cos(theta));
      vertices.push(-width/2,y,z,width/2,y,z);
      uvs.push(0,i/segments,1,i/segments);
      if(i<segments){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    geometry.setIndex(indices);geometry.computeVertexNormals();
    const material=this.material(texture,width/5,radius/3);
    material.side=THREE.DoubleSide;
    const mesh=new THREE.Mesh(geometry,material);mesh.position.copy(position);mesh.rotation.y=yaw;
    mesh.castShadow=true;mesh.receiveShadow=true;this.context.group.add(mesh);mesh.updateMatrixWorld(true);
    this.context.physics.addMesh(geometry,mesh.matrixWorld,this.surface(texture),this.rolling(texture));
    const lipStart=new THREE.Vector3(-width/2,radius,-radius/2).applyAxisAngle(new THREE.Vector3(0,1,0),yaw).add(position);
    const lipEnd=new THREE.Vector3(width/2,radius,-radius/2).applyAxisAngle(new THREE.Vector3(0,1,0),yaw).add(position);
    this.cylinderBetween(lipStart,lipEnd,.07,new THREE.MeshStandardMaterial({color:0xaebac0,metalness:.7,roughness:.3}),false);
    this.addQuarterSides(position,width,radius,yaw);
    return mesh;
  }

  private addQuarterSides(position:THREE.Vector3,width:number,radius:number,yaw:number):void{
    for(const side of [-1,1]){
      const vertices:number[]=[];const uvs:number[]=[];const indices:number[]=[];const x=side*width/2+side*.008;
      for(let i=0;i<=24;i++){
        const theta=i/24*Math.PI/2;const z=radius/2-radius*Math.sin(theta);const y=radius*(1-Math.cos(theta));
        vertices.push(x,y,z);uvs.push(i/24,y/radius);
      }
      vertices.push(x,0,-radius/2);uvs.push(1,0);
      for(let i=1;i<25;i++)indices.push(0,i,i+1);
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
      geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
      const panel=new THREE.Mesh(geometry,this.streetArtMaterial());panel.position.copy(position);panel.rotation.y=yaw;panel.castShadow=true;this.context.group.add(panel);
    }
  }

  halfPipe(position: THREE.Vector3, width: number, length: number, radius: number): void {
    this.ground(position.x,position.z,width-radius*2,length,'wood_ramp',position.y);
    this.quarterPipe(new THREE.Vector3(position.x-width/2+radius/2,position.y,position.z),length,radius,Math.PI/2,'wood_ramp');
    this.quarterPipe(new THREE.Vector3(position.x+width/2-radius/2,position.y,position.z),length,radius,-Math.PI/2,'wood_ramp');
  }

  rail(start: THREE.Vector3, end: THREE.Vector3, material: 'metal' | 'concrete' = 'metal'): void {
    this.cylinderBetween(start,end,.065,new THREE.MeshStandardMaterial({color:material==='metal'?0x9faeb5:0xbab9ae,metalness:material==='metal'?.75:0,roughness:.35}),true);
    for(const point of [start,end]){
      const bottom=point.clone();bottom.y=Math.max(0,point.y-1.1);
      this.cylinderBetween(bottom,point,.045,new THREE.MeshStandardMaterial({color:0x717d82,metalness:.6}),false);
    }
    const center=start.clone().add(end).multiplyScalar(.5);
    const direction=end.clone().sub(start);const length=direction.length();
    const quaternion=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),direction.normalize());
    this.context.physics.addBox(center,new THREE.Vector3(.13,.13,length),quaternion);
    this.grindables.push({start:start.clone(),end:end.clone(),material});
  }

  ledge(position: THREE.Vector3, size: THREE.Vector3, yaw=0): void {
    this.box(position,size,this.material('concrete',2,2),true,'concrete',yaw);
    const half=size.z/2;
    const start=new THREE.Vector3(0,size.y/2+.03,-half).applyAxisAngle(new THREE.Vector3(0,1,0),yaw).add(position);
    const end=new THREE.Vector3(0,size.y/2+.03,half).applyAxisAngle(new THREE.Vector3(0,1,0),yaw).add(position);
    this.grindables.push({start,end,material:'concrete'});
    // Years of waxed grinds leave a dark band along a ledge's top edge.
    const top=position.clone().setY(position.y+size.y/2);
    this.addDecals('skid',[{position:top,normal:new THREE.Vector3(0,1,0),yaw:yaw+Math.PI/2,width:Math.min(size.x*.7,.6),length:size.z*.95}]);
  }

  // Scatter grime over the walkable surfaces in an area. Each decal is dropped onto whatever flat
  // surface is below it, so it lands on ground, ramps tops and benches rather than floating.
  grime(x: number, z: number, width: number, depth: number, counts: Partial<Record<DecalKind, number>>, seed: number): void {
    const next = seededRandom(seed);
    for (const [kind, count] of Object.entries(counts) as [DecalKind, number][]) {
      const [minWidth, maxWidth, aspect] = DECAL_SIZES[kind];
      const placements: DecalPlacement[] = [];
      for (let i = 0; i < count; i++) {
        const origin = new THREE.Vector3(x + (next() - .5) * width, 80, z + (next() - .5) * depth);
        const hit = this.context.physics.ray(origin, new THREE.Vector3(0, -1, 0), 120);
        const decalWidth = THREE.MathUtils.lerp(minWidth, maxWidth, next());
        const yaw = kind === 'skid' ? (next() - .5) * .5 : next() * Math.PI * 2;
        const length = decalWidth * aspect * (.7 + next() * .6);
        if (!hit || hit.normal.y < .95) continue;
        // The whole footprint has to sit on that same surface, not hang off a rail or a bench edge.
        const reach = Math.max(decalWidth, length) / 2;
        const supported = [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => {
          const corner = this.context.physics.ray(origin.clone().add(new THREE.Vector3(dx! * reach, 0, dz! * reach)), new THREE.Vector3(0, -1, 0), 120);
          return corner && Math.abs(corner.point.y - hit.point.y) < .03;
        });
        if (supported) placements.push({ position: hit.point, normal: hit.normal, yaw, width: decalWidth, length });
      }
      this.addDecals(kind, placements);
    }
  }

  private addDecals(kind: DecalKind, placements: DecalPlacement[]): void {
    const mesh = createDecals(kind, placements);
    if (mesh) this.context.group.add(mesh);
  }

  stairs(position: THREE.Vector3, width: number, steps: number, stepHeight=.18, stepDepth=.42): void {
    for(let i=0;i<steps;i++){
      const height=(i+1)*stepHeight;
      this.box(new THREE.Vector3(position.x,position.y+height/2,position.z-i*stepDepth),new THREE.Vector3(width,height,stepDepth+.02),this.material('stone_plaza',width/4,1),true,'concrete',0,this.rolling('stone_plaza'));
    }
    const start=new THREE.Vector3(position.x-width*.32,position.y+stepHeight+.65,position.z+stepDepth/2);
    const end=new THREE.Vector3(position.x-width*.32,position.y+steps*stepHeight+.65,position.z-(steps-1)*stepDepth-stepDepth/2);
    this.rail(start,end);
  }

  cylinderBetween(start: THREE.Vector3, end: THREE.Vector3, radius: number, material: THREE.Material, shadow: boolean): THREE.Mesh {
    const direction=end.clone().sub(start);const length=direction.length();
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,length,10),material);
    mesh.position.copy(start).add(end).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
    mesh.castShadow=shadow;this.context.group.add(mesh);return mesh;
  }

  instances(name: string, transforms: Transform[], collide=true): void {
    if(!transforms.length)return;
    const source=this.context.assets.model(name).scene;
    source.updateMatrixWorld(true);
    const meshes: THREE.Mesh[]=[];source.traverse((object)=>{if(object instanceof THREE.Mesh)meshes.push(object);});
    for(const sourceMesh of meshes){
      const instanced=new THREE.InstancedMesh(sourceMesh.geometry,sourceMesh.material,transforms.length);
      transforms.forEach((transform,index)=>{
        const matrix=new THREE.Matrix4().compose(
          new THREE.Vector3(...transform.position),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),transform.yaw??0),
          new THREE.Vector3().setScalar(transform.scale??1),
        );
        matrix.multiply(sourceMesh.matrixWorld);
        instanced.setMatrixAt(index,matrix);
      });
      instanced.castShadow=name==='tree'||name.startsWith('house');
      instanced.receiveShadow=true;this.context.group.add(instanced);
    }
    if(collide){
      const size=COLLIDER_SIZES[name];
      if(size)transforms.forEach((transform)=>{
        const scale=transform.scale??1;
        this.context.physics.addBox(new THREE.Vector3(transform.position[0],transform.position[1]+size[1]*scale/2,transform.position[2]),new THREE.Vector3(size[0]*scale,size[1]*scale,size[2]*scale),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),transform.yaw??0));
      });
    }
  }

  pedestrian(start: THREE.Vector3,end: THREE.Vector3,speed=.8): void {
    const gltf=this.context.assets.model('pedestrian');const model=clone(gltf.scene);
    const root=new THREE.Group();root.userData.sharedAsset=true;root.add(model);root.position.copy(start);this.context.group.add(root);
    const mixer=gltf.animations.length?new THREE.AnimationMixer(model):undefined;
    if(mixer&&gltf.animations[0])mixer.clipAction(gltf.animations[0]).play();
    this.pedestrians.push({root,mixer,start:start.clone(),end:end.clone(),speed,progress:Math.random(),direction:1});
  }
}
