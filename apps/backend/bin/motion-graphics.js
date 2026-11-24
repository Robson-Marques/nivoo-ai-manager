'use strict';
// Fachada compatível com os consumidores atuais (planner, worker e Playwright).
// Somente funções do código instalado são serializadas: nenhum código de job
// entra nesta construção. A função resultante é autocontida no navegador.
const {createMath}=require('./motion/graphics/math');
const {createGeometry}=require('./motion/graphics/geometry');
const {createSoftwareRenderer}=require('./motion/graphics/software');
const {createWebGLRenderer}=require('./motion/graphics/webgl');
const {installRuntime}=require('./motion/graphics/runtime');
const {graphicsAuthorContract}=require('./motion/graphics/authoring');
const graphicsRuntimeFiles=[
  require.resolve('./motion/graphics/math'),
  require.resolve('./motion/graphics/geometry'),
  require.resolve('./motion/graphics/software'),
  require.resolve('./motion/graphics/webgl'),
  require.resolve('./motion/graphics/runtime'),
  require.resolve('./motion/graphics/authoring'),
];
const deps=[createMath,createGeometry,createSoftwareRenderer,createWebGLRenderer];
const installMotionGraphics=new Function('return function installMotionGraphics(){('+installRuntime.toString()+')('+deps.map(fn=>'('+fn.toString()+')').join(',')+');}')();
module.exports={installMotionGraphics,graphicsAuthorContract,graphicsRuntimeFiles};
