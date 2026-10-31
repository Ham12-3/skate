import bpy, os, shutil
from mathutils import Vector

ROOT=r'C:\Users\mobol\Downloads\skate-board'
name=globals().get('ROOT_OBJECT')
output=globals().get('OUTPUT_NAME')
target=float(globals().get('TARGET_SIZE',1))
if not name or not output:raise RuntimeError('ROOT_OBJECT and OUTPUT_NAME are required')
root=bpy.data.objects.get(name)
if not root:raise RuntimeError(f'Imported object not found: {name}')
objects=[root]+list(root.children_recursive)
meshes=[obj for obj in objects if obj.type=='MESH']
if not meshes:raise RuntimeError(f'No mesh children under {name}')
bpy.ops.object.select_all(action='DESELECT')
for obj in meshes:obj.select_set(True)
bpy.context.view_layer.objects.active=meshes[0]
bpy.ops.object.convert(target='MESH')
bpy.ops.object.select_all(action='DESELECT')
for obj in objects:obj.select_set(True)
bpy.context.view_layer.objects.active=root
bpy.context.view_layer.update()
points=[obj.matrix_world@Vector(corner) for obj in meshes for corner in obj.bound_box]
mins=Vector(tuple(min(p[i] for p in points) for i in range(3)))
maxs=Vector(tuple(max(p[i] for p in points) for i in range(3)))
largest=max(maxs.x-mins.x,maxs.y-mins.y,maxs.z-mins.z)
factor=target/largest
root.scale*=factor
bpy.context.view_layer.update()
points=[obj.matrix_world@Vector(corner) for obj in meshes for corner in obj.bound_box]
root.location.z-=min(p.z for p in points)
triangles=sum(len(obj.data.polygons) for obj in meshes)
ratio=min(1,12000/max(1,triangles))
if ratio<1:
    for obj in meshes:
        mod=obj.modifiers.new('Game triangle budget','DECIMATE');mod.ratio=ratio
out=os.path.join(ROOT,'public','assets','models',output+'.glb')
backup=os.path.join(ROOT,'tools','asset-backups')
os.makedirs(backup,exist_ok=True)
backup_model=os.path.join(backup,output+'-procedural.glb')
if os.path.exists(out) and not os.path.exists(backup_model):shutil.copy2(out,backup_model)
bpy.ops.export_scene.gltf(filepath=out,export_format='GLB',use_selection=True,export_apply=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(backup,output+'.blend'))
print(output,'triangles before LOD',triangles,'ratio',ratio,'scale',factor)
