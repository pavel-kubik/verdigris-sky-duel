"""
Verdigris Sky Duel — procedural high-density dragon asset builder.
Run with Blender 4.x:
  blender -b -P tools/dragon/build_dragon.py
Outputs: assets/dragon/verdigris_dragon.glb and source PNG PBR maps.
This is a generated production starter, not an artist sculpt or hand-painted asset.
"""
import bpy, math, os
from mathutils import Vector
from math import sin, cos, pi
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "dragon")
os.makedirs(OUT, exist_ok=True)
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete(use_global=False)

def smooth_mesh(obj, voxel=0.055):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    rem = obj.modifiers.new("Sculpt_union", "REMESH"); rem.mode = "VOXEL"; rem.voxel_size = voxel
    bpy.ops.object.modifier_apply(modifier=rem.name)
    sm = obj.modifiers.new("Sculpt_polish", "SMOOTH"); sm.factor=1.35; sm.iterations=5
    bpy.ops.object.modifier_apply(modifier=sm.name)
    for p in obj.data.polygons: p.use_smooth=True
    obj.select_set(False)

# A single implicit-surface union gives torso, chest, neck, skull, haunches and tail continuous volume.
mb = bpy.data.metaballs.new("Dragon_Sculpt_Field"); mb.resolution=0.075; mb.render_resolution=0.045; mb.threshold=0.62
field = bpy.data.objects.new("Dragon_Sculpt_Field", mb); bpy.context.collection.objects.link(field)
def blob(co, radius, stiffness=2.0):
    e=mb.elements.new(); e.co=co; e.radius=radius; e.stiffness=stiffness
blob((0,0,1.25),1.25); blob((0,0.5,1.35),1.05); blob((0,-0.82,1.3),0.92)
for s in (-1,1):
    blob((s*.72,-.55,1.22),.72); blob((s*.68,.62,1.15),.68)
    blob((s*.48,1.12,1.55),.48); blob((s*.34,1.48,1.88),.34)
    blob((s*.35,-.5,.62),.45); blob((s*.32,.72,.68),.38)
for i in range(9):
    t=i/8; blob((0,-1.15-2.05*t,1.05-.45*t),.54*(1-t)+.09)
blob((0,1.78,1.95),.48); blob((0,2.08,1.88),.35)
bpy.context.view_layer.objects.active=field; field.select_set(True); bpy.ops.object.convert(target="MESH")
body=bpy.context.object; body.name="Dragon_Body_HighDensity"; smooth_mesh(body,.035)
sub=body.modifiers.new("Micro_surface_subdivision","SUBSURF"); sub.levels=1; sub.render_levels=1
bpy.ops.object.modifier_apply(modifier=sub.name)

# Explicit skeleton, named for predictable runtime retargeting.
arm_data=bpy.data.armatures.new("Dragon_Rig"); rig=bpy.data.objects.new("Dragon_Rig",arm_data); bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig; rig.select_set(True); bpy.ops.object.mode_set(mode="EDIT")
bones=[
("root",(0,0,0),(0,0,1)),("pelvis",(0,-.65,1.2),(0,0,1.25)),
("spine_01",(0,-.35,1.25),(0,.35,1.28)),("spine_02",(0,.35,1.28),(0,.85,1.4)),
("neck_01",(0,.85,1.4),(0,1.35,1.65)),("neck_02",(0,1.35,1.65),(0,1.75,1.9)),
("head",(0,1.75,1.9),(0,2.35,1.9)),("jaw",(0,1.95,1.68),(0,2.3,1.65)),
("tail_01",(0,-.75,1.2),(0,-1.45,1.05)),("tail_02",(0,-1.45,1.05),(0,-2.15,.88)),("tail_03",(0,-2.15,.88),(0,-2.85,.72)),("tail_tip",(0,-2.85,.72),(0,-3.35,.58))]
for s,side in [(-1,"L"),(1,"R")]:
    bones += [(f"shoulder.{side}",(s*.55,.45,1.45),(s*1.15,.5,1.4)),(f"wing_elbow.{side}",(s*1.15,.5,1.4),(s*2.1,.7,1.35)),(f"wing_wrist.{side}",(s*2.1,.7,1.35),(s*3.0,.85,1.25)),
    (f"hip.{side}",(s*.55,-.6,1.15),(s*.62,-.7,.7)),(f"knee.{side}",(s*.62,-.7,.7),(s*.62,-.55,.28)),(f"ankle.{side}",(s*.62,-.55,.28),(s*.62,-.25,.16)),
    (f"forearm.{side}",(s*.42,.7,1.2),(s*.5,.9,.72)),(f"wrist.{side}",(s*.5,.9,.72),(s*.5,1.05,.32))]
edit={}
for name,h,t in bones:
    b=arm_data.edit_bones.new(name); b.head=h; b.tail=t; edit[name]=b
for name in ["pelvis","spine_01","tail_01"]: edit[name].parent=edit["root"]
edit["spine_02"].parent=edit["spine_01"]; edit["neck_01"].parent=edit["spine_02"]; edit["neck_02"].parent=edit["neck_01"]; edit["head"].parent=edit["neck_02"]; edit["jaw"].parent=edit["head"]
edit["tail_02"].parent=edit["tail_01"]; edit["tail_03"].parent=edit["tail_02"]; edit["tail_tip"].parent=edit["tail_03"]
for side in ("L","R"):
    for child,parent in [(f"wing_elbow.{side}",f"shoulder.{side}"),(f"wing_wrist.{side}",f"wing_elbow.{side}"),(f"knee.{side}",f"hip.{side}"),(f"ankle.{side}",f"knee.{side}"),(f"wrist.{side}",f"forearm.{side}")]: edit[child].parent=edit[parent]
    edit[f"shoulder.{side}"].parent=edit["spine_02"]; edit[f"hip.{side}"].parent=edit["pelvis"]; edit[f"forearm.{side}"].parent=edit["spine_02"]
bpy.ops.object.mode_set(mode="OBJECT"); rig.select_set(False)

# Automatic heat weights on the continuous body, then clean modifier stack.
body.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active=rig
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
body.select_set(False); rig.select_set(False)
# Keep the root as the scene origin and apply transforms.
for obj in (body,rig): obj.location=(0,0,0)

# Wing membranes: quad grids with three-bone blend along span, mirrored.
for s,side in [(-1,"L"),(1,"R")]:
    verts=[]; faces=[]; nx,nz=24,12
    for j in range(nz+1):
        v=j/nz
        for i in range(nx+1):
            u=i/nx
            x=s*(.55+2.65*u)
            y=.5 + .45*u + .18*sin(pi*u)*sin(pi*v)
            z=1.42 + .36*u - .95*v + .18*sin(pi*u)*sin(pi*v)
            verts.append((x,y,z))
    for j in range(nz):
        for i in range(nx):
            a=j*(nx+1)+i; faces.append((a,a+1,a+nx+2,a+nx+1))
    me=bpy.data.meshes.new("Wing_Membrane_Mesh"); me.from_pydata(verts,[],faces); me.update()
    wing=bpy.data.objects.new("Wing_Membrane."+side,me); bpy.context.collection.objects.link(wing)
    for p in me.polygons: p.use_smooth=True
    groups={n:wing.vertex_groups.new(name=n) for n in (f"shoulder.{side}",f"wing_elbow.{side}",f"wing_wrist.{side}")}
    for idx,(x,y,z) in enumerate(verts):
        u=min(1,max(0,(abs(x)-.55)/2.65))
        weights=[max(0,1-u*2), max(0,1-abs(u-.5)*2), max(0,(u-.45)*1.9)]
        total=sum(weights) or 1
        for g,w in zip(groups.values(),weights):
            if w>0: g.add([idx],w/total,"REPLACE")
    mod=wing.modifiers.new("Dragon_Rig","ARMATURE"); mod.object=rig; wing.parent=rig
    wing.parent_type="OBJECT"

# PBR texture atlas: color, roughness and tangent-space normal, generated at 1024px.
N=1024
def make_maps():
    import random
    random.seed(17)
    color=bpy.data.images.new("Dragon_BaseColor_1K",width=N,height=N)
    rough=bpy.data.images.new("Dragon_Roughness_1K",width=N,height=N)
    normal=bpy.data.images.new("Dragon_Normal_1K",width=N,height=N)
    cp=[]; rp=[]; np=[]
    for y in range(N):
        for x in range(N):
            u=x/N; v=y/N
            wave=sin(v*2*pi*34 + (x%2)*.3)
            scale=max(0, sin(u*2*pi*48)*sin(v*2*pi*38))
            noise=(sin(x*.17+y*.11)+sin(x*.037-y*.091))*.018
            belly=max(0,1-abs(v-.18)*7)
            r=int(max(0,min(255,34+22*scale+noise*255+belly*105)))
            g=int(max(0,min(255,105+42*scale+noise*255-belly*32)))
            b=int(max(0,min(255,65+18*scale+noise*255-belly*18)))
            cp.extend((r/255,g/255,b/255,1))
            rv=max(.28,min(.82,.53+wave*.045-belly*.08+noise)); rp.extend((rv,rv,rv,1))
            nxv=.5+sin(x*.22)*.035; nyv=.5+cos(y*.19)*.035
            np.extend((nxv,nyv,.997,1))
    color.pixels[:]=cp; rough.pixels[:]=rp; normal.pixels[:]=np
    for im,name in [(color,"dragon_basecolor.png"),(rough,"dragon_roughness.png"),(normal,"dragon_normal.png")]:
        im.filepath_raw=os.path.join(OUT,name); im.file_format="PNG"; im.save()
    return color,rough,normal
base,roughmap,normalmap=make_maps()
mat=bpy.data.materials.new("Verdigris_Dragon_PBR"); mat.use_nodes=True
nodes=mat.node_tree.nodes; links=mat.node_tree.links; bs=nodes.get("Principled BSDF")
def image_node(img,label,noncolor=False):
    n=nodes.new("ShaderNodeTexImage"); n.image=img; n.label=label
    if noncolor: n.image.colorspace_settings.name="Non-Color"
    return n
bc=image_node(base,"Base Color"); links.new(bc.outputs["Color"],bs.inputs["Base Color"])
rr=image_node(roughmap,"Roughness",True); links.new(rr.outputs["Color"],bs.inputs["Roughness"])
nn=image_node(normalmap,"Normal",True); bump=nodes.new("ShaderNodeNormalMap"); links.new(nn.outputs["Color"],bump.inputs["Color"]); links.new(bump.outputs["Normal"],bs.inputs["Normal"])
bs.inputs["Metallic"].default_value=.04
body.data.materials.clear(); body.data.materials.append(mat)
# UV unwrap for actual texture delivery.
bpy.context.view_layer.objects.active=body; body.select_set(True)
bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT"); bpy.ops.uv.smart_project(island_margin=.012); bpy.ops.object.mode_set(mode="OBJECT"); body.select_set(False)
# Simple membrane material shares atlas for coherent color and roughness.
wingmat=mat
for ob in bpy.data.objects:
    if ob.name.startswith("Wing_Membrane"): ob.data.materials.append(wingmat)

# Export only character, rig and image textures as a compact glTF binary.
bpy.ops.object.select_all(action="DESELECT")
for ob in [body,rig]+[o for o in bpy.data.objects if o.name.startswith("Wing_Membrane")]: ob.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,"verdigris_dragon.glb"),export_format="GLB",use_selection=True,export_apply=True,export_skins=True,export_animations=False)
print("Dragon asset exported:",os.path.join(OUT,"verdigris_dragon.glb"))
