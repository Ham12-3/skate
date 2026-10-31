import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const MODELS = ['skater','skateboard','house_1','house_2','house_3','tree','car','bench','planter','lamp_post','pedestrian','skyscraper_1','skyscraper_2','ac_unit','roof_vent','desert_rock'];
const TEXTURES = ['asphalt','concrete','wood_ramp','brick','metal_rail','grass','gravel','stone_plaza','sand'];
const PBR_SURFACES = ['asphalt','concrete','wood_ramp','brick','metal_rail','gravel','stone_plaza','sand'];
const PBR_CHANNELS = ['color','normal','roughness','ao'] as const;
const ICONS = ['kickflip','heelflip','shoveit','grab','grind','spin','lock'];

export class AssetLoader {
  readonly models = new Map<string, GLTF>();
  readonly textures = new Map<string, THREE.Texture>();
  // Motion-capture clips retargeted by tools/blender/retarget_mocap.py, named after skater states.
  mocapClips: THREE.AnimationClip[] = [];
  private readonly gltfLoader = new GLTFLoader();
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly rgbeLoader = new RGBELoader();

  async loadCore(onProgress: (progress: number, label: string) => void): Promise<void> {
    const jobs: Array<() => Promise<void>> = [];
    MODELS.forEach((name) => jobs.push(async () => {
      try {
        this.models.set(name, await this.gltfLoader.loadAsync(`/assets/models/${name}.glb`));
      } catch (error) {
        console.warn(`Model fallback used: ${name}.glb`, error);
        this.models.set(name, { scene: this.fallbackModel(name), scenes: [], animations: [], cameras: [], asset: {}, parser: {} as GLTF['parser'], userData: {} });
      }
    }));
    TEXTURES.forEach((name) => jobs.push(async () => { this.textures.set(name, await this.loadTexture(`/assets/textures/${name}.jpg`, name)); }));
    PBR_SURFACES.forEach((name) => PBR_CHANNELS.forEach((channel) => jobs.push(async () => {
      const key = `${name}_${channel}`;
      this.textures.set(key, await this.loadTexture(`/assets/pbr/${key}.jpg`, key, false, channel === 'color', false));
    })));
    for (let i = 1; i <= 4; i++) jobs.push(async () => { this.textures.set(`deck${i}`, await this.loadTexture(`/assets/decks/deck${i}.png`, `deck${i}`)); });
    jobs.push(async () => { this.textures.set('logo', await this.loadTexture('/assets/ui/logo.png', 'logo')); });
    ICONS.forEach((name) => jobs.push(async () => { this.textures.set(`icon_${name}`, await this.loadTexture(`/assets/ui/icon_${name}.png`, name)); }));
    jobs.push(async () => {
      try {
        this.mocapClips = (await this.gltfLoader.loadAsync('/assets/mocap/skater_mocap.glb')).animations;
      } catch {
        // No recorded clips yet: the skater is animated procedurally.
      }
    });
    let complete = 0;
    await Promise.all(jobs.map((job) => job().finally(() => {
      complete++;
      onProgress(complete / jobs.length, `Loading city assets ${complete}/${jobs.length}`);
    })));
  }

  async loadSky(filename: string): Promise<THREE.Texture> {
    const key = `sky:${filename}`;
    const cached = this.textures.get(key);
    if (cached) return cached;
    const texture = await this.loadTexture(`/assets/sky/${filename}`, filename, true);
    this.textures.set(key, texture);
    return texture;
  }

  async loadEnvironment(level: number): Promise<THREE.Texture | null> {
    const key = `hdri:level${level + 1}`;
    const cached = this.textures.get(key);
    if (cached) return cached;
    try {
      const texture = await this.rgbeLoader.loadAsync(`/assets/hdri/level${level + 1}.hdr`);
      texture.mapping = THREE.EquirectangularReflectionMapping;
      this.textures.set(key, texture);
      return texture;
    } catch (error) {
      console.warn(`HDR environment fallback used: level${level + 1}.hdr`, error);
      return null;
    }
  }

  private async loadTexture(url: string, label: string, sky = false, srgb = true, fallback = true): Promise<THREE.Texture> {
    try {
      const texture = await this.textureLoader.loadAsync(url);
      texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      if (!sky) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = 4;
      }
      return texture;
    } catch (error) {
      if (!fallback) throw error;
      console.warn(`Texture fallback used: ${label}`, error);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const context = canvas.getContext('2d')!;
      const gradient = context.createLinearGradient(0, 0, 0, 128);
      gradient.addColorStop(0, sky ? '#4a9edd' : '#9a9d98');
      gradient.addColorStop(1, sky ? '#f2bd86' : '#676c69');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 128, 128);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }
  }

  optionalTexture(name: string): THREE.Texture | undefined {
    return this.textures.get(name);
  }

  texture(name: string): THREE.Texture {
    const texture = this.textures.get(name);
    if (!texture) throw new Error(`Texture not loaded: ${name}`);
    return texture;
  }

  model(name: string): GLTF {
    const model = this.models.get(name);
    if (!model) throw new Error(`Model not loaded: ${name}`);
    return model;
  }

  private fallbackModel(name: string): THREE.Group {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: name.includes('rock') ? 0xb65f40 : 0xe57936 });
    if (name === 'skateboard') {
      group.add(new THREE.Mesh(new THREE.BoxGeometry(.78, .07, .23), material));
      for (const [x, z, wheelName] of [[-.15,-.27,'wheel_fl'],[.15,-.27,'wheel_fr'],[-.15,.27,'wheel_bl'],[.15,.27,'wheel_br']] as const) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,.035,12), new THREE.MeshStandardMaterial({ color: 0xeeeecc }));
        wheel.name = wheelName; wheel.rotation.z = Math.PI / 2; wheel.position.set(x,-.07,z); group.add(wheel);
      }
    } else if (name === 'tree') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.2,.25,2,10), new THREE.MeshStandardMaterial({ color: 0x795033 })); trunk.position.y = 1; group.add(trunk);
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5,1), new THREE.MeshStandardMaterial({ color: 0x58a24f })); crown.position.y = 3; group.add(crown);
    } else {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), material); mesh.position.y = .5; group.add(mesh);
    }
    group.name = `${name}_fallback`;
    return group;
  }
}
