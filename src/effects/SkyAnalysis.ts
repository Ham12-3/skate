import * as THREE from 'three';

export interface SkyLight {
  // Direction toward the sun, if the sky has a clear one.
  sunDirection?: THREE.Vector3;
  // Sun tint, normalised so its brightest channel is 1 (linear).
  sunColor: THREE.Color;
  // Average radiance just above the horizon (linear), for fog that melts into the sky.
  horizonColor: THREE.Color;
  // False for night skies, whose brightest spot is a street lamp rather than a sun.
  daylight: boolean;
  // Irradiance in the HDR's own units: from the whole sky onto flat ground, and from the sun disk
  // onto a surface facing it. Comparable directly with environment lighting at intensity 1.
  skyIrradiance: number;
  sunIrradiance: number;
}

const SAMPLE_WIDTH = 512;

// Read an equirectangular HDR sky and find where its light comes from, so the shadow-casting sun
// matches the sun visible in the sky and the fog matches its horizon.
export function analyzeSky(texture: THREE.Texture): SkyLight {
  const result: SkyLight = { sunColor: new THREE.Color(1, 1, 1), horizonColor: new THREE.Color(.6, .65, .7), daylight: false, skyIrradiance: 0, sunIrradiance: 0 };
  const image = texture.image as { data?: ArrayLike<number>; width: number; height: number } | undefined;
  const data = image?.data;
  if (!image || !data) return result;
  const { width, height } = image;
  const channels = data.length / (width * height);
  const half = texture.type === THREE.HalfFloatType;
  const read = (index: number): number => half ? THREE.DataUtils.fromHalfFloat(data[index]!) : data[index]!;
  const step = Math.max(1, Math.floor(width / SAMPLE_WIDTH));
  // Row 0 is the top of the image; flipY puts it at the zenith.
  const pixel = (column: number, row: number): [number, number, number] => {
    const index = (row * width + column) * channels;
    return [read(index), read(index + 1), read(index + 2)];
  };
  const luminance = ([r, g, b]: [number, number, number]): number => .2126 * r + .7152 * g + .0722 * b;
  const elevationOf = (row: number): number => (.5 - (row + .5) / height) * Math.PI;
  // Solid angle of one equirect pixel shrinks toward the poles.
  const solidAngle = (row: number): number => (2 * Math.PI / width) * (Math.PI / height) * Math.cos(elevationOf(row));

  let brightest = 0, brightColumn = 0, brightRow = 0, skyTotal = 0, skyCount = 0;
  const horizon = [0, 0, 0];
  let horizonCount = 0;
  for (let row = 0; row < height / 2; row += step) {
    for (let column = 0; column < width; column += step) {
      const colour = pixel(column, row);
      const value = luminance(colour);
      skyTotal += value; skyCount++;
      result.skyIrradiance += value * Math.sin(elevationOf(row)) * solidAngle(row) * step * step;
      if (value > brightest) { brightest = value; brightColumn = column; brightRow = row; }
      if (row > height * .44) { horizon[0] += colour[0]; horizon[1] += colour[1]; horizon[2] += colour[2]; horizonCount++; }
    }
  }
  if (horizonCount) result.horizonColor.setRGB(horizon[0]! / horizonCount, horizon[1]! / horizonCount, horizon[2]! / horizonCount);

  // A real sun is a tiny spot far brighter than the rest of the sky; overcast skies have none.
  const average = skyTotal / Math.max(1, skyCount);
  result.daylight = average > .2;
  if (!result.daylight || brightest < average * 8) return result;
  // Centroid of the hot spot, weighted by brightness, for a direction steadier than a single pixel.
  const radius = Math.max(4, Math.round(width / 64));
  let weight = 0, sumColumn = 0, sumRow = 0;
  const sun = [0, 0, 0];
  for (let row = Math.max(0, brightRow - radius); row <= Math.min(height - 1, brightRow + radius); row++) {
    for (let offset = -radius; offset <= radius; offset++) {
      const column = (brightColumn + offset + width) % width;
      const colour = pixel(column, row);
      const value = luminance(colour);
      if (value > brightest * .01) result.sunIrradiance += value * solidAngle(row);
      if (value < brightest * .5) continue;
      weight += value; sumColumn += (brightColumn + offset) * value; sumRow += row * value;
      sun[0] += colour[0]; sun[1] += colour[1]; sun[2] += colour[2];
    }
  }
  const u = (sumColumn / weight + .5) / width;
  const v = 1 - (sumRow / weight + .5) / height;
  // Inverse of three.js's equirect lookup: u = atan(z, x) / 2π + 0.5, v = asin(y) / π + 0.5.
  const azimuth = (u - .5) * Math.PI * 2;
  const elevation = (v - .5) * Math.PI;
  if (elevation < THREE.MathUtils.degToRad(3)) return result;
  result.sunDirection = new THREE.Vector3(Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.sin(azimuth) * Math.cos(elevation));
  const peak = Math.max(sun[0]!, sun[1]!, sun[2]!, 1e-6);
  result.sunColor.setRGB(sun[0]! / peak, sun[1]! / peak, sun[2]! / peak);
  return result;
}
