import { maintenanceIntent,maintenanceFocus,maintenanceEngineeringContext } from '../../src/specialties/software/maintenance';
import { selectSkills } from '../../src/specialties/skills';

describe('Engenharia de manutenção',()=>{
  const base={phase:'execution' as const,media:false,software:true};
  const ids=(text:string)=>selectSkills({...base,text}).map(s=>s.id);
  it('reconhece depuração e desempenho sem confundir tarefas genéricas',()=>{
    expect(maintenanceIntent("Depurar falha de código")).toBe(true);
    expect(maintenanceIntent("Corrigir bug no backend")).toBe(true);
    expect(maintenanceIntent("Refatorar arquitetura e logs")).toBe(true);
    expect(maintenanceIntent("Medir latência p95")).toBe(true);
    expect(maintenanceIntent("Corrigir vazamento de memória")).toBe(true);
    expect(maintenanceIntent("Investigar loop de tentativas")).toBe(true);
    expect(maintenanceIntent("Revisar src/http/request.logger.ts")).toBe(true);
    expect(maintenanceIntent("Reduzir consumo de tokens")).toBe(true);
    expect(maintenanceIntent("Corrigir N+1")).toBe(true);
    expect(maintenanceIntent("Criar formulário React")).toBe(false);
    expect(maintenanceIntent("Implementar backend")).toBe(false);
    expect(maintenanceIntent("Corrigir endpoint")).toBe(false);
    expect(maintenanceIntent("Criar fila de pedidos")).toBe(false);
    expect(maintenanceIntent("Ajustar cache de imagens")).toBe(false);
    expect(ids('Refatorar arquitetura e logs')).toEqual(expect.arrayContaining(['codigo','software-arquitetura','software-manutencao']));
    expect(ids('Corrigir endpoint')).not.toContain('software-manutencao');
  });
  it('seleciona focos pertinentes',()=>{
    expect(maintenanceFocus("Depurar stack trace")).toEqual(["diagnostico","observabilidade"]);
    expect(maintenanceFocus("Logs e telemetria")).toEqual(["observabilidade"]);
    expect(maintenanceFocus("Latência p95")).toEqual(["desempenho"]);
    expect(maintenanceFocus("Race condition e deadlock")).toEqual(["concorrencia"]);
    expect(maintenanceFocus("Cache e invalidação")).toEqual(["recursos"]);
    expect(maintenanceFocus("Retomar após timeout")).toEqual(["recuperacao"]);
    expect(maintenanceFocus("Refatorar legado")).toEqual(["manutencao"]);
    expect(maintenanceFocus("Vazamento de memória")).toEqual(["desempenho","recursos"]);
    expect(maintenanceFocus("N+1")).toEqual(["desempenho","recursos"]);
  });
  it('distingue fases e recuperação baseada em evidência',()=>{
    const plan=maintenanceEngineeringContext('planner','Medir latência').join('\n');
    const exec=maintenanceEngineeringContext('execution','Medir latência').join('\n');
    expect(plan).toContain('baseline');
    expect(exec).toContain('Desempenho:');
    expect(exec).toContain('Não declare ganhos');
    expect(exec).not.toContain('Recuperação:');
    const resumed=maintenanceEngineeringContext('execution','Corrigir endpoint',true).join('\n');
    expect(resumed).toContain('última conferência e o checkpoint');
    expect(resumed).toContain('Diagnóstico:');
    expect(resumed).toContain('Recuperação:');
    expect(resumed).not.toContain('Desempenho:');
    expect(maintenanceEngineeringContext('planner','Corrigir endpoint',true).join('\n')).not.toContain('Existe falha');
  });
  it('especializa somente retomada de etapa de código e preserva domínios',()=>{
    const failed={...base,previousError:true,text:'Implementar backend'};
    expect(selectSkills(failed).map(s=>s.id)).toEqual(expect.arrayContaining(['diagnostico','codigo','software-backend','software-manutencao']));
    expect(selectSkills({...failed,phase:'planner'}).some(s=>s.id==='software-manutencao')).toBe(false);
    expect(selectSkills({...failed,text:'Editar documento'}).some(s=>s.id==='software-manutencao')).toBe(false);
    expect(selectSkills({...failed,software:false}).some(s=>s.id==='software-manutencao')).toBe(false);
    expect(selectSkills({...failed,executor:true})).toEqual([]);
    expect(selectSkills({...failed,motionAuthor:true,media:true,text:'Animar vídeo e corrigir logs'}).some(s=>s.id==='software-manutencao')).toBe(false);
    expect(selectSkills({...failed,nativeImage:true,media:true,text:'Gerar imagem'}).some(s=>s.id==='software-manutencao')).toBe(false);
  });
});
