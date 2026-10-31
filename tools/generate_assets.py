from pathlib import Path
import math, random, json, struct, subprocess, wave, array
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'public' / 'assets'
for folder in ['models','textures','sky','decks','ui','video','audio']:
    (ASSETS / folder).mkdir(parents=True, exist_ok=True)
random.seed(28)

def font(size, bold=False):
    paths = [
        'C:/Windows/Fonts/arialbd.ttf' if bold else 'C:/Windows/Fonts/arial.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    ]
    for p in paths:
        if Path(p).exists(): return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def texture(name, base, kind):
    n=1024
    im=Image.new('RGB',(n,n),base); d=ImageDraw.Draw(im)
    noise=Image.effect_noise((n,n),18).convert('RGB')
    im=Image.blend(im,noise,.09); d=ImageDraw.Draw(im)
    if kind=='brick':
        h=128; w=256
        for y in range(0,n,h):
            off=-128 if (y//h)%2 else 0
            d.line((0,y,n,y),fill=(188,181,164),width=9)
            for x in range(off,n,w): d.line((x,y,x,y+h),fill=(188,181,164),width=8)
    elif kind=='plaza':
        for y in range(0,n,256):
            d.line((0,y,n,y),fill=(126,116,99),width=5)
            off=-256 if (y//256)%2 else 0
            for x in range(off,n,512): d.line((x,y,x,y+256),fill=(126,116,99),width=5)
    elif kind=='wood':
        for x in range(0,n,128): d.line((x,0,x,n),fill=(79,135,155),width=3)
        for _ in range(100):
            x=random.randrange(n); y=random.randrange(n); length=random.randrange(15,130)
            d.line((x,y,x,y+length),fill=random.choice([(145,177,181),(194,164,119),(106,157,176)]),width=random.randrange(1,5))
    elif kind=='rail':
        for _ in range(500):
            y=random.randrange(n); x=random.randrange(n); le=random.randrange(20,400)
            d.line((x,y,min(n,x+le),y),fill=random.choice([(180,190,194),(103,116,124),(215,221,222)]),width=1)
    elif kind=='grass':
        for _ in range(12000):
            x=random.randrange(n); y=random.randrange(n)
            d.line((x,y,x+random.randrange(-2,3),y-random.randrange(2,8)),fill=random.choice([(68,125,54),(111,157,65),(48,105,47)]),width=1)
    else:
        count=5000 if kind in ['asphalt','gravel','sand'] else 600
        for _ in range(count):
            x=random.randrange(n); y=random.randrange(n); r=random.randrange(1,4) if kind!='gravel' else random.randrange(2,8)
            delta=random.randrange(-30,31); c=tuple(max(0,min(255,v+delta)) for v in base)
            d.ellipse((x-r,y-r,x+r,y+r),fill=c)
        if kind=='asphalt':
            for _ in range(12):
                x=random.randrange(n); y=random.randrange(n)
                pts=[(x,y)]
                for j in range(6): x+=random.randrange(-20,21); y+=random.randrange(10,35); pts.append((x,y))
                d.line(pts,fill=(48,51,53),width=2)
        if kind=='concrete':
            for _ in range(25):
                x=random.randrange(n); y=random.randrange(n)
                d.arc((x,y,x+random.randrange(40,250),y+random.randrange(30,160)),0,150,fill=(145,148,145),width=2)
    im.save(ASSETS/'textures'/name,quality=91)

for args in [
    ('asphalt.jpg',(77,81,83),'asphalt'),('concrete.jpg',(180,183,177),'concrete'),
    ('wood_ramp.jpg',(111,172,193),'wood'),('brick.jpg',(164,72,54),'brick'),
    ('metal_rail.jpg',(157,169,175),'rail'),('grass.jpg',(78,139,60),'grass'),
    ('gravel.jpg',(113,116,115),'gravel'),('stone_plaza.jpg',(191,174,143),'plaza'),
    ('sand.jpg',(204,143,75),'sand')]: texture(*args)

def sky(name, top, bottom, mode):
    w,h=2048,1024; im=Image.new('RGB',(w,h)); p=im.load()
    for y in range(h):
        t=y/(h-1); c=tuple(int(top[i]*(1-t)+bottom[i]*t) for i in range(3))
        for x in range(w): p[x,y]=c
    d=ImageDraw.Draw(im,'RGBA')
    if mode=='night':
        for _ in range(350):
            x=random.randrange(w); y=random.randrange(620); r=random.choice([1,1,1,2]); d.ellipse((x-r,y-r,x+r,y+r),fill=(240,244,255,220))
        d.ellipse((1500,120,1640,260),fill=(255,245,197,255)); d.ellipse((1475,100,1600,225),fill=(*top,255))
    else:
        for _ in range(36):
            x=random.randrange(-100,w); y=random.randrange(100,520); s=random.randrange(35,105)
            for ox,oy,r in [(-s,10,s),(0,-20,s*1.2),(s,5,s*.8),(s*1.6,18,s*.6)]:
                d.ellipse((x+ox-r,y+oy-r,x+ox+r,y+oy+r),fill=(255,250,239,130))
    horizon=720
    if mode in ['sunset','night','afternoon']:
        x=0
        while x<w:
            bw=random.randrange(35,105); bh=random.randrange(70,260)
            col=(31,37,63,255) if mode=='night' else ((73,54,79,255) if mode=='sunset' else (91,117,133,180))
            d.rectangle((x,horizon-bh,x+bw,horizon+120),fill=col)
            if mode=='night':
                for wy in range(horizon-bh+15,horizon,25):
                    for wx in range(x+10,x+bw-5,20): d.rectangle((wx,wy,wx+5,wy+8),fill=(255,194,82,190))
            x+=bw+random.randrange(4,16)
    elif mode=='desert':
        for x in range(-100,w,300):
            d.polygon([(x,horizon+100),(x+40,horizon-40),(x+110,horizon-90),(x+180,horizon-85),(x+230,horizon+100)],fill=(157,73,50,220))
    else:
        d.polygon([(0,760),(200,590),(420,710),(700,560),(950,720),(1250,590),(1510,700),(1770,570),(2048,710),(2048,900),(0,900)],fill=(74,131,75,200))
    im.save(ASSETS/'sky'/name,quality=92)

sky('level1_suburb.jpg',(62,151,224),(218,239,242),'morning')
sky('level2_skatepark.jpg',(38,112,202),(244,191,128),'afternoon')
sky('level3_plaza.jpg',(70,43,119),(250,140,77),'sunset')
sky('level4_rooftops.jpg',(7,15,45),(45,50,85),'night')
sky('level5_megaramp.jpg',(86,172,220),(243,211,152),'desert')

# Deck artwork
for i in range(1,5):
    im=Image.new('RGB',(1024,256),(20,20,25)); d=ImageDraw.Draw(im)
    if i==1:
        for x in range(-40,1100,85):
            d.polygon([(x,256),(x+20,120),(x+40,180),(x+75,20),(x+64,160),(x+100,95),(x+85,256)],fill=(242,69+random.randrange(70),20))
            d.polygon([(x+25,256),(x+45,155),(x+62,205),(x+75,120),(x+79,256)],fill=(255,196,36))
    elif i==2:
        cols=[(31,184,224),(244,70,151),(255,218,54),(113,74,194)]
        for _ in range(45):
            x=random.randrange(-50,1024); y=random.randrange(-30,256); r=random.randrange(20,90); c=random.choice(cols)
            d.rounded_rectangle((x,y,x+r*2,y+r),radius=20,fill=c,outline=(20,20,25),width=5)
    elif i==3:
        im.paste((16,43,79),(0,0,1024,256)); d=ImageDraw.Draw(im)
        for x in range(-100,1100,170):
            d.arc((x,30,x+240,280),180,350,fill=(238,244,231),width=18)
            d.arc((x+40,85,x+200,250),180,345,fill=(88,172,199),width=13)
            for j in range(4): d.ellipse((x+35+j*30,50+j%2*12,x+50+j*30,65+j%2*12),fill=(238,244,231))
    else:
        im.paste((42,16,66),(0,0,1024,256)); d=ImageDraw.Draw(im)
        for x in range(-50,1100,100):
            d.polygon([(x,0),(x+40,0),(x+130,256),(x+90,256)],fill=(107,255,65))
            d.ellipse((x+20,65,x+85,130),outline=(218,64,255),width=12)
        for y in range(0,256,48): d.line((0,y,1024,y),fill=(240,105,255),width=4)
    im.save(ASSETS/'decks'/f'deck{i}.png')

# Logo and icons
im=Image.new('RGBA',(1024,512),(0,0,0,0)); d=ImageDraw.Draw(im)
f=font(145,True)
for text,y in [('KICKFLIP',35),('CITY',190)]:
    box=d.textbbox((0,0),text,font=f,stroke_width=12); tw=box[2]
    d.text(((1024-tw)/2+9,y+12),text,font=f,fill=(20,20,28,255),stroke_width=15,stroke_fill=(20,20,28,255))
    d.text(((1024-tw)/2,y),text,font=f,fill=(255,107,28,255) if y<100 else (250,250,237,255),stroke_width=10,stroke_fill=(20,20,28,255))
d.rounded_rectangle((375,407,675,438),15,fill=(255,128,28,255),outline=(20,20,28,255),width=8)
for x in [420,630]: d.ellipse((x-18,435,x+18,471),fill=(240,240,230,255),outline=(20,20,28,255),width=6)
im.save(ASSETS/'ui'/'logo.png')

for name in ['kickflip','heelflip','shoveit','grab','grind','spin','lock']:
    size=128 if name=='lock' else 256
    im=Image.new('RGBA',(size,size),(0,0,0,0)); d=ImageDraw.Draw(im); s=size/256
    def pts(seq): return [(int(x*s),int(y*s)) for x,y in seq]
    if name=='lock':
        d.rounded_rectangle((int(45*s),int(105*s),int(211*s),int(225*s)),radius=int(20*s),fill=(255,184,45,255),outline=(22,25,34,255),width=int(13*s))
        d.arc((int(73*s),int(30*s),int(183*s),int(150*s)),180,360,fill=(22,25,34,255),width=int(22*s))
        d.ellipse((int(115*s),int(140*s),int(141*s),int(166*s)),fill=(22,25,34,255)); d.rectangle((int(122*s),int(155*s),int(134*s),int(190*s)),fill=(22,25,34,255))
    else:
        d.ellipse((int(15*s),int(15*s),int(241*s),int(241*s)),fill=(25,29,42,230),outline=(255,125,33,255),width=int(9*s))
        if name in ['kickflip','heelflip','shoveit']:
            d.rounded_rectangle((int(47*s),int(112*s),int(209*s),int(139*s)),radius=int(12*s),fill=(245,240,217,255))
            for x in [75,180]: d.ellipse((int((x-10)*s),int(140*s),int((x+10)*s),int(160*s)),fill=(255,126,31,255))
            if name=='shoveit': d.arc((int(55*s),int(42*s),int(205*s),int(205*s)),200,520,fill=(255,183,43,255),width=int(12*s))
            else: d.arc((int(42*s),int(67*s),int(214*s),int(195*s)),20 if name=='kickflip' else 160,290 if name=='kickflip' else 430,fill=(255,183,43,255),width=int(12*s))
        elif name=='grab':
            d.line(pts([(90,45),(130,110),(165,165)]),fill=(245,240,217,255),width=int(24*s)); d.line(pts([(130,110),(70,165)]),fill=(245,240,217,255),width=int(20*s)); d.rounded_rectangle((int(55*s),int(185*s),int(205*s),int(207*s)),10,fill=(255,126,31,255))
        elif name=='grind':
            d.line(pts([(40,190),(220,85)]),fill=(245,240,217,255),width=int(13*s)); d.rounded_rectangle((int(60*s),int(125*s),int(190*s),int(147*s)),10,fill=(255,126,31,255))
            for x,y in [(175,150),(198,160),(150,170)]: d.line(pts([(x,y),(x+20,y+20)]),fill=(255,211,60,255),width=int(7*s))
        else:
            d.arc((int(50*s),int(50*s),int(205*s),int(205*s)),30,315,fill=(245,240,217,255),width=int(18*s)); d.polygon(pts([(178,35),(215,68),(165,80)]),fill=(255,183,43,255))
    im.save(ASSETS/'ui'/f'icon_{name}.png')

# Minimal glTF 2.0 builder with rigid-bound skeletal character animation.
class GLB:
    def __init__(self):
        self.nodes=[]; self.meshes=[]; self.materials=[]; self.accessors=[]; self.views=[]; self.data=bytearray(); self.animations=[]
    def material(self,color,metal=0):
        self.materials.append({'name':f'mat_{len(self.materials)}','pbrMetallicRoughness':{'baseColorFactor':[*[v/255 for v in color],1],'metallicFactor':metal,'roughnessFactor':.72}})
        return len(self.materials)-1
    def accessor(self,vals,typ,target=34962):
        comp=5123 if target==34963 else 5126; fmt='H' if target==34963 else 'f'; count=len(vals)
        flat=[x for v in vals for x in (v if isinstance(v,(list,tuple)) else [v])]
        off=len(self.data); self.data.extend(struct.pack('<'+fmt*len(flat),*flat))
        while len(self.data)%4:self.data.append(0)
        vi=len(self.views); self.views.append({'buffer':0,'byteOffset':off,'byteLength':len(flat)*(2 if target==34963 else 4),'target':target})
        size={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[typ]
        a={'bufferView':vi,'componentType':comp,'count':count,'type':typ}
        if typ=='VEC3':
            a['min']=[min(v[i] for v in vals) for i in range(3)]; a['max']=[max(v[i] for v in vals) for i in range(3)]
        self.accessors.append(a); return len(self.accessors)-1
    def part(self,name,verts,norms,uvs,inds,mat,trans=(0,0,0),rot=None,parent=None):
        mi=len(self.meshes); self.meshes.append({'name':name,'primitives':[{'attributes':{'POSITION':self.accessor(verts,'VEC3'),'NORMAL':self.accessor(norms,'VEC3'),'TEXCOORD_0':self.accessor(uvs,'VEC2')},'indices':self.accessor(inds,'SCALAR',34963),'material':mat}]})
        ni=len(self.nodes); n={'name':name,'mesh':mi,'translation':list(trans)}
        if rot:n['rotation']=list(rot)
        self.nodes.append(n)
        if parent is not None:self.nodes[parent].setdefault('children',[]).append(ni)
        return ni
    def node(self,name,trans=(0,0,0),parent=None):
        ni=len(self.nodes); self.nodes.append({'name':name,'translation':list(trans)})
        if parent is not None:self.nodes[parent].setdefault('children',[]).append(ni)
        return ni
    def box(self,name,size,mat,trans=(0,0,0),parent=None):
        x,y,z=[v/2 for v in size]; vs=[]; ns=[]; us=[]; ids=[]
        faces=[((0,0,1),[(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]),((0,0,-1),[(x,-y,-z),(-x,-y,-z),(-x,y,-z),(x,y,-z)]),((1,0,0),[(x,-y,z),(x,-y,-z),(x,y,-z),(x,y,z)]),((-1,0,0),[(-x,-y,-z),(-x,-y,z),(-x,y,z),(-x,y,-z)]),((0,1,0),[(-x,y,z),(x,y,z),(x,y,-z),(-x,y,-z)]),((0,-1,0),[(-x,-y,-z),(x,-y,-z),(x,-y,z),(-x,-y,z)])]
        for norm,pts in faces:
            start=len(vs); vs+=pts; ns += [list(norm)]*4; us += [[0,0],[1,0],[1,1],[0,1]]; ids += [start,start+1,start+2,start,start+2,start+3]
        return self.part(name,vs,ns,us,ids,mat,trans,parent=parent)
    def cylinder(self,name,r,depth,mat,trans=(0,0,0),parent=None,r2=None,segments=12):
        r2=r if r2 is None else r2; vs=[]; ns=[]; us=[]; ids=[]
        for y,rad in [(-depth/2,r),(depth/2,r2)]:
            for i in range(segments+1):
                a=i*math.tau/segments; vs.append([math.cos(a)*rad,y,math.sin(a)*rad]); ns.append([math.cos(a),0,math.sin(a)]); us.append([i/segments,y/depth+.5])
        for i in range(segments):
            a=i; b=i+1; c=i+segments+1; e=c+1; ids += [a,c,b,b,c,e]
        for y,rad,normal in [(-depth/2,r,-1),(depth/2,r2,1)]:
            center=len(vs); vs.append([0,y,0]); ns.append([0,normal,0]); us.append([.5,.5])
            for i in range(segments+1):
                a=i*math.tau/segments; vs.append([math.cos(a)*rad,y,math.sin(a)*rad]); ns.append([0,normal,0]); us.append([math.cos(a)*.5+.5,math.sin(a)*.5+.5])
            for i in range(segments): ids += [center,center+i+1,center+i+2] if normal==1 else [center,center+i+2,center+i+1]
        return self.part(name,vs,ns,us,ids,mat,trans,parent=parent)
    def sphere(self,name,r,mat,trans=(0,0,0),parent=None,scale=(1,1,1)):
        vs=[]; ns=[]; us=[]; ids=[]; lat=8; lon=12
        for j in range(lat+1):
            v=j/lat; p=math.pi*v
            for i in range(lon+1):
                u=i/lon; a=math.tau*u; n=[math.sin(p)*math.cos(a),math.cos(p),math.sin(p)*math.sin(a)]
                vs.append([n[k]*r*scale[k] for k in range(3)]); ns.append(n); us.append([u,v])
        for j in range(lat):
            for i in range(lon):
                a=j*(lon+1)+i; b=a+lon+1; ids += [a,b,a+1,a+1,b,b+1]
        return self.part(name,vs,ns,us,ids,mat,trans,parent=parent)
    def animate(self,name,targets,duration=1):
        channels=[]; samplers=[]
        for node,poses in targets.items():
            if len(poses)==1: poses=poses*2
            times=[i*duration/(len(poses)-1) for i in range(len(poses))]
            ti=self.accessor(times,'SCALAR'); vi=self.accessor(poses,'VEC4')
            samplers.append({'input':ti,'output':vi,'interpolation':'LINEAR'}); channels.append({'sampler':len(samplers)-1,'target':{'node':node,'path':'rotation'}})
        self.animations.append({'name':name,'channels':channels,'samplers':samplers})
    def save(self,name):
        roots=[i for i,n in enumerate(self.nodes) if not any(i in p.get('children',[]) for p in self.nodes)]
        obj={'asset':{'version':'2.0','generator':'Kickflip City procedural asset studio'},'scene':0,'scenes':[{'nodes':roots}],'nodes':self.nodes,'meshes':self.meshes,'materials':self.materials,'accessors':self.accessors,'bufferViews':self.views,'buffers':[{'byteLength':len(self.data)}]}
        if self.animations:obj['animations']=self.animations
        js=json.dumps(obj,separators=(',',':')).encode(); js+=b' '*((-len(js))%4); self.data+=b'\0'*((-len(self.data))%4)
        total=12+8+len(js)+8+len(self.data)
        with open(ASSETS/'models'/name,'wb') as f:
            f.write(struct.pack('<III',0x46546C67,2,total)); f.write(struct.pack('<II',len(js),0x4E4F534A)); f.write(js); f.write(struct.pack('<II',len(self.data),0x004E4942)); f.write(self.data)

def palette(g):
    return {k:g.material(c,m) for k,c,m in [('orange',(242,105,35),0),('cream',(240,233,211),0),('dark',(28,34,45),0),('skin',(184,121,82),0),('blue',(48,115,157),0),('green',(59,133,75),0),('leaf',(74,153,72),0),('wood',(142,87,50),0),('concrete',(174,177,171),0),('metal',(129,148,157),.65),('red',(179,65,47),0),('glass',(67,142,173),.25),('yellow',(242,186,50),0)]}

def q(axis,ang):
    return [axis[0]*math.sin(ang/2),axis[1]*math.sin(ang/2),axis[2]*math.sin(ang/2),math.cos(ang/2)]

def skater_model(name='skater.glb',pedestrian=False):
    g=GLB(); m=palette(g)
    root=g.node('root')
    hoodie=m['blue'] if pedestrian else g.material((232,83,24)); pants=g.material((39,48,61)); sole=g.material((225,224,208))
    hips=g.node('hips',(0,.92,0),root); spine=g.node('spine',(0,.15,0),hips); chest=g.node('chest',(0,.19,0),spine); neck=g.node('neck',(0,.24,0),chest); head=g.node('head',(0,.11,0),neck)
    g.box('cargo_waist',(.36,.2,.28),pants,(0,-.01,0),hips)
    g.sphere('hoodie_body',.2,hoodie,(0,-.05,0),chest,scale=(1.18,1.25,.76))
    g.box('hoodie_pocket',(.25,.1,.025),hoodie,(0,-.16,.145),chest)
    g.sphere('hood',.14,hoodie,(0,.14,-.1),chest,scale=(1.2,1,.65))
    for x in [-.045,.045]:g.cylinder('drawstring',.008,.12,m['cream'],(x,.02,.155),chest,segments=6)
    g.sphere('head_mesh',.15,m['skin'],(0,.08,0),head,scale=(.85,1.08,.9))
    g.sphere('nose',.035,m['skin'],(0,.065,.14),head,scale=(.75,.8,1))
    for x in [-.05,.05]:g.sphere('eye',.014,m['dark'],(x,.11,.127),head,scale=(1,1,.5))
    if not pedestrian:
        g.sphere('cap',.158,m['dark'],(0,.17,0),head,scale=(1,.48,1)); g.box('cap_peak',(.24,.028,.18),m['dark'],(0,.14,.15),head)
        g.box('cap_patch',(.07,.04,.012),m['orange'],(0,.19,.145),head)
    else:g.sphere('hair',.153,m['wood'],(0,.145,-.01),head,scale=(1,.65,1))
    bones={'hips':hips,'spine':spine,'chest':chest,'neck':neck,'head':head}
    for side,sign in [('l',-1),('r',1)]:
        shoulder=g.node('shoulder_'+side,(sign*.25,.12,0),chest); upper=g.node('upper_arm_'+side,(sign*.055,-.05,0),shoulder); fore=g.node('forearm_'+side,(0,-.29,0),upper); hand=g.node('hand_'+side,(0,-.27,0),fore)
        g.sphere('upper_arm_mesh_'+side,.085,hoodie,(0,-.13,0),upper,scale=(1,1.9,1)); g.sphere('forearm_mesh_'+side,.072,hoodie,(0,-.12,0),fore,scale=(1,1.85,1))
        g.cylinder('cuff_'+side,.077,.055,pants,(0,-.245,0),fore); g.sphere('hand_mesh_'+side,.07,m['skin'],(0,-.02,0),hand,scale=(.85,1.15,.8))
        thigh=g.node('thigh_'+side,(sign*.12,-.04,0),hips); shin=g.node('shin_'+side,(0,-.43,0),thigh); foot=g.node('foot_'+side,(0,-.40,0),shin)
        g.sphere('thigh_mesh_'+side,.12,pants,(0,-.19,0),thigh,scale=(1,1.85,1)); g.box('cargo_pocket_'+side,(.035,.17,.16),pants,(sign*.115,-.2,.015),thigh)
        g.sphere('shin_mesh_'+side,.095,pants,(0,-.18,0),shin,scale=(1,1.85,1))
        g.box('trainer_'+side,(.18,.1,.29),m['cream'],(0,-.015,.075),foot); g.box('trainer_sole_'+side,(.19,.04,.34),sole,(0,-.075,.08),foot)
        for z in [.02,.07,.12]:g.box('lace_'+side,(.12,.012,.012),m['dark'],(0,.04,z),foot)
        bones.update({'shoulder_'+side:shoulder,'upper_arm_'+side:upper,'forearm_'+side:fore,'hand_'+side:hand,'thigh_'+side:thigh,'shin_'+side:shin,'foot_'+side:foot})
    rest=[0,0,0,1]
    if pedestrian:
        g.animate('walk',{bones['thigh_l']:[q((1,0,0),a) for a in [-.55,0,.55,0,-.55]],bones['thigh_r']:[q((1,0,0),a) for a in [.55,0,-.55,0,.55]],bones['upper_arm_l']:[q((1,0,0),a) for a in [.45,0,-.45,0,.45]],bones['upper_arm_r']:[q((1,0,0),a) for a in [-.45,0,.45,0,-.45]]},1)
    else:
        g.animate('idle',{spine:[rest,q((0,0,1),.018),rest]},2)
        g.animate('roll',{bones['thigh_l']:[q((1,0,0),-.25)],bones['thigh_r']:[q((1,0,0),-.25)],bones['shin_l']:[q((1,0,0),.4)],bones['shin_r']:[q((1,0,0),.4)]})
        g.animate('push',{bones['thigh_r']:[q((1,0,0),a) for a in [-.2,.4,-.5,-.2]],bones['shin_r']:[q((1,0,0),a) for a in [.3,.1,.8,.3]],bones['upper_arm_l']:[q((1,0,0),a) for a in [0,-.4,.3,0]]})
        crouch={bones[k]:[q((1,0,0),v)] for k,v in [('thigh_l',-.65),('thigh_r',-.65),('shin_l',1.0),('shin_r',1.0)]}; crouch[spine]=[q((1,0,0),.25)]; g.animate('crouch',crouch)
        g.animate('air',{bones['thigh_l']:[q((1,0,0),-.45)],bones['thigh_r']:[q((1,0,0),-.45)],bones['shin_l']:[q((1,0,0),.65)],bones['shin_r']:[q((1,0,0),.65)]})
        g.animate('grab',{bones['upper_arm_r']:[q((1,0,0),-1.2)],bones['forearm_r']:[q((1,0,0),-.6)],bones['thigh_r']:[q((1,0,0),-.8)]})
        g.animate('grind',{bones['upper_arm_l']:[q((0,0,1),-1.35)],bones['upper_arm_r']:[q((0,0,1),1.35)],bones['thigh_l']:[q((1,0,0),-.3)],bones['thigh_r']:[q((1,0,0),-.3)]})
        g.animate('land',{bones['thigh_l']:[q((1,0,0),-.8),q((1,0,0),-.25)],bones['thigh_r']:[q((1,0,0),-.8),q((1,0,0),-.25)],bones['shin_l']:[q((1,0,0),1.1),q((1,0,0),.4)],bones['shin_r']:[q((1,0,0),1.1),q((1,0,0),.4)]},.35)
        g.animate('bail',{hips:[rest,q((1,0,0),1.2),q((0,0,1),2.4)],bones['upper_arm_l']:[rest,q((1,0,0),1.8)],bones['upper_arm_r']:[rest,q((1,0,0),-1.8)]},1.2)
    g.save(name)

skater_model(); skater_model('pedestrian.glb',True)

def simple_model(name,build):
    g=GLB(); m=palette(g); build(g,m); g.save(name)

def board(g,m):
    g.box('deck',(.58,.06,.22),m['dark'],(0,.13,0))
    for x in [-.29,.29]:g.cylinder('deck_round',.11,.06,m['dark'],(x,.13,0),segments=16)
    for x,angle in [(-.36,-.18),(.36,.18)]:
        nose=g.box('kicked_nose',(.16,.05,.22),m['dark'],(x,.155,0));g.nodes[nose]['rotation']=q((0,0,1),angle)
    g.box('deck_top',(.74,.009,.205),m['orange'],(0,.166,0))
    for z in [-.25,.25]:
        g.box('truck_base',(.12,.035,.12),m['metal'],(0,.09,z));g.box('truck_axle',(.055,.055,.31),m['metal'],(0,.055,z))
    for name,x,z in [('wheel_fl',-.15,-.27),('wheel_fr',.15,-.27),('wheel_bl',-.15,.27),('wheel_br',.15,.27)]:
        n=g.cylinder(name,.055,.04,m['cream'],(x,.055,z));g.nodes[n]['rotation']=q((0,0,1),math.pi/2)
        hub=g.cylinder(name+'_hub',.025,.043,m['orange'],(x,.055,z));g.nodes[hub]['rotation']=q((0,0,1),math.pi/2)
simple_model('skateboard.glb',board)

def house(color):
    def build(g,m):
        mat=g.material(color);trim=g.material((239,231,209));roofmat=g.material((133,57,45))
        g.box('house',(6,3.4,5),mat,(0,1.7,0));g.box('foundation',(6.15,.35,5.15),m['concrete'],(0,.18,0))
        for x,angle in [(-1.45,-.52),(1.45,.52)]:
            roof=g.box('gable_roof',(3.8,.24,5.7),roofmat,(x,4.02,0));g.nodes[roof]['rotation']=q((0,0,1),angle)
        g.box('chimney',(.65,1.5,.65),m['red'],(1.6,4.35,-1.1));g.box('chimney_cap',(.8,.15,.8),m['concrete'],(1.6,5.05,-1.1))
        g.box('door',(1,2,.12),m['wood'],(0,1.05,2.55));g.box('door_frame',(1.2,.12,.16),trim,(0,2.1,2.58));g.box('door_step',(1.5,.18,.65),m['concrete'],(0,.09,2.8))
        g.sphere('door_knob',.055,m['yellow'],(.32,1.02,2.64))
        for x in [-1.9,1.9]:
            g.box('window',(1.15,1.05,.1),m['glass'],(x,2,2.55));g.box('window_frame',(1.3,.09,.14),trim,(x,2,2.61));g.box('window_frame',(.09,1.2,.14),trim,(x,2,2.61))
            for y in [1.43,2.57]:g.box('window_trim',(1.35,.09,.14),trim,(x,y,2.61))
            g.box('flower_box',(1.25,.25,.35),m['wood'],(x,1.35,2.72));g.sphere('flowers',.28,m['leaf'],(x,1.58,2.74),scale=(1.8,.7,1))
    return build
for i,c in enumerate([(232,184,117),(150,190,200),(205,154,157)],1):simple_model(f'house_{i}.glb',house(c))
def tree(g,m):
    g.cylinder('trunk',.23,2.2,m['wood'],(0,1.1,0));g.cylinder('branch',.12,1.4,m['wood'],(.35,2.1,0),r2=.07)
    for x,y,z,r in [(0,3.2,0,1.35),(-.8,2.9,.2,.95),(.85,3,.15,1),(.25,3.85,-.2,.9),(.2,2.8,-.75,.85)]:g.sphere('crown',r,m['leaf'] if x<0 else m['green'],(x,y,z),scale=(1,1.08,1))
simple_model('tree.glb',tree)
def car(g,m):
    paint=g.material((235,164,37));g.box('body',(3.5,.85,1.65),paint,(0,.7,0));g.box('bumper',(3.6,.22,1.7),m['dark'],(0,.42,0))
    cabin=g.box('cabin',(1.9,.8,1.48),m['glass'],(-.25,1.45,0));g.nodes[cabin]['rotation']=q((0,0,1),-.06)
    g.box('roof',(1.25,.12,1.5),paint,(-.3,1.88,0));g.box('grille',(.08,.25,.8),m['dark'],(1.78,.68,0))
    for z in [-.55,.55]:g.box('headlight',(.08,.22,.3),m['cream'],(1.8,.88,z));g.box('taillight',(.08,.22,.25),m['red'],(-1.8,.85,z))
    for x in [-1.1,1.1]:
        for z in [-.8,.8]:
            n=g.cylinder('wheel',.35,.2,m['dark'],(x,.35,z));g.nodes[n]['rotation']=q((1,0,0),math.pi/2)
            hub=g.cylinder('hubcap',.19,.21,m['metal'],(x,.35,z));g.nodes[hub]['rotation']=q((1,0,0),math.pi/2)
simple_model('car.glb',car)
def bench(g,m):
    for y in [.55,.85,1.12]:g.box('slat',(2,.13,.12),m['wood'],(0,y,-.25))
    g.box('seat',(2,.13,.6),m['wood'],(0,.55,0))
    for x in [-.75,.75]:g.box('leg',(.12,.55,.5),m['metal'],(x,.27,0))
simple_model('bench.glb',bench)
simple_model('planter.glb',lambda g,m:(g.box('pot',(1.2,.75,1.2),m['concrete'],(0,.375,0)),g.sphere('bush',.7,m['leaf'],(0,1.05,0),scale=(1,.8,1))))
simple_model('lamp_post.glb',lambda g,m:(g.cylinder('pole',.07,4,m['metal'],(0,2,0)),g.box('lamp',(.5,.22,.35),m['cream'],(0,4,0)),g.box('base',(.35,.18,.35),m['dark'],(0,.09,0))))
for idx in [1,2]:
    def tower(g,m,idx=idx):
        g.box('tower',(5,16+idx*4,5),m['blue'] if idx==1 else m['concrete'],(0,(16+idx*4)/2,0))
        windows=g.material((255,190,85));g.materials[windows]['emissiveFactor']=[1,.48,.12]
        g.box('roof_trim',(5.25,.35,5.25),m['dark'],(0,16+idx*4,0))
        for y in range(2,16+idx*4,2):
            for x in [-1.5,0,1.5]:g.box('window',(1,.8,.06),windows if idx==2 else m['glass'],(x,y,2.53))
    simple_model(f'skyscraper_{idx}.glb',tower)
simple_model('ac_unit.glb',lambda g,m:(g.box('unit',(1.5,1,1.2),m['metal'],(0,.5,0)),g.cylinder('fan',.4,.04,m['dark'],(0,1.02,0))))
simple_model('roof_vent.glb',lambda g,m:(g.cylinder('vent',.25,1.1,m['metal'],(0,.55,0)),g.cylinder('cap',.4,.18,m['metal'],(0,1.12,0))))
simple_model('desert_rock.glb',lambda g,m:(g.sphere('rock',2,m['red'],(0,1.3,0),scale=(1.4,1.1,1)),g.sphere('rock_top',1.3,m['orange'],(-.4,2.7,0),scale=(1.2,.7,1))))

# Audio synthesis: original loops and event sounds, encoded as MP3.
SR=22050
def write_audio(name,duration,fn,loop=False):
    data=array.array('h'); rng=random.Random(sum(map(ord,name))); smooth=0
    for i in range(int(duration*SR)):
        t=i/SR; noise=rng.uniform(-1,1); smooth=smooth*.92+noise*.08
        v=fn(t,noise,smooth); v=max(-1,min(1,v)); data.append(int(v*26000))
    wav=ASSETS/'audio'/(name+'.wav')
    with wave.open(str(wav),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(SR);w.writeframes(data.tobytes())
    subprocess.run(['ffmpeg','-loglevel','error','-y','-i',str(wav),'-codec:a','libmp3lame','-b:a','128k',str(ASSETS/'audio'/(name+'.mp3'))],check=True)
    wav.unlink()

write_audio('roll_concrete',2,lambda t,n,s:s*.55+n*.06)
write_audio('roll_wood',2,lambda t,n,s:s*.32+math.sin(math.tau*(75*t+8*t*t))*.08)
write_audio('push',.32,lambda t,n,s:(n*.25+math.sin(math.tau*(110-160*t)*t)*.3)*math.exp(-t*12))
write_audio('ollie',.24,lambda t,n,s:(math.sin(math.tau*(160-300*t)*t)*.55+n*.25)*math.exp(-t*16))
write_audio('land',.38,lambda t,n,s:(math.sin(math.tau*(65-50*t)*t)*.65+n*.25)*math.exp(-t*12))
write_audio('bail',.8,lambda t,n,s:(n*.45+math.sin(math.tau*55*t)*.4)*math.exp(-t*5))
write_audio('combo',.75,lambda t,n,s:sum(math.sin(math.tau*f*t) for f in [523,659,784])*.16*math.exp(-t*3))
write_audio('click',.12,lambda t,n,s:math.sin(math.tau*700*t)*.45*math.exp(-t*40))
write_audio('grind_metal',2,lambda t,n,s:n*.16+math.sin(math.tau*180*t)*.11+math.sin(math.tau*237*t)*.06)
write_audio('grind_concrete',2,lambda t,n,s:s*.8+n*.08)
notes=[0,3,5,7,10,12,15,17]
def music_fn(seed):
    rng=random.Random(seed); melody=[rng.choice(notes) for _ in range(16)]
    def fn(t,n,s):
        beat=t*2; step=int(beat*2)%16; phase=(beat*2)%1; root=55*2**(melody[step]/12)
        bass=math.sin(math.tau*root*t)*.2*math.exp(-phase*3)
        kick=math.sin(math.tau*(55+80*math.exp(-((beat%1)*18)))*t)*.34*math.exp(-(beat%1)*13)
        snare=n*.22*math.exp(-((beat+.5)%1)*18)
        hat=n*.07*math.exp(-((beat*2)%1)*28)
        lead=math.sin(math.tau*root*4*t)*.055*(1 if int(beat)%2 else .6)
        return (bass+kick+snare+hat+lead)*.85
    return fn
for i,name in enumerate(['music_menu']+[f'music_level{x}' for x in range(1,6)]):write_audio(name,16,music_fn(50+i),True)

# Stylised animated cinematography, rendered to real 1080p H.264 MP4 files.
W,H=960,540
LEVEL_COLORS=[((100,190,235),(247,220,150)),((63,153,220),(246,177,106)),((91,48,124),(249,130,72)),((8,18,48),(57,57,90)),((91,177,222),(237,189,111))]
def scene(level,t,duration,trailer_shot=None):
    top,bottom=LEVEL_COLORS[level]; im=Image.new('RGB',(W,H),top); d=ImageDraw.Draw(im)
    for y in range(300):
        qv=y/300; d.line((0,y,W,y),fill=tuple(int(top[i]*(1-qv)+bottom[i]*qv) for i in range(3)))
    sun=(255,238,177) if level!=3 else (230,236,255); d.ellipse((735,65,805,135),fill=sun)
    pan=math.sin(t/duration*math.tau)*25 if duration==8 else t/duration*70
    if level==3:
        for x in range(-30,1000,65):
            bh=90+((x*17)%150); d.rectangle((x-pan*.2,300-bh,x+50-pan*.2,330),fill=(27,31,59))
            for yy in range(320-bh,295,22):
                for xx in range(int(x-pan*.2+8),int(x+45-pan*.2),18):d.rectangle((xx,yy,xx+5,yy+8),fill=(255,196,78))
    elif level==4:
        d.polygon([(0,300),(150,220),(280,280),(420,200),(570,285),(720,210),(960,290),(960,350),(0,350)],fill=(164,77,52))
    else:
        for x in range(-50,1050,95):
            bh=45+(x*13)%90; d.rectangle((x-pan*.25,300-bh,x+70-pan*.25,320),fill=(61,84,101) if level==2 else (100,143,99))
    ground=[(102,128,91),(151,156,151),(175,147,119),(48,53,67),(193,128,68)][level]
    d.polygon([(0,300),(960,300),(960,540),(0,540)],fill=ground)
    if level==0:
        d.polygon([(280-pan,300),(680-pan,300),(900-pan,540),(40-pan,540)],fill=(69,74,79))
        for x in range(0,960,150):
            xx=x-pan%150; d.rectangle((xx,360,xx+20,390),fill=(233,205,93))
            d.rectangle((xx+40,240,xx+125,310),fill=(223,170+int(x)%40,127)); d.polygon([(xx+30,240),(xx+82,205),(xx+135,240)],fill=(154,69,52))
    else:
        for j in range(3):
            x=(120+j*310-pan)%1100-70; y=390+j%2*45
            d.polygon([(x,y),(x+190,y),(x+130,y-100),(x+65,y-100)],fill=(116,179,195) if level in [1,4] else (181,181,169))
            d.line((x+65,y-100,x+130,y-100),fill=(238,235,210),width=5)
        d.line((80-pan,355,760-pan,280),fill=(62,69,76),width=8)
    if trailer_shot is not None:draw_skater(d,trailer_shot,t)
    return im

def draw_skater(d,shot,t):
    x=480+math.sin(t*1.7)*35; y=330
    if shot==2:y-=abs(math.sin(t*math.pi))*110
    if shot==4:y-=math.sin(t/5*math.pi)*170
    if shot==5:y-=math.sin(t/6*math.pi)*140
    d.ellipse((x-17,y-150,x+17,y-116),fill=(184,121,82)); d.pieslice((x-22,y-158,x+22,y-122),180,360,fill=(28,34,45))
    d.line((x,y-115,x,y-55),fill=(242,105,35),width=28); d.line((x,y-100,x-45,y-55),fill=(184,121,82),width=10); d.line((x,y-100,x+48,y-75),fill=(184,121,82),width=10)
    d.line((x,y-55,x-30,y),fill=(28,34,45),width=14); d.line((x,y-55,x+33,y),fill=(28,34,45),width=14)
    angle=t*math.tau if shot==2 else 0; bw=int(75*abs(math.cos(angle)))+5
    d.rounded_rectangle((x-bw//2,y,x+bw//2,y+10),5,fill=(255,126,31)); d.ellipse((x-35,y+8,x-23,y+20),fill=(240,233,211));d.ellipse((x+23,y+8,x+35,y+20),fill=(240,233,211))

def encode_video(name,duration,level,trailer=False,loop=False):
    path=ASSETS/'video'/name
    cmd=['ffmpeg','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r','24','-i','-','-vf','scale=1920:1080','-c:v','libx264','-preset','veryfast','-crf','26','-pix_fmt','yuv420p','-movflags','+faststart',str(path)]
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE)
    frames=duration*24
    for i in range(frames):
        t=i/24
        if trailer:
            shot=0 if t<6 else 1 if t<12 else 2 if t<17 else 3 if t<22 else 4 if t<27 else 5 if t<33 else 6
            lev=[2,0,1,2,3,4,1][shot]; im=scene(lev,t-[0,6,12,17,22,27,33][shot],40,shot if shot<6 else None)
            if shot==6:
                im=im.filter(ImageFilter.GaussianBlur(3)); logo=Image.open(ASSETS/'ui'/'logo.png').convert('RGBA'); logo.thumbnail((760,380)); im.paste(logo,((W-logo.width)//2,(H-logo.height)//2),logo)
        else:im=scene(level,t,duration)
        proc.stdin.write(im.tobytes())
    proc.stdin.close(); result=proc.wait()
    if result:raise RuntimeError(f'ffmpeg failed for {name}')

for i in range(5):scene(i,2.5,5).resize((640,360),Image.Resampling.LANCZOS).save(ASSETS/'ui'/f'level{i+1}_thumb.jpg',quality=92)
encode_video('menu_loop.mp4',8,1,loop=True)
for i in range(5):encode_video(f'level{i+1}_intro.mp4',5,i)
encode_video('trailer.mp4',40,1,trailer=True)

print('Generated Kickflip City assets:')
for p in sorted(ASSETS.rglob('*')):
    if p.is_file():print(p.relative_to(ROOT),p.stat().st_size)
