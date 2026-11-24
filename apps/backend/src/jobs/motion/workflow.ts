import type { RawStep, MotionMode } from './types';
import { pedeGeometria3D, pedeGrafismos, pedeRevisaoVisual } from './intent';
import { renderSource, selectSource, selectStandaloneHtml } from './source';
import { attachAuthorContract, attachStandalone3DContract, authorOutputCheck, isComposer, originalAuthorInstructions } from './authoring';

/**
 * Obrigatório em ambos os caminhos: JobsService.validatePlan e create.
 * Preserva a ordem original e liga autoria ao render; apenas uma revisão
 * visual sem autoria recebe a etapa produtora que estava faltando.
 */
export function conectarMotorMotion(raw: unknown, defaultProvider: string, objective = ''): unknown {
  if (!Array.isArray(raw) || !raw.length) return raw;
  const steps: RawStep[] = raw.map(item =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? { ...item as RawStep } : item);

  for (let ri = 0; ri < steps.length; ri++) {
    const render = steps[ri];
    if (!render || typeof render !== 'object') continue;
    if (String(render.provider ?? defaultProvider) !== 'local-shell') continue;
    const command = String(render.instructions ?? '');
    const source = renderSource(command);
    if (!source) continue;

    let insertedAuthor=false;
    const candidateIndices = steps.slice(0, ri).flatMap((s, i) => {
      if (!s || typeof s !== 'object' || !isComposer(s)) return [];
      const provider = String(s.provider ?? defaultProvider);
      if (['local-shell','juntar-videos','gemini-video','arquivos-projeto'].includes(provider)) return [];
      return [i];
    });
    if (!candidateIndices.length && pedeRevisaoVisual(objective) &&
        !['local-shell','juntar-videos','gemini-video','arquivos-projeto'].includes(defaultProvider)) {
      // A rejected creative result requires an author, not a second export.
      let key='compor-nova-arte';
      for(let n=2;steps.some(s=>s&&s.key===key);n++)key='compor-nova-arte-'+n;
      const author: RawStep = {
        key, title:'Refazer composição visual', provider:defaultProvider,
        instructions:'Crie a composição corrigida em '+source+' atendendo à última solicitação. Preserve os ativos e restrições válidos, não o visual rejeitado.',
        dependsOn:Array.isArray(render.dependsOn)?[...render.dependsOn]:[],
      };
      insertedAuthor=true;
      steps.splice(ri,0,author);
      candidateIndices.push(ri);
      ri++;
    }
    if (!candidateIndices.length) {
      // Uma nova renderização pode corrigir um problema do MOTOR sem tocar
      // em UMA linha do HTML/overlays.json já produzido. Não impedir o
      // caminho local-shell nem exigir uma nova sessão de IA para refazer v4.
      continue;
    }

    const matchesSource = candidateIndices.filter(i =>
      (String(steps[i].instructions ?? '') + ' ' + String(steps[i].verifyCommand ?? '')).includes(source));
    if (matchesSource.length > 1) continue; // não adivinhar qual IA produz a fonte
    if (!matchesSource.length && candidateIndices.length !== 1) continue;
    const ci = matchesSource[0] ?? candidateIndices[0];
    const compose = steps[ci];

    // Na segunda passagem (validatePlan→create) ignorar instruções que o
    // próprio Nivo acrescentou, para não inferir WebGL do texto "NÃO use WebGL".
    const original = originalAuthorInstructions(compose);
    const text = [
      objective, String(compose.title ?? ''), original, String(render.title ?? ''),
    ].join(' ');
    const real3d = pedeGeometria3D(text);
    const hasPhotos = /pizzas?|fotografias?|imagens?|produtos?|logomarcas?|logos?|png|webp|assets?|fotos?|recort/i.test(text);
    // Se precisa de geometria 3D real, o HTML mantém a geometria; imagens
    // passam obrigatoriamente para overlay independente. Fotos 2D usam JSON.
    // 3D não pode voltar silenciosamente ao scene.json de uma revisão
    // antiga. Uma entrada HTML explícita também funciona com --motor auto.
    // Retomadas sem etapa autora mantêm a fonte originalmente escolhida.
    if (real3d) render.instructions = selectSource(command, source);
    if (real3d && !hasPhotos) {
      render.instructions=selectStandaloneHtml(command,source);
      const authorKey=String(compose.key??'');
      if(authorKey && authorKey!==String(render.key??''))
        render.dependsOn=[...new Set([...(Array.isArray(render.dependsOn)?render.dependsOn.map(String):[]),authorKey])];
      attachStandalone3DContract(compose,source);
      if (insertedAuthor) compose.verifyCommand=authorOutputCheck(source,'graphics');
      continue;
    }
    const mode: MotionMode = real3d ? 'hybrid' : pedeGrafismos(text) ? 'graphics' : 'scene';
    if(mode==='graphics') render.instructions=selectStandaloneHtml(command,source);
    else if(mode==='scene' && /\/index\.html(?=["'\s]|$)/.test(command)) render.instructions=selectSource(command,source,'scene.json');
    const authorKey=String(compose.key??'');
    if(authorKey && authorKey!==String(render.key??'')){
      render.dependsOn=[...new Set([...(Array.isArray(render.dependsOn)?render.dependsOn.map(String):[]),authorKey])];
    }
    attachAuthorContract(compose,source,mode,pedeRevisaoVisual(objective));
    if (insertedAuthor) compose.verifyCommand=authorOutputCheck(source,mode);
    // NÃO acrescentar revisores nem testes extras.
    // O próprio renderer seleciona o motor e respeita os movimentos criados
    // pela IA, sem acelerar DUAS vezes o néon após a edição da composição.
    // Critérios de entrega originais permanecem intocados.
  }
  return steps;
}
