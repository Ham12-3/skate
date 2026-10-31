"""Turn a video of a person into a skater animation clip, entirely on this PC (MediaPipe, no account).

Usage (from the project root):
  tools\\mocap\\.venv\\Scripts\\python.exe tools/mocap/video_to_clip.py my_push_video.mp4 push

Steps: MediaPipe finds 33 body landmarks in 3D on every frame -> gaps are filled and the motion is smoothed
-> landmark positions become joint rotations on a standard T-pose skeleton -> written as
tools/mocap/incoming/<name>.bvh -> tools/blender/retarget_mocap.py fits every clip in that folder onto
the game's skater (public/assets/mocap/skater_mocap.glb).

Name the clip after the skater state it should drive: idle, roll, push, crouch, air, land, grind, grab.
"""
import argparse
import glob
import math
import os
import subprocess
import sys

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions, vision

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
MODEL = os.path.join(HERE, 'models', 'pose_landmarker_heavy.task')
INCOMING = os.path.join(HERE, 'incoming')
RETARGET = os.path.join(ROOT, 'tools', 'blender', 'retarget_mocap.py')
MAX_WIDTH = 960

# MediaPipe pose landmark indices ("left" is the person's own left).
NOSE, L_EAR, R_EAR = 0, 7, 8
L_SH, R_SH, L_EL, R_EL, L_WR, R_WR = 11, 12, 13, 14, 15, 16
L_PINKY, R_PINKY, L_INDEX, R_INDEX = 17, 18, 19, 20
L_HIP, R_HIP, L_KNEE, R_KNEE, L_ANK, R_ANK = 23, 24, 25, 26, 27, 28
L_TOE, R_TOE = 31, 32

# T-pose skeleton: Y up, facing +Z, the person's left along +X, centimetres. (name, parent, offset)
JOINTS = [
    ('Hips', None, (0, 95, 0)), ('Spine', 'Hips', (0, 10, 0)), ('Spine1', 'Spine', (0, 15, 0)),
    ('Neck', 'Spine1', (0, 20, 0)), ('Head', 'Neck', (0, 10, 0)),
    ('LeftShoulder', 'Spine1', (5, 18, 0)), ('LeftArm', 'LeftShoulder', (12, 0, 0)),
    ('LeftForeArm', 'LeftArm', (25, 0, 0)), ('LeftHand', 'LeftForeArm', (22, 0, 0)),
    ('RightShoulder', 'Spine1', (-5, 18, 0)), ('RightArm', 'RightShoulder', (-12, 0, 0)),
    ('RightForeArm', 'RightArm', (-25, 0, 0)), ('RightHand', 'RightForeArm', (-22, 0, 0)),
    ('LeftUpLeg', 'Hips', (10, 0, 0)), ('LeftLeg', 'LeftUpLeg', (0, -42, 0)), ('LeftFoot', 'LeftLeg', (0, -40, 0)),
    ('RightUpLeg', 'Hips', (-10, 0, 0)), ('RightLeg', 'RightUpLeg', (0, -42, 0)), ('RightFoot', 'RightLeg', (0, -40, 0)),
]
END_SITES = {'Head': (0, 15, 0), 'LeftHand': (8, 0, 0), 'RightHand': (-8, 0, 0), 'LeftFoot': (0, -5, 12), 'RightFoot': (0, -5, 12)}
PARENT = {name: parent for name, parent, _ in JOINTS}
# Limb bones: rest direction (from the offsets above) and the landmarks giving their direction now.
LIMBS = {
    'LeftArm': ((1, 0, 0), L_SH, L_EL), 'LeftForeArm': ((1, 0, 0), L_EL, L_WR), 'LeftHand': ((1, 0, 0), L_WR, (L_INDEX, L_PINKY)),
    'RightArm': ((-1, 0, 0), R_SH, R_EL), 'RightForeArm': ((-1, 0, 0), R_EL, R_WR), 'RightHand': ((-1, 0, 0), R_WR, (R_INDEX, R_PINKY)),
    'LeftUpLeg': ((0, -1, 0), L_HIP, L_KNEE), 'LeftLeg': ((0, -1, 0), L_KNEE, L_ANK), 'LeftFoot': ((0, -5, 12), L_ANK, L_TOE),
    'RightUpLeg': ((0, -1, 0), R_HIP, R_KNEE), 'RightLeg': ((0, -1, 0), R_KNEE, R_ANK), 'RightFoot': ((0, -5, 12), R_ANK, R_TOE),
}


def detect(video, rotate):
    capture = cv2.VideoCapture(video)
    if not capture.isOpened():
        raise SystemExit(f'Could not open video: {video}')
    fps = capture.get(cv2.CAP_PROP_FPS) or 30
    options = vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=MODEL), running_mode=vision.RunningMode.VIDEO,
                                           min_pose_detection_confidence=.5, min_pose_presence_confidence=.5, min_tracking_confidence=.5)
    frames = []
    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        index = 0
        while True:
            ok, image = capture.read()
            if not ok:
                break
            if rotate:
                image = cv2.rotate(image, {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}[rotate])
            if image.shape[1] > MAX_WIDTH:
                scale = MAX_WIDTH / image.shape[1]
                image = cv2.resize(image, (MAX_WIDTH, round(image.shape[0] * scale)))
            rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            result = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(index * 1000 / fps))
            if result.pose_world_landmarks:
                # MediaPipe world space is x right, y down, z away from the camera; flip to y up, z toward it.
                frames.append(np.array([(p.x, -p.y, -p.z) for p in result.pose_world_landmarks[0]], dtype=np.float64))
            else:
                frames.append(None)
            index += 1
            if index % 30 == 0:
                print(f'  tracked {index} frames', flush=True)
    capture.release()
    return frames, fps


def fill_and_smooth(frames, sigma):
    found = [i for i, frame in enumerate(frames) if frame is not None]
    if len(found) < max(5, len(frames) * .5):
        raise SystemExit(f'A person was only found in {len(found)} of {len(frames)} frames. Keep the whole body in view, in good light.')
    data = np.stack([frames[i] for i in found])                      # (found, 33, 3)
    times = np.arange(len(frames))
    filled = np.empty((len(frames), 33, 3))
    for joint in range(33):
        for axis in range(3):
            filled[:, joint, axis] = np.interp(times, found, data[:, joint, axis])
    if sigma > 0:
        # Offline, so the filter can look ahead as well as back: a centred Gaussian over time.
        radius = int(math.ceil(sigma * 3))
        kernel = np.exp(-.5 * (np.arange(-radius, radius + 1) / sigma) ** 2)
        kernel /= kernel.sum()
        padded = np.pad(filled, ((radius, radius), (0, 0), (0, 0)), mode='edge')
        filled = np.stack([np.tensordot(kernel, padded[i:i + 2 * radius + 1], axes=(0, 0)) for i in range(len(frames))])
    return filled, len(frames) - len(found)


def normalise(v):
    length = np.linalg.norm(v)
    return v / length if length > 1e-9 else v


def frame_from(across, up):
    """Rotation whose X axis points along `across` (the person's left) and Y along `up`."""
    y = normalise(up)
    z = normalise(np.cross(across, y))
    return np.column_stack([np.cross(y, z), y, z])


def swing(a, b):
    """Smallest rotation taking unit vector a onto unit vector b."""
    a, b = normalise(a), normalise(b)
    axis = np.cross(a, b)
    s, c = np.linalg.norm(axis), float(np.dot(a, b))
    if s < 1e-9:
        if c > 0:
            return np.eye(3)
        axis = normalise(np.cross(a, [1, 0, 0] if abs(a[0]) < .9 else [0, 1, 0]))
        return rotation(axis, math.pi)
    return rotation(axis / s, math.atan2(s, c))


def rotation(axis, angle):
    x, y, z = axis
    k = np.array([[0, -z, y], [z, 0, -x], [-y, x, 0]])
    return np.eye(3) + math.sin(angle) * k + (1 - math.cos(angle)) * k @ k


def blend(a, b, t):
    """Rotation part-way from a to b (rotation-vector interpolation)."""
    delta = a.T @ b
    angle = math.acos(max(-1.0, min(1.0, (np.trace(delta) - 1) / 2)))
    if angle < 1e-6:
        return a
    axis = normalise(np.array([delta[2, 1] - delta[1, 2], delta[0, 2] - delta[2, 0], delta[1, 0] - delta[0, 1]]))
    return a @ rotation(axis, angle * t)


def pose_rotations(p):
    """World rotations of every joint for one frame of landmarks."""
    mid_hip, mid_sh, mid_ear = (p[L_HIP] + p[R_HIP]) / 2, (p[L_SH] + p[R_SH]) / 2, (p[L_EAR] + p[R_EAR]) / 2
    world = {}
    world['Hips'] = frame_from(p[L_HIP] - p[R_HIP], mid_sh - mid_hip)
    chest = frame_from(p[L_SH] - p[R_SH], mid_sh - mid_hip)
    world['Spine'] = blend(world['Hips'], chest, .5)
    world['Spine1'] = chest
    head = frame_from(p[L_EAR] - p[R_EAR], mid_ear - mid_sh)
    world['Neck'] = blend(chest, head, .5)
    world['Head'] = head
    world['LeftShoulder'] = world['RightShoulder'] = chest
    for name, _, _ in JOINTS:
        if name not in LIMBS:
            continue
        rest, start, end = LIMBS[name]
        tip = (p[end[0]] + p[end[1]]) / 2 if isinstance(end, tuple) else p[end]
        parent = world[PARENT[name]]
        carried = parent @ normalise(np.array(rest, dtype=np.float64))
        world[name] = swing(carried, tip - p[start]) @ parent
    return world


def euler_zxy(r):
    """BVH 'Zrotation Xrotation Yrotation' angles (degrees) for R = Rz @ Rx @ Ry."""
    x = math.asin(max(-1.0, min(1.0, r[2, 1])))
    y = math.atan2(-r[2, 0], r[2, 2])
    z = math.atan2(-r[0, 1], r[1, 1])
    return math.degrees(z), math.degrees(x), math.degrees(y)


def write_bvh(path, rotations, fps):
    children = {name: [c for c, parent, _ in JOINTS if parent == name] for name, _, _ in JOINTS}
    offsets = {name: offset for name, _, offset in JOINTS}

    def hierarchy(name, indent):
        tag = 'ROOT' if PARENT[name] is None else 'JOINT'
        channels = '6 Xposition Yposition Zposition' if PARENT[name] is None else '3'
        o = offsets[name]
        text = f'{indent}{tag} {name}\n{indent}{{\n{indent}  OFFSET {o[0]} {o[1]} {o[2]}\n{indent}  CHANNELS {channels} Zrotation Xrotation Yrotation\n'
        for child in children[name]:
            text += hierarchy(child, indent + '  ')
        if name in END_SITES:
            e = END_SITES[name]
            text += f'{indent}  End Site\n{indent}  {{\n{indent}    OFFSET {e[0]} {e[1]} {e[2]}\n{indent}  }}\n'
        return text + f'{indent}}}\n'

    order = []

    def walk(name):
        order.append(name)
        for child in children[name]:
            walk(child)
    walk('Hips')
    lines = []
    for world in rotations:
        values = [0.0, 95.0, 0.0]
        for name in order:
            parent = PARENT[name]
            local = world[name] if parent is None else world[parent].T @ world[name]
            values += euler_zxy(local)
        lines.append(' '.join(f'{v:.4f}' for v in values))
    with open(path, 'w') as handle:
        handle.write('HIERARCHY\n' + hierarchy('Hips', '') + f'MOTION\nFrames: {len(lines)}\nFrame Time: {1 / fps:.6f}\n' + '\n'.join(lines) + '\n')


def find_blender():
    found = sorted(glob.glob(r'C:\Program Files\Blender Foundation\Blender *\blender.exe'))
    return found[-1] if found else None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('video', help='video file of one person, whole body in view')
    parser.add_argument('name', help='clip name = skater state it drives (idle, roll, push, crouch, air, land, grind, grab)')
    parser.add_argument('--smooth', type=float, default=2.0, help='temporal smoothing in frames (0 = none, higher = steadier but softer)')
    parser.add_argument('--rotate', type=int, choices=(0, 90, 180, 270), default=0, help='rotate frames clockwise if the video comes out sideways')
    parser.add_argument('--start', type=float, default=0, help='seconds to trim from the start')
    parser.add_argument('--end', type=float, default=0, help='keep up to this many seconds (0 = to the end)')
    parser.add_argument('--no-retarget', action='store_true', help='only write the BVH, skip the Blender step')
    parser.add_argument('--blender', default=find_blender(), help='path to blender.exe')
    args = parser.parse_args()

    print(f'Tracking {args.video} ...')
    frames, fps = detect(args.video, args.rotate)
    first = int(args.start * fps)
    last = int(args.end * fps) if args.end > 0 else len(frames)
    frames = frames[first:last]
    landmarks, missing = fill_and_smooth(frames, args.smooth)
    print(f'{len(frames)} frames at {fps:.0f} fps; person not found in {missing} (filled in)')
    os.makedirs(INCOMING, exist_ok=True)
    out = os.path.join(INCOMING, f'{args.name.lower()}.bvh')
    write_bvh(out, [pose_rotations(p) for p in landmarks], fps)
    print('Wrote', out)
    if args.no_retarget:
        return
    if not args.blender or not os.path.exists(args.blender):
        raise SystemExit('Blender not found; pass --blender "path\\to\\blender.exe" or run tools/blender/retarget_mocap.py yourself.')
    print('Fitting clips onto the skater with Blender ...')
    subprocess.run([args.blender, '-b', '--python', RETARGET, '--', INCOMING], check=True)


if __name__ == '__main__':
    sys.exit(main())
