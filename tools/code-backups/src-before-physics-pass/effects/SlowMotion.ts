import { CONFIG } from '../core/config';

export class SlowMotion {
  private remaining=0;

  trigger():void{this.remaining=CONFIG.combo.slowMotionDuration;}
  update(realDt:number):number{
    if(this.remaining<=0)return 1;
    this.remaining-=realDt;
    return this.remaining>0?CONFIG.combo.slowMotionScale:1;
  }
  reset():void{this.remaining=0;}
}
