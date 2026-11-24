'use strict';

// Biblioteca WebGL local, sem CDN, sem dependência de IA e sem cenário fixo.
// O autor decide a arte. A ferramenta cuida de malhas, câmera, luz e materiais.
function installMotionGraphics() {
  if (window.NivooGraphics) return;
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const sub=(a,b)=>a.map((x,i)=>x-b[i]);
  const dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0);
  const norm=a=>{const n=Math.hypot(...a)||1;return a.map(x=>x/n);};
  const rad=v=>v*Math.PI/180;
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
  function mesh(positions,normals) {
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
  function create(canvas) {
    const gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:true});
    if(!gl)throw Error('WebGL indisponível');
    const vs='attribute vec3 p,n; uniform mat4 vp; uniform vec3 pos,rot,scl; varying vec3 P,N; vec3 rotate(vec3 v){float a=cos(rot.x),b=sin(rot.x);v=vec3(v.x,a*v.y-b*v.z,b*v.y+a*v.z);a=cos(rot.y);b=sin(rot.y);v=vec3(a*v.x+b*v.z,v.y,-b*v.x+a*v.z);a=cos(rot.z);b=sin(rot.z);return vec3(a*v.x-b*v.y,b*v.x+a*v.y,v.z);} void main(){P=rotate(p*scl)+pos;N=normalize(rotate(n/scl));gl_Position=vp*vec4(P,1.); }';
    const fs='precision mediump float; varying vec3 P,N; uniform vec3 color,eye,key,fill; uniform float metal,rough,ambient,emission; void main(){vec3 n=normalize(N),v=normalize(eye-P),l=normalize(key),h=normalize(v+l);float d=max(dot(n,l),0.),f=max(dot(n,normalize(fill)),0.);float sp=pow(max(dot(n,h),0.),mix(100.,7.,rough));float rim=pow(1.-max(dot(n,v),0.),3.);vec3 c=color*(ambient+d*.85+f*.30+emission)+mix(vec3(.8),color,metal)*sp*(.35+metal*.9)+vec3(.13,.16,.20)*rim;gl_FragColor=vec4(clamp(c,0.,1.),1.); }';
    function shader(type,src){const sh=gl.createShader(type);gl.shaderSource(sh,src);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(sh));return sh;}
    const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vs));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const uniforms={};for(const k of ['vp','pos','rot','scl','color','eye','key','fill','metal','rough','ambient','emission'])uniforms[k]=gl.getUniformLocation(program,k);
    const pLoc=gl.getAttribLocation(program,'p'),nLoc=gl.getAttribLocation(program,'n'),buffers=new Map();
    function geometry(g){
      if(buffers.has(g))return buffers.get(g);
      if(!g?.positions||!g?.normals)throw Error('Use uma malha de NivooGraphics');
      const buffer=data=>{const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);return b;};
      const item={p:buffer(g.positions),n:buffer(g.normals),count:g.positions.length/3};buffers.set(g,item);return item;
    }
    const v3=(name,v)=>gl.uniform3fv(uniforms[name],v);
    const num=(name,v)=>gl.uniform1f(uniforms[name],v);
    function render(objects,options={}){
      const {eye=[0,1,5],target=[0,0,0],fov=40,background=null,key=[-3,5,5],fill=[4,1,2],ambient=.22}=options;
      gl.viewport(0,0,canvas.width,canvas.height);
      const bg=background===null?[0,0,0]:rgb(background);gl.clearColor(...bg,background===null?0:1);
      gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);
      gl.uniformMatrix4fv(uniforms.vp,false,mul(perspective(fov,canvas.width/Math.max(1,canvas.height),.05,200),view(eye,target)));
      v3('eye',eye);v3('key',key);v3('fill',fill);num('ambient',ambient);
      for(const o of objects){
        const g=geometry(o.geometry);
        for(const [loc,b] of [[pLoc,g.p],[nLoc,g.n]]){gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);}
        const scale=typeof o.scale==='number'?[o.scale,o.scale,o.scale]:o.scale??[1,1,1];
        v3('pos',o.position??[0,0,0]);v3('rot',(o.rotation??[0,0,0]).map(rad));v3('scl',scale.map(x=>Math.max(.0001,x)));
        v3('color',rgb(o.color));num('metal',clamp(o.metal??0,0,1));num('rough',clamp(o.roughness??.4,0,1));num('emission',clamp(o.emission??0,0,2));
        gl.drawArrays(gl.TRIANGLES,0,g.count);
      }
    }
    function dispose(){for(const g of buffers.values()){gl.deleteBuffer(g.p);gl.deleteBuffer(g.n);}buffers.clear();gl.deleteProgram(program);}
    return {render,dispose};
  }
  window.NivooGraphics=Object.freeze({create,mesh,box,sphere,torus,cylinder,lerp,smooth});
}

function graphicsAuthorContract(){
  return [
    'FERRAMENTA NATIVA HTML: window.NivooGraphics já está disponível antes do primeiro script da página, sem import, CDN ou instalação.',
    'Use NivooGraphics.create(canvas) para criar um renderer WebGL; crie as malhas UMA vez: box(), sphere(), torus(raio,tubo), cylinder(raioInferior,raioSuperior), mesh(triângulosXYZ,normaisXYZ opcionais).',
    'renderer.render([{geometry,position:[x,y,z],rotation:[grausX,grausY,grausZ],scale:[x,y,z],color:"#d9a348",metal:.8,roughness:.25,emission:0}],{eye:[0,1,5],target:[0,0,0],fov:40,key:[-3,5,5],fill:[4,1,2],ambient:.22,background:null}); background:null deixa o canvas transparente.',
    'Use malhas e materiais diferentes para criar objetos, grafismos e símbolos específicos do briefing, não uma coleção genérica de formas. SVG/CSS/HTML locais podem compor grafismos, máscaras, degradês e tipografia; o canvas 3D tem profundidade e luz reais.',
    'Defina window.__motionSegundos e window.__renderAt(t) com tempo em segundos para atualizar câmera, objetos, SVG e tipografia a cada quadro; prepare as malhas fora da função. O Nivoo captura a timeline; não é necessário reimplementar a captura.',
  ].join('\n');
}
module.exports={installMotionGraphics,graphicsAuthorContract};
