'use strict';
// Backend sem GPU: projeção, iluminação e desenho de malhas.
function createSoftwareRenderer(canvas,math){
  const {cross,sub,dot,norm,rad,clamp,lerp,rgb}=math;
  // Headless servers may lack WebGL. Project and illuminate the same XYZ
  // meshes on Canvas 2D, sorting faces in camera space. This is real 3D
  // geometry with a painter fallback (not a full depth buffer).

    const ctx=canvas.getContext('2d');
    if(!ctx)throw Error('Canvas indisponível');
    const rotate=(p,r)=>{
      let [x,y,z]=p;
      let a=Math.cos(r[0]),b=Math.sin(r[0]);[y,z]=[a*y-b*z,b*y+a*z];
      a=Math.cos(r[1]);b=Math.sin(r[1]);[x,z]=[a*x+b*z,-b*x+a*z];
      a=Math.cos(r[2]);b=Math.sin(r[2]);[x,y]=[a*x-b*y,b*x+a*y];
      return [x,y,z];
    };
    function render(objects,options={}){
      const {eye=[0,1,5],target=[0,0,0],fov=40,background=null,key=[-3,5,5],fill=[4,1,2],ambient=.22}=options;
      const W=canvas.width,H=canvas.height;
      const z=norm(sub(eye,target)),up=Math.abs(z[1])>.999?[0,0,1]:[0,1,0],x=norm(cross(up,z)),y=cross(z,x);
      const focal=H/2/Math.tan(rad(fov)/2), light=norm(key), bounce=norm(fill), triangles=[];
      ctx.clearRect(0,0,W,H);
      if(background!==null){ctx.fillStyle='rgb('+rgb(background).map(v=>Math.round(v*255)).join(',')+')';ctx.fillRect(0,0,W,H);}
      for(const o of objects){
        if(!o.geometry?.positions||!o.geometry?.normals)throw Error('Use uma malha de NivooGraphics');
        const p=o.geometry.positions,n=o.geometry.normals,pos=o.position??[0,0,0],r=(o.rotation??[0,0,0]).map(rad);
        const scale=(typeof o.scale==='number'?[o.scale,o.scale,o.scale]:o.scale??[1,1,1]).map(v=>Math.max(.0001,v));
        const base=rgb(o.color),metal=clamp(o.metal??0,0,1),rough=clamp(o.roughness??.4,0,1),emission=clamp(o.emission??0,0,2);
        for(let i=0;i<p.length;i+=9){
          const xyz=[],screen=[],depths=[],ns=[];
          for(let j=0;j<9;j+=3){
            const world=rotate([p[i+j]*scale[0],p[i+j+1]*scale[1],p[i+j+2]*scale[2]],r).map((v,k)=>v+pos[k]);
            const delta=sub(world,eye),d=-dot(z,delta);
            xyz.push(world);depths.push(d);
            if(d<=.05)break;
            screen.push([W/2+dot(x,delta)*focal/d,H/2-dot(y,delta)*focal/d]);
            ns.push(rotate([n[i+j]/scale[0],n[i+j+1]/scale[1],n[i+j+2]/scale[2]],r));
          }
          if(screen.length!==3)continue;
          const center=[0,1,2].map(k=>(xyz[0][k]+xyz[1][k]+xyz[2][k])/3);
          const normal=norm([0,1,2].map(k=>ns[0][k]+ns[1][k]+ns[2][k]));
          const v=norm(sub(eye,center)),ndv=dot(normal,v);
          if(ndv<=0)continue;
          const half=norm(v.map((q,k)=>q+light[k]));
          const diffuse=ambient+Math.max(dot(normal,light),0)*.85+Math.max(dot(normal,bounce),0)*.30+emission;
          const spec=Math.pow(Math.max(dot(normal,half),0),lerp(100,7,rough))*(.35+metal*.9),rim=Math.pow(1-Math.max(ndv,0),3);
          const color=base.map((q,k)=>Math.round(clamp(q*diffuse+lerp(.8,q,metal)*spec+[.13,.16,.20][k]*rim,0,1)*255));
          triangles.push({screen,depth:(depths[0]+depths[1]+depths[2])/3,color:'rgb('+color.join(',')+')'});
        }
      }
      triangles.sort((a,b)=>b.depth-a.depth);
      ctx.lineWidth=.6;ctx.lineJoin='round';
      for(const {screen,color} of triangles){
        ctx.beginPath();ctx.moveTo(...screen[0]);ctx.lineTo(...screen[1]);ctx.lineTo(...screen[2]);ctx.closePath();
        ctx.fillStyle=color;ctx.strokeStyle=color;ctx.fill();ctx.stroke();
      }
    }
    return {render,dispose(){},backend:'software'};
}
module.exports={createSoftwareRenderer};
