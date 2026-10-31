import * as THREE from 'three';
import './style.css';
import { AssetLoader } from './core/AssetLoader';
import { EventBus } from './core/EventBus';
import { GameLoop } from './core/GameLoop';
import { InputManager } from './core/InputManager';
import { PhysicsWorld } from './core/PhysicsWorld';
import { SaveManager, type SaveData } from './core/SaveManager';
import { CONFIG } from './core/config';
import { PlayerController } from './player/PlayerController';
import { ComboSystem } from './player/ComboSystem';
import { ChaseCamera } from './player/ChaseCamera';
import { LevelManager } from './levels/LevelManager';
import { LEVELS } from './levels';
import { UI } from './ui/UI';
import { SoundManager } from './audio/SoundManager';
import { ParticleSystem } from './effects/ParticleSystem';
import { SlowMotion } from './effects/SlowMotion';
import { PostProcessing } from './effects/PostProcessing';

type GameState='loading'|'menu'|'intro'|'playing'|'paused'|'results';

class KickflipCity {
  private readonly scene=new THREE.Scene();
  private readonly renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  private readonly physics=new PhysicsWorld();
  private readonly assets=new AssetLoader();
  private readonly events=new EventBus();
  private readonly input=new InputManager();
  private readonly save=new SaveManager();
  private readonly combo=new ComboSystem(this.events);
  private readonly sound=new SoundManager(this.events);
  private readonly slowMotion=new SlowMotion();
  private readonly sun=new THREE.DirectionalLight();
  private readonly sunOffset=new THREE.Vector3();
  private readonly ambient=new THREE.HemisphereLight();
  private readonly ui:UI;
  private readonly loop:GameLoop;
  private levels!:LevelManager;
  private player!:PlayerController;
  private chase!:ChaseCamera;
  private particles!:ParticleSystem;
  private post?:PostProcessing;
  private state:GameState='loading';
  private currentLevel=0;
  private timeRemaining=0;
  private elapsed=0;
  private fps=60;
  private loadToken=0;
  private pixelRatio=Math.min(devicePixelRatio,CONFIG.rendering.maxPixelRatio);
  private resolutionTimer=0;
  private readonly fallbackCamera=new THREE.PerspectiveCamera();

  constructor(){
    this.renderer.setSize(innerWidth,innerHeight);this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.95;
    document.querySelector<HTMLElement>('#game')!.append(this.renderer.domElement);
    this.sun.castShadow=true;this.sun.shadow.mapSize.set(CONFIG.rendering.shadowMapSize,CONFIG.rendering.shadowMapSize);
    this.sun.shadow.camera.left=-CONFIG.rendering.shadowDistance;this.sun.shadow.camera.right=CONFIG.rendering.shadowDistance;
    this.sun.shadow.camera.top=CONFIG.rendering.shadowDistance;this.sun.shadow.camera.bottom=-CONFIG.rendering.shadowDistance;
    this.sun.shadow.camera.near=.5;this.sun.shadow.camera.far=180;this.sun.shadow.bias=-.0003;
    this.scene.add(this.sun,this.ambient);
    this.ui=new UI(document.querySelector<HTMLElement>('#ui')!,{
      play:()=>void this.startLevel(Math.min(this.save.data.unlockedLevels-1,4)),
      selectLevel:(index)=>void this.startLevel(index),resume:()=>this.resume(),restart:()=>void this.startLevel(this.currentLevel,true),
      quit:()=>this.menu(),next:()=>void this.startLevel(Math.min(4,this.currentLevel+1)),
      settings:(settings)=>this.applySettings(settings),
    });
    this.loop=new GameLoop((dt)=>this.fixedUpdate(dt),(alpha,dt)=>this.render(alpha,dt));
    window.addEventListener('resize',()=>{this.renderer.setSize(innerWidth,innerHeight);this.post?.setSize(innerWidth,innerHeight,this.pixelRatio);});
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&this.state==='playing')this.pause();});
    this.bindEvents();
  }

  async initialize():Promise<void>{
    this.ui.loading(0,'Starting physics');
    await Promise.all([
      this.physics.initialize(),
      this.assets.loadCore((progress,label)=>this.ui.loading(progress,label)),
    ]);
    this.levels=new LevelManager(this.scene,this.physics,this.assets);
    this.player=new PlayerController(this.physics,this.input,this.events,this.combo,this.assets);
    this.player.board.setDeck(this.save.data.settings.deck);this.scene.add(this.player.root);
    this.chase=new ChaseCamera(this.physics);this.chase.distance=this.save.data.settings.cameraDistance;
    this.post=new PostProcessing(this.renderer,this.scene,this.chase.camera);
    this.particles=new ParticleSystem(this.scene);
    this.sound.setVolumes(this.save.data.settings.musicVolume,this.save.data.settings.soundVolume);
    this.menu();this.loop.start();
  }

  private bindEvents():void{
    this.events.on('trick',({name,icon})=>this.ui.trick(name,icon));
    this.events.on('score',({chain,pending})=>this.ui.combo(chain,pending));
    this.events.on('bank',({points})=>this.ui.bank(points));
    this.events.on('push',()=>this.particles?.dust(this.player.position,CONFIG.effects.pushDustCount));
    this.events.on('land',({impact,clean,combo})=>{
      this.particles.dust(this.player.position,Math.round(CONFIG.effects.landingDustCount*Math.min(2,impact/7)));
      if(impact>=CONFIG.tricks.hardLandingVelocity)this.chase.addShake(CONFIG.camera.shakeLanding*Math.min(2,impact/CONFIG.tricks.hardLandingVelocity));
      if(clean&&combo>=CONFIG.combo.slowMotionCombo)this.slowMotion.trigger();
    });
    this.events.on('bail',()=>this.chase?.addShake(CONFIG.camera.shakeBail));
    this.events.on('grind',({active,balance})=>this.ui.balance(active?1:0,balance));
  }

  private async startLevel(index:number,skipIntro=false):Promise<void>{
    if(index<0||index>=LEVELS.length||index>=this.save.data.unlockedLevels)return;
    const token=++this.loadToken;this.state='loading';this.input.setEnabled(false);
    this.ui.loading(0,`Building ${LEVELS[index]!.name}`);this.slowMotion.reset();
    const definition=LEVELS[index]!;
    await this.levels.load(definition);if(token!==this.loadToken)return;
    this.currentLevel=index;this.timeRemaining=definition.timeLimit;this.elapsed=0;
    this.applyLighting(definition.lighting);
    this.player.reset(definition);this.player.board.setDeck(this.save.data.settings.deck);
    this.player.currentGrindables=this.levels.buildResult?.grindables??[];
    this.player.currentPedestrians=this.levels.buildResult?.pedestrians??[];
    this.chase.snap(this.player.position,this.player.yaw);
    await this.sound.playMusic(definition.musicFile);
    if(token!==this.loadToken)return;
    if(skipIntro)this.beginGameplay();else{this.state='intro';this.ui.intro(definition,()=>this.beginGameplay());}
  }

  private beginGameplay():void{
    if(!this.levels.definition)return;
    this.state='playing';this.input.setEnabled(true);this.ui.gameplay(this.levels.definition);
    this.ui.updateHUD(this.combo.score,this.timeRemaining,this.player.speed);
  }

  private menu():void{
    ++this.loadToken;this.state='menu';this.input.setEnabled(false);this.slowMotion.reset();this.levels?.unload();
    this.scene.fog=null;this.scene.background=new THREE.Color(0x182336);this.scene.environment=null;
    if(this.player)this.player.root.visible=false;
    this.ui.menu(this.save.data);void this.sound.playMusic('music_menu');
  }

  private pause():void{
    if(this.state!=='playing')return;this.state='paused';this.ui.pause(this.save.data);
  }

  private resume():void{
    if(this.state!=='paused'||!this.levels.definition)return;
    this.state='playing';this.ui.gameplay(this.levels.definition);this.input.setEnabled(true);
  }

  private finish():void{
    if(this.state!=='playing'||!this.levels.definition)return;
    this.state='results';this.input.setEnabled(false);this.grindsStop();
    const level=this.levels.definition;const score=Math.round(this.combo.score);
    const highScore=this.save.recordScore(this.currentLevel,score,this.combo.bestMultiplier);
    if(score>=level.scoreTarget&&this.currentLevel===this.save.data.unlockedLevels-1)this.save.unlock(LEVELS.length);
    this.ui.results(level,score,this.combo.bestMultiplier,highScore,this.currentLevel<LEVELS.length-1&&score>=level.scoreTarget,this.save.data.bestScores[this.currentLevel]??score);
  }

  private grindsStop():void{this.player.grinds.stop();}

  private applySettings(settings:SaveData['settings']):void{
    this.save.data.settings={...settings};this.save.write();this.sound.setVolumes(settings.musicVolume,settings.soundVolume);
    if(this.chase)this.chase.distance=settings.cameraDistance;if(this.player)this.player.board.setDeck(settings.deck);
  }

  private applyLighting(lighting:import('./levels/LevelTypes').LightingSettings):void{
    this.sun.color.setHex(lighting.sunColor);this.sun.intensity=lighting.sunIntensity;this.sunOffset.set(...lighting.sunPosition);
    this.sun.position.copy(this.sunOffset);this.scene.add(this.sun.target);
    this.ambient.color.setHex(lighting.ambientColor);this.ambient.groundColor.setHex(0x4a3d35);this.ambient.intensity=lighting.ambientIntensity;
  }

  private fixedUpdate(dt:number):void{
    this.input.update();
    if(this.input.wasPressed('fps'))this.ui.toggleFPS();
    if(this.state==='playing'){
      if(this.input.wasPressed('pause'))this.pause();
      else if(this.input.wasPressed('restart'))void this.startLevel(this.currentLevel,true);
      else{
        this.timeRemaining-=dt;this.elapsed+=dt;
        this.levels.update(dt);this.physics.step();this.player.root.visible=true;this.player.fixedUpdate(dt);
        if(this.player.grinds.active)this.particles.sparks(this.player.position);
        if(this.timeRemaining<=0)this.finish();
      }
    }else if(this.state==='paused'&&this.input.wasPressed('pause'))this.resume();
    this.input.endStep();
  }

  private render(alpha:number,frameDelta:number):void{
    this.loop.timeScale=this.state==='playing'?this.slowMotion.update(frameDelta):1;
    if(this.player&&this.chase){
      if(this.state==='playing'){
        this.player.render(alpha);this.chase.update(frameDelta,this.player.cameraPosition,this.player.cameraYaw,this.player.speed);
        this.sun.position.copy(this.player.cameraPosition).add(this.sunOffset);this.sun.target.position.copy(this.player.cameraPosition);
        this.ui.updateHUD(this.combo.score,this.timeRemaining,this.player.speed);
        this.ui.tutorial(this.elapsed,this.currentLevel===0&&this.save.data.settings.tutorial);
        this.ui.speedLines(Math.min(Math.abs(this.player.speed)/CONFIG.movement.absoluteMaxSpeed,1));
      }
    }
    this.particles?.update(frameDelta*(this.loop.timeScale||1));
    const fpsAlpha=1-Math.exp(-frameDelta/CONFIG.ui.fpsSampleDuration);
    this.fps=THREE.MathUtils.lerp(this.fps,frameDelta>0?1/frameDelta:60,fpsAlpha);this.ui.update(frameDelta,this.fps);
    if(this.state==='playing')this.updateAdaptiveResolution(frameDelta);
    if(this.post&&this.chase)this.post.render(frameDelta);
    else this.renderer.render(this.scene,this.fallbackCamera);
  }

  private updateAdaptiveResolution(frameDelta:number):void{
    this.resolutionTimer+=frameDelta;
    if(this.resolutionTimer<CONFIG.rendering.resolutionAdjustInterval)return;
    this.resolutionTimer=0;
    this.post?.setPerformance(this.fps);
    let next=this.pixelRatio;
    if(this.fps<CONFIG.rendering.resolutionDownFps)next=Math.max(CONFIG.rendering.minPixelRatio,this.pixelRatio-CONFIG.rendering.pixelRatioStep);
    else if(this.fps>CONFIG.rendering.resolutionUpFps)next=Math.min(Math.min(devicePixelRatio,CONFIG.rendering.maxPixelRatio),this.pixelRatio+CONFIG.rendering.pixelRatioStep);
    if(Math.abs(next-this.pixelRatio)>.01){this.pixelRatio=next;this.renderer.setPixelRatio(next);this.post?.setSize(innerWidth,innerHeight,next);}
  }
}

const game=new KickflipCity();
void game.initialize().catch((error:unknown)=>{
  console.error('Kickflip City initialization failed',error);
  const ui=document.querySelector<HTMLElement>('#ui')!;
  ui.innerHTML='<section class="loading"><h1>Unable to start</h1><p>WebGL is required to play Kickflip City. Please enable hardware acceleration and reload.</p></section>';
});
