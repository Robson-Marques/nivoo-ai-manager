import { BadRequestException } from '@nestjs/common';

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
    const temEntradasDeMontagem = Array.isArray(opts.cenas) && opts.cenas.length > 0 &&
      typeof opts.arquivo === 'string' && /\.mp4$/i.test(opts.arquivo);
    // Instrução técnica conflitante com os parâmetros de montagem: o contrato
    // vence e o núcleo substitui o método por seu executor oficial.
    if (temEntradasDeMontagem) {
      return {
        ...step,
        provider: 'juntar-videos',
        instructions: 'Montagem de mídia pelo executor interno obrigatório; preservar cenas, locução e trilha.',
        verifyCommand: undefined,
        providerOptions: opts,
      };
    }
    // Só recusa comandos que realmente fazem montagem/exportação.
    // ffprobe, captura visual, geração de trilha independente e
    // nivoo-renderizar-motion são operações distintas.
    const scriptDeMontagem = /(?:^|[\s;&|])(?:python(?:3)?\s+)?(?:[\w./-]*\/)?(?:montar|juntar|mixar|sincronizar)[\w-]*\.py\b/i.test(instr);
    const ffmpegMontagem = /\bffmpeg\b/.test(instr) &&
      (/(?:-filter_complex\b|-c:v\b|-c:a\b|-map\b)/.test(instr) ||
       /(?:midia\/saida\/|out\/)[\w.-]+\.mp4\b/i.test(instr));
    const ferramentaApropriada = /\bnivoo-(?:renderizar-motion|analisar-video|extrair-quadros|conferir-arte)\b/.test(instr);
    if ((scriptDeMontagem || ffmpegMontagem) && !ferramentaApropriada) {
      throw new BadRequestException(
        'A estrutura interna tem prioridade: montagem, mixagem e ajuste de duração de MP4 devem usar o executor juntar-videos. ' +
        'Forneça providerOptions.cenas, arquivo, narracao, trilha e sincronizarVideoComNarracao. ' +
        'Não crie scripts Python ou comandos FFmpeg próprios para substituir o executor.');
    }
    return step;
  });
}
