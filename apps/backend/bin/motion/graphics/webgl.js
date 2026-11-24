'use strict';
// Backend acelerado: shaders, buffers, uniforms e depth test.
function createWebGLRenderer(canvas,gl,math){
  const {rad,clamp,rgb,perspective,view,mul}=math;
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
    return {render,dispose,backend:'webgl'};
}
module.exports={createWebGLRenderer};
