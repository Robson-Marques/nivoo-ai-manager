import { createHarness,Harness,truncateAll } from '../support/harness';
import { ProjectProfileService } from '../../src/projects/project-profile.service';

describe('API — perfil visual de projeto',()=>{
  let h:Harness;
  beforeAll(async()=>{h=await createHarness();await truncateAll(h.prisma);});
  afterAll(async()=>{await h.close();});
  it('expõe catálogo estático antes da rota de ID de projeto',async()=>{
    const result=(await h.http().get('/api/projects/visual-styles').expect(200)).body;
    expect(result.version).toBe(1);
    expect(result.styles.map((s:any)=>s.id)).toEqual(['liquid-glass','minimalist','corporate','premium-dark']);
    expect(result.glassVariants.map((s:any)=>s.id)).toEqual(['crystal-glass','frosted-glass','dark-glass','prism-glass']);
  });
  it('expõe fontes e combinações sem instalar ativos',async()=>{
    const result=(await h.http().get('/api/projects/visual-typography').expect(200)).body;
    expect(result.version).toBe(1);
    expect(result.fonts).toHaveLength(8);
    expect(result.pairings).toHaveLength(5);
    expect(result.fonts.find((f:any)=>f.id==='manrope')).toMatchObject({license:'OFL-1.1',availability:'optional-local'});
  });
  it('expõe paletas, densidades e fundações visuais',async()=>{
    const result=(await h.http().get('/api/projects/visual-tokens').expect(200)).body;
    expect(result.version).toBe(1);
    expect(result.palettes.map((p:any)=>p.id)).toEqual(['ocean-blue','emerald','violet','graphite','ruby','amber','teal','magenta','indigo','bordeaux']);
    expect(result.densities.map((d:any)=>d.id)).toEqual(['compact','balanced','spacious']);
    expect(result.foundations).toHaveLength(4);
  });
  it('expõe núcleo original Liquid Glass sem alterar projetos',async()=>{
    const result=(await h.http().get('/api/projects/visual-templates/liquid-glass').expect(200)).body;
    expect(result.id).toBe('liquid-glass');expect(result.version).toBe(2);expect(result.engine).toBe('liqui-design');
    expect(result.files.map((f:any)=>f.name)).toContain('engine/LiquiGlass.tsx');
  });
  it('expõe registry original de componentes',async()=>{
    const result=(await h.http().get('/api/projects/visual-templates/liquid-glass/components').expect(200)).body;
    expect(result.version).toBe(2);expect(result.requires).toEqual({id:'liquid-glass',version:2});
    expect(result.components).toHaveLength(38);
    expect(result.files.map((f:any)=>f.name)).toContain('registry/ui/button.tsx');
  });
  it('persiste decisão, isola projetos, rejeita revisão antiga, restaura ausência e compõe o perfil compartilhado',async()=>{
    const a=(await h.http().post('/api/projects').send({name:'Visual A',base:'software'}).expect(201)).body;
    const b=(await h.http().post('/api/projects').send({name:'Visual B',base:'software'}).expect(201)).body;
    const p={schemaVersion:1,mode:'guided',styleId:'liquid-glass',glassVariantId:'prism-glass',paletteId:'ocean-blue',theme:'system',fonts:{body:'inter'}};
    const url='/api/projects/'+a.id+'/visual-profile';
    expect(a.visualProfile).toBeNull();
    expect(a.visualProfileRevision).toBe(0);
    await h.http().patch(url).send({expectedRevision:0,profile:{...p,rawCss:'a'}}).expect(400);
    await h.http().patch(url).send({expectedRevision:0,profile:{...p,styleId:'not-in-catalog'}}).expect(400);
    await h.http().patch(url).send({expectedRevision:0,profile:{...p,fonts:{body:'ibm-plex-mono'}}}).expect(400);
    await h.http().patch(url).send({expectedRevision:0,profile:{...p,fonts:{body:'not-in-catalog'}}}).expect(400);
    await h.http().patch(url).send({expectedRevision:0,profile:{...p,paletteId:'not-in-catalog'}}).expect(400);
    const saved=(await h.http().patch(url).send({expectedRevision:0,profile:p}).expect(200)).body;
    expect(saved.visualProfile).toEqual(p);
    expect(saved.visualProfileRevision).toBe(1);
    expect((await h.http().get('/api/projects/'+b.id).expect(200)).body.visualProfile).toBeNull();
    await h.http().patch(url).send({expectedRevision:0,profile:null}).expect(409);
    const profiles=h.app.get(ProjectProfileService);
    expect((await profiles.build(a.id)).text).toContain('Estilo: liquid-glass');
    expect((await profiles.build(a.id)).text).toContain('Material Prism Glass');
    expect((await profiles.build(a.id)).text).toContain('Paleta Azul oceano — referência clara');
    expect((await profiles.build(b.id)).text).not.toContain('Estilo: liquid-glass');
    const cleared=(await h.http().patch(url).send({expectedRevision:1,profile:null}).expect(200)).body;
    expect(cleared.visualProfile).toBeNull();
    expect(cleared.visualProfileRevision).toBe(2);
    expect((await profiles.build(a.id)).text).not.toContain('## Perfil visual do projeto');
  });
  it('não define identidade de frontend para projeto exclusivamente audiovisual',async()=>{
    const a=(await h.http().post('/api/projects').send({name:'Visual Vídeo',base:'video'}).expect(201)).body;
    await h.http().patch('/api/projects/'+a.id+'/visual-profile').send({expectedRevision:0,profile:{schemaVersion:1,mode:'delegated'}}).expect(400);
    expect((await h.http().get('/api/projects/'+a.id).expect(200)).body.visualProfileRevision).toBe(0);
  });
});
