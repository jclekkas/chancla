import * as THREE from 'three';
import { buildWorld as original } from '../fps/render/world.baseline';
import { buildWorld as upgraded } from '../fps/render/world';
import { courtyardDetail } from './detail';
import type { Quality } from '../fps/settings';

declare const __BUILD_ID__: string;
const stage=document.querySelector<HTMLElement>('#stage')!;
const status=document.querySelector<HTMLElement>('#status')!;
const label=document.querySelector<HTMLElement>('#label')!;
const presets={
  plaza:{pos:[-15,1.6,6],look:[10,1.4,-2]},
  facade:{pos:[-9,1.6,0],look:[-6,3,-9]},
  overview:{pos:[0,34,30],look:[0,0,-1]},
} as const;
function save(blob:Blob,name:string){const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
try {
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  renderer.shadowMap.type=THREE.PCFShadowMap;
  stage.append(renderer.domElement);
  const camera=new THREE.PerspectiveCamera(70,1,.05,260);
  const pairs=new Map<Quality,{before:THREE.Scene;after:THREE.Scene}>();
  let quality:Quality='high', after=true, frames:number[]=[], start=0, last=0;
  let report:unknown=null;
  const results:unknown[]=[];
  function pair(){
    let p=pairs.get(quality);
    if(!p){
      const before=new THREE.Scene(), afterScene=new THREE.Scene();
      before.fog=new THREE.Fog(0xf3b07a,45,140);afterScene.fog=before.fog.clone();
      before.add(original(quality).group);afterScene.add(upgraded(quality).group,courtyardDetail());
      p={before,after:afterScene};pairs.set(quality,p);
    }
    return p;
  }
  function resize(){renderer.setPixelRatio(Math.min(devicePixelRatio,quality==='high'?1.5:quality==='medium'?1.25:1));renderer.setSize(stage.clientWidth,stage.clientHeight);camera.aspect=stage.clientWidth/stage.clientHeight;camera.updateProjectionMatrix();cancelMeasure();}
  function cancelMeasure(){start=0;frames=[];document.querySelector<HTMLButtonElement>('#measure')!.disabled=false;}
  function update(){
    cancelMeasure();
    const key=document.querySelector<HTMLSelectElement>('#view')!.value as keyof typeof presets;
    const v=presets[key];camera.position.set(v.pos[0],v.pos[1],v.pos[2]);camera.lookAt(v.look[0],v.look[1],v.look[2]);
    renderer.shadowMap.enabled=quality!=='low';
    const p=pair(); renderer.render(after?p.after:p.before,camera);
    label.textContent=after?'EXPERIMENT · environment pass':'BEFORE · production environment at d27f74d';
    for(const id of ['before','after'])document.getElementById(id)!.setAttribute('aria-pressed',String((id==='after')===after));
    status.textContent=`${quality} · ${renderer.domElement.width} × ${renderer.domElement.height} · ${renderer.info.render.calls} draw calls · ${renderer.info.render.triangles.toLocaleString()} triangles`;
  }
  document.getElementById('before')!.onclick=()=>{after=false;update();};
  document.getElementById('after')!.onclick=()=>{after=true;update();};
  document.getElementById('view')!.onchange=update;
  document.getElementById('quality')!.onchange=()=>{quality=document.querySelector<HTMLSelectElement>('#quality')!.value as Quality;resize();update();};
  document.getElementById('shot')!.onclick=()=>renderer.domElement.toBlob(b=>{if(b)save(b,`chancla-${after?'experiment':'before'}-${document.querySelector<HTMLSelectElement>('#view')!.value}-${quality}.png`);});
  document.getElementById('measure')!.onclick=()=>{frames=[];start=performance.now();last=start;document.querySelector<HTMLButtonElement>('#measure')!.disabled=true;status.textContent='Measuring 10 seconds; keep this tab visible…';};
  document.getElementById('report')!.onclick=()=>save(new Blob([JSON.stringify(results,null,2)],{type:'application/json'}),'chancla-courtyard-results.json');
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&start){cancelMeasure();status.textContent='Measurement cancelled: tab hidden. Run again with the tab visible.';}});
  new ResizeObserver(()=>{resize();update();}).observe(stage);
  resize();update();
  function tick(now:number){
    if(!document.hidden){const p=pair();renderer.render(after?p.after:p.before,camera);}
    if(start){
      // Discard first second for warmup, including shader compilation.
      if(now-start>1000)frames.push(now-last);
      last=now;
      if(now-start>=11000&&frames.length){
        const sorted=[...frames].sort((a,b)=>a-b),avg=frames.reduce((a,b)=>a+b,0)/frames.length;
        report={build:__BUILD_ID__,baseline:'d27f74d',variant:after?'experiment':'before',quality,view:document.querySelector<HTMLSelectElement>('#view')!.value,width:renderer.domElement.width,height:renderer.domElement.height,meanFps:1000/avg,p95FrameMs:sorted[Math.floor(sorted.length*.95)],drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,userAgent:navigator.userAgent,note:'Static environment only; preserveDrawingBuffer enabled for capture; not a gameplay benchmark.'};
        results.push(report);cancelMeasure();document.querySelector<HTMLButtonElement>('#report')!.disabled=false;status.textContent=`Recorded ${(1000/avg).toFixed(1)} FPS average · p95 ${sorted[Math.floor(sorted.length*.95)]!.toFixed(1)} ms. Switch view to compare; Save results exports all measurements.`;
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}catch(e){document.querySelector<HTMLElement>('#error')!.hidden=false;document.querySelector<HTMLElement>('#error')!.textContent=`3D rendering could not start: ${e instanceof Error?e.message:String(e)}. No performance or visual result has been measured.`;status.textContent='WebGL unavailable';}
