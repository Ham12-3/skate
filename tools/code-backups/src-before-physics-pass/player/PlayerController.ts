import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { EventBus } from '../core/EventBus';
import type { InputManager } from '../core/InputManager';
import type { PhysicsWorld, RayHit } from '../core/PhysicsWorld';
import type { AssetLoader } from '../core/AssetLoader';
import type { LevelDefinition } from '../levels/LevelTypes';
import { createCharacter, type CharacterModel } from './CharacterModel';
import { Skateboard } from './Skateboard';
import { TrickSystem } from './TrickSystem';
import { GrindSystem } from './GrindSystem';
import type { ComboSystem } from './ComboSystem';

const UP=new THREE.Vector3(0,1,0);
const DOWN=new THREE.Vector3(0,-1,0);

export class PlayerController {
  readonly root=new THREE.Group();
  readonly character:CharacterModel;
  readonly board:Skateboard;
  readonly tricks:TrickSystem;
  readonly grinds:GrindSystem;
  readonly position=new THREE.Vector3();
  speed=0;
  yaw=Math.PI;
  grounded=false;
  bailed=false;

  private readonly previousPosition=new THREE.Vector3();
  private readonly previousQuaternion=new THREE.Quaternion();
  private previousYaw=Math.PI;
  private renderYaw=Math.PI;
  private readonly renderQuaternion=new THREE.Quaternion();
  private readonly targetQuaternion=new THREE.Quaternion();
  private readonly groundNormal=new THREE.Vector3(0,1,0);
  private verticalVelocity=0;
  private airTime=0;
  private targetSpeed=0;
  private smoothedSteer=0;
  private crouchHold=0;
  private pushCooldown=0;
  private pushPoseTimer=0;
  private landingPoseTimer=0;
  private bailTimer=0;
  private invulnerability=0;
  private definition?:LevelDefinition;
  private respawnPoint=new THREE.Vector3();
  private checkpointIndex=0;
  private lastSurface:'concrete'|'wood'='concrete';

  constructor(private readonly physics:PhysicsWorld,private readonly input:InputManager,private readonly events:EventBus,private readonly combo:ComboSystem,assets:AssetLoader){
    this.character=createCharacter(assets);this.board=new Skateboard(assets);
    this.character.root.position.y=.17;
    this.root.add(this.board.root,this.character.root);
    this.tricks=new TrickSystem(this.board,combo);
    this.grinds=new GrindSystem(combo,events);
  }

  reset(definition:LevelDefinition):void{
    this.definition=definition;
    this.position.set(...definition.spawn);this.previousPosition.copy(this.position);
    this.respawnPoint.copy(this.position);this.checkpointIndex=0;
    this.yaw=definition.yaw;this.previousYaw=this.yaw;this.renderYaw=this.yaw;
    this.speed=0;this.targetSpeed=0;this.smoothedSteer=0;this.verticalVelocity=0;this.airTime=0;this.grounded=false;this.bailed=false;
    this.groundNormal.copy(UP);this.crouchHold=0;this.pushCooldown=0;this.invulnerability=0;
    this.combo.reset();this.tricks.reset();this.grinds.reset();
    this.character.setPose('idle');this.character.root.position.set(0,.17,0);this.character.root.rotation.set(0,0,0);
    this.updateOrientation(1);this.root.position.copy(this.position);this.root.quaternion.copy(this.targetQuaternion);
  }

  fixedUpdate(dt:number):void{
    if(!this.definition)return;
    this.previousPosition.copy(this.position);this.previousQuaternion.copy(this.root.quaternion);this.previousYaw=this.yaw;
    this.pushCooldown=Math.max(0,this.pushCooldown-dt);this.pushPoseTimer=Math.max(0,this.pushPoseTimer-dt);
    this.landingPoseTimer=Math.max(0,this.landingPoseTimer-dt);this.invulnerability=Math.max(0,this.invulnerability-dt);
    if(this.bailed){
      this.bailTimer-=dt;this.character.update(dt,0,0,0,0);
      this.character.root.rotation.x+=dt*4;this.character.root.rotation.z+=dt*3;
      this.character.root.position.x+=dt*1.1;this.character.root.position.y=Math.max(-.35,this.character.root.position.y-dt*.8);
      if(this.bailTimer<=0)this.respawn();
      return;
    }
    if(this.invulnerability<=0){
      for(const pedestrian of this.definition&&this.currentPedestrians?this.currentPedestrians:[]){
        if(pedestrian.root.position.distanceToSquared(this.position)<CONFIG.character.pedestrianHitDistance**2){this.bail('Pedestrian collision');return;}
      }
    }
    if(this.grinds.active){this.updateGrind(dt);return;}
    const steer=(this.input.isHeld('left')?1:0)-(this.input.isHeld('right')?1:0);
    this.smoothedSteer=THREE.MathUtils.lerp(this.smoothedSteer,steer,1-Math.exp(-CONFIG.movement.steerSmoothing*dt));
    const steering=THREE.MathUtils.lerp(CONFIG.movement.steeringLowSpeed,CONFIG.movement.steeringHighSpeed,Math.min(Math.abs(this.speed)/CONFIG.movement.steeringSpeedReference,1));
    this.yaw+=steer*steering*dt*(this.grounded?1:.32);
    if(this.grounded)this.updateGround(dt,steer);
    else this.updateAir(dt);
    if(this.grinds.active)return;
    this.updateCheckpoint();
    this.combo.update(dt,this.grounded,true);
    this.board.update(dt,this.speed,this.smoothedSteer,this.grounded);
    const accelerationLean=THREE.MathUtils.clamp((this.targetSpeed-this.speed)/CONFIG.movement.maxPushSpeed,-1,1)*CONFIG.character.accelerationLean;
    const speedLean=Math.min(Math.abs(this.speed)/CONFIG.movement.absoluteMaxSpeed,1)*CONFIG.character.speedLean;
    this.character.update(dt,Math.abs(this.speed),this.grinds.balance,this.smoothedSteer,accelerationLean+speedLean);
    this.updateOrientation(dt);
    this.events.emit('speed',{normalized:Math.min(Math.abs(this.speed)/CONFIG.movement.absoluteMaxSpeed,1),grounded:this.grounded});
    const fallY=this.definition.id===3?this.respawnPoint.y-18:this.definition.id===4?-12:CONFIG.physics.fallRespawnY;
    if(this.position.y<fallY)this.bail('Fell off the line');
  }

  currentPedestrians:import('../levels/LevelTypes').Pedestrian[]=[];

  private updateGround(dt:number,steer:number):void{
    if((this.input.isHeld('push')||this.input.wasPressed('push'))&&this.pushCooldown<=0&&!this.input.isHeld('ollie')){
      if(this.speed<CONFIG.movement.maxPushSpeed){
        this.speed=Math.min(CONFIG.movement.maxPushSpeed,this.speed+CONFIG.movement.pushImpulse);
        this.pushCooldown=CONFIG.movement.pushCooldown;this.pushPoseTimer=CONFIG.movement.pushCooldown;
        this.events.emit('push',undefined);
      }
    }
    if(this.input.isHeld('brake'))this.speed=THREE.MathUtils.lerp(this.speed,0,Math.min(1,CONFIG.movement.brakeForce*dt/Math.max(Math.abs(this.speed),1)));
    this.speed=Math.sign(this.speed)*Math.max(0,Math.abs(this.speed)-CONFIG.movement.rollingFriction*dt);
    const forward=new THREE.Vector3(Math.sin(this.yaw),0,Math.cos(this.yaw));
    this.speed+=this.groundNormal.dot(forward)*CONFIG.movement.slopeAcceleration*dt;
    this.speed=THREE.MathUtils.clamp(this.speed,-CONFIG.movement.absoluteMaxSpeed,CONFIG.movement.absoluteMaxSpeed);
    if(this.input.isHeld('ollie'))this.crouchHold=Math.min(CONFIG.ollie.maxHold,this.crouchHold+dt);
    if(this.input.wasReleased('ollie')){
      const charge=THREE.MathUtils.clamp((this.crouchHold-CONFIG.ollie.minHold)/(CONFIG.ollie.maxHold-CONFIG.ollie.minHold),0,1);
      this.verticalVelocity=THREE.MathUtils.lerp(CONFIG.ollie.minJumpForce,CONFIG.ollie.maxJumpForce,charge);
      this.grounded=false;this.position.y+=.06;this.crouchHold=0;this.tricks.start(this.input);
      this.events.emit('ollie',undefined);
      this.updateAir(dt);return;
    }
    const next=this.position.clone().addScaledVector(forward,this.speed*dt);
    const wall=this.physics.ray(this.position.clone().add(new THREE.Vector3(0,.45,0)),forward,CONFIG.physics.wallRayDistance);
    if(wall&&wall.normal.y<.45&&wall.normal.dot(forward)<-.3){
      if(Math.abs(this.speed)>CONFIG.physics.wallBailSpeed){this.bail('High-speed wall impact');return;}
      this.speed*=-.15;
    }else this.position.copy(next);
    const hit=this.groundRay(this.position);
    if(hit&&hit.point.y-this.position.y<=CONFIG.physics.groundSnapDistance&&this.position.y-hit.point.y<=CONFIG.physics.groundSnapDistance){
      this.position.y=hit.point.y;
      this.groundNormal.lerp(this.alignedGroundNormal(hit),1-Math.exp(-CONFIG.physics.groundNormalSmoothing*dt)).normalize();
      this.setSurface(hit.surface);
      this.character.setPose(this.input.isHeld('ollie')?'crouch':this.landingPoseTimer>0?'land':this.pushPoseTimer>0?'push':Math.abs(this.speed)>.2?'roll':'idle');
    }else{
      const launchSpeed=Math.abs(this.speed);
      this.verticalVelocity=this.groundNormal.y<CONFIG.movement.lipNormalThreshold&&launchSpeed>CONFIG.movement.lipMinimumSpeed?launchSpeed*CONFIG.movement.lipLaunchSpeedFactor:0;
      if(this.verticalVelocity>0)this.speed*=CONFIG.movement.lipHorizontalRetention;
      this.grounded=false;this.tricks.start(this.input);
    }
    if(steer!==0&&Math.abs(this.speed)<.1)this.speed=0;
  }

  private updateAir(dt:number):void{
    this.airTime+=dt;
    this.tricks.update(dt,this.input);
    this.verticalVelocity+=CONFIG.physics.gravity*dt;
    const forward=new THREE.Vector3(Math.sin(this.yaw),0,Math.cos(this.yaw));
    this.position.addScaledVector(forward,this.speed*dt);this.position.y+=this.verticalVelocity*dt;
    this.groundNormal.lerp(UP,1-Math.exp(-5*dt)).normalize();
    if(this.verticalVelocity<=0&&this.definition){
      if(this.grinds.tryStart(this.position,this.yaw,this.speed,this.currentGrindables)){
        const rail=this.grinds.rail!;
        const segment=rail.end.clone().sub(rail.start);const t=THREE.MathUtils.clamp(this.position.clone().sub(rail.start).dot(segment)/segment.lengthSq(),0,1);
        this.position.y=THREE.MathUtils.lerp(rail.start.y,rail.end.y,t)+.12;
        this.character.setPose('grind');return;
      }
    }
    const hit=this.groundRay(this.position);
    if(this.verticalVelocity<=0&&hit&&this.position.y<=hit.point.y+CONFIG.movement.spawnClearance){
      // Landing quality compares the interpolated board up vector with the actual contact normal.
      const boardUp=UP.clone().applyQuaternion(this.targetQuaternion);
      const angle=Math.acos(THREE.MathUtils.clamp(boardUp.dot(hit.normal),-1,1))*180/Math.PI;
      if(angle>CONFIG.tricks.sketchyLandingAngle){this.bail('Bad landing angle');return;}
      const trickResult=this.tricks.land();if(!trickResult.valid){this.bail(trickResult.reason);return;}
      const impact=Math.abs(this.verticalVelocity);const clean=angle<CONFIG.tricks.cleanLandingAngle;
      if(clean&&this.airTime>.2)this.combo.addPoints(CONFIG.tricks.cleanLandingBonus);
      this.airTime=0;
      this.position.y=hit.point.y;this.verticalVelocity=0;this.grounded=true;this.groundNormal.copy(hit.normal);
      this.landingPoseTimer=.3;this.character.setPose('land');this.setSurface(hit.surface);
      this.events.emit('land',{impact,clean,combo:this.combo.multiplier});
    }else this.character.setPose(this.tricks.grabbing?'grab':this.tricks.isFlipping?'air':'air');
  }

  private updateGrind(dt:number):void{
    const result=this.grinds.update(dt,this.input,this.position,this.speed);
    this.yaw=result.yaw;
    if(this.grinds.rail){
      const rail=this.grinds.rail;const segment=rail.end.clone().sub(rail.start);
      const t=THREE.MathUtils.clamp(this.position.clone().sub(rail.start).dot(segment)/segment.lengthSq(),0,1);
      this.position.y=THREE.MathUtils.lerp(rail.start.y,rail.end.y,t)+.12;
    }
    this.character.setPose('grind');this.character.update(dt,Math.abs(this.speed),this.grinds.balance);
    this.board.update(dt,this.speed,0,false);this.combo.update(dt,false,false);this.updateOrientation(dt);
    if(result.bail){this.bail('Lost grind balance');return;}
    if(result.exit){
      this.grounded=false;this.verticalVelocity=this.input.wasPressed('ollie')?CONFIG.ollie.grindJumpForce:-1;
      this.speed*=CONFIG.grind.exitSpeedBoost;this.tricks.start(this.input);
    }
  }

  private groundRay(position:THREE.Vector3):RayHit|null{
    return this.physics.ray(position.clone().add(new THREE.Vector3(0,1,0)),DOWN,CONFIG.physics.groundRayLength);
  }

  // Front and rear truck rays capture the ramp tangent instead of snapping to a generic upright pose.
  private alignedGroundNormal(center:RayHit):THREE.Vector3{
    const forward=new THREE.Vector3(Math.sin(this.yaw),0,Math.cos(this.yaw));
    const normal=center.normal.clone();let samples=1;
    for(const offset of [-.27,.27]){
      const origin=this.position.clone().addScaledVector(forward,offset).add(new THREE.Vector3(0,1,0));
      const hit=this.physics.ray(origin,DOWN,CONFIG.physics.groundRayLength);
      if(hit){normal.add(hit.normal);samples++;}
    }
    return normal.multiplyScalar(1/samples).normalize();
  }

  private updateOrientation(dt:number):void{
    const forward=new THREE.Vector3(Math.sin(this.yaw),0,Math.cos(this.yaw));
    forward.addScaledVector(this.groundNormal,-forward.dot(this.groundNormal)).normalize();
    const right=new THREE.Vector3().crossVectors(this.groundNormal,forward).normalize();
    const matrix=new THREE.Matrix4().makeBasis(right,this.groundNormal,forward);
    this.targetQuaternion.setFromRotationMatrix(matrix);
    this.targetQuaternion.multiply(new THREE.Quaternion().setFromAxisAngle(UP,this.tricks.spinAngle));
    this.renderQuaternion.copy(this.targetQuaternion);
    if(dt>=1)this.root.quaternion.copy(this.targetQuaternion);
  }

  render(alpha:number):void{
    if(this.bailed)return;
    this.root.position.lerpVectors(this.previousPosition,this.position,alpha);
    this.root.quaternion.slerpQuaternions(this.previousQuaternion,this.renderQuaternion,alpha);
    const delta=Math.atan2(Math.sin(this.yaw-this.previousYaw),Math.cos(this.yaw-this.previousYaw));
    this.renderYaw=this.previousYaw+delta*alpha;
  }

  get cameraPosition():THREE.Vector3{return this.root.position;}
  get cameraYaw():number{return this.renderYaw;}

  bail(reason:string):void{
    if(this.bailed||this.invulnerability>0)return;
    this.bailed=true;this.bailTimer=CONFIG.character.bailDuration;this.combo.bail();this.tricks.reset();this.grinds.stop();
    this.character.setPose('bail');this.events.emit('bail',{reason});
  }

  private respawn():void{
    this.position.copy(this.respawnPoint);this.previousPosition.copy(this.position);this.speed=0;this.verticalVelocity=0;this.airTime=0;
    this.yaw=this.definition?.yaw??Math.PI;this.groundNormal.copy(UP);this.bailed=false;this.grounded=false;
    this.invulnerability=CONFIG.character.respawnInvulnerability;this.character.setPose('idle');this.root.quaternion.identity();
    this.character.root.position.set(0,.17,0);this.character.root.rotation.set(0,0,0);
  }

  private updateCheckpoint():void{
    if(!this.definition)return;
    const next=this.definition.checkpoints[this.checkpointIndex+1];
    if(next&&this.position.z<next[2]&&Math.abs(this.position.x-next[0])<20&&Math.abs(this.position.y-next[1])<10){
      this.checkpointIndex++;this.respawnPoint.set(...next);
    }
  }

  private setSurface(surface:'concrete'|'wood'):void{
    if(surface!==this.lastSurface){this.lastSurface=surface;this.events.emit('surface',{surface});}
  }

  currentGrindables:import('../levels/LevelTypes').Grindable[]=[];
}
