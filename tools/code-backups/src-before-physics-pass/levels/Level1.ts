import * as THREE from 'three';
import { LevelBuilder } from './LevelBuilder';
import type { LevelDefinition } from './LevelTypes';

export const Level1: LevelDefinition = {
  id: 0, name: 'Suburban Street', description: 'Learn the lines. Own the street.', spawn: [0,.2,5], yaw: Math.PI,
  timeLimit: 90, scoreTarget: 5000, skyFile: 'level1_suburb.jpg', introVideoFile: 'level1_intro.mp4', musicFile: 'music_level1.mp3', surface: 'concrete',
  lighting: { sunColor: 0xfff0cf, sunIntensity: 2.2, ambientColor: 0xbde0ff, ambientIntensity: .65, fogColor: 0xc6e3e5, sunPosition: [-35,55,20] },
  checkpoints: [[0,.2,5],[0,.2,-65],[0,.2,-135]],
  build(context) {
    const b=new LevelBuilder(context);
    b.ground(0,-90,200,210,'grass');
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
    houses.forEach(([name,transforms])=>b.instances(name,transforms));
    b.instances('tree',Array.from({length:16},(_,i)=>({position:[(i%2?1:-1)*11.5,0,-i*12-3],scale:.8+(i%3)*.12})));
    b.instances('lamp_post',Array.from({length:12},(_,i)=>({position:[(i%2?1:-1)*9,0,-i*17-8]})));
    b.instances('car',[-25,-72,-118,-164].map((z,i)=>({position:[i%2?4.5:-4.5,.05,z],yaw:i%2?0:Math.PI})));
    b.kicker(new THREE.Vector3(0,.03,-32),4,1.25,5);
    b.kicker(new THREE.Vector3(-2,.03,-84),4,1.6,6);
    b.kicker(new THREE.Vector3(2,.03,-140),4,2,6);
    b.rail(new THREE.Vector3(-2,.55,-56),new THREE.Vector3(-2,.55,-69));
    b.rail(new THREE.Vector3(6.15,.22,-17),new THREE.Vector3(6.15,.22,-43),'concrete');
    b.rail(new THREE.Vector3(-6.15,.22,-102),new THREE.Vector3(-6.15,.22,-128),'concrete');
    b.instances('bench',[{position:[10,0,-45],yaw:-Math.PI/2},{position:[-10,0,-110],yaw:Math.PI/2}]);
    return {grindables:b.grindables,pedestrians:b.pedestrians,spawn:new THREE.Vector3(...Level1.spawn)};
  },
};
