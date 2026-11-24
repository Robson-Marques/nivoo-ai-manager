import { applyReelsSafeArea,reelsSafeArea,REELS_SAFE_MARKER } from '../../src/jobs/motion/safe-area';
import { compileWorkflowPlan } from '../../src/jobs/workflow/compile-plan';

describe('Margens de publicação Reels',()=>{
  it('usa margens proporcionais e reserva espaço adicional à direita',()=>{
    expect(reelsSafeArea(1080,1920)).toEqual({left:60,right:120,top:120,bottom:240,x:60,y:120,width:900,height:1560,xMax:960,yMax:1680});
    expect(reelsSafeArea(720,1280)).toEqual({left:40,right:80,top:80,bottom:160,x:40,y:80,width:600,height:1040,xMax:640,yMax:1120});
  });
  const p='codex-cli--450809da';
  const art={key:'arte',title:'Criar referência',instructions:'ImageGen',providerOptions:{visualAsset:{arquivo:'motion/c/assets/ref.png',transparente:false}}};
  const obj={key:'obj',title:'Criar recorte',instructions:'ImageGen',providerOptions:{visualAsset:{arquivo:'motion/c/assets/obj.png',transparente:true},visualReferences:['motion/c/assets/ref.png']}};
  const author={key:'compor',title:'Criar composição',instructions:'Componha motion/c/index.html',verifyCommand:'test -s motion/c/index.html'};
  const render={key:'render',provider:'local-shell',instructions:'nivoo-renderizar-motion motion/c --saida midia/saida/c.mp4 --segundos 20 --tamanho 1080x1920'};
  it('propaga área segura desde a arte até a composição sem etapas extras',()=>{
    const input=[art,obj,author,render];
    const plan=compileWorkflowPlan(input,p,'Publicidade de pizza para Reels',{template:'design-video'}) as any[];
    expect(plan).toHaveLength(4);
    for(const i of [0,1,2])expect(plan[i].instructions).toContain(REELS_SAFE_MARKER);
    expect(plan[1].instructions).toContain('Para PNG isolado transparente, não aplique a margem');
    expect(plan[2].instructions).toContain('x=60 até 960, y=120 até 1680');
    expect(plan[2].instructions).toContain('não reduza o produto para caber na guia');
    expect(plan[2].instructions).toContain('Proteja somente logo, textos, preço e CTA');
    expect(plan[3].instructions).not.toContain(REELS_SAFE_MARKER);
    expect(compileWorkflowPlan(plan,p,'Publicidade de pizza para Reels',{template:'design-video'})).toEqual(plan);
    expect(art.instructions).toBe('ImageGen');
    const stale=plan.map((step:any)=>({...step,instructions:step.instructions.replace(/\[NIVOO_REELS_SAFE_AREA_V1\][^\n]*/,'[NIVOO_REELS_SAFE_AREA_V1] antiga margem 672 px')}));
    const refreshed=compileWorkflowPlan(stale,p,'Publicidade de pizza para Reels',{template:'design-video'}) as any[];
    expect(refreshed[2].instructions).toContain('x=60 até 960, y=120 até 1680');
    expect(refreshed[2].instructions).not.toContain('antiga margem');
  });
  it('não impõe Reels a vídeo horizontal, Stories isolado ou render existente',()=>{
    const landscape={...render,instructions:render.instructions.replace('1080x1920','1920x1080')};
    for(const [r,objective] of [[landscape,'Publicidade para Reels'],[render,'Publicidade para Stories']] as const){
      const plan=compileWorkflowPlan([art,obj,author,r],p,objective,{template:'design-video'}) as any[];
      expect(plan.every(s=>!s.instructions.includes(REELS_SAFE_MARKER))).toBe(true);
    }
    expect(applyReelsSafeArea([render],p,'Renderizar novamente para Reels')).toEqual([render]);
  });
});
