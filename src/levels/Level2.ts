import * as THREE from 'three';
import { LevelBuilder } from './LevelBuilder';
import type { LevelDefinition } from './LevelTypes';

export const Level2: LevelDefinition = {
  id: 1, name: 'Skatepark', description: 'Concrete waves. Endless lines.', spawn: [0,.2,38], yaw: Math.PI,
  timeLimit: 120, scoreTarget: 15000, skyFile: 'level2_skatepark.jpg', introVideoFile: 'level2_intro.mp4', musicFile: 'music_level2.mp3', surface: 'concrete',
  lighting: { sunColor: 0xffd7a0, sunIntensity: 2.4, ambientColor: 0xaacfff, ambientIntensity: .6, fogColor: 0xe6c69e, sunPosition: [35,45,15] },
  checkpoints: [[0,.2,38],[0,.2,0]],
  build(context) {
    const b=new LevelBuilder(context);b.ground(0,0,100,100,'concrete');
    b.bounds(0,0,100,100);
    b.halfPipe(new THREE.Vector3(0,0,-25),20,30,3.4);
    b.quarterPipe(new THREE.Vector3(-30,0,-20),14,3,0);
    b.quarterPipe(new THREE.Vector3(30,0,5),16,3.5,Math.PI);
    b.box(new THREE.Vector3(0,.65,5),new THREE.Vector3(8,1.3,8),b.material('concrete',3,3));
    b.kicker(new THREE.Vector3(0,0,13),8,1.3,8,0,'concrete');
    b.kicker(new THREE.Vector3(0,0,-3),8,1.3,8,Math.PI,'concrete');
    b.ledge(new THREE.Vector3(-17,.45,15),new THREE.Vector3(2,.9,12));
    b.ledge(new THREE.Vector3(18,.3,25),new THREE.Vector3(2,.6,10),Math.PI/2);
    b.ledge(new THREE.Vector3(-26,.6,-2),new THREE.Vector3(2,1.2,8));
    b.rail(new THREE.Vector3(-8,.55,24),new THREE.Vector3(-8,.55,12));
    b.rail(new THREE.Vector3(11,.85,19),new THREE.Vector3(11,.85,5));
    b.rail(new THREE.Vector3(25,1.2,-18),new THREE.Vector3(25,1.2,-32));
    b.rail(new THREE.Vector3(-20,.45,35),new THREE.Vector3(-5,.45,35));
    b.instances('tree',[{position:[-43,0,-40]},{position:[43,0,-40]},{position:[-43,0,40]},{position:[43,0,40]}]);
    b.instances('bench',[{position:[-38,0,20],yaw:Math.PI/2},{position:[38,0,-20],yaw:-Math.PI/2}]);
    b.grime(0,0,96,96,{skid:34,crack:12,oil:4,gum:8},21);
    return {grindables:b.grindables,pedestrians:b.pedestrians,spawn:new THREE.Vector3(...Level2.spawn)};
  },
};
