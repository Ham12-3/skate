import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { EventBus } from '../core/EventBus';
import type { InputManager } from '../core/InputManager';
import type { PhysicsWorld, RayHit } from '../core/PhysicsWorld';
import type { AssetLoader } from '../core/AssetLoader';
import type { LevelDefinition } from '../levels/LevelTypes';
import { createCharacter, type CharacterModel, type SkaterMotion } from './CharacterModel';
import { Skateboard } from './Skateboard';
import { TrickSystem } from './TrickSystem';
import { GrindSystem } from './GrindSystem';
import type { ComboSystem } from './ComboSystem';

const UP=new THREE.Vector3(0,1,0);
const DOWN=new THREE.Vector3(0,-1,0);
const wrapAngle=(angle:number):number=>Math.atan2(Math.sin(angle),Math.cos(angle));

export class PlayerController {
  readonly root=new THREE.Group();
  readonly character:CharacterModel;
  readonly board:Skateboard;
  readonly tricks:TrickSystem;
  readonly grinds:GrindSystem;
  readonly position=new THREE.Vector3();
  // Signed speed along the riding surface; horizontal speed while airborne.
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
  // Physics contact normal, and the smoothed normal the board is drawn against.
  private readonly groundNormal=new THREE.Vector3(0,1,0);
  private readonly boardNormal=new THREE.Vector3(0,1,0);
  private readonly velocity=new THREE.Vector3();
  private airTime=0;
  private launchNormalY=1;
  private rollingResistance:number=CONFIG.surfaces.concrete;
  private acceleration=0;
  private smoothedSteer=0;
  private carve=0;
  private revertAngle=0;
  private crouchHold=0;
  private pushCooldown=0;
  private pushQueued=false;
  private pushPoseTimer=0;
  private landingPoseTimer=0;
  private grindCooldown=0;
  private bailTimer=0;
  private invulnerability=0;
  private definition?:LevelDefinition;
  private respawnPoint=new THREE.Vector3();
  private checkpointIndex=0;
  // Recent flat spots the rider rolled over, newest last, so a slam restarts just before it.
  private readonly safeSpots:{position:THREE.Vector3;yaw:number;time:number}[]=[];
  private clock=0;
  private lastGroundTime=0;
  private safeTimer=0;
  private lastSurface:'concrete'|'wood'='concrete';
  private ragdolled=false;
  private readonly cameraFocus=new THREE.Vector3();

  constructor(private readonly physics:PhysicsWorld,private readonly input:InputManager,private readonly events:EventBus,private readonly combo:ComboSystem,assets:AssetLoader){
    this.board=new Skateboard(assets);this.character=createCharacter(assets,this.board);
    this.root.add(this.board.root,this.character.root);
    this.tricks=new TrickSystem(this.board,combo);
    this.grinds=new GrindSystem(combo,events);
  }

  reset(definition:LevelDefinition):void{
    this.definition=definition;
    this.position.set(...definition.spawn);this.previousPosition.copy(this.position);
    this.respawnPoint.copy(this.position);this.checkpointIndex=0;this.safeSpots.length=0;this.clock=0;this.lastGroundTime=0;this.safeTimer=0;
    this.yaw=definition.yaw;this.previousYaw=this.yaw;this.renderYaw=this.yaw;
    this.speed=0;this.velocity.set(0,0,0);this.acceleration=0;this.smoothedSteer=0;this.carve=0;this.revertAngle=0;
    this.airTime=0;this.grounded=false;this.bailed=false;this.launchNormalY=1;this.rollingResistance=CONFIG.surfaces.concrete;
    this.groundNormal.copy(UP);this.boardNormal.copy(UP);this.crouchHold=0;this.pushCooldown=0;this.pushQueued=false;this.grindCooldown=0;this.invulnerability=0;
    this.combo.reset();this.tricks.reset();this.grinds.reset();
    this.character.stopRagdoll();this.ragdolled=false;
    this.character.setPose('idle');this.character.resetRoot();
    this.updateOrientation(1);this.root.position.copy(this.position);this.root.quaternion.copy(this.targetQuaternion);
  }

  fixedUpdate(dt:number):void{
    if(!this.definition)return;
    this.previousPosition.copy(this.position);this.previousQuaternion.copy(this.root.quaternion);this.previousYaw=this.yaw;
    this.pushCooldown=Math.max(0,this.pushCooldown-dt);this.pushPoseTimer=Math.max(0,this.pushPoseTimer-dt);
    this.landingPoseTimer=Math.max(0,this.landingPoseTimer-dt);this.invulnerability=Math.max(0,this.invulnerability-dt);
    this.grindCooldown=Math.max(0,this.grindCooldown-dt);
    this.revertAngle*=Math.exp(-CONFIG.movement.revertRate*dt);
    if(this.bailed){
      this.bailTimer-=dt;this.character.update(dt,this.motion(0));
      if(!this.ragdolled){
        this.character.root.rotation.x+=dt*4;this.character.root.rotation.z+=dt*3;
        this.character.root.position.x+=dt*1.1;this.character.root.position.y=Math.max(-.35,this.character.root.position.y-dt*.8);
      }
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
    const previousSpeed=this.speed;
    if(this.grounded)this.updateGround(dt);
    else this.updateAir(dt);
    if(this.grinds.active)return;
    this.updateCheckpoint();
    this.recordSafeSpot(dt);
    this.combo.update(dt,this.grounded,true);
    this.board.setGrab(!this.grounded&&this.tricks.grabbing);
    this.board.update(dt,this.speed,this.smoothedSteer,this.grounded);
    this.acceleration=THREE.MathUtils.lerp(this.acceleration,(this.speed-previousSpeed)/dt,1-Math.exp(-6*dt));
    const accelerationLean=THREE.MathUtils.clamp(this.acceleration/3,-1,1)*CONFIG.character.accelerationLean;
    const speedLean=Math.min(Math.abs(this.speed)/CONFIG.movement.feedbackSpeed,1)*CONFIG.character.speedLean;
    this.character.update(dt,this.motion(accelerationLean+speedLean));
    this.updateOrientation(dt);
    this.events.emit('speed',{normalized:Math.min(Math.abs(this.speed)/CONFIG.movement.feedbackSpeed,1),grounded:this.grounded});
    const fallY=this.definition.id===3?this.respawnPoint.y-18:this.definition.id===4?-12:CONFIG.physics.fallRespawnY;
    if(this.position.y<fallY)this.bail('Fell off the line');
  }

  currentPedestrians:import('../levels/LevelTypes').Pedestrian[]=[];

  private updateGround(dt:number):void{
    const normal=this.groundNormal;
    // Trucks turn the board along an arc: tight radius at walking pace, capped by grip at speed.
    const absSpeed=Math.abs(this.speed);
    const carveRate=absSpeed>.05?Math.min(absSpeed/CONFIG.movement.minTurnRadius,CONFIG.movement.maxLateralAcceleration/absSpeed):0;
    const kickturnRate=CONFIG.movement.kickturnRate*THREE.MathUtils.clamp(1-absSpeed/CONFIG.movement.kickturnMaxSpeed,0,1);
    this.yaw+=this.smoothedSteer*(carveRate*(this.speed<0?-1:1)+kickturnRate)*dt;
    const lateral=absSpeed*carveRate*Math.abs(this.smoothedSteer);
    this.carve=this.smoothedSteer*Math.min(1,absSpeed*carveRate/CONFIG.movement.maxLateralAcceleration);
    const tangent=this.surfaceTangent(normal);

    // Foot pushes only work on near-flat ground; on transitions holding push pumps instead.
    // A tap during the previous stroke is remembered and pushed as soon as the foot is free again.
    if(this.input.wasPressed('push'))this.pushQueued=true;
    if((this.input.isHeld('push')||this.pushQueued)&&!this.input.isHeld('ollie')){
      if(normal.y>=CONFIG.movement.pushMaxSlope){
        if(this.pushCooldown<=0&&this.speed<CONFIG.movement.maxPushSpeed){
          this.pushQueued=false;
          const forwardSpeed=Math.max(0,this.speed);
          this.speed+=CONFIG.movement.pushImpulse*(1-(forwardSpeed/CONFIG.movement.maxPushSpeed)**2);
          this.pushCooldown=CONFIG.movement.pushCooldown;this.pushPoseTimer=CONFIG.movement.pushCooldown;
          this.events.emit('push',undefined);
        }else if(this.speed>=CONFIG.movement.maxPushSpeed)this.pushQueued=false;
      }else if(absSpeed>.5)this.speed+=Math.sign(this.speed)*CONFIG.movement.pumpAcceleration*dt;
    }
    let deceleration=this.rollingResistance*-CONFIG.physics.gravity*normal.y+CONFIG.physics.airDrag*this.speed*this.speed+CONFIG.movement.carveScrub*lateral;
    if(this.input.isHeld('brake'))deceleration+=CONFIG.movement.brakeDeceleration;
    this.speed=Math.sign(this.speed)*Math.max(0,Math.abs(this.speed)-deceleration*dt);
    this.speed+=CONFIG.physics.gravity*tangent.y*dt;
    this.speed=THREE.MathUtils.clamp(this.speed,-CONFIG.movement.absoluteMaxSpeed,CONFIG.movement.absoluteMaxSpeed);
    // Rolling back down a transition: kickturn so the rider faces down the ramp again.
    if(this.speed<0&&normal.y<CONFIG.movement.pushMaxSlope){
      this.yaw+=Math.PI;this.speed=-this.speed;tangent.negate();
      this.revertAngle=wrapAngle(this.revertAngle-Math.PI);
    }

    if(this.input.isHeld('ollie'))this.crouchHold=Math.min(CONFIG.ollie.maxHold,this.crouchHold+dt);
    if(this.input.wasReleased('ollie')){
      const charge=THREE.MathUtils.clamp((this.crouchHold-CONFIG.ollie.minHold)/(CONFIG.ollie.maxHold-CONFIG.ollie.minHold),0,1);
      const pop=normal.clone().lerp(UP,CONFIG.ollie.surfacePopBlend).normalize().multiplyScalar(THREE.MathUtils.lerp(CONFIG.ollie.minJumpForce,CONFIG.ollie.maxJumpForce,charge));
      this.crouchHold=0;this.takeOff(tangent,pop);this.board.pop();
      this.events.emit('ollie',undefined);
      this.updateAir(dt);return;
    }

    const travel=tangent.clone().multiplyScalar(this.speed<0?-1:1);
    const wall=this.physics.ray(this.position.clone().addScaledVector(normal,CONFIG.physics.wallRayHeight),travel,CONFIG.physics.wallRayDistance+Math.abs(this.speed)*dt);
    if(wall&&wall.normal.dot(normal)<.5&&wall.normal.dot(travel)<-.3){
      this.collide(wall.normal,travel,CONFIG.physics.wallBailSpeed,'High-speed wall impact');return;
    }
    const previous=this.position.clone();
    this.position.addScaledVector(tangent,this.speed*dt);
    const hit=this.probeGround(this.position,normal,CONFIG.physics.groundSnapDown);
    if(!hit){this.takeOff(tangent,null);return;}
    // A step that rises faster than a wheel can roll over it stops the board like a wall.
    const rise=CONFIG.physics.groundProbeHeight-hit.distance;
    const blocked=hit.distance<1e-4||rise>.3;
    if(blocked||rise>CONFIG.physics.stepUpTolerance&&hit.normal.dot(normal)>.99){
      this.position.copy(previous);
      // The probe hit the top of the step; a low ray finds the face the wheels actually struck.
      const face=this.physics.ray(previous.clone().addScaledVector(normal,.04),travel,Math.abs(this.speed)*dt+.35);
      const faceNormal=face&&face.normal.dot(normal)<.5?face.normal:travel.clone().negate();
      this.collide(faceNormal,travel,CONFIG.physics.curbBailSpeed,blocked?'Ran into an obstacle':'Clipped a curb');return;
    }
    this.position.copy(hit.point);
    this.groundNormal.copy(this.truckNormal(hit,tangent));
    this.rollingResistance=hit.rollingResistance;this.setSurface(hit.surface);
    this.character.setPose(this.input.isHeld('ollie')?'crouch':this.landingPoseTimer>0?'land':this.pushPoseTimer>0?'push':Math.abs(this.speed)>.2?'roll':'idle');
  }

  // Only the part of the motion driven into an obstacle counts: grazing a curb or wall knocks the
  // board along it, while riding straight into one stops it or throws the rider.
  private collide(faceNormal:THREE.Vector3,travel:THREE.Vector3,bailSpeed:number,reason:string):void{
    const normal=this.groundNormal;
    const across=faceNormal.clone().addScaledVector(normal,-faceNormal.dot(normal)).normalize();
    const into=Math.max(0,-travel.dot(across));
    if(Math.abs(this.speed)*into>bailSpeed){this.bail(reason);return;}
    if(into>CONFIG.physics.headOnContact){
      const impact=Math.abs(this.speed)*into;
      if(impact>CONFIG.physics.runOutSpeed)this.runOut(impact);
      else this.speed*=-CONFIG.physics.wallRestitution;
      return;
    }
    const along=travel.clone().addScaledVector(across,into).normalize();
    const heading=this.speed<0?along.negate():along;
    const yaw=Math.atan2(heading.x,heading.z);
    this.revertAngle=wrapAngle(this.revertAngle+this.yaw-yaw);
    this.yaw=yaw;
    // Scrubbing loss grows with how squarely the edge was hit; rubbing along it costs almost nothing.
    this.speed*=Math.sqrt(1-into*into)*(1-(1-CONFIG.physics.glanceRetention)*into);
  }

  // A solid but survivable hit: the board stops dead and the rider steps off and runs it out, as real
  // skaters do. No slam and no respawn, but the trick chain is lost.
  private runOut(impact:number):void{
    this.speed=0;this.combo.bail();this.tricks.reset();this.character.land(impact);
    this.events.emit('land',{impact:Math.max(impact,CONFIG.tricks.hardLandingVelocity),clean:false,combo:0});
  }

  private takeOff(tangent:THREE.Vector3,pop:THREE.Vector3|null):void{
    this.velocity.copy(tangent).multiplyScalar(this.speed);
    if(pop){this.velocity.add(pop);this.position.addScaledVector(this.groundNormal,.02);}
    // Off a vertical wall the rider leans back in so they come down on the transition.
    else if(this.groundNormal.y<.5)this.velocity.addScaledVector(this.groundNormal,CONFIG.movement.vertReentrySpeed);
    this.launchNormalY=this.groundNormal.y;this.airTime=0;this.grounded=false;this.tricks.start(this.input);
  }

  private updateAir(dt:number):void{
    this.airTime+=dt;
    this.tricks.update(dt,this.input);
    this.carve=THREE.MathUtils.lerp(this.carve,0,1-Math.exp(-6*dt));
    // Arcade air control: A/D turn the rider and their line of flight together.
    if(CONFIG.movement.airSteer>0){
      const turn=this.smoothedSteer*CONFIG.movement.airSteer*dt;
      this.yaw+=turn;this.velocity.applyAxisAngle(UP,turn);
    }
    this.velocity.y+=CONFIG.physics.gravity*dt;
    this.velocity.multiplyScalar(Math.max(0,1-CONFIG.physics.airDrag*this.velocity.length()*dt));
    const previous=this.position.clone();
    this.position.addScaledVector(this.velocity,dt);
    this.speed=Math.hypot(this.velocity.x,this.velocity.z);
    this.alignToLanding(dt);
    if(this.velocity.y<=0&&this.grindCooldown<=0&&!this.tricks.isFlipping&&this.definition){
      if(this.grinds.tryStart(this.position,this.yaw+this.tricks.spinAngle,this.velocity,this.currentGrindables)){
        const rail=this.grinds.rail!;
        const segment=rail.end.clone().sub(rail.start);
        this.speed=Math.abs(this.velocity.dot(segment.clone().normalize()));
        this.revertAngle=wrapAngle(this.revertAngle+this.tricks.spinAngle);
        if(!this.tricks.land().valid)this.tricks.reset();
        const t=THREE.MathUtils.clamp(this.position.clone().sub(rail.start).dot(segment)/segment.lengthSq(),0,1);
        this.position.y=THREE.MathUtils.lerp(rail.start.y,rail.end.y,t)+.12;
        this.character.setPose('grind');return;
      }
    }
    const contact=this.airContact(previous);
    if(contact)this.touchDown(contact);
    else this.character.setPose(this.tricks.grabbing?'grab':'air');
  }

  // Sweep the step for a surface we are moving into, falling back to a probe straight down.
  private airContact(previous:THREE.Vector3):RayHit|null{
    const displacement=this.position.clone().sub(previous);
    const distance=displacement.length();
    if(distance>1e-6){
      const hit=this.physics.ray(previous,displacement.divideScalar(distance),distance+.05);
      if(hit&&hit.distance>1e-4&&this.velocity.dot(hit.normal)<0)return hit;
    }
    if(this.velocity.y>0)return null;
    const down=this.groundRay(this.position);
    return down&&this.position.y<=down.point.y+CONFIG.movement.spawnClearance?down:null;
  }

  private touchDown(hit:RayHit):void{
    const normal=hit.normal.lengthSq()>.5?hit.normal:UP;
    const impact=Math.max(0,-this.velocity.dot(normal));
    const boardUp=UP.clone().applyQuaternion(this.targetQuaternion);
    const angle=Math.acos(THREE.MathUtils.clamp(boardUp.dot(normal),-1,1))*180/Math.PI;
    if(angle>CONFIG.tricks.sketchyLandingAngle){
      if(normal.y>=.5){this.bail('Bad landing angle');return;}
      // Walls and faces the board isn't lined up with: glance off unless it's a hard hit.
      if(impact>CONFIG.physics.wallBailSpeed){this.bail('Slammed into a wall');return;}
      this.velocity.addScaledVector(normal,-(1+CONFIG.physics.wallRestitution)*this.velocity.dot(normal));
      this.position.copy(hit.point).addScaledVector(normal,.05);
      return;
    }
    if(impact>CONFIG.physics.landingBailImpact){this.bail('Landed too hard');return;}
    const boardYaw=this.yaw+this.tricks.spinAngle+this.revertAngle;
    const trickResult=this.tricks.land();if(!trickResult.valid){this.bail(trickResult.reason);return;}
    // Momentum along the landing surface survives; the part driven into it is absorbed.
    const surfaceVelocity=this.velocity.clone().addScaledVector(normal,-this.velocity.dot(normal));
    const surfaceSpeed=surfaceVelocity.length();
    this.groundNormal.copy(normal);
    if(surfaceSpeed>.75){
      const heading=new THREE.Vector3(surfaceVelocity.x,0,surfaceVelocity.z);
      if(heading.length()<surfaceSpeed*.25)heading.set(normal.x,0,normal.z).multiplyScalar(surfaceVelocity.y<0?1:-1);
      const headingYaw=Math.atan2(heading.x,heading.z);
      const offset=wrapAngle(boardYaw-headingYaw);
      const misalignment=Math.min(Math.abs(offset),Math.PI-Math.abs(offset))*180/Math.PI;
      if(misalignment>CONFIG.movement.landingYawTolerance){this.bail('Landed sideways');return;}
      // Landing backwards: the board pivots round to face the line of travel (a revert).
      if(Math.abs(offset)>Math.PI/2&&this.airTime>.2)this.combo.addTrick('Revert',CONFIG.tricks.revertScore,'spin');
      this.yaw=headingYaw;this.revertAngle=offset;this.speed=surfaceSpeed;
    }else{
      this.revertAngle=wrapAngle(boardYaw-this.yaw);
      this.speed=surfaceVelocity.dot(this.surfaceTangent(normal));
    }
    const clean=angle<CONFIG.tricks.cleanLandingAngle;
    if(clean&&this.airTime>.2)this.combo.addPoints(CONFIG.tricks.cleanLandingBonus);
    this.airTime=0;this.velocity.set(0,0,0);
    this.position.copy(hit.point);this.grounded=true;
    this.rollingResistance=hit.rollingResistance;
    this.landingPoseTimer=.3;this.character.setPose('land');this.character.land(impact);this.setSurface(hit.surface);
    this.events.emit('land',{impact,clean,combo:this.combo.multiplier});
  }

  // Line the board up with the surface it is about to land on.
  private alignToLanding(dt:number):void{
    const speed=this.velocity.length();
    // Only vert airs come back down onto near-vertical faces; anything else that steep is a wall.
    const steepest=this.launchNormalY<.5?-.1:.35;
    let target:THREE.Vector3|undefined;
    if(speed>.5){
      const hit=this.physics.ray(this.position,this.velocity.clone().divideScalar(speed),Math.max(2.5,speed*.6));
      if(hit&&hit.distance>1e-4&&hit.normal.y>steepest)target=hit.normal;
    }
    if(!target&&this.velocity.y<=0){
      const down=this.groundRay(this.position);
      if(down&&down.normal.lengthSq()>.5)target=down.normal;
    }
    // Vert airs keep the board against the wall until the transition comes back into view.
    if(!target)target=this.launchNormalY<.5?this.boardNormal:UP;
    this.boardNormal.lerp(target,1-Math.exp(-CONFIG.physics.airAlignRate*dt)).normalize();
    this.groundNormal.copy(this.boardNormal);
  }

  private updateGrind(dt:number):void{
    const result=this.grinds.update(dt,this.input,this.position,this.speed);
    this.speed=result.speed;this.velocity.copy(result.direction).multiplyScalar(this.speed);
    this.revertAngle=wrapAngle(this.revertAngle+this.yaw-result.yaw);
    this.yaw=result.yaw;
    if(this.grinds.rail){
      const rail=this.grinds.rail;const segment=rail.end.clone().sub(rail.start);
      const t=THREE.MathUtils.clamp(this.position.clone().sub(rail.start).dot(segment)/segment.lengthSq(),0,1);
      this.position.y=THREE.MathUtils.lerp(rail.start.y,rail.end.y,t)+.12;
    }
    this.board.update(dt,this.speed,0,false);
    this.character.setPose('grind');this.character.update(dt,this.motion(0));
    this.combo.update(dt,false,false);this.updateOrientation(dt);
    if(result.bail){this.bail('Lost grind balance');return;}
    if(result.exit){
      this.velocity.copy(result.direction).multiplyScalar(this.speed);
      if(this.input.wasPressed('ollie')){this.velocity.y+=CONFIG.ollie.grindJumpForce;this.board.pop();}
      this.grounded=false;this.airTime=0;this.launchNormalY=1;this.grindCooldown=CONFIG.grind.relockDelay;this.tricks.start(this.input);
    }
  }

  private groundRay(position:THREE.Vector3):RayHit|null{
    return this.physics.ray(position.clone().add(new THREE.Vector3(0,1,0)),DOWN,CONFIG.physics.groundRayLength);
  }

  // Probe along the surface normal rather than straight down, so walls and vert ramps stay rideable.
  private probeGround(position:THREE.Vector3,normal:THREE.Vector3,reach:number):RayHit|null{
    const height=CONFIG.physics.groundProbeHeight;
    return this.physics.ray(position.clone().addScaledVector(normal,height),normal.clone().negate(),height+reach);
  }

  // Board forward direction lying in the riding surface; the truck axle stays horizontal.
  private surfaceTangent(normal:THREE.Vector3):THREE.Vector3{
    const forward=new THREE.Vector3(Math.sin(this.yaw),0,Math.cos(this.yaw));
    const tangent=new THREE.Vector3().crossVectors(new THREE.Vector3().crossVectors(UP,forward),normal);
    return tangent.lengthSq()<1e-6?forward:tangent.normalize();
  }

  // Front and rear truck rays capture the ramp tangent instead of snapping to a generic upright pose.
  private truckNormal(center:RayHit,tangent:THREE.Vector3):THREE.Vector3{
    if(center.normal.lengthSq()<.5)return this.groundNormal.clone();
    const normal=center.normal.clone();
    for(const offset of [-CONFIG.physics.truckOffset,CONFIG.physics.truckOffset]){
      const hit=this.probeGround(this.position.clone().addScaledVector(tangent,offset),this.groundNormal,.3);
      if(hit&&hit.distance>1e-4&&hit.normal.dot(center.normal)>.5)normal.add(hit.normal);
    }
    return normal.normalize();
  }

  private updateOrientation(dt:number):void{
    if(this.grinds.active)this.boardNormal.lerp(UP,1-Math.exp(-CONFIG.physics.renderNormalSmoothing*dt)).normalize();
    else if(this.grounded)this.boardNormal.lerp(this.groundNormal,1-Math.exp(-CONFIG.physics.renderNormalSmoothing*dt)).normalize();
    const forward=this.surfaceTangent(this.boardNormal);
    const right=new THREE.Vector3().crossVectors(this.boardNormal,forward).normalize();
    const matrix=new THREE.Matrix4().makeBasis(right,this.boardNormal,forward);
    this.targetQuaternion.setFromRotationMatrix(matrix);
    this.targetQuaternion.multiply(new THREE.Quaternion().setFromAxisAngle(UP,this.tricks.spinAngle+this.revertAngle));
    this.renderQuaternion.copy(this.targetQuaternion);
    if(dt>=1)this.root.quaternion.copy(this.targetQuaternion);
  }

  render(alpha:number):void{
    if(this.bailed)return;
    this.root.position.lerpVectors(this.previousPosition,this.position,alpha);
    this.root.quaternion.slerpQuaternions(this.previousQuaternion,this.renderQuaternion,alpha);
    const delta=wrapAngle(this.yaw-this.previousYaw);
    this.renderYaw=this.previousYaw+delta*alpha;
  }

  // While ragdolling the camera follows the body, which can tumble well away from where the bail happened.
  get cameraPosition():THREE.Vector3{
    return this.bailed&&this.character.ragdollFocus(this.cameraFocus)?this.cameraFocus:this.root.position;
  }
  get cameraYaw():number{return this.renderYaw;}

  bail(reason:string):void{
    if(this.bailed||this.invulnerability>0)return;
    // Momentum at the moment of the slam carries into the ragdoll; on the ground the feet stop with the board.
    const velocity=this.grounded?this.surfaceTangent(this.groundNormal).multiplyScalar(this.speed):this.velocity.clone();
    this.bailed=true;this.bailTimer=CONFIG.character.bailDuration;this.combo.bail();this.tricks.reset();this.grinds.stop();
    // Build the ragdoll from the exact physics pose rather than the last interpolated render.
    this.root.position.copy(this.position);this.root.quaternion.copy(this.renderQuaternion);
    this.character.setPose('bail');this.ragdolled=this.character.startRagdoll(this.physics,velocity,this.grounded);
    this.events.emit('bail',{reason});
  }

  private respawn():void{
    // Come back at a flat spot from just before the slam; fall back to the last checkpoint.
    // Look back from the last moment on the ground, so a long fall doesn't restart right at the edge.
    // (The clock only runs while riding, so it stopped at the moment of the slam.)
    const cutoff=Math.min(this.clock,this.lastGroundTime)-CONFIG.physics.respawnLookback;
    const spot=[...this.safeSpots].reverse().find((sample)=>sample.time<=cutoff);
    this.position.copy(spot?.position??this.respawnPoint);
    // Checkpoints can sit inside level geometry; drop the rider onto whatever is underneath.
    const ground=this.physics.ray(this.position.clone().add(new THREE.Vector3(0,10,0)),DOWN,20);
    if(ground)this.position.y=ground.point.y;
    this.previousPosition.copy(this.position);this.speed=0;this.velocity.set(0,0,0);this.airTime=0;this.revertAngle=0;
    this.yaw=spot?.yaw??this.definition?.yaw??Math.PI;this.groundNormal.copy(UP);this.boardNormal.copy(UP);this.launchNormalY=1;this.bailed=false;this.grounded=false;
    this.invulnerability=CONFIG.character.respawnInvulnerability;this.character.stopRagdoll();this.ragdolled=false;
    this.character.setPose('idle');this.root.quaternion.identity();
    this.character.resetRoot();
  }

  // Everything the animator needs to pose the rider this step.
  private motion(lean:number):SkaterMotion{
    return {
      speed:Math.abs(this.speed),carve:this.carve,lean,balance:this.grinds.balance,
      crouch:this.grounded&&this.input.isHeld('ollie')?this.crouchHold/CONFIG.ollie.maxHold:0,
      pushPhase:this.grounded&&this.pushPoseTimer>0?1-this.pushPoseTimer/CONFIG.movement.pushCooldown:-1,
      airTime:this.grounded?0:this.airTime,verticalSpeed:this.velocity.y,
      flip:this.tricks.flipState,grabbing:this.tricks.grabbing,
    };
  }

  private recordSafeSpot(dt:number):void{
    this.clock+=dt;this.safeTimer-=dt;
    if(this.grounded)this.lastGroundTime=this.clock;
    if(this.safeTimer>0||!this.grounded||this.groundNormal.y<.99)return;
    this.safeTimer=CONFIG.physics.safeSampleInterval;
    this.safeSpots.push({position:this.position.clone(),yaw:this.yaw,time:this.clock});
    if(this.safeSpots.length>CONFIG.physics.safeHistory)this.safeSpots.shift();
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
