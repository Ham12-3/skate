export const CONFIG = {
  physics: {
    fixedStep: 1 / 60,
    maxFrameDelta: 0.1,
    gravity: -9.81,
    groundRayLength: 4,
    groundProbeHeight: 0.5,
    groundSnapDown: 0.06,
    stepUpTolerance: 0.08,
    truckOffset: 0.27,
    renderNormalSmoothing: 14,
    airAlignRate: 6,
    wallRayHeight: 0.35,
    wallRayDistance: 0.48,
    // Impact speed into an obstacle (m/s): below runOutSpeed the board just bumps to a stop; above it the
    // rider steps off and runs it out (combo lost, no slam); only above the bail speeds do they slam.
    runOutSpeed: 1.5,
    wallBailSpeed: 6,
    curbBailSpeed: 5.5,
    wallRestitution: 0.15,
    // Contacts closer to head-on than this (cosine of the angle off the face normal) stop the board;
    // shallower ones glance off, scrubbing up to (1 - glanceRetention) of the speed along the edge.
    headOnContact: 0.85,
    glanceRetention: 0.85,
    // Quadratic drag factor ½ρ·CdA/m for a 75 kg skater (CdA ≈ 0.45 m²).
    airDrag: 0.0037,
    // Impact speed into the landing surface; 13 m/s is roughly an 8.6 m drop to flat.
    landingBailImpact: 13,
    fallRespawnY: -35,
    // After a slam the rider comes back at a flat spot they passed at least this long before it.
    respawnLookback: 1,
    safeSampleInterval: 0.25,
    safeHistory: 24,
  },
  // Rolling resistance coefficients (deceleration = μ·g) for urethane wheels, keyed by level texture.
  surfaces: {
    concrete: 0.012,
    wood_ramp: 0.009,
    asphalt: 0.02,
    stone_plaza: 0.015,
    brick: 0.03,
    metal_rail: 0.01,
    gravel: 0.09,
    sand: 0.15,
    grass: 0.2,
  },
  movement: {
    pushImpulse: 1.5,
    pushCooldown: 0.7,
    maxPushSpeed: 7,
    pushMaxSlope: 0.97,
    pumpAcceleration: 1.2,
    absoluteMaxSpeed: 30,
    feedbackSpeed: 15,
    brakeDeceleration: 3.5,
    steerSmoothing: 6,
    minTurnRadius: 1.8,
    maxLateralAcceleration: 5.4,
    carveScrub: 0.04,
    kickturnRate: 2.4,
    kickturnMaxSpeed: 1.2,
    vertReentrySpeed: 0.5,
    revertRate: 9,
    // Turning rate in the air from A/D (rad/s). Real skaters can't steer mid-air, so 0 here.
    airSteer: 0,
    landingYawTolerance: 35,
    boardSteerTilt: 0.18,
    wheelRadius: 0.055,
    spawnClearance: 0.18,
  },
  ollie: {
    minHold: 0.1,
    maxHold: 0.6,
    // Vertical pop speed: 2.8 m/s ≈ 0.4 m ollie, 4.5 m/s ≈ 1.03 m (near the world record).
    minJumpForce: 2.8,
    maxJumpForce: 4.5,
    grindJumpForce: 3.2,
    surfacePopBlend: 0.5,
  },
  tricks: {
    kickflipDuration: 0.34,
    heelflipDuration: 0.34,
    shoveitDuration: 0.28,
    kickflipScore: 500,
    heelflipScore: 500,
    shoveitScore: 400,
    spin180Score: 300,
    spin360Score: 700,
    spin540Score: 1200,
    spinDegreesPerSecond: 450,
    grabTickDuration: 0.5,
    grabTickScore: 100,
    cleanLandingAngle: 20,
    sketchyLandingAngle: 35,
    cleanLandingBonus: 100,
    revertScore: 150,
    hardLandingVelocity: 6,
  },
  grind: {
    snapHorizontalDistance: 0.55,
    snapVerticalDistance: 0.7,
    minimumSpeed: 2,
    minimumAlignment: 0.35,
    scorePerSecond: 200,
    balanceCorrection: 1.25,
    balanceDrift: 0.22,
    balanceDurationRamp: 0.045,
    balanceNoiseInterval: 0.55,
    metalFriction: 0.1,
    concreteFriction: 0.16,
    boardslideFrictionScale: 1.6,
    stallSpeed: 1,
    relockDelay: 0.25,
  },
  finish: {
    // Crossing a finish line banks the open trick chain and adds this, plus a bonus per second left.
    bonus: 1000,
    timeBonus: 25,
  },
  combo: {
    bankDelay: 1,
    slowMotionCombo: 5,
    slowMotionDuration: 0.3,
    slowMotionScale: 0.35,
  },
  animation: {
    poseSmoothing: 10,
    // Foot placement along the board (board space, metres; +z is the nose).
    frontFootZ: 0.15,
    backFootZ: -0.29,
    ollieFrontFootZ: 0.05,
    ollieBackFootZ: -0.36,
    ollieSlide: 0.2,
    frontFootAngle: 35,
    backFootAngle: -8,
    // Hips bone height above the deck, and how far each stance drops it.
    standHeight: 0.8,
    rideHeight: 0.75,
    speedTuck: 0.07,
    crouchDrop: 0.28,
    tuckDrop: 0.36,
    pushDrop: 0.13,
    maxCarveLean: 0.45,
    hipOpen: 0.18,
    shoulderOpen: 0.32,
    pushOpen: 0.75,
    headLook: 0.85,
    pushContactStart: 0.2,
    pushContactEnd: 0.6,
    pushStride: 0.65,
    pushFootSide: 0.24,
    // Ollie: the tail snaps down, the nose pitches up, then the front foot levels it out.
    popPitch: 0.5,
    popRiseTime: 0.07,
    popLevelTime: 0.24,
    flipLift: 0.16,
    grabLift: 0.12,
    landingStiffness: 140,
    landingDamping: 0.7,
    landingImpactScale: 0.22,
    maxCompression: 0.3,
  },
  ragdoll: {
    // Roughly the density of a human body, so the capsules add up to a ~60-70 kg rider.
    density: 985,
    friction: 0.8,
    restitution: 0.05,
    linearDamping: 0.05,
    angularDamping: 1.5,
    kneeMaxBend: 2.5,
    elbowMaxBend: 2.6,
    // When the board stops dead the feet stop with it and the body pitches over the top.
    tripLegSpeed: 0.3,
    // How far (radians, per axis) each ball joint may rotate away from the pose at the bail.
    waistRange: 0.5,
    neckRange: 0.6,
    shoulderRange: 1.6,
    hipRange: 1.3,
    boardDensity: 240,
    boardSpin: 6,
  },
  camera: {
    distance: 6.2,
    minDistance: 2.2,
    maxDistance: 10,
    height: 2.8,
    smoothing: 8,
    lookSmoothing: 11,
    collisionPadding: 0.35,
    baseFov: 62,
    speedFovBoost: 10,
    speedPullback: 2,
    shakeLanding: 0.16,
    shakeBail: 0.42,
    shakeDecay: 4,
    // Filmer rigs, as in real skate footage: where the filmer rides relative to the skater and with what lens.
    // behind/side/height in metres (height above the ground, which the filmer stays on during airs),
    // fov is the vertical field of view, follow/lag are how quickly the filmer matches position/heading.
    fisheye: { behind: 2.4, side: 0.7, height: 0.85, fov: 80, follow: 6, lag: 3.5, look: 10, handheld: 1, speedFov: 4 },
    longlens: { behind: 9, side: 3.5, height: 1.5, fov: 30, follow: 3, lag: 2, look: 6, handheld: 0.5, speedFov: 0 },
    // Barrel distortion of the fisheye lens (0 = rectilinear) and how fast the filmer's ground height catches up after a drop.
    fisheyeStrength: 0.35,
    groundLag: 2.5,
  },
  character: {
    animationBlend: 0.15,
    bailDuration: 2,
    respawnInvulnerability: 0.6,
    pedestrianHitDistance: 0.8,
    breathingSpeed: 2,
    steeringLean: 0.28,
    accelerationLean: 0.08,
    speedLean: 0.08,
  },
  effects: {
    landingDustCount: 24,
    pushDustCount: 8,
    grindSparkCount: 3,
    particleLife: 0.65,
    speedLineThreshold: 0.82,
  },
  audio: {
    defaultMusicVolume: 0.45,
    defaultSoundVolume: 0.7,
    musicFadeSpeed: 2,
    rollMaxVolume: 0.34,
    rollMinPitch: 0.65,
    rollMaxPitch: 1.8,
  },
  ui: {
    tutorialDuration: 20,
    trickPopupDuration: 1.1,
    fpsSampleDuration: 0.25,
  },
  rendering: {
    // Show the HDRI as the sky (daytime levels), so the visible sun and the lighting agree.
    hdriBackground: true,
    backgroundIntensity: 1,
    environmentIntensity: 1,
    // Image-based light from the HDRI does the fill; the old hemisphere light only tops it up.
    ambientScale: 0.3,
    // How far each level's authored sun colour leans toward the colour measured in its HDRI.
    sunColorFromSky: 0.25,
    // The sun disk in these 2k HDRIs is hazy or clipped; never let it fall below this multiple of the
    // sky's own irradiance (real daylight runs roughly 3-8x).
    minSunToSky: 3,
    fogDensity: 0.0055,
    exposure: 1,
    // Two cascades over 100 m: a sharp one near the rider, a coarse one out to where fog takes over.
    shadowCascades: 2,
    shadowMaxFar: 100,
    shadowBias: -0.0002,
    maxPixelRatio: 1.75,
    minPixelRatio: 0.85,
    pixelRatioStep: 0.15,
    resolutionAdjustInterval: 2,
    resolutionDownFps: 50,
    resolutionUpFps: 58,
    shadowMapSize: 2048,
  },
  post: {
    ssaoKernelRadius: 8,
    ssaoMinDistance: 0.0008,
    ssaoMaxDistance: 0.08,
    ssaoDisableFps: 45,
    bloomEnabled: true,
    bloomThreshold: 1.15,
    bloomStrength: 0.12,
    bloomRadius: 0.35,
    gradeContrast: 0.25,
    gradeSaturation: 1.12,
    vignette: 0.22,
    grain: 0.025,
  },
} as const;

export type DeckChoice = 1 | 2 | 3 | 4;
export type HandlingMode = 'arcade' | 'realistic';

type Sections = 'physics' | 'movement' | 'ollie' | 'tricks';
type Overrides = { [S in Sections]?: Partial<Record<keyof (typeof CONFIG)[S], number>> };

// The values above are real-world numbers. Arcade handling layers faster pushing, bigger air,
// snappier steering, air control and more forgiving curbs on top; Realistic uses them as they are.
const HANDLING: Record<HandlingMode, Overrides> = {
  arcade: {
    // Pushing to ~40 km/h, sidewalk curbs roll up, and only hard hits throw the rider.
    physics: { airDrag: 0.002, stepUpTolerance: 0.22, runOutSpeed: 3, curbBailSpeed: 7, wallBailSpeed: 9, landingBailImpact: 16 },
    movement: { pushImpulse: 2.6, pushCooldown: 0.42, maxPushSpeed: 11, steerSmoothing: 14, minTurnRadius: 1.3, maxLateralAcceleration: 9, kickturnRate: 3.6, airSteer: 1.2 },
    // Ollies from ~1.3 m (tap) to ~2.9 m (full charge), with time for a trick or two.
    ollie: { minJumpForce: 5, maxJumpForce: 7.5, grindJumpForce: 5 },
    tricks: { kickflipDuration: 0.3, heelflipDuration: 0.3, shoveitDuration: 0.25 },
  },
  realistic: {},
};

const BASELINE = structuredClone({ physics: CONFIG.physics, movement: CONFIG.movement, ollie: CONFIG.ollie, tricks: CONFIG.tricks });

export function applyHandling(mode: HandlingMode): void {
  for (const section of Object.keys(BASELINE) as Sections[]) {
    Object.assign(CONFIG[section] as unknown as Record<string, number>, BASELINE[section], HANDLING[mode][section]);
  }
}
