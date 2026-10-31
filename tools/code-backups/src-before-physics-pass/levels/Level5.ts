import * as THREE from 'three';
import { LevelBuilder } from './LevelBuilder';
import type { LevelDefinition } from './LevelTypes';

export const Level5: LevelDefinition = {
  id: 4, name: 'Mega Ramp', description: 'Drop in. Fly farther. Go huge.', spawn: [0,18.2,58], yaw: Math.PI,
  timeLimit: 120, scoreTarget: 50000, skyFile: 'level5_megaramp.jpg', introVideoFile: 'level5_intro.mp4', musicFile: 'music_level5.mp3', surface: 'wood',
  lighting: { sunColor: 0xfff1ce, sunIntensity: 2.8, ambientColor: 0xc2dcff, ambientIntensity: .7, fogColor: 0xe6bc82, sunPosition: [-15,70,10] },
  checkpoints: [[0,18.2,58],[0,.2,15],[0,.2,-55]],
  build(context) {
    const b=new LevelBuilder(context);b.ground(0,-35,240,260,'sand',-8);
    b.kicker(new THREE.Vector3(0,0,45),14,18,30,Math.PI,'wood_ramp');
    b.ground(0,15,14,30,'wood_ramp',0);
    b.kicker(new THREE.Vector3(0,0,-15),14,6,16,0,'wood_ramp');
    b.ground(0,-50,14,38,'wood_ramp',0);
    b.quarterPipe(new THREE.Vector3(0,0,-91),20,24,0,'wood_ramp');
    b.ground(0,-122,50,18,'wood_ramp',0);
    b.rail(new THREE.Vector3(-6,1,15),new THREE.Vector3(-6,1,-1));
    b.kicker(new THREE.Vector3(22,-8,-35),10,9,18,0,'wood_ramp');
    b.quarterPipe(new THREE.Vector3(-28,-8,-65),16,14,Math.PI/2,'wood_ramp');
    b.instances('desert_rock',Array.from({length:18},(_,i)=>({position:[(i%2?1:-1)*(30+(i%4)*15),-8,35-i*10],scale:.8+(i%3)*.55,yaw:i*.7})),false);
    return {grindables:b.grindables,pedestrians:b.pedestrians,spawn:new THREE.Vector3(...Level5.spawn)};
  },
};
