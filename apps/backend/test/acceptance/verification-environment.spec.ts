import {createHarness,Harness,truncateAll,waitFor} from '../support/harness';
import {gravarVariavelDaConferencia} from '../../src/accounts/secrets';

describe('Ambiente da avaliação final',()=>{
  let h:Harness;
  beforeAll(async()=>{h=await createHarness();await truncateAll(h.prisma);h.worker.start();});
  afterAll(()=>h.close());
  async function run(p:any,criteria:any[]){
    const url='/api/projects/'+p.id+'/jobs';
    const j=(await h.http().post(url).send({title:'Verificação',objective:'Fixture de ambiente',defaultProvider:'local-shell',steps:[{key:'a',title:'Construir',instructions:'printf pronto > resultado.txt'}],criteria}).expect(201)).body;
    await h.http().post(url+'/'+j.id+'/start').expect(201);
    return waitFor(async()=>{
      const r=(await h.http().get(url+'/'+j.id)).body;
      return ['CONCLUIDO','BLOQUEADO','FALHOU'].includes(r.status)?r:null;
    },60000);
  }
  it('repassa ao critério final as variáveis configuradas no projeto e oculta o valor na evidência',async()=>{
    const p=(await h.http().post('/api/projects').send({name:'Ambiente credencial fixture'}).expect(201)).body;
    const secret='fixture-secret-NIVOO-38492';
    gravarVariavelDaConferencia(p.id,'FIXTURE_TOKEN',secret);
    try {
      const j=await run(p,[{key:'env',kind:'COMMAND',description:'Variável do projeto',config:{command:'test -n "$FIXTURE_TOKEN" && printf "%s" "$FIXTURE_TOKEN"'}}]);
      expect(j.status).toBe('CONCLUIDO');
      expect(j.criteria[0].checks[0].evidence.stdout).toBe('[SEGREDO]');
      expect(JSON.stringify(j.criteria[0].checks)).not.toContain(secret);
    } finally {gravarVariavelDaConferencia(p.id,'FIXTURE_TOKEN',null);}
  });
  it('interrompe a avaliação em falha de infraestrutura, sem executar os critérios seguintes',async()=>{
    const p=(await h.http().post('/api/projects').send({name:'Ambiente indisponível fixture'}).expect(201)).body;
    const j=await run(p,[
      {key:'infra',kind:'COMMAND',description:'Falha simulada de ambiente',config:{command:"printf 'ENOSPC: fixture\\n' >&2; exit 1"}},
      {key:'posterior',kind:'COMMAND',description:'Não deve rodar',config:{command:'printf indevido > out/posterior.txt'}},
    ]);
    expect(j.status).toBe('BLOQUEADO');
    expect(j.blockedReason).toBe('VERIFICACAO_IMPOSSIVEL');
    expect(j.criteria.find((x:any)=>x.key==='posterior').status).toBe('PENDENTE');
    expect(j.criteria.find((x:any)=>x.key==='posterior').checks).toHaveLength(0);
    expect(j.steps).toHaveLength(1);
  });
});
