import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { CONFIG } from '../core/config';

export class PostProcessing {
  private readonly composer: EffectComposer;
  private readonly ssao: SSAOPass;
  private readonly bloom: UnrealBloomPass;
  private readonly fxaa: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const target = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.ssao = new SSAOPass(scene, camera, innerWidth, innerHeight);
    this.ssao.kernelRadius = CONFIG.post.ssaoKernelRadius;
    this.ssao.minDistance = CONFIG.post.ssaoMinDistance;
    this.ssao.maxDistance = CONFIG.post.ssaoMaxDistance;
    this.composer.addPass(this.ssao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), CONFIG.post.bloomStrength, CONFIG.post.bloomRadius, CONFIG.post.bloomThreshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
    this.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
  }

  render(delta: number): void { this.composer.render(delta); }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.fxaa.material.uniforms.resolution!.value.set(1 / (width * pixelRatio), 1 / (height * pixelRatio));
  }

  setPerformance(fps: number): void {
    this.ssao.enabled = fps >= CONFIG.post.ssaoDisableFps;
    this.bloom.enabled = CONFIG.post.bloomEnabled;
  }
}
