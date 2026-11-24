import { BadRequestException } from '@nestjs/common';
import { hasMotionCommand,readMotionInvocation,motionFpsFromText } from './motion/command';
/**
 * Compatibilidade com planejamento em linguagem natural:
 * uma única cena pode vir como string ou campo "video"/"videoOriginal".
 * Nunca deduzir a fonte a partir do nome do arquivo de SAÍDA;
 * quando ambíguo, exigir escolha explícita em vez de inventar caminho.
 */
export { normalizarCenasDeMontagem } from './workflow/media-dependencies';
import { normalizarCenasDeMontagem } from './workflow/media-dependencies';



/**
 * Núcleo decide o executor: pedidos de montagem de vídeo não podem ser
 * implementados por scripts arbitrários só porque a IA assim planejou.
 *
 * Não altera etapas de geração de composição visual nem de inspeção (ffprobe).
 * A exceção para sincronismo visual avançado exige um executor próprio aprovado,
 * não um comando improvisado de shell.
 */
export function aplicarPrioridadeDosExecutores(raw: unknown, defaultProvider: string): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map((step: any) => {
    if (!step || typeof step !== 'object') return step;
    const provider = String(step.provider ?? defaultProvider);
    if (provider !== 'local-shell') return step;
    const instr = String(step.instructions ?? '');
    const opts = step.providerOptions ?? {};
    // Explicit Motion render is never a join, even if the planner included obsolete assembly options.
    if(hasMotionCommand(instr))return step;
    const cenas = normalizarCenasDeMontagem(opts);
    const temEntradasDeMontagem = cenas.length > 0 &&
      typeof opts.arquivo === 'string' && /\.mp4$/i.test(opts.arquivo);
    // Instrução técnica conflitante com os parâmetros de montagem: o contrato
    // vence e o núcleo substitui o método por seu executor oficial.
    if (temEntradasDeMontagem) {
      return {
        ...step,
        provider: 'juntar-videos',
        instructions: 'Montagem de mídia pelo executor interno obrigatório; preservar cenas, locução e trilha.',
        verifyCommand: undefined,
        providerOptions: { ...opts, cenas },
      };
    }
    // Só recusa comandos que realmente fazem montagem/exportação.
    // ffprobe, captura visual, geração de trilha independente e
    // nivoo-renderizar-motion são operações distintas.
    const scriptDeMontagem = /(?:^|[\s;&|])(?:python(?:3)?\s+)?(?:[\w./-]*\/)?(?:montar|juntar|mixar|sincronizar)[\w-]*\.py\b/i.test(instr);
    const ffmpegMontagem = /\bffmpeg\b/.test(instr) &&
      (/(?:-filter_complex\b|-c:v\b|-c:a\b|-map\b)/.test(instr) ||
       /(?:midia\/saida\/|out\/)[\w.-]+\.mp4\b/i.test(instr));
    // Presença de ferramenta oficial em OUTRA parte da instrução não
    // autoriza um script de montagem improvisado na mesma etapa.
    if (scriptDeMontagem || ffmpegMontagem) {
      throw new BadRequestException(
        'A estrutura interna tem prioridade: montagem, mixagem e ajuste de duração de MP4 devem usar o executor juntar-videos. ' +
        'Forneça providerOptions.cenas, arquivo, narracao, trilha e sincronizarVideoComNarracao. ' +
        'Não crie scripts Python ou comandos FFmpeg próprios para substituir o executor.');
    }
    return step;
  });
}

/**
 * As instruções do executor local são código Bash, nunca linguagem natural.
 * Bloqueia planos com prosa acidental antes do job existir; permite scripts
 * de projeto e comandos locais explícitos, sem assumir que o arquivo exista.
 * Checagem adicional no executor cobre jobs antigos já persistidos.
 */
export function erroDeComandoLocal(instructions: string): string | null {
  const lines = instructions.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  if (!lines.length) return 'comando Bash vazio';
  const first = lines[0].replace(/^(?:sudo\s+|env\s+)+/, '');
  // Estruturas e comandos do shell, variáveis e scripts com caminho explícito.
  if (/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s*)+(?:$|\S)/.test(first)) return null;
  if (/^(?:\.|\/|~\/)[^\s]*?(?:\s|$)/.test(first)) return null;
  if (/^(?:if|for|while|until|case|function|\{|\}|\(|\)|then|else|elif|fi|do|done|esac|set|export|unset|source|eval|exec|trap|cd|pwd|echo|printf|test|\[|\[\[|:|true|false|read|local|return|exit|wait|shift|umask|command|type|hash|alias|unalias|declare|readonly|pushd|popd|dirs|mapfile|readarray|shopt|ulimit|jobs|kill|disown|time|coproc|select)\b/.test(first)) return null;
  if (/^(?:nivoo(?:-[\w-]+)?|node|npm|npx|pnpm|yarn|bun|python(?:3(?:\.\d+)?)?|bash|sh|git|ffmpeg|ffprobe|cat|ls|find|grep|rg|sed|awk|cut|sort|uniq|head|tail|wc|jq|tee|mkdir|cp|mv|rm|touch|chmod|chown|ln|stat|file|sha256sum|date|sleep|curl|wget|tar|unzip|zip|docker|systemctl|journalctl|psql|sqlite3|java|make|cmake|gcc|g\+\+|tsc|vite|jest|pytest|playwright|convert|magick|ffplay|identify|ffmpeg-normalize|bc|xargs|du|df|dd|timeout|mktemp|realpath|dirname|basename|readlink|diff|cmp|patch|which|printenv|envsubst|perl|ruby|php|go|cargo|rustc|dotnet|mvn|gradle|ssh|scp|rsync)\b/.test(first)) return null;
  // Binário não reconhecido não é autorização para executar uma palavra da conversa.
  // Ferramentas próprias devem ser chamadas por caminho explícito (./scripts/...)
  // ou cadastradas no núcleo, em vez de inferidas de texto livre.
  const word = first.split(/[\s;|&]+/)[0];
  return `A etapa local-shell recebeu texto em vez de comando Bash: "${first.slice(0, 150)}". ` +
    `O executor é determinístico: use uma chamada CLI real (por exemplo, nivoo-conferir-arte) ou atribua a tarefa de análise à IA; não execute "${word}" no terminal.`;
}

/**
 * Etapas que realmente ENTREGAM MP4 motion são execução local, não sessão de
 * chat. A IA pode escrever a composição em outra etapa, mas não fingir que
 * executou um comando em bloco markdown e aprovar um MP4 de trabalho anterior.
 *
 * Converte somente quando fonte, destino, duração e resolução são explícitos;
 * caso contrário exige plano concreto. Não adivinha a fonte pelos nomes do MP4.
 */
export function etapaPedeRenderizacaoMotion(step: { key?: unknown; title?: unknown; verifyCommand?: unknown; instructions?: unknown }): boolean {
  const key = String(step.key ?? '').toLowerCase();
  const title = String(step.title ?? '').toLowerCase();
  const verify = String(step.verifyCommand ?? '');
  const instr = String(step.instructions ?? '');
  // A etapa corretiva criada pelo worker cita o comando que FALHOU,
  // mas entrega um relatório de reparo, nunca o MP4. Não confundir
  // a citação com uma solicitação de execução pela IA.
  if (/^reparo-[a-z0-9_-]+-\d+$/.test(key) &&
      instr.startsWith('REPARO AUTOMÁTICO DA ETAPA DO MESMO TRABALHO') &&
      verify.trim() === "test -s 'out/reparos/" + key + ".md'") return false;
  const entregaMp4 = /midia\/saida\/[A-Za-z0-9._-]+\.mp4/.test(verify) ||
    /--saida\s+midia\/saida\/[A-Za-z0-9._-]+\.mp4/.test(instr);
  return entregaMp4 && (/^render(?:_|-|$)/.test(key) || /\brenderiz(?:ar|a(?:ção|cao))\b/i.test(title)) &&
    /\b(?:3d|motion|composi(?:ção|cao)|anima(?:ção|cao))\b/i.test(title + ' ' + instr);
}

/**
 * Converte o pedido de render em uma chamada real do executor local.
 * A forma textual do Bash não é um contrato: comandos com set -e, paths
 * absolutos do binário, flags em outra ordem, e aspas continuam válidos.
 * Nunca considera "test -s MP4" como evidência de execução.
 */
export function corrigirPlanoRenderizacaoMotion(raw: unknown, defaultProvider: string, objective = ''): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const step = item as Record<string, unknown>;
    const provider = String(step.provider ?? defaultProvider);
    if(provider==='gemini-video'||provider==='nvidia-media')return item;

    const instr = String(step.instructions ?? '').trim();
    // Comando de render real, inclusive depois de "set -e;" ou em linha
    // seguinte. A conferência técnica do MP4 é independente disso.
    const comandoReal = hasMotionCommand(instr);
    if (provider === 'local-shell' && comandoReal) return item;
    if(comandoReal&&provider==='juntar-videos'&&readMotionInvocation(instr)?.source)return {...step,provider:'local-shell'};

    const opts = step.providerOptions && typeof step.providerOptions === 'object' && !Array.isArray(step.providerOptions)
      ? step.providerOptions as Record<string, unknown> : {};
    const texto = instr + ' ' + objective;
    const fps=motionFpsFromText(String(step.title??'')+' '+instr)??motionFpsFromText(objective);
    const motionSource=typeof (opts.fonte??opts.entrada??opts.source??opts.sourcePath)==='string'&&/^motion\//.test(String(opts.fonte??opts.entrada??opts.source??opts.sourcePath));
    const wrongJoin=provider==='juntar-videos'&&!normalizarCenasDeMontagem(opts).length&&!!fps&&(motionSource||/\bmotion\/[A-Za-z0-9._/-]+/.test(instr));
    if(!wrongJoin&&(!etapaPedeRenderizacaoMotion(step)||provider==='juntar-videos'))return item;
    const escolher = (items: string[]): string | null => {
      const unicos = [...new Set(items.filter(Boolean))];
      return unicos.length === 1 ? unicos[0] : null;
    };
    const caminhoFonte = (value: unknown): string => {
      const text = String(value ?? '').trim().replace(/^['"]|['"]$/g, '');
      return /^motion\/[A-Za-z0-9._/-]+$/.test(text) && !text.split('/').includes('..') ? text : '';
    };
    const fontesInstrucao = [...instr.matchAll(/\bmotion\/[A-Za-z0-9._/-]+/g)]
      .map(m => caminhoFonte(m[0]));
    const fontesObjetivo = [...objective.matchAll(/\bmotion\/[A-Za-z0-9._/-]+/g)]
      .map(m => caminhoFonte(m[0]));
    const source = escolher([
      caminhoFonte(opts.fonte ?? opts.entrada ?? opts.source ?? opts.sourcePath),
      ...fontesInstrucao,
    ]) ?? escolher(fontesObjetivo);

    const saida = /--saida\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/.exec(instr);
    const saidaDeclarada = saida?.[1] ?? saida?.[2] ?? saida?.[3] ??
      String(opts.saida ?? opts.arquivo ?? opts.output ?? '');
    const saidaValida = (v: string) => /^midia\/saida\/[A-Za-z0-9._-]+\.mp4$/.test(v) ? v : '';
    const alvosInstrucao = [...instr.matchAll(/midia\/saida\/[A-Za-z0-9._-]+\.mp4/g)].map(m => m[0]);
    const alvosConferencia = [...String(step.verifyCommand ?? '').matchAll(/midia\/saida\/[A-Za-z0-9._-]+\.mp4/g)]
      .map(m => m[0]);
    const target = saidaValida(saidaDeclarada) ||
      escolher(alvosInstrucao.map(saidaValida)) ||
      escolher(alvosConferencia.map(saidaValida));

    const segundosExplicitos = /--segundos\s+(\d+(?:\.\d+)?)/.exec(instr)?.[1] ??
      String(opts.segundos ?? opts.duracao ?? '');
    const seconds = segundosExplicitos || /(\d+(?:\.\d+)?)\s*(?:s\b|segundos?\b)/i.exec(texto)?.[1] || '';
    const tamanhoExplicito = /--tamanho\s+(\d{3,5}[x×]\d{3,5})/.exec(instr)?.[1] ??
      String(opts.tamanho ?? opts.resolucao ?? '');
    const size = (tamanhoExplicito || /\b(\d{3,5}\s*[x×]\s*\d{3,5})\b/i.exec(texto)?.[1] || '')
      .replace(/\s/g, '').replace('×', 'x');

    if (source && target && Number(seconds) > 0 && Number(seconds) <= 300 &&
        /^\d{3,5}x\d{3,5}$/.test(size)) {
      const command = 'nivoo-renderizar-motion ' + source +
        ' --saida ' + target + ' --segundos ' + seconds + ' --tamanho ' + size + (fps?' --fps '+fps:'');
      return { ...step, provider: 'local-shell', instructions: command };
    }

    const falta = [
      !source ? 'fonte motion/<pasta>' : '',
      !target ? 'destino midia/saida/<nome>.mp4' : '',
      !(Number(seconds) > 0 && Number(seconds) <= 300) ? 'duração em segundos' : '',
      !/^\d{3,5}x\d{3,5}$/.test(size) ? 'resolução' : '',
    ].filter(Boolean).join(', ');
    throw new BadRequestException(
      'A etapa ' + String(step.key ?? 'render') + ' foi atribuída a ' + provider +
      ', mas ainda faltam dados para criar o comando de renderização: ' + falta +
      '. O Nivoo deve recuperar esses dados da composição existente e do catálogo de arquivos, ' +
      'sem pedir ao usuário um comando Bash. Não é permitido aprovar MP4 anterior como renderização nova.');
  });
}

/**
 * Dependências físicas de mídia: a montagem não pode começar enquanto a
 * etapa do mesmo job que produz sua cena ainda está renderizando. O planejador
 * nem sempre declara dependsOn, portanto o núcleo resolve pelos caminhos
 * EXATOS dos arquivos, não por semelhança de nome ou texto livre.
 */
export { dependenciasDeMontagemPorArquivo } from './workflow/media-dependencies';
