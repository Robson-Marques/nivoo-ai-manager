import { createHarness,Harness,truncateAll } from '../support/harness';
import { ProjectProfileService } from '../../src/projects/project-profile.service';

describe('API — perfil visual de projeto',()=>{
  let h:Harness;
  beforeAll(async()=>{h=await createHarness();await truncateAll(h.prisma);});
  afterAll(async()=>{await h.close();});
  it('persiste decisão, isola projetos, rejeita revisão antiga, restaura ausência e compõe o perfil compartilhado',async()=>{
    const a=(await h.http().post('/api/projects').send({name:'Visual A',base:'software'}).expect(201)).body;
    const b=(await h.http().post('/api/projects').send({name:'Visual B',base:'software'}).expect(201)).body;
    const p={schemaVersion:1,mode:'guided',styleId:'liquid-glass',theme:'system',fonts:{body:'inter'}};
    const url='/api/projects/'+a.id+'/visual-profile';
    expect(a.visualProfile).toBeNull();
    expect(a.visualProfileRevision).toBe(0);
    await h.http().patch(url).send({expectedRevision:0,profile:{...p,rawCss:'a'}}).expect(400);
    const saved=(await h.http().patch(url).send({expectedRevision:0,profile:p}).expect(200)).body;
    expect(saved.visualProfile).toEqual(p);
    expect(saved.visualProfileRevision).toBe(1);
    expect((await h.http().get('/api/projects/'+b.id).expect(200)).body.visualProfile).toBeNull();
    await h.http().patch(url).send({expectedRevision:0,profile:null}).expect(409);
    const profiles=h.app.get(ProjectProfileService);
    expect((await profiles.build(a.id)).text).toContain('Estilo: liquid-glass');
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
