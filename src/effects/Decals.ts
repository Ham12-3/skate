import * as THREE from 'three';

export type DecalKind = 'oil' | 'skid' | 'crack' | 'gum';

// Atlas cell (column, row) for each kind in the 2x2 grime atlas.
const CELLS: Record<DecalKind, [number, number]> = { oil: [0, 0], skid: [1, 0], crack: [0, 1], gum: [1, 1] };
const CELL = 512;

const random = (seed: number): (() => number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

let atlas: THREE.CanvasTexture | undefined;
const geometries = new Map<DecalKind, THREE.BufferGeometry>();
const materials = new Map<DecalKind, THREE.MeshStandardMaterial>();

// Grime drawn procedurally once: oil stains, wheel/wax streaks, hairline cracks and trodden-in gum.
function grimeAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = CELL * 2;
  const context = canvas.getContext('2d')!;
  const next = random(7);
  const cell = (kind: DecalKind, draw: () => void): void => {
    const [column, row] = CELLS[kind];
    context.save();
    context.beginPath(); context.rect(column * CELL, row * CELL, CELL, CELL); context.clip();
    context.translate(column * CELL, row * CELL);
    draw();
    context.restore();
  };
  cell('oil', () => {
    // Many faint overlapping blots build an irregular stain with a darker core.
    context.filter = 'blur(6px)';
    for (let i = 0; i < 90; i++) {
      const angle = next() * Math.PI * 2, distance = Math.pow(next(), 1.6) * 170;
      const x = 256 + Math.cos(angle) * distance, y = 256 + Math.sin(angle) * distance * .8, radius = 20 + next() * 70;
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(14,12,10,${.2 + next() * .14})`);
      gradient.addColorStop(1, 'rgba(14,12,10,0)');
      context.fillStyle = gradient; context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
    }
  });
  cell('skid', () => {
    // Long rubber/wax streaks running along the cell's length.
    context.filter = 'blur(2px)';
    context.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const y = 120 + next() * 272, start = 30 + next() * 120, end = 360 + next() * 120;
      context.strokeStyle = `rgba(18,16,14,${.08 + next() * .22})`;
      context.lineWidth = 2 + next() * 9;
      context.beginPath(); context.moveTo(start, y); context.bezierCurveTo(200, y + (next() - .5) * 30, 320, y + (next() - .5) * 30, end, y + (next() - .5) * 20); context.stroke();
    }
  });
  cell('crack', () => {
    // Branching random walks for hairline cracks.
    context.filter = 'none';
    context.lineCap = 'round';
    const walk = (x: number, y: number, angle: number, steps: number, width: number): void => {
      context.lineWidth = width; context.strokeStyle = `rgba(10,9,8,${.55 + next() * .3})`;
      context.beginPath(); context.moveTo(x, y);
      for (let i = 0; i < steps; i++) {
        angle += (next() - .5) * .9; x += Math.cos(angle) * 9; y += Math.sin(angle) * 9;
        context.lineTo(x, y);
        if (next() < .06 && width > .8) { context.stroke(); walk(x, y, angle + (next() - .5) * 2, steps / 2, width * .6); context.beginPath(); context.moveTo(x, y); }
      }
      context.stroke();
    };
    for (let i = 0; i < 3; i++) walk(40 + next() * 60, 150 + next() * 200, (next() - .5) * .6, 46, 2.6);
  });
  cell('gum', () => {
    // Flattened gum: small dark discs with a lighter rim, plus fine dirt specks.
    context.filter = 'blur(.6px)';
    for (let i = 0; i < 70; i++) {
      const x = 20 + next() * 472, y = 20 + next() * 472, radius = 3 + Math.pow(next(), 2) * 11;
      context.fillStyle = `rgba(${next() < .3 ? '120,116,110' : '28,26,24'},${.45 + next() * .4})`;
      context.beginPath(); context.ellipse(x, y, radius, radius * (.7 + next() * .3), next() * Math.PI, 0, Math.PI * 2); context.fill();
    }
    for (let i = 0; i < 400; i++) { context.fillStyle = `rgba(30,28,25,${next() * .35})`; context.fillRect(next() * 512, next() * 512, 1.5, 1.5); }
  });
  atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 8;
  return atlas;
}

function decalGeometry(kind: DecalKind): THREE.BufferGeometry {
  let geometry = geometries.get(kind);
  if (geometry) return geometry;
  geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const [column, row] = CELLS[kind];
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  // Canvas row 0 is the top of the texture (flipY), so atlas rows count down from v = 1.
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (column + uv.getX(i)) * .5, 1 - (row + 1 - uv.getY(i)) * .5);
  geometries.set(kind, geometry);
  return geometry;
}

function decalMaterial(kind: DecalKind): THREE.MeshStandardMaterial {
  let material = materials.get(kind);
  if (material) return material;
  // Oil leaves a slick, glossier patch; everything else is matte dirt.
  material = new THREE.MeshStandardMaterial({ map: grimeAtlas(), transparent: true, depthWrite: false, roughness: kind === 'oil' ? .35 : .95,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  materials.set(kind, material);
  return material;
}

export interface DecalPlacement { position: THREE.Vector3; normal: THREE.Vector3; yaw: number; width: number; length: number }

// One instanced mesh per kind; geometry, material and atlas are shared across levels.
export function createDecals(kind: DecalKind, placements: DecalPlacement[]): THREE.InstancedMesh | undefined {
  if (!placements.length) return undefined;
  const mesh = new THREE.InstancedMesh(decalGeometry(kind), decalMaterial(kind), placements.length);
  const matrix = new THREE.Matrix4();
  placements.forEach((placement, index) => {
    const align = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), placement.normal);
    const rotation = align.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.yaw));
    mesh.setMatrixAt(index, matrix.compose(placement.position.clone().addScaledVector(placement.normal, .004), rotation, new THREE.Vector3(placement.length, 1, placement.width)));
  });
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.userData.sharedAsset = true;
  return mesh;
}

export { random as seededRandom };
