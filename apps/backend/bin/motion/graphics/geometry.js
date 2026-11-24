'use strict';
// Fábricas puras de malhas: independentes de Canvas, WebGL e animação.
function createGeometry(math){
  const {cross,sub,norm,clamp}=math;
  function mesh(positions,normals) {
    // Both factory and renderer expose the same geometry builders. Accept the
    // usual explicit mesh descriptor in addition to a flat triangle array.
    const flat=v=>Array.isArray(v)&&Array.isArray(v[0])?v.flat():v;
    if(positions&&typeof positions==='object'&&!Array.isArray(positions)&&!ArrayBuffer.isView(positions)){
      const spec=positions;
      positions=flat(spec.positions??spec.vertices);
      normals=flat(normals??spec.normals);
      const indices=flat(spec.indices);
      if(indices!==undefined){
        if(!positions||positions.length%3||!indices.length||indices.length%3||indices.length>180000||
          !Array.from(indices).every(i=>Number.isInteger(i)&&i>=0&&i<positions.length/3))
          throw Error('Índices de malha inválidos');
        if(normals!==undefined&&normals.length!==positions.length)throw Error('Normais inválidas');
        const expand=values=>Array.from(indices).flatMap(i=>[values[3*i],values[3*i+1],values[3*i+2]]);
        if(normals!==undefined)normals=expand(normals);
        positions=expand(positions);
      }
    }
    positions=flat(positions);normals=flat(normals);
    if(!positions||positions.length<9||positions.length%9||positions.length>540000||
       !Array.from(positions).every(Number.isFinite))throw Error('Malha: informe triângulos XYZ válidos');
    const p=new Float32Array(positions), n=new Float32Array(p.length);
    if(normals!==undefined){
      if(normals.length!==p.length||!Array.from(normals).every(Number.isFinite))throw Error('Normais inválidas');
      n.set(normals);
    }else for(let i=0;i<p.length;i+=9){
      const normal=norm(cross(sub(p.slice(i+3,i+6),p.slice(i,i+3)),sub(p.slice(i+6,i+9),p.slice(i,i+3))));
      for(let j=0;j<9;j+=3)n.set(normal,i+j);
    }
    return {positions:p,normals:n};
  }
  function box() {
    const p=[];
    for(const [a,b,c,d] of [
      [[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]],
      [[.5,-.5,-.5],[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5]],
      [[.5,-.5,.5],[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5]],
      [[-.5,-.5,-.5],[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5]],
      [[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5],[-.5,.5,-.5]],
      [[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5]],
    ])p.push(...a,...b,...c,...a,...c,...d);
    return mesh(p);
  }
  function surface(uSteps,vSteps,sample) {
    const p=[],n=[];
    uSteps=clamp(Math.floor(uSteps)||32,3,96);vSteps=clamp(Math.floor(vSteps)||16,3,64);
    for(let i=0;i<uSteps;i++)for(let j=0;j<vSteps;j++){
      const a=sample(i/uSteps,j/vSteps),b=sample((i+1)/uSteps,j/vSteps),
        c=sample((i+1)/uSteps,(j+1)/vSteps),d=sample(i/uSteps,(j+1)/vSteps);
      for(const q of [a,b,c,a,c,d]){p.push(...q[0]);n.push(...q[1]);}
    }
    return mesh(p,n);
  }
  function sphere(segments=40,rings=24) {
    return surface(segments,rings,(u,v)=>{
      const a=u*2*Math.PI,b=v*Math.PI;
      const n=[Math.cos(a)*Math.sin(b),Math.cos(b),Math.sin(a)*Math.sin(b)];
      return [n.map(x=>x*.5),n];
    });
  }
  function torus(radius=.38,tube=.12,segments=48,rings=20) {
    return surface(segments,rings,(u,v)=>{
      const a=u*2*Math.PI,b=v*2*Math.PI;
      const n=[Math.cos(a)*Math.cos(b),Math.sin(b),Math.sin(a)*Math.cos(b)];
      return [[(radius+tube*Math.cos(b))*Math.cos(a),tube*Math.sin(b),(radius+tube*Math.cos(b))*Math.sin(a)],n];
    });
  }
  // Cilindro, cone e tronco de cone; tampas incluídas. Eixo vertical Y.
  function cylinder(bottom=.5,top=.5,segments=48) {
    if(!Number.isFinite(bottom)||!Number.isFinite(top)||bottom<0||top<0||bottom+top<=0)throw Error('Raios inválidos');
    const p=[],n=[];segments=clamp(Math.floor(segments)||48,3,96);
    for(let i=0;i<segments;i++){
      const a=i*2*Math.PI/segments,b=(i+1)*2*Math.PI/segments;
      const ring=(r,y,t)=>[r*Math.cos(t),y,r*Math.sin(t)];
      const aa=ring(bottom,-.5,a),bb=ring(bottom,-.5,b),cc=ring(top,.5,b),dd=ring(top,.5,a);
      const na=norm([Math.cos(a),bottom-top,Math.sin(a)]),nb=norm([Math.cos(b),bottom-top,Math.sin(b)]);
      p.push(...aa,...bb,...cc,...aa,...cc,...dd);n.push(...na,...nb,...nb,...na,...nb,...na);
      if(bottom){p.push(0,-.5,0,...aa,...bb);n.push(0,-1,0,0,-1,0,0,-1,0);}
      if(top){p.push(0,.5,0,...cc,...dd);n.push(0,1,0,0,1,0,0,1,0);}
    }
    return mesh(p,n);
  }
  return {mesh,box,sphere,torus,cylinder};
}
module.exports={createGeometry};
