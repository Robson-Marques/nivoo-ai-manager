import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileWorkflowPlan } from '../../src/jobs/workflow/compile-plan';
import { readMotionInvocation } from '../../src/jobs/motion/command';
import { inspecionarVideoGerado } from '../../src/jobs/native-video-result';

/**
 * Integrated capability acceptance fixture. No AI, production data, network
 * or editorial gate. Uses the actual installed CLI, Chromium and FFmpeg.
 */
describe('Motion — produção integrada de MP4', () => {
  const cli=path.resolve(__dirname,'../../bin/nivoo-renderizar-motion');
  let root:string;
  beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-motion-integrado-'));});
  afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
  function run(exe:string,args:string[],env=process.env):Buffer {
    const result=spawnSync(exe,args,{cwd:root,env,timeout:120000,maxBuffer:10*1024*1024});
    if(result.error||result.status!==0)throw new Error(exe+' '+String(result.error??'')+'\n'+result.stderr.toString()+'\n'+result.stdout.toString());
    return result.stdout;
  }
  function render(mode:'scene'|'hybrid'):string {
    const src='motion/'+mode;
    const dir=path.join(root,src);
    fs.mkdirSync(path.join(dir,'assets'),{recursive:true});
    const asset='assets/produto.svg';
    fs.writeFileSync(path.join(dir,asset),'<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" fill="#00ff00"/></svg>');
    const layer={id:'produto',type:'image',asset,x:80,y:120,width:50,height:50,required:true,shadow:false,
      keys:[{at:0,x:40},{at:1,x:120}]};
    const scene={version:1,width:160,height:240,duration:1,background:'#112233',layers:[layer]};
    if(mode==='scene')fs.writeFileSync(path.join(dir,'scene.json'),JSON.stringify(scene));
    else {
      fs.writeFileSync(path.join(dir,'overlays.json'),JSON.stringify({...scene,background:undefined}));
      fs.writeFileSync(path.join(dir,'index.html'),'<html><body style="margin:0;background:#112233"><canvas width="160" height="240"></canvas><script>const r=NivooGraphics.create(document.querySelector("canvas"));const g=r.box();window.__motionSegundos=1;window.__renderAt=t=>r.render([{geometry:g,color:"#d9a348",rotation:[20,t*180,0]}]);window.__renderAt(0);</script></body></html>');
    }
    const output='midia/saida/'+mode+'.mp4';
    const steps=[
      {key:'compor',title:mode==='hybrid'?'Criar composição 3D com produto':'Criar composição com produto',provider:'codex-cli',instructions:'Produzir '+src,verifyCommand:"test -s '"+src+(mode==='hybrid'?'/index.html':'/scene.json')+"'"},
      {key:'render',title:'Renderizar animação',provider:'local-shell',instructions:'nivoo-renderizar-motion '+src+' --saida '+output+' --segundos 1 --tamanho 160x240'},
    ];
    const objective=mode==='hybrid'?'Geometria 3D real com foto de produto':'Animação sem geometria 3D';
    const plan=compileWorkflowPlan(steps,'codex-cli',objective,{template:'design-video'}) as any[];
    expect(plan[1].dependsOn).toContain('compor');
    const op=readMotionInvocation(plan[1].instructions)!;
    expect(op.output).toBe(output);
    const mediaDir=path.join(root,'midia');
    run(process.execPath,[cli,op.source,'--motor',mode,'--saida',output,'--segundos','1','--tamanho','160x240'],{...process.env,NIVOO_MIDIA_DIR:mediaDir});
    const result=inspecionarVideoGerado(mediaDir,output,'local-shell',plan[1].instructions);
    expect(result.ok).toBe(true);
    expect(result.frames).toBe(25);
    expect(result.seconds).toBeCloseTo(1,1);
    const video=result.absolutePath!;
    // Verify actual decoded frames, not only file existence or metadata.
    const pixels=(second:string)=>run('ffmpeg',['-v','error','-ss',second,'-i',video,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
    const first=pixels('0'), last=pixels('0.8');
    const greenCenter=(frame:Buffer,x:number)=>{
      let green=0;
      for(let y=108;y<132;y++)for(let col=x-10;col<x+10;col++){
        const i=(y*160+col)*3;
        if(frame[i+1]>150&&frame[i+1]>frame[i]+65&&frame[i+1]>frame[i+2]+65)green++;
      }
      return green;
    };
    expect(first.length).toBe(160*240*3);
    expect(greenCenter(first,40)).toBeGreaterThan(300);
    expect(greenCenter(last,104)).toBeGreaterThan(300);
    expect(first.equals(last)).toBe(false);
    return video;
  }
  it('produz uma cena declarativa com imagem visível e movimento',()=>{render('scene');});
  it('produz geometria 3D com overlay de produto sincronizado',()=>{render('hybrid');});
});
