'use strict';
// Composition root: escolhe um backend e expõe o mesmo contrato em ambos.
function installRuntime(createMath,createGeometry,createSoftwareRenderer,createWebGLRenderer){
  if(window.NivooGraphics)return;
  const math=createMath(),geometry=createGeometry(math);
  const {lerp,smooth}=math;
  function create(canvas){
    const gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:true});
    const renderer=gl?createWebGLRenderer(canvas,gl,math):createSoftwareRenderer(canvas,math);
    return {...renderer,...geometry,lerp,smooth};
  }
  window.NivooGraphics=Object.freeze({create,...geometry,lerp,smooth});
}
module.exports={installRuntime};
