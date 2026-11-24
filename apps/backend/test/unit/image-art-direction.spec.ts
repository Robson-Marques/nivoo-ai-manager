import { imageOptions } from '../../src/providers/image-options';
import { validImagePng,imageData } from '../../src/providers/gemini-image.provider';
import { compileWorkflowPlan } from '../../src/jobs/workflow/compile-plan';

describe('Arte visual como insumo do Motion',()=>{
  it('valida caminhos, extensão e proporção antes de chamar API',()=>{
    expect(imageOptions('arte',{arquivo:'motion/c/assets/arte.png'})).toEqual({arquivo:'motion/c/assets/arte.png',proporcao:'9:16',tamanho:'1K',referencias:[]});
    expect(()=>imageOptions('arte',{arquivo:'../../arte.png'})).toThrow();
    expect(()=>imageOptions('arte',{arquivo:'motion/c/a.jpg'})).toThrow();
    expect(()=>imageOptions('arte',{arquivo:'motion/c/a.png',referencias:['../segredo.png']})).toThrow();
  });
  it('não considera resposta de texto ou JPEG uma imagem PNG',()=>{
    expect(validImagePng(Buffer.from('falso png'))).toBe(false);
    expect(imageData({steps:[{content:[{type:'text',text:'imagem pronta'}]}]})).toBeNull();
    expect(imageData({output_image:{data:'YWJj',mime_type:'image/jpeg'}})).toBeNull();
  });
  it('liga imagem, autoria e render sem adicionar sessão de revisão',()=>{
    const art={key:'arte',title:'Gerar imagem editorial',provider:'gemini-image',instructions:'Fotografia de campanha',providerOptions:{arquivo:'motion/c/assets/arte.png'}};
    const author={key:'compor',title:'Criar composição 3D',provider:'codex-cli',instructions:'Componha motion/c/index.html',verifyCommand:'test -s motion/c/index.html'};
    const render={key:'render',provider:'local-shell',instructions:'nivoo-renderizar-motion motion/c --saida midia/saida/c.mp4 --segundos 12 --tamanho 1080x1920'};
    const plan=compileWorkflowPlan([art,author,render],'codex-cli','Campanha editorial profissional',{template:'design-video'}) as any[];
    expect(plan).toHaveLength(3);
    expect(plan[1].dependsOn).toContain('arte');
    expect(plan[1].instructions).toContain('motion/c/assets/arte.png');
    expect(plan[2].dependsOn).toContain('compor');
    expect(plan[2].instructions).toContain('--motor html');
    expect(compileWorkflowPlan(plan,'codex-cli','Campanha editorial profissional',{template:'design-video'})).toEqual(plan);
  });
});
