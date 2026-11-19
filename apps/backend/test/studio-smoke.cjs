/* Teste real e isolado de edição audiovisual (sem banco/worker).
 * Roda com Node 22, ffmpeg/ffprobe instalados, após npm run build -w apps/backend.
 */
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const {VideoStudioService}=require('../dist/video-studio/video-studio.service');

function cmd(bin,args){return execFileSync(bin,args,{encoding:'utf8',timeout:90000,stdio:['ignore','pipe','pipe']});}
async function main(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-studio-test-'));
  const media=path.join(root,'midia');
  fs.mkdirSync(path.join(media,'entrada'),{recursive:true});
  fs.mkdirSync(path.join(media,'saida'),{recursive:true});
  const source=path.join(media,'entrada','demo.mp4');
  try{
    cmd('ffmpeg',['-hide_banner','-loglevel','error','-y',
      '-f','lavfi','-i','color=c=navy:s=640x360:r=30:d=1.5',
      '-f','lavfi','-i','sine=frequency=440:duration=1.5',
      '-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',source]);
    const prisma={project:{findUnique:async()=>({dirKey:'test'})}};
    const workspace={projectDirs:()=>({midia:media})};
    const studio=new VideoStudioService(prisma,workspace);
    let p=await studio.create('any-project','Teste de edição');
    assert.equal((await studio.list('any-project')).length,1);
    p.clips=[{id:'scene-01',source:'midia/entrada/demo.mp4',start:0,end:1.5,duration:1.5}];
    p.captions=[{id:'text-01',text:'Olá, mundo!',start:.2,end:1.2,x:.5,y:.8,color:'#FFFFFF',fontSize:50,animation:'pop'}];
    p.soundtrack={source:'midia/entrada/demo.mp4',volume:.15};
    p=await studio.save('any-project',p.id,p);
    assert.equal((await studio.get('any-project',p.id)).clips.length,1);
    let blocked=false;
    try{await studio.save('any-project',p.id,{...p,clips:[{...p.clips[0],source:'midia/entrada/../../outro.mp4'}]})}
    catch{blocked=true;}
    assert(blocked,'caminho malicioso deveria ser bloqueado');
    await studio.render('any-project',p.id);
    let st;
    for(let i=0;i<90;i++){
      await new Promise(r=>setTimeout(r,500));
      st=studio.state('any-project',p.id);
      if(st.state!=='running')break;
    }
    assert.equal(st.state,'done',st.error||'renderização falhou');
    const dest=path.join(media,st.output.replace(/^midia\//,''));
    assert(fs.existsSync(dest),'vídeo renderizado não existe');
    const probe=JSON.parse(cmd('ffprobe',['-v','error','-show_entries','stream=codec_type:format=duration','-of','json',dest]));
    assert(probe.streams.some(s=>s.codec_type==='video'),'vídeo exportado sem imagem');
    assert(probe.streams.some(s=>s.codec_type==='audio'),'áudio original perdido');
    assert(Number(probe.format.duration)>1.3,'vídeo exportado muito curto');
    console.log('STUDIO SMOKE OK: exportação MP4 com legenda e trilha, áudio e vídeo preservados.');
  }finally{
    fs.rmSync(root,{recursive:true,force:true});
  }
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
