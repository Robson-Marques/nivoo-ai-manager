import * as fs from 'node:fs';
import * as path from 'node:path';
import { ProjectProfileService } from '../../src/projects/project-profile.service';
import { WorkspaceService } from '../../src/storage/workspace.service';
import { createHarness, Harness, truncateAll } from '../support/harness';
import { findTemplate,AREAS_INSTALADAS } from '../../src/areas/area-templates';

describe('Modelos nativos e aposentadoria do Studio Workflow',()=>{
  let h:Harness;
  beforeAll(async()=>{h=await createHarness();await truncateAll(h.prisma);});
  afterAll(()=>h.close());
  it('oferece Software e não instala a metodologia retirada',async()=>{
    expect(findTemplate('studio-workflow')).toBeUndefined();
    expect(AREAS_INSTALADAS).toContain('software');
    expect((await h.http().get('/api/areas/templates')).body.map((t:any)=>t.key)).not.toContain('studio-workflow');
    const p=(await h.http().post('/api/projects').send({name:'Software nativo',base:'software'}).expect(201)).body;
    const profile=await h.app.get(ProjectProfileService).build(p.id);
    expect(profile.text).toContain('Código limpo');
    expect(profile.text).not.toContain('Relatório de alinhamento');
  });
  it('preserva materiais antigos no disco, mas não entrega o pacote retirado à IA',async()=>{
    const p=(await h.http().post('/api/projects').send({name:'Software migrado',base:'software'}).expect(201)).body;
    const area=await h.prisma.area.findUniqueOrThrow({where:{id:p.area.id}});
    const w=h.app.get(WorkspaceService),base=w.areaDirs(area.slug).base;
    await w.writeKnowledge(base,[{path:'prompt-alinhamento.md',content:Buffer.from('METODO_ANTIGO')},{path:'regra-cliente.md',content:Buffer.from('REGRA_CLIENTE')}],'teste','materiais antigos');
    await h.prisma.area.update({where:{id:area.id},data:{retiredStudioWorkflow:true}});
    const profile=await h.app.get(ProjectProfileService).build(p.id);
    expect(profile.text).not.toContain('contexto/base/prompt-alinhamento.md');
    expect(profile.text).toContain('contexto/base/regra-cliente.md');
    const tmp=fs.mkdtempSync(path.join(w.projectDirs(p.dirKey).root,'retired-'));
    try{
      w.prepareSessionContext(area.slug,p.dirKey,tmp,true);
      expect(fs.existsSync(path.join(tmp,'contexto/base/prompt-alinhamento.md'))).toBe(false);
      expect(fs.readFileSync(path.join(tmp,'contexto/base/regra-cliente.md'),'utf8')).toBe('REGRA_CLIENTE');
      expect(fs.existsSync(path.join(base,'prompt-alinhamento.md'))).toBe(true);
    }finally{fs.rmSync(tmp,{recursive:true,force:true});}
  });
  it('modelo pronto "Vídeo com IA (Omni)": instalado, com regras de cenas e o guia; projeto nele recebe as regras', async () => {
    const m = (await h.http().get('/api/areas/video-veo').expect(200)).body;
    expect(m.name).toBe('Vídeo com IA (Omni)');
    const regras = m.instructions[m.instructions.length - 1].text;
    expect(regras).toContain('provider "gemini-video"');
    expect(regras).toContain('contexto/base/guia-de-cenas.md');
    expect(m.baseFiles.map((f: any) => f.path).sort()).toEqual(['README.md', 'guia-de-cenas.md']);
    const p = (await h.http().post('/api/projects').send({ name: 'Reels da pizzaria', base: 'video-veo' }).expect(201)).body;
    const perfil = await h.app.get(ProjectProfileService).build(p.id);
    expect(perfil.text).toContain('Você é diretor e roteirista de vídeos curtos gerados por IA');
    expect(perfil.text).toContain('contexto/base/guia-de-cenas.md');
  });

});
