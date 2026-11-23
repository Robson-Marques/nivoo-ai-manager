import { BadRequestException } from '@nestjs/common';
/**
 * Compatibilidade com planejamento em linguagem natural:
 * uma única cena pode vir como string ou campo "video"/"videoOriginal".
 * Nunca deduzir a fonte a partir do nome do arquivo de SAÍDA;
 * quando ambíguo, exigir escolha explícita em vez de inventar caminho.
 */
export function normalizarCenasDeMontagem(o: any): unknown[] {
  if (!o || typeof o !== 'object') return [];
  if (Array.isArray(o.cenas)) return o.cenas;
  if (typeof o.cenas === 'string' && o.cenas.trim()) return [o.cenas.trim()];
  const entrada = o.videoOriginal ?? o.videoEntrada ?? o.video ?? o.cena;
  if (typeof entrada === 'string' && entrada.trim()) return [entrada.trim()];
  if (entrada && typeof entrada === 'object' && typeof entrada.arquivo === 'string')
    return [entrada.arquivo.trim()];
  return [];
}



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
  const entregaMp4 = /midia\/saida\/[A-Za-z0-9._-]+\.mp4/.test(verify) ||
    /--saida\s+midia\/saida\/[A-Za-z0-9._-]+\.mp4/.test(instr);
  return entregaMp4 && (/^render(?:_|-|$)/.test(key) || /\brenderiz(?:ar|a(?:ção|cao))\b/i.test(title)) &&
    /\b(?:3d|motion|composi(?:ção|cao)|anima(?:ção|cao))\b/i.test(title + ' ' + instr);
}

export function corrigirPlanoRenderizacaoMotion(raw: unknown, defaultProvider: string, objective = ''): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const step = item as Record<string, unknown>;
    const provider = String(step.provider ?? defaultProvider);
    if (!etapaPedeRenderizacaoMotion(step) || provider === 'juntar-videos' || provider === 'gemini-video') return item;
    const instr = String(step.instructions ?? '').trim();
    if (provider === 'local-shell') {
      // Atribuir local-shell sem chamar o renderizador (ex.: comando true)
      // também era capaz de aprovar MP4 anterior com test -s.
      if (!/^nivoo-renderizar-motion\s+motion\/[A-Za-z0-9._/-]+\s+--saida\s+midia\/saida\/[A-Za-z0-9._-]+\.mp4(?:\s|$)/.test(instr)) {
        throw new BadRequestException('Etapa motion local-shell não executa nivoo-renderizar-motion com fonte e destino explícitos. Não basta encontrar um MP4 anterior na conferência.');
      }
      return item;
    }
    const verified = String(step.verifyCommand ?? '');
    const normalized = (instr + ' ' + objective);
    const paths = [...normalized.matchAll(/(?:^|[\s'"(])((?:motion)\/[A-Za-z0-9._/-]+)(?=[\s'")]|$)/g)]
      .map(m => m[1].replace(/\/index\.html$/, ''));
    const source = [...new Set(paths)].length === 1 ? paths[0] : null;
    const targets = [...(instr + ' ' + verified).matchAll(/midia\/saida\/[A-Za-z0-9._-]+\.mp4/g)].map(m => m[0]);
    const target = [...new Set(targets)].length === 1 ? targets[0] : null;
    const seconds = /--segundos\s+(\d+(?:\.\d+)?)/.exec(instr)?.[1] ??
      /(\d+(?:\.\d+)?)\s*(?:s\b|segundos?\b)/i.exec(normalized)?.[1];
    const size = /--tamanho\s+(\d{3,5}x\d{3,5})/.exec(instr)?.[1] ??
      /\b(\d{3,5}x\d{3,5})\b/.exec(normalized)?.[1];

    if (source && target && seconds && size &&
        !source.split('/').includes('..') && Number(seconds) > 0 && Number(seconds) <= 300) {
      const command = `nivoo-renderizar-motion ${source} --saida ${target} --segundos ${seconds} --tamanho ${size}`;
      return { ...step, provider: 'local-shell', instructions: command };
    }
    throw new BadRequestException(
      `Etapa "${String(step.key ?? 'render')}" tenta renderizar MP4 com IA (${provider}), mas a IA não executa terminal. ` +
      'Separe a criação da composição em uma etapa de IA e a renderização em uma etapa local-shell. ' +
      'Informe a fonte REAL motion/<pasta> (com index.html), o --saida midia/saida/<novo-nome>.mp4, ' +
      '--segundos e --tamanho. Não aprove um MP4 antigo com test -s.');
  });
}

/**
 * Dependências físicas de mídia: a montagem não pode começar enquanto a
 * etapa do mesmo job que produz sua cena ainda está renderizando. O planejador
 * nem sempre declara dependsOn, portanto o núcleo resolve pelos caminhos
 * EXATOS dos arquivos, não por semelhança de nome ou texto livre.
 */
export function dependenciasDeMontagemPorArquivo(raw: unknown, defaultProvider: string): unknown {
  if (!Array.isArray(raw)) return raw;
  const etapa = raw as Array<Record<string, unknown>>;
  const saidas = new Map<string, string>();
  for (const s of etapa) {
    if (!s || typeof s !== 'object') continue;
    if (String(s.provider ?? defaultProvider) !== 'local-shell') continue;
    const comando = String(s.instructions ?? '');
    const match = /\bnivoo-renderizar-motion\b[^\n]*?--saida\s+(?:'([^']+)'|"([^"]+)"|([^\s;&|]+))/.exec(comando);
    const arquivo = match?.[1] ?? match?.[2] ?? match?.[3];
    if (!arquivo || !/^midia\/saida\/[A-Za-z0-9._-]+\.mp4$/.test(arquivo)) continue;
    const anterior = saidas.get(arquivo);
    if (anterior && anterior !== s.key) {
      throw new BadRequestException('Duas etapas tentam produzir o mesmo MP4 ' + arquivo + '. Use saídas distintas para não sobrescrever versões anteriores.');
    }
    saidas.set(arquivo, String(s.key));
  }
  return etapa.map((s) => {
    if (!s || typeof s !== 'object' || String(s.provider ?? defaultProvider) !== 'juntar-videos') return s;
    const entradas = normalizarCenasDeMontagem(s.providerOptions);
    const originais = Array.isArray(s.dependsOn) ? s.dependsOn.map(String) : [];
    const novas = entradas.flatMap((v) => {
      const arquivo = typeof v === 'string' ? v : (v && typeof v === 'object' ? String((v as { arquivo?: unknown }).arquivo ?? '') : '');
      const produtor = saidas.get(arquivo);
      return produtor && produtor !== String(s.key) ? [produtor] : [];
    });
    if (!novas.some((key) => !originais.includes(key))) return s;
    return { ...s, dependsOn: [...new Set([...originais, ...novas])] };
  });
}
