import * as THREE from 'three';

// World-space macro variation for tiled surfaces: slow patches of lighter/darker, smoother/rougher
// material, so a texture repeated thirty times across a street stops reading as a grid.
const NOISE = /* glsl */`
varying vec3 vSurfaceWorld;
float surfaceHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float surfaceNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(surfaceHash(i), surfaceHash(i + vec2(1.0, 0.0)), u.x), mix(surfaceHash(i + vec2(0.0, 1.0)), surfaceHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float surfaceFbm(vec2 p) {
  float value = 0.0, amplitude = 0.5;
  for (int i = 0; i < 4; i++) { value += amplitude * surfaceNoise(p); p = p * 2.03 + 17.0; amplitude *= 0.5; }
  return value;
}
`;

export function addSurfaceVariation(material: THREE.MeshStandardMaterial, amount: number): void {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSurfaceWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurfaceWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        // Skew by height so walls get patches too, not vertical streaks.
        vec2 surfacePlane = vSurfaceWorld.xz + vec2(vSurfaceWorld.y * 0.73, -vSurfaceWorld.y * 0.61);
        float surfaceMacro = surfaceFbm(surfacePlane * 0.045);
        float surfaceMeso = surfaceFbm(surfacePlane * 0.55);
        diffuseColor.rgb *= 1.0 + (surfaceMacro - 0.5) * ${(amount * 2).toFixed(3)} + (surfaceMeso - 0.5) * ${(amount * .6).toFixed(3)};`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (surfaceMacro - 0.5) * ${(amount * 1.4).toFixed(3)}, 0.04, 1.0);`);
  };
  material.customProgramCacheKey = () => `surface-variation:${amount}`;
  material.needsUpdate = true;
}
