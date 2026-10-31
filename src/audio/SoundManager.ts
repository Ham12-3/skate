import { CONFIG } from '../core/config';
import type { EventBus } from '../core/EventBus';

export class SoundManager {
  private context?:AudioContext;
  private master?:GainNode;
  private musicBus?:GainNode;
  private soundBus?:GainNode;
  private readonly buffers=new Map<string,AudioBuffer>();
  private readonly loading=new Map<string,Promise<AudioBuffer>>();
  private musicSource?:AudioBufferSourceNode;
  private musicGain?:GainNode;
  private currentMusic='';
  private rollSources?:{concrete:AudioBufferSourceNode;wood:AudioBufferSourceNode;concreteGain:GainNode;woodGain:GainNode};
  private grindSource?:AudioBufferSourceNode;
  private grindGain?:GainNode;
  private grindMaterial:'metal'|'concrete'='metal';
  private grinding=false;
  private speed=0;
  private surface:'concrete'|'wood'='concrete';
  private musicVolume:number=CONFIG.audio.defaultMusicVolume;
  private soundVolume:number=CONFIG.audio.defaultSoundVolume;

  constructor(events:EventBus){
    window.addEventListener('pointerdown',this.unlock,{passive:true});
    window.addEventListener('keydown',this.unlock,{passive:true});
    document.addEventListener('click',(event)=>{if((event.target as HTMLElement).closest('button'))void this.play('click',.5);});
    events.on('push',()=>void this.play('push'));
    events.on('ollie',()=>void this.play('ollie'));
    events.on('land',({impact})=>void this.play('land',Math.min(1,.35+impact/18)));
    events.on('bail',()=>void this.play('bail'));
    events.on('bank',()=>void this.play('combo',.8));
    events.on('surface',({surface})=>{this.surface=surface;this.updateLoops();});
    events.on('speed',({normalized,grounded})=>{this.speed=grounded?normalized:0;this.updateLoops();});
    events.on('grind',({active,material})=>{this.grinding=active;this.grindMaterial=material;void this.ensureGrind();this.updateLoops();});
  }

  private unlock=():void=>{void this.initialize();};

  async initialize():Promise<void>{
    if(this.context){if(this.context.state==='suspended')await this.context.resume();return;}
    const AudioContextClass=window.AudioContext;
    this.context=new AudioContextClass();
    this.master=this.context.createGain();this.musicBus=this.context.createGain();this.soundBus=this.context.createGain();
    this.musicBus.gain.value=this.musicVolume;this.soundBus.gain.value=this.soundVolume;
    this.musicBus.connect(this.master);this.soundBus.connect(this.master);this.master.connect(this.context.destination);
    await this.context.resume();
    await this.ensureRoll();
  }

  setVolumes(music:number,sound:number):void{
    this.musicVolume=music;this.soundVolume=sound;
    if(this.context&&this.musicBus&&this.soundBus){this.musicBus.gain.setTargetAtTime(music,this.context.currentTime,.05);this.soundBus.gain.setTargetAtTime(sound,this.context.currentTime,.05);}
  }

  async playMusic(name:string):Promise<void>{
    if(name===this.currentMusic)return;
    this.currentMusic=name;
    await this.initialize();if(!this.context||!this.musicBus)return;
    const buffer=await this.load(name);if(!this.context||name!==this.currentMusic)return;
    if(this.musicGain&&this.musicSource){const oldSource=this.musicSource;const oldGain=this.musicGain;oldGain.gain.setTargetAtTime(0,this.context.currentTime,1/CONFIG.audio.musicFadeSpeed);setTimeout(()=>{try{oldSource.stop();}catch{/* already stopped */}},1500);}
    const source=this.context.createBufferSource();const gain=this.context.createGain();
    source.buffer=buffer;source.loop=true;gain.gain.value=0;source.connect(gain);gain.connect(this.musicBus);source.start();
    gain.gain.setTargetAtTime(1,this.context.currentTime,1/CONFIG.audio.musicFadeSpeed);
    this.musicSource=source;this.musicGain=gain;
  }

  private async play(name:string,volume=1,pitch=1):Promise<void>{
    await this.initialize();if(!this.context||!this.soundBus)return;
    const buffer=await this.load(name);const source=this.context.createBufferSource();const gain=this.context.createGain();
    source.buffer=buffer;source.playbackRate.value=pitch;gain.gain.value=volume;source.connect(gain);gain.connect(this.soundBus);source.start();
  }

  private async ensureRoll():Promise<void>{
    if(!this.context||!this.soundBus||this.rollSources)return;
    const [concrete,wood]=await Promise.all([this.load('roll_concrete'),this.load('roll_wood')]);
    if(!this.context||!this.soundBus)return;
    const concreteSource=this.context.createBufferSource(),woodSource=this.context.createBufferSource();
    const concreteGain=this.context.createGain(),woodGain=this.context.createGain();
    concreteSource.buffer=concrete;woodSource.buffer=wood;concreteSource.loop=woodSource.loop=true;
    concreteGain.gain.value=woodGain.gain.value=0;
    concreteSource.connect(concreteGain);woodSource.connect(woodGain);concreteGain.connect(this.soundBus);woodGain.connect(this.soundBus);
    concreteSource.start();woodSource.start();this.rollSources={concrete:concreteSource,wood:woodSource,concreteGain,woodGain};this.updateLoops();
  }

  private async ensureGrind():Promise<void>{
    if(!this.context||!this.soundBus)return;
    if(!this.grindSource){
      const buffer=await this.load(`grind_${this.grindMaterial}`);if(!this.context||!this.soundBus)return;
      const source=this.context.createBufferSource();this.grindGain=this.context.createGain();source.buffer=buffer;source.loop=true;this.grindGain.gain.value=0;
      source.connect(this.grindGain);this.grindGain.connect(this.soundBus);source.start();this.grindSource=source;
    }else if(this.grindSource.buffer?.duration){
      const expected=await this.load(`grind_${this.grindMaterial}`);if(this.grindSource.buffer!==expected)this.grindSource.buffer=expected;
    }
  }

  private updateLoops():void{
    if(!this.context)return;
    const now=this.context.currentTime;const volume=Math.min(CONFIG.audio.rollMaxVolume,this.speed*CONFIG.audio.rollMaxVolume);
    const pitch=CONFIG.audio.rollMinPitch+this.speed*(CONFIG.audio.rollMaxPitch-CONFIG.audio.rollMinPitch);
    if(this.rollSources){
      this.rollSources.concrete.playbackRate.setTargetAtTime(pitch,now,.05);this.rollSources.wood.playbackRate.setTargetAtTime(pitch,now,.05);
      this.rollSources.concreteGain.gain.setTargetAtTime(this.surface==='concrete'?volume:0,now,.05);
      this.rollSources.woodGain.gain.setTargetAtTime(this.surface==='wood'?volume:0,now,.05);
    }
    this.grindGain?.gain.setTargetAtTime(this.grinding?.5:0,now,.04);
  }

  private async load(name:string):Promise<AudioBuffer>{
    const cached=this.buffers.get(name);if(cached)return cached;
    const pending=this.loading.get(name);if(pending)return pending;
    const promise=this.fetchBuffer(name);this.loading.set(name,promise);
    try{const buffer=await promise;this.buffers.set(name,buffer);return buffer;}finally{this.loading.delete(name);}
  }

  private async fetchBuffer(name:string):Promise<AudioBuffer>{
    if(!this.context)throw new Error('Audio context not initialized');
    try{
      // Sound effects use bare names; level definitions give full filenames like their other assets.
      const file=name.endsWith('.mp3')?name:`${name}.mp3`;
      const response=await fetch(`/assets/audio/${file}`);if(!response.ok)throw new Error(`${response.status} ${response.statusText}`);
      return await this.context.decodeAudioData(await response.arrayBuffer());
    }catch(error){
      console.warn(`Audio fallback used: ${name}.mp3`,error);
      const length=this.context.sampleRate;const buffer=this.context.createBuffer(1,length,this.context.sampleRate);const data=buffer.getChannelData(0);
      for(let i=0;i<length;i++)data[i]=Math.sin(i/length*Math.PI*8)*Math.exp(-i/length*5)*.2;
      return buffer;
    }
  }
}
