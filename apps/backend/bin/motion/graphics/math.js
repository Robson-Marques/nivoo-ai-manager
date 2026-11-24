'use strict';
// Operações e transformação de câmera compartilhadas pelos backends.
function createMath(){
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const sub=(a,b)=>a.map((x,i)=>x-b[i]);
  const dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0);
  const norm=a=>{const n=Math.hypot(...a)||1;return a.map(x=>x/n);};
  const rad=v=>v*Math.PI/180;
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
  function perspective(fov,aspect,near,far){
    const f=1/Math.tan(rad(fov)/2),r=1/(near-far);
    return [f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*r,-1,0,0,2*far*near*r,0];
  }
  function view(eye,target){
    const z=norm(sub(eye,target)),up=Math.abs(z[1])>.999?[0,0,1]:[0,1,0],x=norm(cross(up,z)),y=cross(z,x);
    return [x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1];
  }
  function mul(a,b){
    const c=new Float32Array(16);
    for(let col=0;col<4;col++)for(let row=0;row<4;row++)for(let k=0;k<4;k++)c[col*4+row]+=a[k*4+row]*b[col*4+k];
    return c;
  }
  function rgb(value) {
    if(Array.isArray(value)&&value.length===3&&value.every(Number.isFinite))return value.map(x=>clamp(x,0,1));
    const m=/^#([0-9a-f]{6})$/i.exec(value??'');
    return m?[0,2,4].map(i=>parseInt(m[1].slice(i,i+2),16)/255):[.8,.8,.8];
  }
  return {cross,sub,dot,norm,rad,clamp,lerp,smooth,perspective,view,mul,rgb};
}
module.exports={createMath};
