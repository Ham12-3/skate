import * as THREE from 'three';
import { LevelBuilder } from './LevelBuilder';
import type { LevelDefinition } from './LevelTypes';

export const Level1: LevelDefinition = {
  id: 0, name: 'Suburban Street', description: 'Learn the lines. Own the street.', spawn: [0,.2,5], yaw: Math.PI,
  timeLimit: 90, scoreTarget: 5000, skyFile: 'level1_suburb.jpg', introVideoFile: 'level1_intro.mp4', musicFile: 'music_level1.mp3', surface: 'concrete',
  lighting: { sunColor: 0xfff0cf, sunIntensity: 2.2, ambientColor: 0xbde0ff, ambientIntensity: .65, fogColor: 0xc6e3e5, sunPosition: [-35,55,20] },
  checkpoints: [[0,.2,5],[0,.2,-65],[0,.2,-135]],
  finish: { position: [0,1,-188], size: [40,8,3] },
  build(context) {
    const b=new LevelBuilder(context);
    b.ground(0,-90,200,210,'grass');
    // The street ends at a T-junction: a cross street, a far sidewalk and a row of houses facing up the road.
    b.ground(0,-235,200,80,'grass');
    b.bounds(0,-130,200,290);
    b.ground(0,-203,64,16,'asphalt',.02);
    b.box(new THREE.Vector3(0,.1,-212.3),new THREE.Vector3(64,.2,2.6),b.material('concrete',12,1));
    b.box(new THREE.Vector3(0,.038,-194.6),new THREE.Vector3(12,.012,.4),new THREE.MeshStandardMaterial({color:0xe8e4d7,roughness:.85}),false);
    b.ground(0,-90,12,210,'asphalt',.02);
    const roadPaint=new THREE.MeshStandardMaterial({color:0xf5c84c,roughness:.8});
    for(let z=0;z>-195;z-=10)b.box(new THREE.Vector3(0,.035,z),new THREE.Vector3(.13,.012,4),roadPaint,false);
    const crossingPaint=new THREE.MeshStandardMaterial({color:0xe8e4d7,roughness:.85});
    for(let x=-4.5;x<=4.5;x+=1.5)b.box(new THREE.Vector3(x,.038,-105),new THREE.Vector3(.65,.012,3),crossingPaint,false);
    for(const x of [-7.4,7.4]){
      b.box(new THREE.Vector3(x,.1,-90),new THREE.Vector3(2.6,.2,210),b.material('concrete',2,40));
      b.ground(x*2.05,-90,6,210,'grass',.05);
    }
    const houses: [string,import('./LevelBuilder').Transform[]][]=[['house_1',[]],['house_2',[]],['house_3',[]]];
    for(let i=0;i<8;i++)for(const side of [-1,1])houses[i%3][1].push({position:[side*19,0,-i*26-5],yaw:side<0?Math.PI/2:-Math.PI/2});
    [-24,-8,8,24].forEach((x,i)=>houses[i%3]![1].push({position:[x,0,-226],yaw:0}));
    houses.forEach(([name,transforms])=>b.instances(name,transforms));
    b.instances('tree',Array.from({length:16},(_,i)=>({position:[(i%2?1:-1)*11.5,0,-i*12-3],scale:.8+(i%3)*.12})));
    b.instances('lamp_post',Array.from({length:12},(_,i)=>({position:[(i%2?1:-1)*9,0,-i*17-8]})));
    b.instances('car',[-25,-72,-118,-164].map((z,i)=>({position:[i%2?4.5:-4.5,.05,z],yaw:i%2?0:Math.PI})));
    b.kicker(new THREE.Vector3(0,.03,-32),4,.7,3.2);
    b.kicker(new THREE.Vector3(-2,.03,-84),4,.9,3.6);
    b.kicker(new THREE.Vector3(2,.03,-140),4,1.1,4.2);
    b.rail(new THREE.Vector3(-2,.55,-56),new THREE.Vector3(-2,.55,-69));
    b.rail(new THREE.Vector3(6.15,.22,-17),new THREE.Vector3(6.15,.22,-43),'concrete');
    b.rail(new THREE.Vector3(-6.15,.22,-102),new THREE.Vector3(-6.15,.22,-128),'concrete');
    b.instances('bench',[{position:[10,0,-45],yaw:-Math.PI/2},{position:[-10,0,-110],yaw:Math.PI/2}]);
    b.instances('tree',[{position:[-16,0,-219],scale:.9},{position:[16,0,-219],scale:1},{position:[0,0,-221],scale:.85}]);
    b.instances('lamp_post',[{position:[-12,0,-212.8]},{position:[12,0,-212.8]}]);
    b.finishLine(new THREE.Vector3(0,.02,-188),18);
    b.grime(0,-97,12,195,{oil:22,skid:10},11);
    for(const x of [-7.4,7.4])b.grime(x,-97,2.4,195,{gum:14,crack:6},x>0?12:13);
    return {grindables:b.grindables,pedestrians:b.pedestrians,spawn:new THREE.Vector3(...Level1.spawn)};
  },
};
