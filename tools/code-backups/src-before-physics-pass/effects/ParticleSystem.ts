import * as THREE from 'three';
import { CONFIG } from '../core/config';

interface Particle { velocity:THREE.Vector3;life:number;maxLife:number; }

export class ParticleSystem {
  readonly points:THREE.Points;
  private readonly maxParticles=500;
  private readonly positions=new Float32Array(this.maxParticles*3);
  private readonly colors=new Float32Array(this.maxParticles*3);
  private readonly particles:Particle[]=[];
  private cursor=0;

  constructor(scene:THREE.Scene){
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(this.positions,3));
    geometry.setAttribute('color',new THREE.BufferAttribute(this.colors,3));
    geometry.setDrawRange(0,this.maxParticles);
    const material=new THREE.PointsMaterial({size:.11,vertexColors:true,transparent:true,opacity:.85,depthWrite:false,blending:THREE.AdditiveBlending});
    this.points=new THREE.Points(geometry,material);this.points.frustumCulled=false;scene.add(this.points);
    for(let i=0;i<this.maxParticles;i++){this.positions[i*3+1]=-1000;this.particles.push({velocity:new THREE.Vector3(),life:0,maxLife:1});}
  }

  dust(position:THREE.Vector3,count:number=CONFIG.effects.landingDustCount):void{
    for(let i=0;i<count;i++)this.spawn(position,new THREE.Vector3((Math.random()-.5)*3,Math.random()*1.5,(Math.random()-.5)*3),new THREE.Color(0xd8c5a0),CONFIG.effects.particleLife);
  }

  sparks(position:THREE.Vector3):void{
    for(let i=0;i<CONFIG.effects.grindSparkCount;i++)this.spawn(position,new THREE.Vector3((Math.random()-.5)*2,Math.random()*1.4,(Math.random()-.5)*2),new THREE.Color(0xffa32b),.35);
  }

  private spawn(position:THREE.Vector3,velocity:THREE.Vector3,color:THREE.Color,life:number):void{
    const index=this.cursor++%this.maxParticles;this.positions[index*3]=position.x;this.positions[index*3+1]=position.y+.08;this.positions[index*3+2]=position.z;
    this.colors[index*3]=color.r;this.colors[index*3+1]=color.g;this.colors[index*3+2]=color.b;
    this.particles[index]!.velocity.copy(velocity);this.particles[index]!.life=life;this.particles[index]!.maxLife=life;
  }

  update(dt:number):void{
    for(let i=0;i<this.maxParticles;i++){
      const particle=this.particles[i]!;if(particle.life<=0)continue;
      particle.life-=dt;
      if(particle.life<=0){this.positions[i*3+1]=-1000;continue;}
      particle.velocity.y-=4*dt;this.positions[i*3]!+=particle.velocity.x*dt;this.positions[i*3+1]!+=particle.velocity.y*dt;this.positions[i*3+2]!+=particle.velocity.z*dt;
      const fade=Math.max(0,particle.life/particle.maxLife);this.colors[i*3]!*=Math.min(1,fade+.05);this.colors[i*3+1]!*=Math.min(1,fade+.05);this.colors[i*3+2]!*=Math.min(1,fade+.05);
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate=true;
    (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate=true;
  }
}
