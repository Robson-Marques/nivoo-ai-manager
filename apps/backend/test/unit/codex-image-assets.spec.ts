import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { nativeImageTarget,nativeImageCandidates,recoverNativeImage,prepareNativeImage,imageEventPath,imageEventBytes,imageEventFailure,isCodexAccount,rolloutImageBytes,visualReceiptKey,recordVisualReceipt,reuseVisualReceipt } from '../../src/providers/codex-image-assets';
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
  it('liga referência final, recorte e composição por arquivo, mesmo fora de ordem',()=>{
    const provider='codex-cli--450809da';
    const ref={key:'referencia',title:'Criar referência',instructions:'ImageGen',providerOptions:{visualAsset:{arquivo:'motion/c/assets/ref.png'}}};
    const cut={key:'recorte',title:'Criar recorte',instructions:'ImageGen',providerOptions:{visualAsset:{arquivo:'motion/c/assets/obj.png',transparente:true},visualReferences:['motion/c/assets/ref.png']}};
    const author={key:'compor',title:'Composição',instructions:'Componha motion/c/index.html',verifyCommand:'test -s motion/c/index.html'};
    const render={key:'render',provider:'local-shell',instructions:'nivoo-renderizar-motion motion/c --saida midia/saida/c.mp4 --segundos 12 --tamanho 1080x1920'};
    const plan=compileWorkflowPlan([cut,ref,author,render],provider,'Campanha',{template:'design-video'}) as any[];
    expect(plan[0].dependsOn).toContain('referencia');
    expect(plan[2].dependsOn).toEqual(expect.arrayContaining(['referencia','recorte']));
    expect(plan[3].dependsOn).toContain('compor');
    expect(()=>compileWorkflowPlan([ref,{...cut,providerOptions:ref.providerOptions},author,render],provider,'Campanha',{template:'design-video'})).toThrow(/mesmo/);
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
      const receipt=visualReceiptKey('job','step','codex-cli','brief',target);
      recordVisualReceipt(cwd,target,receipt);
      await expect(reuseVisualReceipt(cwd,target,receipt)).resolves.toBe(true);
      await expect(reuseVisualReceipt(cwd,target,visualReceiptKey('job','other','codex-cli','brief',target))).resolves.toBe(false);
      const base64=fs.readFileSync(png).toString('base64');
      const extension={type:'event_msg',payload:{type:'item_completed',item:{type:'Extension',kind:'image_gen.generation',status:'completed',result:base64,savedPath:png}}};
      expect(imageEventPath(extension)).toBe(png);
      expect(imageEventBytes(extension)?.toString('base64')).toBe(base64);
      expect(imageEventBytes({type:'item.completed',item:{type:'extension',kind:'image_gen.generation',status:'completed',image:{result:base64}}})?.toString('base64')).toBe(base64);
      expect(imageEventBytes({type:'event_msg',payload:{type:'item_completed',item:{type:'Extension',kind:'other',status:'completed',result:base64}}})).toBeUndefined();
      expect(imageEventFailure({type:'item.completed',item:{type:'extension',kind:'image_gen.generation',status:'failed',failure:{type:'usage_limit_exceeded',limit_id:'image_gen'}}})).toContain('usage_limit_exceeded');
      fs.unlinkSync(png);
      expect(nativeImageCandidates(home,cwd,thread,[],Date.now()-10000)).toEqual([]);
      const dated=path.join(home,'sessions',new Date().toISOString().slice(0,10).replace(/-/g,'/'));
      fs.mkdirSync(dated,{recursive:true});
      fs.writeFileSync(path.join(dated,'rollout-fixture-'+thread+'.jsonl'),[
        {type:'session_meta',payload:{id:thread}},
        {type:'response_item',payload:{type:'image_generation_call',status:'generating',result:base64}}
      ].map(x=>JSON.stringify(x)).join('\n'));
      const fromRollout=nativeImageTarget({arquivo:'motion/c/assets/recuperado.png',transparente:true})!;
      prepareNativeImage(cwd,fromRollout);
      expect((await rolloutImageBytes(home,thread,Date.now()-10000)).length).toBe(1);
      await expect(recoverNativeImage({CODEX_HOME:home},cwd,fromRollout,thread,[],Date.now()-10000)).resolves.toBe(fromRollout.arquivo);
      expect(fs.readFileSync(path.join(cwd,fromRollout.arquivo)).toString('base64')).toBe(base64);
      // Newer versions may retain just the savedPath (not the inline bytes).
      const local=path.join(cwd,'generated_images','new.png');
      fs.mkdirSync(path.dirname(local),{recursive:true});
      fs.writeFileSync(local,Buffer.from(base64,'base64'));
      fs.writeFileSync(path.join(dated,'rollout-fixture-'+thread+'.jsonl'),[
        {type:'session_meta',payload:{id:thread}},
        {type:'event_msg',payload:{type:'item_completed',item:{type:'Extension',kind:'image_gen.generation',status:'completed',savedPath:local}}}
      ].map(x=>JSON.stringify(x)).join('\n'));
      const fromPath=nativeImageTarget({arquivo:'motion/c/assets/from-path.png',transparente:true})!;
      prepareNativeImage(cwd,fromPath);
      await expect(recoverNativeImage({CODEX_HOME:home},cwd,fromPath,thread,[],Date.now()-10000)).resolves.toBe(fromPath.arquivo);
      expect(fs.readFileSync(path.join(cwd,fromPath.arquivo)).toString('base64')).toBe(base64);
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  });
});
