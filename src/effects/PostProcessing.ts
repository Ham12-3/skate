import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { CONFIG } from '../core/config';

// Display-space finishing: a filmic S-curve, saturation, lens vignette and fine animated grain.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    contrast: { value: CONFIG.post.gradeContrast },
    saturation: { value: CONFIG.post.gradeSaturation },
    vignette: { value: CONFIG.post.vignette },
    grain: { value: CONFIG.post.grain },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float time, contrast, saturation, vignette, grain;
    varying vec2 vUv;
    void main() {
      vec4 source = texture2D(tDiffuse, vUv);
      vec3 colour = mix(source.rgb, smoothstep(0.0, 1.0, source.rgb), contrast);
      colour = mix(vec3(dot(colour, vec3(0.2126, 0.7152, 0.0722))), colour, saturation);
      colour *= mix(1.0 - vignette, 1.0, smoothstep(0.85, 0.3, length(vUv - 0.5) * 1.15));
      float noise = fract(sin(dot(vUv * vec2(12.9898, 78.233) + fract(time) * 31.7, vec2(1.0))) * 43758.5453);
      colour += (noise - 0.5) * grain;
      gl_FragColor = vec4(clamp(colour, 0.0, 1.0), source.a);
    }`,
};

// Skate-video fisheye: barrel distortion (centre magnified, edges bowed) with the darker corners of a
// lens hood. Rendered from a wide rectilinear view, so strength trades centre zoom for curvature.
const FisheyeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    strength: { value: 0 },
    aspect: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float strength, aspect;
    varying vec2 vUv;
    void main() {
      vec2 offset = (vUv - 0.5) * vec2(aspect, 1.0);
      // Squared radius normalised so the frame corner is 1.
      float radius2 = dot(offset, offset) / (0.25 * (aspect * aspect + 1.0));
      vec2 source = offset * (1.0 - strength + strength * radius2) / vec2(aspect, 1.0) + 0.5;
      vec4 colour = texture2D(tDiffuse, source);
      colour.rgb *= mix(1.0, smoothstep(1.05, 0.7, radius2), min(1.0, strength * 1.6));
      gl_FragColor = colour;
    }`,
};

export class PostProcessing {
  private readonly composer: EffectComposer;
  private readonly ssao: SSAOPass;
  private readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;
  private readonly fisheye: ShaderPass;
  private time = 0;

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
    // SMAA keeps edges clean without FXAA's blur over the whole frame; grain goes on after it.
    this.composer.addPass(new SMAAPass());
    this.fisheye = new ShaderPass(FisheyeShader);
    this.fisheye.enabled = false;
    this.composer.addPass(this.fisheye);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
  }

  render(delta: number): void {
    this.time += delta;
    this.grade.uniforms.time!.value = this.time;
    this.composer.render(delta);
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.fisheye.uniforms.aspect!.value = width / height;
  }

  // 0 turns the lens off (rectilinear); skate fisheyes sit around 0.3-0.4.
  setFisheye(strength: number): void {
    this.fisheye.uniforms.strength!.value = strength;
    this.fisheye.enabled = strength > 0;
  }

  setPerformance(fps: number): void {
    this.ssao.enabled = fps >= CONFIG.post.ssaoDisableFps;
    this.bloom.enabled = CONFIG.post.bloomEnabled;
  }
}
