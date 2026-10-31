import type { SaveData } from '../core/SaveManager';
import type { LevelDefinition } from '../levels/LevelTypes';
import { CONFIG, type DeckChoice } from '../core/config';

export interface UIHandlers {
  play:()=>void;
  selectLevel:(index:number)=>void;
  resume:()=>void;
  restart:()=>void;
  quit:()=>void;
  next:()=>void;
  settings:(settings:SaveData['settings'])=>void;
  demo:()=>void;
}

export class UI {
  private readonly screen=document.createElement('div');
  private readonly hud=document.createElement('div');
  private readonly popup=document.createElement('div');
  private readonly fps=document.createElement('div');
  private popupTimer=0;
  private introCleanup?:()=>void;

  constructor(private readonly root:HTMLElement,private readonly handlers:UIHandlers){
    this.screen.id='screen';this.hud.id='hud';this.popup.id='trick-popup';this.fps.id='fps';
    root.append(this.screen,this.hud,this.popup,this.fps);
    root.addEventListener('error',(event)=>{
      const image=event.target;
      if(!(image instanceof HTMLImageElement)||image.dataset.fallback)return;
      image.dataset.fallback='true';console.warn(`UI image fallback used: ${image.src}`);
      const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;
      const context=canvas.getContext('2d')!;context.fillStyle='#171d2b';context.fillRect(0,0,512,256);
      context.strokeStyle='#ff7628';context.lineWidth=14;context.strokeRect(14,14,484,228);
      context.fillStyle='#f8f4e8';context.font='900 58px sans-serif';context.textAlign='center';context.textBaseline='middle';
      context.fillText(image.alt||'KICKFLIP CITY',256,128,450);image.src=canvas.toDataURL('image/png');
    },true);
  }

  loading(progress:number,label:string):void{
    this.hud.className='';this.screen.innerHTML=`<section class="loading"><img src="/assets/ui/logo.png" alt="Kickflip City"><h2>BUILDING YOUR CITY</h2><div class="progress"><i style="width:${Math.round(progress*100)}%"></i></div><p>${label}</p></section>`;
  }

  menu(save:SaveData):void{
    this.clearIntro();this.hud.className='';
    this.screen.innerHTML=`<section class="menu"><video class="menu-video" autoplay muted loop playsinline poster="/assets/ui/level2_thumb.jpg"><source src="/assets/video/menu_loop.mp4" type="video/mp4"></video><div class="shade"></div><div class="menu-content"><img class="logo" src="/assets/ui/logo.png" alt="Kickflip City"><p class="eyebrow">FIVE SPOTS. ONE CITY. YOUR LINE.</p><div class="menu-buttons"><button data-action="play" class="primary">PLAY <span>↗</span></button><button data-action="levels">LEVEL SELECT</button><button data-action="settings">SETTINGS</button><button data-action="controls">CONTROLS</button><button data-action="demo" class="outline">▶ WATCH DEMO</button><button data-action="trailer" class="outline">▶ WATCH TRAILER</button></div><p class="save-note">${save.unlockedLevels}/5 spots unlocked · Progress saves locally</p></div><div class="menu-tag">SKATE<br>THE<br>WHOLE<br>CITY.</div></section>`;
    this.button('play',this.handlers.play);this.button('levels',()=>this.levelSelect(save));
    this.button('settings',()=>this.settings(save,'menu'));this.button('controls',()=>this.controls('menu',save));
    this.button('trailer',()=>this.trailer());this.button('demo',this.handlers.demo);
    void this.screen.querySelector<HTMLVideoElement>('.menu-video')?.play().catch(()=>undefined);
  }

  levelSelect(save:SaveData):void{
    const cards=Array.from({length:5},(_,i)=>{
      const locked=i>=save.unlockedLevels;
      return `<button class="level-card ${locked?'locked':''}" data-level="${i}" ${locked?'disabled':''}><div class="thumb"><img src="/assets/ui/level${i+1}_thumb.jpg" alt=""><span class="level-number">0${i+1}</span>${locked?'<img class="lock" src="/assets/ui/icon_lock.png" alt="Locked">':''}</div><div class="level-info"><h3>${['SUBURBAN STREET','SKATEPARK','CITY PLAZA','ROOFTOPS','MEGA RAMP'][i]}</h3><p>BEST <b>${(save.bestScores[i]??0).toLocaleString()}</b></p></div></button>`;
    }).join('');
    this.screen.innerHTML=`<section class="panel-page"><header><button data-action="back" class="back">← BACK</button><div><p class="eyebrow">CHOOSE YOUR SPOT</p><h1>LEVEL SELECT</h1></div></header><div class="level-grid">${cards}</div></section>`;
    this.button('back',()=>this.menu(save));
    this.screen.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((button)=>button.addEventListener('click',()=>this.handlers.selectLevel(Number(button.dataset.level))));
  }

  intro(level:LevelDefinition,complete:()=>void):void{
    this.clearIntro();this.hud.className='';
    this.screen.innerHTML=`<section class="intro"><video autoplay muted playsinline poster="/assets/ui/level${level.id+1}_thumb.jpg"><source src="/assets/video/${level.introVideoFile}" type="video/mp4"></video><div class="intro-title"><p>SPOT 0${level.id+1}</p><h1>${level.name}</h1><span>${level.description}</span></div><button class="skip">SKIP ↗</button><div class="skip-hint">PRESS ANY KEY TO SKATE</div></section>`;
    const video=this.screen.querySelector('video')!;let finished=false;
    const done=():void=>{if(finished)return;finished=true;this.clearIntro();complete();};
    const key=():void=>done();window.addEventListener('keydown',key);
    video.addEventListener('ended',done);video.addEventListener('error',done);this.screen.querySelector('.skip')?.addEventListener('click',done);
    this.introCleanup=()=>{window.removeEventListener('keydown',key);video.removeEventListener('ended',done);video.removeEventListener('error',done);};
    void video.play().catch(()=>undefined);
  }

  private clearIntro():void{this.introCleanup?.();this.introCleanup=undefined;}

  gameplay(level:LevelDefinition):void{
    this.clearIntro();this.screen.innerHTML='';
    this.hud.className='active';
    this.hud.innerHTML=`<div class="hud-top"><div class="hud-score"><span>SCORE</span><strong id="score">0</strong><small>TARGET ${level.scoreTarget.toLocaleString()}${level.finish?' · OR REACH THE FINISH':''}</small></div><div class="hud-level"><span>0${level.id+1}</span>${level.name}</div><div class="hud-time"><span>TIME</span><strong id="timer">${level.timeLimit}</strong></div></div><div id="combo" class="combo"></div><div class="speed"><span>SPEED</span><div><i id="speed-fill"></i></div><b id="speed-value">0</b><small>KM/H</small></div><div id="balance" class="balance"><span>GRIND BALANCE</span><div><i id="balance-needle"></i></div><small>A / D TO BALANCE</small></div><div id="tutorial" class="tutorial"></div><div id="speed-lines"></div>`;
  }

  updateHUD(score:number,time:number,speed:number):void{
    this.text('score',Math.round(score).toLocaleString());this.text('timer',Math.max(0,Math.ceil(time)).toString());
    this.text('speed-value',Math.round(Math.abs(speed)*3.6).toString());
    const fill=this.hud.querySelector<HTMLElement>('#speed-fill');if(fill)fill.style.width=`${Math.min(100,Math.abs(speed)/CONFIG.movement.feedbackSpeed*100)}%`;
    const timer=this.hud.querySelector('#timer');timer?.classList.toggle('danger',time<=10);
  }

  combo(chain:string,pending:number):void{
    const element=this.hud.querySelector('#combo');if(element)element.innerHTML=chain?`<strong>${chain}</strong><span>${pending.toLocaleString()} PTS · KEEP ROLLING</span>`:'';
  }

  notice(text:string):void{
    this.popup.innerHTML=`<strong>${text}</strong>`;this.popup.classList.add('show');this.popupTimer=CONFIG.ui.trickPopupDuration;
  }

  trick(name:string,icon:string):void{
    this.popup.innerHTML=`<img src="/assets/ui/icon_${icon}.png" alt=""><strong>${name}</strong>`;this.popup.classList.add('show');this.popupTimer=CONFIG.ui.trickPopupDuration;
  }

  balance(active:number,balance:number):void{
    const element=this.hud.querySelector('#balance');element?.classList.toggle('show',Boolean(active));
    const needle=this.hud.querySelector<HTMLElement>('#balance-needle');if(needle)needle.style.left=`${50+balance*46}%`;
  }

  tutorial(elapsed:number,enabled:boolean):void{
    const element=this.hud.querySelector('#tutorial');if(!element)return;
    let message='';
    if(enabled&&elapsed<CONFIG.ui.tutorialDuration){
      if(elapsed<5)message='<b>W / ↑</b> PUSH FORWARD &nbsp; <b>A D</b> STEER &nbsp; <b>C</b> CAMERA';
      else if(elapsed<10)message='<b>HOLD SPACE</b> CROUCH · RELEASE TO OLLIE';
      else if(elapsed<15)message='<b>J K L</b> FLIP TRICKS IN THE AIR &nbsp; <b>Q E</b> SPIN';
      else message='LAND ON A <b>RAIL</b> TO GRIND · <b>A D</b> BALANCE';
    }
    element.innerHTML=message;element.classList.toggle('show',Boolean(message));
  }

  speedLines(normalized:number):void{this.hud.querySelector('#speed-lines')?.classList.toggle('show',normalized>CONFIG.effects.speedLineThreshold);}

  bank(points:number):void{this.popup.innerHTML=`<strong class="bank">COMBO BANKED<small>+${points.toLocaleString()}</small></strong>`;this.popup.classList.add('show');this.popupTimer=1.3;}

  pause(save:SaveData):void{
    this.screen.innerHTML=`<section class="overlay"><div class="pause-card"><p class="eyebrow">TAKE A BREATHER</p><h1>PAUSED</h1><button data-action="resume" class="primary">RESUME</button><button data-action="restart">RESTART LEVEL</button><button data-action="controls">CONTROLS</button><button data-action="settings">SETTINGS</button><button data-action="quit" class="outline">QUIT TO MENU</button></div></section>`;
    this.button('resume',this.handlers.resume);this.button('restart',this.handlers.restart);this.button('quit',this.handlers.quit);
    this.button('controls',()=>this.controls('pause',save));this.button('settings',()=>this.settings(save,'pause'));
  }

  controls(returnTo:'menu'|'pause',save:SaveData):void{
    this.screen.innerHTML=`<section class="overlay"><div class="wide-card"><p class="eyebrow">FIND YOUR FLOW</p><h1>CONTROLS</h1><div class="controls-grid"><div><h2>KEYBOARD</h2><p><kbd>W / ↑</kbd><span>Push forward</span></p><p><kbd>A D / ← →</kbd><span>Steer · turn in the air · balance</span></p><p><kbd>S / ↓</kbd><span>Brake</span></p><p><kbd>SPACE</kbd><span>Hold, release to ollie</span></p><p><kbd>J / K / L</kbd><span>Kickflip / Heelflip / Shove-It</span></p><p><kbd>SHIFT</kbd><span>Hold in air to grab</span></p><p><kbd>Q / E</kbd><span>Spin left / right</span></p><p><kbd>C</kbd><span>Camera: fisheye filmer / long lens / chase</span></p><p><kbd>R / ESC / F3</kbd><span>Restart / pause / FPS</span></p></div><div><h2>GAMEPAD</h2><p><kbd>LEFT STICK</kbd><span>Steer / push / brake</span></p><p><kbd>A</kbd><span>Ollie</span></p><p><kbd>X / Y / B</kbd><span>Flip tricks</span></p><p><kbd>LT / RT</kbd><span>Spin left / right</span></p><p><kbd>RB</kbd><span>Grab</span></p><p><kbd>START</kbd><span>Pause</span></p><div class="tip">Land clean, link tricks, and roll for one second to bank your combo.</div></div></div><button data-action="back" class="primary">GOT IT</button></div></section>`;
    this.button('back',()=>returnTo==='menu'?this.menu(save):this.pause(save));
  }

  settings(save:SaveData,returnTo:'menu'|'pause'):void{
    const s=save.settings;
    this.screen.innerHTML=`<section class="overlay"><div class="settings-card"><p class="eyebrow">MAKE IT YOURS</p><h1>SETTINGS</h1><label>MUSIC VOLUME <output id="music-out">${Math.round(s.musicVolume*100)}%</output><input id="music" type="range" min="0" max="1" step=".01" value="${s.musicVolume}"></label><label>SOUND VOLUME <output id="sound-out">${Math.round(s.soundVolume*100)}%</output><input id="sound" type="range" min="0" max="1" step=".01" value="${s.soundVolume}"></label><label>CAMERA DISTANCE <output id="camera-out">${s.cameraDistance.toFixed(1)}m</output><input id="camera" type="range" min="${CONFIG.camera.minDistance}" max="${CONFIG.camera.maxDistance}" step=".1" value="${s.cameraDistance}"></label><label class="toggle">TUTORIAL POPUPS <input id="tutorial-setting" type="checkbox" ${s.tutorial?'checked':''}><i></i></label><label class="toggle">GOOFY STANCE (RIGHT FOOT FORWARD) <input id="stance-setting" type="checkbox" ${s.stance==='goofy'?'checked':''}><i></i></label><label class="toggle">REALISTIC PHYSICS (SLOWER, LOWER OLLIES) <input id="handling-setting" type="checkbox" ${s.handling==='realistic'?'checked':''}><i></i></label><span class="label">DECK GRAPHIC</span><div class="decks">${[1,2,3,4].map((i)=>`<button data-deck="${i}" class="${s.deck===i?'selected':''}"><img src="/assets/decks/deck${i}.png" alt="Deck ${i}"></button>`).join('')}</div><button data-action="back" class="primary">SAVE & BACK</button></div></section>`;
    const update=():void=>{
      s.musicVolume=Number(this.input('music').value);s.soundVolume=Number(this.input('sound').value);s.cameraDistance=Number(this.input('camera').value);s.tutorial=this.input('tutorial-setting').checked;s.stance=this.input('stance-setting').checked?'goofy':'regular';s.handling=this.input('handling-setting').checked?'realistic':'arcade';
      this.text('music-out',`${Math.round(s.musicVolume*100)}%`);this.text('sound-out',`${Math.round(s.soundVolume*100)}%`);this.text('camera-out',`${s.cameraDistance.toFixed(1)}m`);
      this.handlers.settings(s);
    };
    this.screen.querySelectorAll('input').forEach((input)=>input.addEventListener('input',update));
    this.screen.querySelectorAll<HTMLButtonElement>('[data-deck]').forEach((button)=>button.addEventListener('click',()=>{s.deck=Number(button.dataset.deck) as DeckChoice;this.screen.querySelectorAll('[data-deck]').forEach((b)=>b.classList.remove('selected'));button.classList.add('selected');update();}));
    this.button('back',()=>returnTo==='menu'?this.menu(save):this.pause(save));
  }

  results(level:LevelDefinition,score:number,combo:number,highScore:boolean,hasNext:boolean,bestScore:number,outcome:{passed:boolean;lineComplete:boolean;bonus:number}):void{
    const success=outcome.passed;this.hud.className='';
    this.screen.innerHTML=`<section class="overlay results"><div class="results-card"><p class="eyebrow">${outcome.lineComplete?'FINISH LINE':success?'SPOT CONQUERED':'SESSION OVER'}</p><h1>${success?'LINE COMPLETE':'SO CLOSE.'}</h1>${highScore?'<div class="high-score">NEW HIGH SCORE</div>':''}<div class="final-score"><span>FINAL SCORE</span><strong>${score.toLocaleString()}</strong><small>${outcome.lineComplete?`FINISH BONUS +${outcome.bonus.toLocaleString()}`:`TARGET ${level.scoreTarget.toLocaleString()}`}</small></div><div class="result-stats"><span>BEST COMBO <b>x${combo}</b></span><span>BEST SCORE <b>${bestScore.toLocaleString()}</b></span></div>${success&&hasNext?'<button data-action="next" class="primary">NEXT LEVEL ↗</button>':''}<button data-action="retry" class="${success&&hasNext?'':'primary'}">RETRY</button><button data-action="menu" class="outline">BACK TO MENU</button></div></section>`;
    this.button('next',this.handlers.next);this.button('retry',this.handlers.restart);this.button('menu',this.handlers.quit);
  }

  private trailer():void{
    const container=document.createElement('div');container.className='trailer';container.innerHTML=`<video autoplay controls playsinline><source src="/assets/video/trailer.mp4" type="video/mp4"></video><button aria-label="Close trailer">CLOSE ×</button>`;
    this.root.append(container);const close=():void=>{container.querySelector('video')?.pause();container.remove();};container.querySelector('button')?.addEventListener('click',close);
  }

  // Self-playing demo: the gameplay HUD minus score and timer, with a caption for the shot and how to leave.
  demo(level:LevelDefinition,caption:string,index:number,total:number):void{
    this.gameplay(level);this.hud.classList.add('demo');
    this.hud.insertAdjacentHTML('beforeend',`<div class="demo-banner"><span>DEMO ${index+1}/${total}</span><strong>0${level.id+1} ${level.name}</strong><em>${caption}</em></div><div class="demo-exit">PRESS ANY KEY OR CLICK TO SKATE</div>`);
  }

  update(dt:number,fpsValue:number):void{
    if(this.popupTimer>0){this.popupTimer-=dt;if(this.popupTimer<=0)this.popup.classList.remove('show');}
    this.fps.textContent=`${Math.round(fpsValue)} FPS`;
  }

  toggleFPS():void{this.fps.classList.toggle('show');}

  private button(action:string,callback:()=>void):void{this.screen.querySelector(`[data-action="${action}"]`)?.addEventListener('click',callback);}
  private input(id:string):HTMLInputElement{return this.screen.querySelector<HTMLInputElement>(`#${id}`)!;}
  private text(id:string,text:string):void{const element=this.root.querySelector(`#${id}`);if(element)element.textContent=text;}
}
