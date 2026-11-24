/**
 * Conexão real entre o plano de trabalho e o compositor oficial.
 *
 * Antes, scene.json/overlays.json eram só sugestões no prompt; a IA podia
 * devolver outro HTML e o executor gastaria 625 quadros com geometria errada.
 *
 * Aqui o NÚCLEO recomenda o formato na etapa autora e preserva o
 * render oficial. Não acrescenta revisores, testes finais nem etapas.
 * Renderizações de composições antigas SEM etapa produtora seguem compatíveis.
 */

// O código do motor é a fonte do contrato. O caminho é o mesmo em
// src/jobs e dist/jobs; bin já acompanha a instalação do backend.
const { motionAuthorContract } = require('../../bin/motion-scene-core') as {
  motionAuthorContract: () => string;
};

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
  return (/compos|compor|cri(ar|a[çc][aã]o)|produz|desenh|animar|anima[çc][aã]o|motion|3d/i.test(title) ||
      /\bmotion\/[A-Za-z0-9._/-]+\/(?:index\.html|scene\.json|overlays\.json)\b/i.test(instr)) &&
    !/revis|auditor|confer|verific|valid|aprov/i.test(title) &&
    !/\bnivoo-renderizar-motion\b/.test(instr);
}

/**
 * "sem geometria 3D" e "não quero WebGL" NÃO solicitam geometria 3D.
 * A classificação considera o briefing da pessoa, nunca a terminologia
 * técnica que o próprio Nivo injetou na validação anterior do plano.
 */
export function pedeGeometria3D(texto: string): boolean {
  const limpo = texto
    .replace(/\b(?:sem|dispensar|dispensa|dispensando|evitar|evite|evitando)\s+(?:(?:qualquer|nenhuma?|uma?|de|geometria|malhas?|objetos?|efeitos?|visual|real|em)\s+){0,5}(?:3[\s-]*d|webgl)\b/gi, ' ')
    .replace(/\bn[aã]o\s+(?:quero|queremos|preciso|precisamos|usar|utilizar|inclua?|incluir|faça|fazer|criar|crie|tem|ter|tenha)\s+(?:(?:de|qualquer|nenhuma?|uma?|geometria|malhas?|objetos?|efeitos?|visual|real|em)\s+){0,5}(?:3[\s-]*d|webgl)\b/gi, ' ');
  return /\b3[\s-]*d\b|\bwebgl\b|\bextrud(?:ado|ada|idos?|idas?|ir|a(?:ç[aã]o|s))?\b/i.test(limpo);
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
    const marker = '[NIVOO_MOTION_CORE_CONTRACT_V1]';
    // Na segunda passagem (validatePlan→create) ignorar instruções que o
    // próprio Nivo acrescentou, para não inferir WebGL do texto "NÃO use WebGL".
    const original = String(compose.instructions ?? '').split('\n\n' + marker)[0];
    const text = [
      objective, String(compose.title ?? ''), original, String(render.title ?? ''),
    ].join(' ');
    const real3d = pedeGeometria3D(text);
    const hasPhotos = /pizzas?|fotografias?|imagens?|produtos?|logomarcas?|logos?|png|webp|assets?|fotos?|recort/i.test(text);
    // Se precisa de geometria 3D real, o HTML mantém a geometria; imagens
    // passam obrigatoriamente para overlay independente. Fotos 2D usam JSON.
    if (real3d && !hasPhotos) continue;
    const mode: MotionMode = real3d ? 'hybrid' : 'scene';
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
            'Remova do HTML inclusive os imports/referências aos arquivos de imagem usados no overlay, para não duplicar visualmente as fotografias.',
            'A duração overlays.json.duration deve acompanhar a duração ORIGINAL do relógio WebGL; diferenças são avisadas, não usadas para bloquear a entrega.',
            'As imagens locais podem ser PNG/WebP/JPG ou módulos JS base64 legados na pasta motion; o próprio motor as carrega.',
          ];
      compose.instructions = String(compose.instructions ?? '') + '\n\n' +
        marker + ' Contrato técnico aplicado pelo NÚCLEO do Nivo, sem criar etapas:\n' +
        requirements.map(s => '- ' + s).join('\n') +
        '\n' + motionAuthorContract() +
        '\n- Não execute render de MP4 nesta etapa; a ferramenta local do Nivo faz isso na etapa já prevista.';
    }
    // NÃO transformar o trabalho feito e NÃO acrescentar testes extras.
    // O próprio renderer seleciona o motor e respeita os movimentos criados
    // pela IA, sem acelerar DUAS vezes o néon após a edição da composição.
    // Critérios de entrega originais permanecem intocados.
  }
  return steps;
}
