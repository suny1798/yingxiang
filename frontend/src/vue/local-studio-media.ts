import { LocalCamera } from '../lib/media/local-camera';
import { CameraPreviewSession } from '../lib/media/camera-preview-session';
import { GarmentInput } from '../lib/images/garment-input';
import type { SessionScope } from './session-scope';

/** 页面拥有流和Blob URL；只复用本机控制器，不创建SDK或调用业务API。 */
export class LocalStudioMedia {
  readonly preview:CameraPreviewSession;
  readonly input:GarmentInput;
  private owner:string|null;
  private stopIdentity:()=>void;
  private active=true;
  constructor(private scope:SessionScope,readonly camera=new LocalCamera(),images?:ConstructorParameters<typeof GarmentInput>[1]){
    this.preview=new CameraPreviewSession(camera);this.input=new GarmentInput(()=>{},images);
    this.owner=scope.capture().userId;
    this.stopIdentity=scope.onIdentityChange(()=>{
      // 访客登录保留仍有效的本机素材；已认证身份退出、换号或变更权限则清空。
      if(this.owner){this.preview.stop();this.input.clear();}
      else this.input.cancel();
      this.owner=scope.capture().userId;
    });
  }
  async startCamera(hidden=false){if(this.active&&!hidden&&!this.scope.state.transitioning&&!this.scope.state.blocked)await this.preview.start();}
  stopCamera=()=>this.preview.stop();
  hidden=()=>{this.preview.stop();this.input.cancel();};
  dispose=()=>{if(!this.active)return;this.active=false;this.stopIdentity();this.preview.stop();this.input.dispose();};
}
