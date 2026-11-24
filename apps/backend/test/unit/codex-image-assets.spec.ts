import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { nativeImageTarget,nativeImageCandidates,recoverNativeImage,prepareNativeImage,imageEventPath,isCodexAccount } from '../../src/providers/codex-image-assets';
import { compileWorkflowPlan } from '../../src/jobs/workflow/compile-plan';
import { mediaImageGenerationRules } from '../../src/specialties/media/planner-contract';
const thread='01234567-1234-1234-1234-0123456789ab';
const other='11234567-1234-1234-1234-0123456789ab';
describe('Codex ImageGen ligado ao Motion',()=>{
  it('não mistura contas, caminhos nem etapas de composição',()=>{
    expect(isCodexAccount('codex-cli--450809da')).toBe(true);
    expect(isCodexAccount('codex-api')).toBe(false);
    expect(()=>nativeImageTarget({arquivo:'../secret.png'})).toThrow();
    expect(()=>nativeImageTarget({arquivo:'motion/a.png',transparente:'true'})).toThrow();
    expect(imageEventPath({type:'item.completed',item:{type:'agent_message',saved_path:'/x'}})).toBeUndefined();
    expect(imageEventPath({type:'item.completed',item:{type:'image_generation',status:'failed',saved_path:'/x'}})).toBeUndefined();
  });
  it('prefere a conexão Codex selecionada, mesmo com Gemini disponível',()=>{
    const text=mediaImageGenerationRules(true,'codex-cli--450809da').join('\n');
    expect(text).toContain('codex-cli--450809da');
    expect(text).toContain('visualAsset');
    expect(text).toContain('somente se o usuário');
  });
  it('liga arte transparente e composição, sem criar novas etapas',()=>{
    const art={key:'arte',title:'Criar arte',provider:'codex-cli--450809da',instructions:'Use ImageGen',providerOptions:{visualAsset:{arquivo:'motion/c/assets/calendario.png',transparente:true}}};
    const author={key:'compor',title:'Criar composição 3D',provider:'codex-cli--450809da',instructions:'Componha motion/c/index.html'};
    const render={key:'render',provider:'local-shell',instructions:'nivoo-renderizar-motion motion/c --saida midia/saida/c.mp4 --segundos 12 --tamanho 1080x1920'};
    const compiled=compileWorkflowPlan([art,author,render],'codex-cli--450809da','Campanha editorial profissional',{template:'design-video'}) as any[];
    expect(compiled).toHaveLength(3);
    expect(compiled[1].dependsOn).toContain('arte');
    expect(compiled[1].providerOptions.visualReferences).toContain('motion/c/assets/calendario.png');
    expect(compiled[2].dependsOn).toContain('compor');
    expect(compiled[2].instructions).toContain('--motor html');
    expect(compileWorkflowPlan(compiled,'codex-cli--450809da','Campanha editorial profissional',{template:'design-video'})).toEqual(compiled);
    const withPerspective=compileWorkflowPlan([art,author,render],'codex-cli--450809da','Calendário 3D com neon e imagem recortada',{template:'design-video'}) as any[];
    expect(withPerspective[2].instructions).toContain('--motor html');
    const explicitGeometry=compileWorkflowPlan([art,author,{...render,instructions:render.instructions+' --motor hybrid'}],'codex-cli--450809da','Calendário 3D com malhas e produto',{template:'design-video'}) as any[];
    expect(explicitGeometry[2].instructions).toContain('--motor hybrid');
  });
  it('recupera somente o PNG da própria sessão, preservando alfa e sem sobrescrever',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-image-test-'));
    try{
      const home=path.join(root,'home'),cwd=path.join(root,'work');
      fs.mkdirSync(cwd);
      for(const id of [thread,other])fs.mkdirSync(path.join(home,'generated_images',id),{recursive:true});
      const png=path.join(home,'generated_images',thread,'image.png');
      // fixture PNG de dois pixels (um transparente e um visível), criado localmente.
      const r=spawnSync('ffmpeg',['-v','error','-f','rawvideo','-pixel_format','rgba','-video_size','2x1','-i','pipe:0','-frames:v','1','-threads','1',png],{input:Buffer.from([255,0,0,0,0,255,0,255])});
      expect(r.status).toBe(0);
      fs.copyFileSync(png,path.join(home,'generated_images',other,'unrelated.png'));
      const target=nativeImageTarget({arquivo:'motion/c/assets/objeto.png',transparente:true})!;
      prepareNativeImage(cwd,target);
      expect(nativeImageCandidates(home,cwd,thread,[],Date.now()-10000)).toEqual([png]);
      await expect(recoverNativeImage({CODEX_HOME:home},cwd,target,thread,[],Date.now()-10000)).resolves.toBe(target.arquivo);
      expect(fs.readFileSync(path.join(cwd,target.arquivo))).toEqual(fs.readFileSync(png));
      expect(()=>prepareNativeImage(cwd,target)).toThrow();
      fs.unlinkSync(png);
      expect(nativeImageCandidates(home,cwd,thread,[],Date.now()-10000)).toEqual([]);
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  });
});
