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
  // Um comando próprio é permitido quando é nome simples e não uma frase.
  if (/^[a-z][a-z0-9_-]*(?:\s+--?[\w-]+(?:=\S+)?)?\s*$/.test(first)) return null;
  const word = first.split(/[\s;|&]+/)[0];
  return `A etapa local-shell recebeu texto em vez de comando Bash: "${first.slice(0, 150)}". ` +
    `O executor é determinístico: use uma chamada CLI real (por exemplo, nivoo-conferir-arte) ou atribua a tarefa de análise à IA; não execute "${word}" no terminal.`;
}
