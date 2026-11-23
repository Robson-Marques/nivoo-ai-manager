/**
 * Conexão real entre o plano de trabalho e o compositor oficial.
 *
 * Antes, scene.json/overlays.json eram só sugestões no prompt; a IA podia
 * devolver outro HTML e o executor gastaria 625 quadros com geometria errada.
 *
 * Aqui o NÚCLEO vincula a etapa produtora ao render oficial, define o formato
 * e exige validação determinística do arquivo produzido. Não cria etapas.
 * Renderizações de composições antigas SEM etapa produtora seguem compatíveis.
 */

type RawStep = Record<string, unknown>;
type MotionMode = 'scene' | 'hybrid';

const pathIsMotion = (s: string) =>
  /^motion\/[A-Za-z0-9._/-]+$/.test(s) && !s.split('/').includes('..');
const validSource = (s: string) =>
  pathIsMotion(s) && s !== 'motion' && !s.endsWith('/index.html') && !s.endsWith('/scene.json');

function renderSource(command: string): string | null {
  // Somente CHAMADA REAL, não texto da IA, documentação ou verifyCommand.
  const m = /(?:^|[;\n])\s*(?:env\s+)?(?:\/usr\/local\/bin\/)?nivoo-renderizar-motion\s+(?:"([^"]+)"|'([^']+)'|(motion\/[A-Za-z0-9._/-]+))(?=\s|$)/m.exec(command);
  const val = m?.[1] ?? m?.[2] ?? m?.[3] ?? '';
  const source = val.replace(/\/(?:index\.html|scene\.json)$/, '');
  return validSource(source) ? source : null;
}

function isComposer(step: RawStep): boolean {
  const title = String(step.title ?? '') + ' ' + String(step.key ?? '');
  const instr = String(step.instructions ?? '');
  return /compos|cri(ar|a[çc][aã]o)|produz|desenh|animar|anima[çc][aã]o|motion|3d/i.test(title) &&
    !/revis|auditor|confer|verific|valid|aprov/i.test(title) &&
    !/\bnivoo-renderizar-motion\b/.test(instr);
}

function existingCheck(verify: string, source: string): string[] {
  // Substitui apenas testes de uma fonte HTML antiga pelo cheque oficial
  // que aceita tanto scene.json como index.html+overlays.json.
  return verify.split(/\s+&&\s+/g)
    .map(s => s.trim()).filter(s =>
      s && s !== 'true' && s !== ':' &&
      !s.includes(source + '/index.html') &&
      !s.includes(source + '/scene.json') &&
      !s.includes(source + '/overlays.json') &&
      !s.includes('nivoo-conferir-motion'));
}

function addRenderFlags(command: string, mode: MotionMode, fast: boolean): string {
  // Preserva "set -e;", nova linha e comandos adjacentes; injeta somente
  // no segmento de invocação. Idempotente em validatePlan() e create().
  return command.replace(/((?:\/usr\/local\/bin\/)?nivoo-renderizar-motion\b[^\n;&]*)/, match => {
    const motor = /(?:^|\s)--motor\s+/.test(match) ? '' : ' --motor ' + mode;
    const ritmo = fast && !/(?:^|\s)--ritmo\s+/.test(match) ? ' --ritmo energetico' : '';
    return match + motor + ritmo;
  });
}

/**
 * Obrigatório em ambos os caminhos: JobsService.validatePlan e create.
 * O retorno mantém exatamente a quantidade/ordem das etapas da IA.
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

    const candidateIndices = steps.slice(0, ri).flatMap((s, i) => {
      if (!s || typeof s !== 'object' || !isComposer(s)) return [];
      const provider = String(s.provider ?? defaultProvider);
      if (['local-shell','juntar-videos','gemini-video','arquivos-projeto'].includes(provider)) return [];
      return [i];
    });
    if (!candidateIndices.length) {
      // Alterar o visual de uma cena antiga NÃO pode ser confundido com apenas
      // recodificar o mesmo HTML. O planejador repara essa estrutura uma vez,
      // incluindo a edição da fonte antes do render. A pessoa não precisa
      // escrever comandos nem especificar tecnologias.
      const wantsVisualFix = /corrig|consert|recort|defeit|falha visual|problema (?:na |de )?(?:imagem|pizza|foto|camada)/i.test(objective);
      const visual3d = /3[\s-]*d|webgl/i.test(objective) &&
        /pizzas?|fotos?|imagens?|produtos?|logos?|recort|camadas?/i.test(objective);
      if (wantsVisualFix && visual3d) throw new Error(
        'MOTION_CONTRATO: o usuário pediu corrigir o visual de um vídeo 3D. ' +
        'Só renderizar a composição antiga repetiria o defeito. ' +
        'O plano deve incluir uma etapa produtora que EDITE a fonte em uma NOVA pasta motion ' +
        'com index.html e overlays.json, seguida da etapa local-shell de render. ' +
        'Preserve a fonte e MP4 antigos. Essa decisão é do Nivo, não do usuário.');
      continue; // render de cena antiga SEM pedido de correção visual
    }

    const matchesSource = candidateIndices.filter(i =>
      (String(steps[i].instructions ?? '') + ' ' + String(steps[i].verifyCommand ?? '')).includes(source));
    if (matchesSource.length > 1) continue; // não adivinhar qual IA produz a fonte
    if (!matchesSource.length && candidateIndices.length !== 1) continue;
    const ci = matchesSource[0] ?? candidateIndices[0];
    const compose = steps[ci];
    const text = [
      objective, String(compose.title ?? ''), String(compose.instructions ?? ''),
      String(render.title ?? ''),
    ].join(' ');
    const real3d = /\b3[\s-]*d\b|webgl|malhas?\s+3d|extrud/i.test(text);
    const hasPhotos = /pizzas?|fotografias?|imagens?|produtos?|logomarcas?|logos?|png|webp|assets?|fotos?|recort/i.test(text);
    // Se precisa de geometria 3D real, o HTML mantém a geometria; imagens
    // passam obrigatoriamente para overlay independente. Fotos 2D usam JSON.
    if (real3d && !hasPhotos) continue;
    const mode: MotionMode = real3d ? 'hybrid' : 'scene';
    const marker = '[NIVOO_MOTION_CORE_CONTRACT_V1]';
    if (!String(compose.instructions ?? '').includes(marker)) {
      const requirements = mode === 'scene'
        ? [
            'Entregue motion/' + source.slice(7) + '/scene.json no formato v1 do motor oficial.',
            'Use layers (image, text, shape, neon), z e supportZ para fotos; animações em keys, ritmo em profile/pacing.',
            'NÃO invente implementação de fotografia com WebGL, clones de textura ou placas escuras para simular relevo.',
          ]
        : [
            'Entregue ' + source + '/index.html com as MALHAS WebGL e ' + source + '/overlays.json (scene v1).',
            'Fotografias, pizzas, produtos e logos ficam SOMENTE em overlays.json como camadas RGBA.',
            'NÃO duplique essas fotos no index.html nem inclíne-as para atravessar a tábua/malhas do WebGL.',
            'As imagens locais podem ser PNG/WebP/JPG ou módulos JS base64 legados na pasta motion; o próprio motor as carrega.',
          ];
      compose.instructions = String(compose.instructions ?? '') + '\n\n' +
        marker + ' Contrato técnico aplicado pelo NÚCLEO do Nivo, sem criar etapas:\n' +
        requirements.map(s => '- ' + s).join('\n') +
        '\n- Não execute render de MP4 nesta etapa; a ferramenta local do Nivo faz isso na etapa já prevista.';
    }
    const verify = String(compose.verifyCommand ?? '');
    compose.verifyCommand = [...existingCheck(verify, source),
      'nivoo-conferir-motion ' + source + ' --modo ' + mode].join(' && ');

    const fast = mode === 'hybrid' &&
      /\b(?:aceler|mais r[aá]pid|din[aâ]mic|ritmo (?:mais )?(?:r[aá]pid|aceler)|agiliz)/i.test(objective);
    render.instructions = addRenderFlags(command, mode, fast);
  }
  return steps;
}
