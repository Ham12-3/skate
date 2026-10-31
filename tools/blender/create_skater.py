import bpy, math, os, shutil
from mathutils import Vector, Quaternion

ROOT=r'C:\Users\mobol\Downloads\skate-board'
OUT=os.path.join(ROOT,'public','assets','models','skater.glb')
BACKUP=os.path.join(ROOT,'tools','asset-backups')
os.makedirs(BACKUP,exist_ok=True)
if os.path.exists(OUT):shutil.copy2(OUT,os.path.join(BACKUP,'skater-procedural.glb'))
bpy.ops.object.select_all(action='DESELECT')
coll=bpy.data.collections.get('Kickflip_Skater')
if coll:
    for obj in list(coll.objects):bpy.data.objects.remove(obj,do_unlink=True)
    bpy.data.collections.remove(coll)
coll=bpy.data.collections.new('Kickflip_Skater');bpy.context.scene.collection.children.link(coll)

def move(obj):
    for old in list(obj.users_collection):old.objects.unlink(obj)
    coll.objects.link(obj)
    return obj

def mat(name,color,rough=.6,metal=0,subsurface=0):
    m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*color,1)
    bs=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=rough;bs.inputs['Metallic'].default_value=metal
    bs.inputs['Subsurface Weight'].default_value=subsurface
    return m

skin=mat('Warm skin',(.52,.29,.17),.48,0,.07)
hoodie=mat('Burnt orange cotton hoodie',(.72,.105,.025),.86)
hoodie_dark=mat('Hoodie seams and cuffs',(.38,.045,.012),.9)
pants=mat('Charcoal cargo twill',(.045,.065,.085),.88)
pants_seam=mat('Cargo stitching',(.12,.15,.17),.82)
capmat=mat('Navy canvas cap',(.025,.04,.065),.82)
cream=mat('Trainer leather',(.78,.76,.66),.5)
sole=mat('Rubber sole',(.19,.21,.22),.8)
white=mat('Eye whites',(.82,.84,.8),.35)
black=mat('Eyes and hair',(.012,.009,.008),.4)
lip=mat('Natural lips',(.28,.095,.065),.55)
metal=mat('Cap and shoe details',(.65,.7,.72),.28,.65)

bone_positions={
 'hips':((0,0,.91),(0,0,1.07),None),
 'spine':((0,0,1.07),(0,0,1.24),'hips'),
 'chest':((0,0,1.24),(0,0,1.43),'spine'),
 'neck':((0,0,1.43),(0,0,1.53),'chest'),
 'head':((0,0,1.53),(0,0,1.76),'neck'),
}
for side,sign in [('l',-1),('r',1)]:
    bone_positions['shoulder_'+side]=((sign*.19,0,1.4),(sign*.29,0,1.37),'chest')
    bone_positions['upper_arm_'+side]=((sign*.29,0,1.37),(sign*.35,-.01,1.14),'shoulder_'+side)
    bone_positions['forearm_'+side]=((sign*.35,-.01,1.14),(sign*.39,-.03,.92),'upper_arm_'+side)
    bone_positions['hand_'+side]=((sign*.39,-.03,.92),(sign*.4,-.055,.81),'forearm_'+side)
    bone_positions['thigh_'+side]=((sign*.105,0,.94),(sign*.115,-.005,.53),'hips')
    bone_positions['shin_'+side]=((sign*.115,-.005,.53),(sign*.11,-.005,.14),'thigh_'+side)
    bone_positions['foot_'+side]=((sign*.11,-.005,.14),(sign*.11,-.17,.07),'shin_'+side)

arm=bpy.data.armatures.new('Skater standard skeleton');rig=bpy.data.objects.new('skater_rig',arm);coll.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
for name,(head,tail,parent) in bone_positions.items():
    bone=arm.edit_bones.new(name);bone.head=head;bone.tail=tail
    if parent:bone.parent=arm.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT');rig.show_in_front=True

parts=[]
def bind(obj,bone,child=None,segment=None):
    group=obj.vertex_groups.new(name=bone)
    if child and segment:
        other=obj.vertex_groups.new(name=child)
        a,b=Vector(segment[0]),Vector(segment[1]);axis=b-a;length=axis.length
        bpy.context.view_layer.update()
        for v in obj.data.vertices:
            t=max(0,min(1,(obj.matrix_world@v.co-a).dot(axis)/length))
            blend=max(0,min(1,(t-.68)/.32))
            group.add([v.index],1-blend,'REPLACE');other.add([v.index],blend,'REPLACE')
    else:group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
    mod=obj.modifiers.new('Skeleton deformation','ARMATURE');mod.object=rig
    obj.parent=rig
    parts.append(obj)
    return obj

def sphere(name,loc,scale,material,bone,segments=24,rings=16,child=None,segment=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,radius=1,location=loc)
    obj=move(bpy.context.object);obj.name=name;obj.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    obj.data.materials.append(material)
    for p in obj.data.polygons:p.use_smooth=True
    return bind(obj,bone,child,segment)

def capsule(name,a,b,radius,material,bone,child=None):
    a,b=Vector(a),Vector(b);mid=(a+b)/2;vec=b-a
    obj=sphere(name,mid,(radius,radius,vec.length/2+radius*.65),material,bone,20,14,child,(a,b))
    obj.rotation_mode='QUATERNION';obj.rotation_quaternion=vec.to_track_quat('Z','Y')
    return obj

def cube(name,loc,scale,material,bone,bevel=.015):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    obj=move(bpy.context.object);obj.name=name;obj.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    obj.data.materials.append(material)
    if bevel:
        mod=obj.modifiers.new('Soft tailored edges','BEVEL');mod.width=bevel;mod.segments=3
        obj.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return bind(obj,bone)

def curve(name,points,radius,material,bone):
    data=bpy.data.curves.new(name,'CURVE');data.dimensions='3D';data.bevel_depth=radius;data.bevel_resolution=3
    spline=data.splines.new('BEZIER');spline.bezier_points.add(len(points)-1)
    for p,co in zip(spline.bezier_points,points):p.co=co;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
    obj=bpy.data.objects.new(name,data);coll.objects.link(obj);obj.data.materials.append(material)
    bpy.context.view_layer.objects.active=obj;obj.select_set(True);bpy.ops.object.convert(target='MESH');obj=bpy.context.object
    return bind(obj,bone)

sphere('Tailored hoodie torso',(0,0,1.25),(.22,.135,.25),hoodie,'chest',28,20)
sphere('Hoodie waist',(0,0,1.075),(.185,.125,.13),hoodie,'spine')
sphere('Cargo pelvis',(0,0,.94),(.18,.125,.13),pants,'hips')
sphere('Soft hood behind neck',(0,.095,1.46),(.165,.095,.16),hoodie,'chest')
capsule('Neck',(0,0,1.44),(0,0,1.56),.065,skin,'neck')
sphere('Human head',(0,-.006,1.655),(.108,.102,.135),skin,'head',32,24)
for side,sign in [('l',-1),('r',1)]:
    sphere('Ear '+side,(sign*.108,.0,1.655),(.022,.014,.038),skin,'head',16,12)
    sphere('Eye white '+side,(sign*.043,-.098,1.688),(.023,.009,.014),white,'head',20,12)
    sphere('Iris '+side,(sign*.043,-.106,1.688),(.009,.004,.01),black,'head',16,10)
    curve('Eyebrow '+side,[(sign*.022,-.099,1.715),(sign*.043,-.106,1.722),(sign*.065,-.097,1.715)],.004,black,'head')
sphere('Nose bridge',(0,-.105,1.665),(.021,.025,.038),skin,'head',20,14)
sphere('Nose tip',(0,-.127,1.65),(.027,.02,.018),skin,'head',20,12)
curve('Upper lip',[(-.035,-.101,1.607),(0,-.115,1.612),(.035,-.101,1.607)],.005,lip,'head')
curve('Lower lip',[(-.03,-.102,1.601),(0,-.112,1.596),(.03,-.102,1.601)],.004,lip,'head')
sphere('Cap crown',(0,.0,1.765),(.113,.108,.065),capmat,'head',28,16)
cube('Curved cap brim',(0,-.113,1.745),(.19,.145,.018),capmat,'head',.025)
cube('Cap orange patch',(0,-.106,1.77),(.055,.012,.025),hoodie,'head',.006)
cube('Hoodie kangaroo pocket',(0,-.13,1.17),(.22,.026,.085),hoodie_dark,'chest',.02)
for x in [-.052,.052]:curve('Hoodie drawstring',[(x,-.09,1.43),(x*.9,-.145,1.36),(x*.8,-.14,1.29)],.004,cream,'chest')
curve('Hoodie center seam',[(0,-.139,1.09),(0,-.145,1.25),(0,-.115,1.41)],.0025,hoodie_dark,'chest')

for side,sign in [('l',-1),('r',1)]:
    shoulder=(sign*.25,0,1.38);elbow=(sign*.35,-.01,1.14);wrist=(sign*.39,-.03,.92)
    sphere('Shoulder '+side,shoulder,(.088,.09,.095),hoodie,'shoulder_'+side)
    capsule('Hoodie upper sleeve '+side,shoulder,elbow,.074,hoodie,'upper_arm_'+side,'forearm_'+side)
    capsule('Hoodie fore sleeve '+side,elbow,wrist,.063,hoodie,'forearm_'+side,'hand_'+side)
    capsule('Ribbed cuff '+side,(sign*.385,-.027,.96),wrist,.067,hoodie_dark,'hand_'+side)
    sphere('Hand '+side,(sign*.4,-.045,.845),(.052,.035,.073),skin,'hand_'+side,20,14)
    for i in range(3):
        capsule('Finger '+side+str(i),(sign*(.375+i*.018),-.065,.81),(sign*(.375+i*.018),-.075,.775),.009,skin,'hand_'+side)
    hip=(sign*.105,0,.94);knee=(sign*.115,-.005,.53);ankle=(sign*.11,-.005,.15)
    capsule('Cargo thigh '+side,hip,knee,.093,pants,'thigh_'+side,'shin_'+side)
    capsule('Cargo shin '+side,knee,ankle,.073,pants,'shin_'+side,'foot_'+side)
    cube('Cargo pocket '+side,(sign*.184,-.015,.735),(.045,.13,.15),pants,'thigh_'+side,.018)
    curve('Cargo pocket stitch '+side,[(sign*.19,-.083,.79),(sign*.19,-.083,.72),(sign*.19,-.083,.68)],.002,pants_seam,'thigh_'+side)
    cube('Rubber sole '+side,(sign*.11,-.065,.055),(.18,.31,.05),sole,'foot_'+side,.025)
    sphere('Leather trainer '+side,(sign*.11,-.055,.105),(.086,.15,.066),cream,'foot_'+side,24,16)
    sphere('Trainer toe '+side,(sign*.11,-.16,.085),(.087,.075,.04),cream,'foot_'+side,20,12)
    for j in range(4):curve('Shoelace '+side+str(j),[(sign*.11-.055,-.02-j*.025,.155),(sign*.11+.055,-.02-j*.025,.155)],.003,white,'foot_'+side)

rig.animation_data_create()
def set_pose(frame,rotations):
    for name,angles in rotations.items():
        pb=rig.pose.bones.get(name)
        if not pb:continue
        pb.rotation_mode='XYZ';pb.rotation_euler=angles
        pb.keyframe_insert('rotation_euler',frame=frame,group=name)

def make_action(name,poses,duration):
    action=bpy.data.actions.new(name)
    rig.animation_data.action=action
    for frame,rotations in poses:
        set_pose(frame,rotations)
    track=rig.animation_data.nla_tracks.new();track.name=name
    track.strips.new(name,1,action)
    track.mute=True
    rig.animation_data.action=None
    return action

make_action('idle',[(1,{}),(25,{'spine':(.015,0,.015)}),(49,{})],49)
make_action('roll',[(1,{'thigh_l':(-.22,0,0),'thigh_r':(-.22,0,0),'shin_l':(.35,0,0),'shin_r':(.35,0,0),'chest':(.08,0,0)})],2)
make_action('push',[(1,{'thigh_r':(-.2,0,0),'shin_r':(.3,0,0)}),(18,{'thigh_r':(.5,0,0),'shin_r':(.15,0,0),'upper_arm_l':(-.4,0,0)}),(35,{'thigh_r':(-.5,0,0),'shin_r':(.75,0,0),'upper_arm_l':(.3,0,0)}),(49,{'thigh_r':(-.2,0,0),'shin_r':(.3,0,0)})],49)
make_action('crouch',[(1,{'thigh_l':(-.65,0,0),'thigh_r':(-.65,0,0),'shin_l':(1,0,0),'shin_r':(1,0,0),'spine':(.25,0,0)})],2)
make_action('air',[(1,{'thigh_l':(-.45,0,0),'thigh_r':(-.45,0,0),'shin_l':(.65,0,0),'shin_r':(.65,0,0),'upper_arm_l':(-.15,0,-.2),'upper_arm_r':(-.15,0,.2)})],2)
make_action('grab',[(1,{'upper_arm_r':(-1.15,0,0),'forearm_r':(-.55,0,0),'thigh_r':(-.8,0,0),'shin_r':(.8,0,0),'chest':(.25,0,.1)})],2)
make_action('grind',[(1,{'upper_arm_l':(0,0,-1.3),'upper_arm_r':(0,0,1.3),'thigh_l':(-.3,0,0),'thigh_r':(-.3,0,0),'shin_l':(.45,0,0),'shin_r':(.45,0,0)})],2)
make_action('land',[(1,{'thigh_l':(-.8,0,0),'thigh_r':(-.8,0,0),'shin_l':(1.1,0,0),'shin_r':(1.1,0,0),'spine':(.3,0,0)}),(12,{'thigh_l':(-.25,0,0),'thigh_r':(-.25,0,0),'shin_l':(.4,0,0),'shin_r':(.4,0,0),'spine':(.05,0,0)})],12)
make_action('bail',[(1,{}),(18,{'hips':(1.1,0,.4),'upper_arm_l':(-1.4,0,-.5),'upper_arm_r':(1.1,0,.5),'spine':(.7,0,0)}),(36,{'hips':(2.2,0,1.1),'upper_arm_l':(-1.8,0,-.8),'upper_arm_r':(1.7,0,.8)})],36)

for pb in rig.pose.bones:
    pb.rotation_euler=(0,0,0);pb.location=(0,0,0);pb.scale=(1,1,1)
bpy.context.scene.frame_set(1)
bpy.context.view_layer.update()
rig.animation_data.use_nla=False
for track in rig.animation_data.nla_tracks:
    track.mute=True
    for strip in track.strips:strip.mute=True
for obj in parts:
    if obj.type=='MESH':
        mod=obj.modifiers.new('Game LOD','DECIMATE');mod.ratio=.47
for obj in parts:obj.select_set(True)
rig.select_set(True);bpy.context.view_layer.objects.active=rig
kwargs=dict(filepath=OUT,export_format='GLB',use_selection=True,export_animations=True,export_skins=True,export_def_bones=True,export_apply=True)
props=bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
if 'export_animation_mode' in props:kwargs['export_animation_mode']='NLA_TRACKS'
bpy.ops.export_scene.gltf(**kwargs)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BACKUP,'skater.blend'))

scene=bpy.context.scene
for obj in scene.objects:
    if obj not in parts and obj!=rig:obj.hide_render=True
scene.render.engine='CYCLES';scene.cycles.samples=32
scene.render.resolution_x=700;scene.render.resolution_y=700;scene.render.resolution_percentage=100
world=bpy.data.worlds.new('Skater preview world') if not bpy.data.worlds.get('Skater preview world') else bpy.data.worlds['Skater preview world']
world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.035,.045,.065,1);world.node_tree.nodes['Background'].inputs[1].default_value=.35
scene.world=world
for name,loc,power,size,color in [('Key',(2,-3,4),650,4,(1,.82,.65)),('Fill',(-3,-1,2.5),450,3,(.65,.8,1)),('Rim',(1,2,3),700,3,(1,.45,.2))]:
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=color
    obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=loc
    obj.rotation_euler=(Vector((0,0,1.1))-obj.location).to_track_quat('-Z','Y').to_euler()
camdata=bpy.data.cameras.new('Preview camera');cam=bpy.data.objects.new('Preview camera',camdata);scene.collection.objects.link(cam)
cam.location=(2.8,-4.5,2.25);cam.rotation_euler=(Vector((0,0,1))-cam.location).to_track_quat('-Z','Y').to_euler();camdata.lens=65;scene.camera=cam
scene.render.filepath=os.path.join(BACKUP,'skater-preview.png');bpy.ops.render.render(write_still=True)
print('Smooth rigged skater exported with animations:',OUT)
