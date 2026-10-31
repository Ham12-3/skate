import * as THREE from 'three';
import { LevelBuilder } from './LevelBuilder';
import type { LevelDefinition } from './LevelTypes';

export const Level3: LevelDefinition = {
  id: 2, name: 'City Plaza', description: 'Sunset lines through the urban jungle.', spawn: [0,.2,40], yaw: Math.PI,
  timeLimit: 120, scoreTarget: 25000, skyFile: 'level3_plaza.jpg', introVideoFile: 'level3_intro.mp4', musicFile: 'music_level3.mp3', surface: 'concrete',
  lighting: { sunColor: 0xff9a58, sunIntensity: 2.6, ambientColor: 0x9a75bb, ambientIntensity: .65, fogColor: 0xb86f71, sunPosition: [-50,24,-15] },
  checkpoints: [[0,.2,40],[0,.2,-25],[0,2.4,-78]],
  build(context) {
    const b=new LevelBuilder(context);b.ground(0,-20,110,150,'stone_plaza');
    b.bounds(0,-20,110,150);
    b.stairs(new THREE.Vector3(0,0,-10),12,5);
    b.box(new THREE.Vector3(0,.9,-20),new THREE.Vector3(16,1.8,12),b.material('stone_plaza',4,4));
    b.stairs(new THREE.Vector3(-22,0,-36),11,8);
    b.box(new THREE.Vector3(-22,1.44,-48),new THREE.Vector3(15,2.88,14),b.material('stone_plaza',4,4));
    b.stairs(new THREE.Vector3(20,0,-60),13,12,.2,.45);
    b.box(new THREE.Vector3(20,2.4,-77),new THREE.Vector3(18,4.8,16),b.material('stone_plaza',4,4));
    b.kicker(new THREE.Vector3(0,0,15),5,.9,3.6,0,'concrete');
    b.ledge(new THREE.Vector3(26,.45,10),new THREE.Vector3(2,.9,16));
    b.ledge(new THREE.Vector3(-28,.45,5),new THREE.Vector3(2,.9,14));
    b.instances('bench',[{position:[-15,0,20]},{position:[15,0,25],yaw:Math.PI},{position:[34,0,-28],yaw:-Math.PI/2},{position:[-35,0,-65],yaw:Math.PI/2}]);
    b.instances('planter',[{position:[-10,0,28]},{position:[10,0,28]},{position:[-34,0,-18]},{position:[34,0,-40]},{position:[0,0,-58],scale:1.4}]);
    b.pedestrian(new THREE.Vector3(-12,0,5),new THREE.Vector3(12,0,5),.9);
    b.pedestrian(new THREE.Vector3(30,0,-15),new THREE.Vector3(30,0,-50),1.1);
    b.pedestrian(new THREE.Vector3(-8,0,-52),new THREE.Vector3(8,0,-52),.8);
    b.instances('skyscraper_1',[{position:[-55,0,-50],scale:1.5},{position:[55,0,-85],scale:1.8}],false);
    b.instances('skyscraper_2',[{position:[-60,0,25],scale:1.2},{position:[58,0,20],scale:1.4}],false);
    b.grime(0,-20,106,146,{gum:46,oil:8,skid:16,crack:12},31);
    return {grindables:b.grindables,pedestrians:b.pedestrians,spawn:new THREE.Vector3(...Level3.spawn)};
  },
};
