'use strict';
// Contrato de autoria: documentação do runtime, não lógica de renderização.
function graphicsAuthorContract(){
  return [
    'FERRAMENTA NATIVA HTML: window.NivooGraphics já está disponível antes do primeiro script da página, sem import, CDN ou instalação. WebGL quando disponível, projeção 3D por software como alternativa sem GPU.',
    'const renderer = NivooGraphics.create(canvas); const cubo = renderer.box(); const face = renderer.mesh([0,0,0, 1,0,0, 0,1,0]); // crie malhas uma vez, fora de __renderAt.',
    'O objeto renderer e NivooGraphics expõem as mesmas fábricas: box(), sphere(segmentos,aneis), torus(raio,tubo), cylinder(raioInferior,raioSuperior), mesh(triângulosXYZ,normaisXYZ opcionais). mesh({positions, normals?, indices?}) também é aceito, com índices inteiros de vértices. Cada fábrica retorna a geometria para a propriedade geometry, não um objeto já inserido na cena.',
    'renderer.render([{geometry,position:[x,y,z],rotation:[grausX,grausY,grausZ],scale:[x,y,z],color:"#d9a348",metal:.8,roughness:.25,emission:0}],{eye:[0,1,5],target:[0,0,0],fov:40,key:[-3,5,5],fill:[4,1,2],ambient:.22,background:null}); background:null deixa o canvas transparente.',
    'Use malhas e materiais diferentes para criar objetos, grafismos e símbolos específicos do briefing, não uma coleção genérica de formas. SVG/CSS/HTML locais podem compor grafismos, máscaras, degradês e tipografia; o canvas 3D tem profundidade e luz reais.',
    'Defina window.__motionSegundos e window.__renderAt(t) com tempo em segundos para atualizar câmera, objetos, SVG e tipografia a cada quadro; prepare as malhas fora da função. O Nivoo captura a timeline; não é necessário reimplementar a captura.',
  ].join('\n');
}
module.exports={graphicsAuthorContract};
