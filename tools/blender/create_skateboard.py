import bpy, math, os
from mathutils import Vector

ROOT = r'C:\Users\mobol\Downloads\skate-board'
OUT = os.path.join(ROOT, 'public', 'assets', 'models', 'skateboard.glb')
BACKUP = os.path.join(ROOT, 'tools', 'asset-backups')
os.makedirs(BACKUP, exist_ok=True)
if os.path.exists(OUT):
    import shutil
    shutil.copy2(OUT, os.path.join(BACKUP, 'skateboard-procedural.glb'))

bpy.ops.object.select_all(action='DESELECT')

def collection(name):
    coll = bpy.data.collections.get(name)
    if coll:
        for obj in list(coll.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.collections.remove(coll)
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    return coll

coll = collection('Kickflip_Skateboard')

def move_to(obj):
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    coll.objects.link(obj)
    return obj

def material(name, color, metallic=0, roughness=.5):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = roughness
    mat.diffuse_color = (*color, 1)
    return mat

wood = material('Deck edge - maple', (.34,.15,.055), 0, .58)
light_ply = material('Light plywood layer', (.72,.52,.27), 0, .62)
grip = material('deck_top', (.028,.032,.04), 0, .92)
metal = material('Brushed truck aluminium', (.46,.53,.58), .82, .27)
dark_metal = material('Kingpin steel', (.07,.085,.1), .85, .24)
urethane = material('Ivory urethane wheels', (.83,.85,.78), 0, .34)
bearing = material('Orange bearing shields', (.9,.19,.035), .55, .28)

outline = []
for i in range(17):
    a = math.radians(90 + i * 180 / 16)
    outline.append((-.29 + .11 * math.cos(a), .11 * math.sin(a)))
for i in range(17):
    a = math.radians(-90 + i * 180 / 16)
    outline.append((.29 + .11 * math.cos(a), .11 * math.sin(a)))
N = len(outline)
verts = []
for z_offset in [0, -.018]:
    for x,y in outline:
        kick = .047 * max(0, (abs(x)-.27)/.13) ** 1.5
        verts.append((x,y,.135 + z_offset + kick))
faces = [tuple(range(N-1,-1,-1)), tuple(range(N,2*N))]
for i in range(N):
    j=(i+1)%N
    faces.append((i,j,N+j,N+i))
mesh=bpy.data.meshes.new('Curved popsicle deck mesh')
mesh.from_pydata(verts,[],faces);mesh.update()
deck=bpy.data.objects.new('deck',mesh);coll.objects.link(deck)
deck.data.materials.append(grip);deck.data.materials.append(wood)
for p in deck.data.polygons:
    p.material_index=0 if p.index==1 else 1
    p.use_smooth=True
bev=deck.modifiers.new('Rounded laminated edge','BEVEL');bev.width=.0025;bev.segments=3
deck.modifiers.new('Deck normals','WEIGHTED_NORMAL')

def curve_path(name, points, radius, mat):
    data=bpy.data.curves.new(name,'CURVE');data.dimensions='3D';data.bevel_depth=radius;data.bevel_resolution=3
    spline=data.splines.new('POLY');spline.points.add(len(points)-1)
    for p,co in zip(spline.points,points):p.co=(*co,1)
    spline.use_cyclic_u=True
    obj=bpy.data.objects.new(name,data);coll.objects.link(obj);obj.data.materials.append(mat)
    return obj

for z in [.122,.13]:
    points=[]
    for x,y in outline:
        kick=.047*max(0,(abs(x)-.27)/.13)**1.5
        points.append((x,y,z+kick))
    curve_path('Visible plywood lamination',points,.0014,light_ply)

def cube(name, loc, scale, mat, bevel=.003):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj=move_to(bpy.context.object);obj.name=name;obj.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    obj.data.materials.append(mat)
    if bevel:
        mod=obj.modifiers.new('Machined radii','BEVEL');mod.width=bevel;mod.segments=3
        obj.modifiers.new('Normals','WEIGHTED_NORMAL')
    return obj

def cylinder(name, loc, radius, depth, mat, axis='Z', vertices=32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    obj=move_to(bpy.context.object);obj.name=name
    if axis=='Y':obj.rotation_euler[0]=math.pi/2
    if axis=='X':obj.rotation_euler[1]=math.pi/2
    obj.data.materials.append(mat)
    for p in obj.data.polygons:p.use_smooth=True
    mod=obj.modifiers.new('Rounded cylinder edges','BEVEL');mod.width=min(.003,radius*.12);mod.segments=3
    obj.modifiers.new('Normals','WEIGHTED_NORMAL')
    return obj

for x in [-.25,.25]:
    cube('truck_baseplate',(x,0,.104),(.115,.105,.014),metal,.006)
    cylinder('kingpin',(x,0,.078),.012,.065,dark_metal)
    cube('truck_hanger',(x,0,.068),(.07,.16,.032),metal,.01)
    cylinder('truck_axle',(x,0,.058),.009,.31,metal,'Y')
    for y in [-.045,.045]:
        cylinder('mounting_bolt',(x,y,.114),.006,.006,dark_metal,vertices=16)

for name,x,y in [('wheel_fl',-.25,-.145),('wheel_fr',.25,-.145),('wheel_bl',-.25,.145),('wheel_br',.25,.145)]:
    wheel=cylinder(name,(x,y,.055),.055,.042,urethane,'Y',48)
    wheel['spin_axis']='local_y'
    cylinder(name+'_bearing',(x,y+(-.022 if y<0 else .022),.055),.024,.006,bearing,'Y',32)
    cylinder(name+'_hub',(x,y+(-.026 if y<0 else .026),.055),.009,.007,dark_metal,'Y',24)

for obj in coll.objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active=deck
bpy.ops.export_scene.gltf(filepath=OUT,export_format='GLB',use_selection=True,export_apply=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'tools','asset-backups','skateboard.blend'))
print('Detailed skateboard exported:',OUT)
