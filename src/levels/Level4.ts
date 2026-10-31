import * as THREE from 'three';
import { LevelBuilder } from './LevelBuilder';
import type { LevelDefinition } from './LevelTypes';

export const Level4: LevelDefinition = {
  id: 3, name: 'Rooftops', description: 'No streets. No fear. Just skyline.', spawn: [0,15.2,14], yaw: Math.PI,
  timeLimit: 150, scoreTarget: 35000, skyFile: 'level4_rooftops.jpg', introVideoFile: 'level4_intro.mp4', musicFile: 'music_level4.mp3', surface: 'concrete',
  lighting: { sunColor: 0x9ab5ff, sunIntensity: 1.0, ambientColor: 0x43518c, ambientIntensity: .55, fogColor: 0x11182f, sunPosition: [25,55,20], skyLighting: false, environmentIntensity: .12 },
  checkpoints: [[0,15.2,14],[0,12.2,-35],[0,9.2,-75],[0,6.2,-125]],
  finish: { position: [0,7,-150], size: [32,6,3] },
  build(context) {
    const b=new LevelBuilder(context);b.ground(0,-75,240,260,'asphalt',-20);
    const roofs=[{z:0,y:15,d:38},{z:-41,y:12,d:36},{z:-86,y:9,d:46},{z:-135,y:6,d:44}];
    roofs.forEach((roof,i)=>{
      b.box(new THREE.Vector3(0,roof.y/2-10,roof.z),new THREE.Vector3(32,roof.y+20,roof.d),b.material('brick',6,6));
      b.ground(0,roof.z,32,roof.d,'concrete',roof.y+.02);
      if(i<roofs.length-1)b.kicker(new THREE.Vector3(0,roof.y+.03,roof.z-roof.d/2+2.75),6,.8,3.5,0,'wood_ramp');
      b.rail(new THREE.Vector3(-14,roof.y+.7,roof.z+roof.d/2-4),new THREE.Vector3(-14,roof.y+.7,roof.z-roof.d/2+4));
      b.instances('ac_unit',[{position:[-8,roof.y,roof.z+3],yaw:i*.5},{position:[8,roof.y,roof.z-2],yaw:i*.3}]);
      b.instances('roof_vent',[{position:[-5,roof.y,roof.z-7]},{position:[7,roof.y,roof.z+8]}]);
      b.box(new THREE.Vector3(-15.8,roof.y+.35,roof.z),new THREE.Vector3(.3,.7,roof.d),b.material('brick',1,8));
      b.box(new THREE.Vector3(15.8,roof.y+.35,roof.z),new THREE.Vector3(.3,.7,roof.d),b.material('brick',1,8));
    });
    roofs.forEach((roof,i)=>b.grime(0,roof.z,30,roof.d,{oil:4,crack:7,skid:5},41+i));
    b.finishLine(new THREE.Vector3(0,6.02,-150),31.4);
    b.instances('skyscraper_1',Array.from({length:8},(_,i)=>({position:[(i%2?1:-1)*42,-20,-i*28],scale:1.3+(i%3)*.25})),false);
    b.instances('skyscraper_2',Array.from({length:7},(_,i)=>({position:[(i%2?1:-1)*60,-20,-i*32-10],scale:1.4})),false);
    return {grindables:b.grindables,pedestrians:b.pedestrians,spawn:new THREE.Vector3(...Level4.spawn)};
  },
};
