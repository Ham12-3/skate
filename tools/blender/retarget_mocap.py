"""Retarget motion-capture clips (Rokoko Vision FBX, or any FBX/BVH humanoid) onto the game's skater rig.

Usage (from the project root):
  blender -b --python tools/blender/retarget_mocap.py -- tools/mocap/incoming

Every .fbx/.bvh in the folder becomes one animation named after its file, e.g. push.fbx -> "push".
Name files after the game states the clip should drive: idle, roll, push, crouch, air, land, grind, grab.
Output: public/assets/mocap/skater_mocap.glb (the skater skeleton plus all clips, rotations only).

How it works: each source bone's world-space rotation, relative to its rest pose, is applied to the
matching skater bone. Rest poses differ (mocap rigs rest in a T-pose, the skater with arms down), so the
skater's rest is first turned to line its bones up with the source's rest. The clip is also turned so the
actor faces the skater's forward on its first frame. Root motion is dropped; the game moves the rider.
"""
import os
import re
import sys

import bpy
from mathutils import Quaternion, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RIG_FILE = os.path.join(ROOT, 'tools', 'asset-backups', 'skater.blend')
OUT = os.path.join(ROOT, 'public', 'assets', 'mocap', 'skater_mocap.glb')
TARGET_FORWARD = Vector((0, -1, 0))  # the skater faces -Y in Blender

# Source bone names seen in Rokoko (default, "Character1_" and legacy presets), Mixamo ("mixamorig:") and
# BVH exports, normalised (prefix stripped, lower case, letters/digits only) -> anatomical role.
ALIASES = {
    'hips': 'hips', 'pelvis': 'hips', 'root': 'hips',
    'neck': 'neck', 'neck1': 'neck', 'head': 'head',
}
for side, letter in (('left', 'L'), ('right', 'R')):
    for names, role in (
        (('shoulder', 'collar', 'clavicle'), 'shoulder'),
        (('arm', 'upperarm', 'shoulderjoint'), 'upper_arm'),
        (('forearm', 'elbow', 'lowerarm'), 'forearm'),
        (('hand', 'wrist'), 'hand'),
        (('upleg', 'hip', 'thigh', 'upperleg'), 'thigh'),
        (('leg', 'knee', 'shin', 'lowerleg', 'calf'), 'shin'),
        (('foot', 'ankle'), 'foot'),
    ):
        for name in names:
            ALIASES[side + name] = f'{role}_{letter}'
            ALIASES[name + side] = f'{role}_{letter}'

# The skater's bone names are mirrored relative to the body: "_l" bones sit on the anatomical right.
TARGET_BONE = {'hips': 'hips', 'spine': 'spine', 'chest': 'chest', 'neck': 'neck', 'head': 'head'}
for role in ('shoulder', 'upper_arm', 'forearm', 'hand', 'thigh', 'shin', 'foot'):
    TARGET_BONE[f'{role}_L'] = f'{role}_r'
    TARGET_BONE[f'{role}_R'] = f'{role}_l'


def normalise(name):
    name = name.split(':')[-1]
    name = re.sub(r'^character\d*_', '', name, flags=re.I)
    return re.sub(r'[^a-z0-9]', '', name.lower())


def depth(bone):
    return 0 if bone.parent is None else 1 + depth(bone.parent)


def world_rotation(obj, matrix):
    return (obj.matrix_world @ matrix).decompose()[1]


def world_point(obj, point):
    return obj.matrix_world @ point


def yaw_between(a, b):
    """Rotation about Z taking horizontal direction a onto horizontal direction b."""
    a = Vector((a.x, a.y, 0)).normalized()
    b = Vector((b.x, b.y, 0)).normalized()
    return a.rotation_difference(b)


def map_bones(source):
    roles = {}
    spine = []
    for bone in source.data.bones:
        key = normalise(bone.name)
        if key.startswith('spine') or key.startswith('chest') or key in ('torso', 'abdomen'):
            spine.append(bone)
        elif key in ALIASES and ALIASES[key] not in roles:
            roles[ALIASES[key]] = bone.name
    # Lowest spine bone drives the skater's spine, the topmost (just under the neck) its chest.
    spine.sort(key=depth)
    if spine:
        roles['spine'] = spine[0].name
        roles['chest'] = spine[-1].name
    missing = [role for role in ('hips', 'spine', 'thigh_L', 'thigh_R', 'shin_L', 'shin_R') if role not in roles]
    if missing:
        raise RuntimeError(f'{source.name}: could not find bones for {missing}. Bones: {[b.name for b in source.data.bones]}')
    return {TARGET_BONE[role]: name for role, name in roles.items()}


def facing(obj, left_thigh, right_thigh, posed):
    get = (lambda name: obj.pose.bones[name].head) if posed else (lambda name: obj.data.bones[name].head_local)
    across = world_point(obj, get(right_thigh)) - world_point(obj, get(left_thigh))
    return Vector((0, 0, 1)).cross(across)


def import_source(path):
    before = set(bpy.data.objects)
    if path.lower().endswith('.bvh'):
        bpy.ops.import_anim.bvh(filepath=path, rotate_mode='NATIVE', update_scene_fps=False, update_scene_duration=False)
    else:
        bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=True)
    created = [obj for obj in bpy.data.objects if obj not in before]
    armatures = [obj for obj in created if obj.type == 'ARMATURE']
    if not armatures:
        raise RuntimeError(f'{path}: no armature found')
    return armatures[0], created


def retarget(rig, source, clip):
    mapping = map_bones(source)
    roles = {TARGET_BONE[r]: r for r in TARGET_BONE}
    left = mapping[TARGET_BONE['thigh_L']]
    right = mapping[TARGET_BONE['thigh_R']]
    # Turn the source so its rest pose faces the skater's way.
    rest_turn = yaw_between(facing(source, left, right, False), TARGET_FORWARD)
    rig_rotation = rig.matrix_world.decompose()[1]
    ordered = sorted(rig.pose.bones, key=lambda b: depth(b.bone))
    rest = {b.name: b.bone.matrix_local.to_quaternion() for b in ordered}
    # The skater's rest, re-aimed so each mapped bone points where the source bone points at rest.
    virtual_rest = {}
    source_rest_inverse = {}
    for bone in ordered:
        name = mapping.get(bone.name)
        if not name:
            continue
        source_bone = source.data.bones[name]
        source_direction = rest_turn @ (source.matrix_world.to_3x3() @ (source_bone.tail_local - source_bone.head_local))
        target_direction = rig.matrix_world.to_3x3() @ (bone.bone.tail_local - bone.bone.head_local)
        align = target_direction.normalized().rotation_difference(source_direction.normalized())
        virtual_rest[bone.name] = align @ rig_rotation @ rest[bone.name]
        source_rest_inverse[bone.name] = (rest_turn @ world_rotation(source, source_bone.matrix_local)).inverted()

    action = source.animation_data.action if source.animation_data else None
    if action is None:
        raise RuntimeError(f'{clip}: source has no animation')
    start, end = (int(round(v)) for v in action.frame_range)
    scene = bpy.context.scene
    scene.frame_set(start)
    # Face the skater's forward on the first frame; turning during the clip is kept.
    first_turn = yaw_between(rest_turn @ facing(source, left, right, True), TARGET_FORWARD) @ rest_turn

    rig.animation_data_create()
    rig.animation_data.action = bpy.data.actions.new(clip)
    for bone in ordered:
        bone.rotation_mode = 'QUATERNION'
    for frame in range(start, end + 1):
        scene.frame_set(frame)
        posed = {}
        for bone in ordered:
            parent = bone.parent
            name = mapping.get(bone.name)
            if name:
                current = first_turn @ world_rotation(source, source.pose.bones[name].matrix)
                desired = rig_rotation.inverted() @ current @ source_rest_inverse[bone.name] @ virtual_rest[bone.name]
            elif parent:
                desired = posed[parent.name] @ rest[parent.name].inverted() @ rest[bone.name]
            else:
                desired = rest[bone.name]
            posed[bone.name] = desired
            base = posed[parent.name] @ rest[parent.name].inverted() @ rest[bone.name] if parent else rest[bone.name]
            bone.rotation_quaternion = base.inverted() @ desired
            bone.keyframe_insert('rotation_quaternion', frame=frame - start + 1)
    clip_action = rig.animation_data.action
    track = rig.animation_data.nla_tracks.new()
    track.name = clip
    track.strips.new(clip, 1, clip_action)
    rig.animation_data.action = None
    for bone in ordered:
        bone.rotation_quaternion = Quaternion()
    print(f'{clip}: {end - start + 1} frames, bones {sorted(mapping)}' + (f', unmapped {sorted(set(roles) - set(mapping))}' if set(roles) - set(mapping) else ''))


def main():
    folder = os.path.abspath(sys.argv[sys.argv.index('--') + 1]) if '--' in sys.argv else os.path.join(ROOT, 'tools', 'mocap', 'incoming')
    files = sorted(f for f in os.listdir(folder) if f.lower().endswith(('.fbx', '.bvh')))
    if not files:
        raise SystemExit(f'No .fbx or .bvh clips in {folder}')
    bpy.ops.wm.open_mainfile(filepath=RIG_FILE)
    rig = bpy.data.objects['skater_rig']
    # Drop the old hand-keyed poses so only the mocap clips are exported.
    if rig.animation_data:
        for track in list(rig.animation_data.nla_tracks):
            rig.animation_data.nla_tracks.remove(track)
        rig.animation_data.action = None
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    for file in files:
        source, created = import_source(os.path.join(folder, file))
        retarget(rig, source, os.path.splitext(file)[0].lower())
        for obj in created:
            bpy.data.objects.remove(obj, do_unlink=True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True,
                              export_animation_mode='NLA_TRACKS', export_def_bones=True)
    print('Wrote', OUT)


main()
