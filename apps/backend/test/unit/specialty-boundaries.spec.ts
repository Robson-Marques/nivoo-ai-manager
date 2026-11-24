import { compileWorkflowPlan } from '../../src/jobs/workflow/compile-plan';
import { mediaEnabledForArea, hasNativeMediaOperation } from '../../src/specialties/media/scope';
import { mediaPlannerRules, mediaOptionalGenerationRules } from '../../src/specialties/media/planner-contract';

describe('Fronteiras entre especialidades', () => {
  const softwareStep = { key: 'teste', title: 'Teste do encoder', provider: 'local-shell',
    instructions: 'ffmpeg -i fixtures/a.mp4 -c:v libx264 out/sample.mp4', verifyCommand: 'test -s out/sample.mp4' };
  const author = { key: 'compor', title: 'Criar animação', provider: 'codex-cli',
    instructions: 'Criar logo em motion/novo/index.html', verifyCommand: 'test -s motion/novo/index.html' };
  const render = { key: 'render', title: 'Renderizar', provider: 'local-shell',
    instructions: 'nivoo-renderizar-motion motion/novo --saida midia/saida/video.mp4 --segundos 12 --tamanho 1080x1920' };
  const assembly = { key: 'montar', provider: 'juntar-videos', instructions: 'Montar',
    providerOptions: { cenas: ['midia/saida/video.mp4'], arquivo: 'midia/saida/final.mp4' } };

  for (const template of ['software','studio-workflow','atendimento']) {
    it('preserva comandos do domínio '+template, () => {
      const original=[softwareStep];
      expect(compileWorkflowPlan(original,'codex-cli','Teste de renderização de vídeo',{template})).toEqual(original);
    });
  }
  it('não confunde documentação com uma invocação da ferramenta', () => {
    const original=[{key:'render_3d',title:'Renderizar composição 3D',provider:'codex-cli',
      instructions:'Documente a ferramenta nivoo-renderizar-motion',verifyCommand:'test -s midia/saida/video.mp4'}];
    expect(hasNativeMediaOperation(original,'codex-cli')).toBe(false);
    expect(compileWorkflowPlan(original,'codex-cli','Documentação software',{template:'software'})).toEqual(original);
  });
  it('permite uma operação nativa explícita sem reescrever etapas de desenvolvimento', () => {
    const original=[softwareStep,render,assembly];
    const plan=compileWorkflowPlan(original,'codex-cli','Teste e vídeo',{template:'software'}) as any[];
    expect(plan[0]).toEqual(softwareStep);
    expect(plan[1]).toEqual(render);
    expect(plan[2].dependsOn).toEqual(['render']);
  });
  it('mantém autoria, render e montagem ligados no domínio Motion', () => {
    const area={template:'design-video'};
    const objective='Vídeo em 3D com logo';
    const plan=compileWorkflowPlan([author,render,assembly],'codex-cli',objective,area) as any[];
    expect(plan[1].instructions).toContain('index.html');
    expect(plan[1].dependsOn).toContain('compor');
    expect(plan[2].dependsOn).toContain('render');
    expect(compileWorkflowPlan(plan,'codex-cli',objective,area)).toEqual(plan);
  });
  it('conecta uma refação visual à saída que o autor deve produzir', () => {
    const area={template:'design-video'};
    const objective='O vídeo é o mesmo. Faça de novo com 3D e logo';
    const plan=compileWorkflowPlan([render],'codex-cli',objective,area) as any[];
    expect(plan).toHaveLength(2);
    expect(plan[0].verifyCommand).toContain('overlays.json');
    expect(compileWorkflowPlan(plan,'codex-cli',objective,area)).toEqual(plan);
  });
  it('mantém ferramentas locais disponíveis quando Gemini não está disponível', () => {
    expect(mediaOptionalGenerationRules(false)).toEqual([]);
    const local=mediaPlannerRules().join('\n');
    for(const tool of ['gerar-narracao','juntar-videos','nivoo-renderizar-motion']) expect(local).toContain(tool);
    expect(mediaOptionalGenerationRules(true).join('\n')).toContain('gemini-video');
  });
  it('usa a configuração real da área, preservando áreas gerais legadas', () => {
    expect(mediaEnabledForArea({template:'design-video',slug:'custom'})).toBe(true);
    expect(mediaEnabledForArea({template:'software',slug:'design-video'})).toBe(false);
    expect(mediaEnabledForArea({template:'generica'})).toBe(true);
  });
});
