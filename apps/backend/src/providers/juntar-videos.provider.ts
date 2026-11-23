import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { minimalEnv, runProcess } from '../common/exec';
import { sha256File } from '../common/hash';
import { appConfig } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { resolveInside } from '../common/path-guard';
import { listarVideos } from '../projects/midia';
import { escolherTrilha, FonteTrilha } from './audio-asset-recovery';
import { GeminiVideoProvider } from './gemini-video.provider';
import { AiProvider, ExecutionRequest, ExecutionResult, ProviderStatus } from './provider.interface';
import { aplicarPronuncias, KokoroTtsError, KokoroTtsService, Pronuncias, roteiroEmUmaFala, frasesDeLocucao, velocidadePadraoLocucao, RitmoLocucao } from './kokoro-tts.service';
import { MotorNarracao, VOZ_PADRAO, VOZ_PADRAO_GEMINI, vozConhecida } from './vozes';

type Trilha = { arquivo?: string; descricao?: string; volume?: number };

/** Mensagem operacional completa: não esconder a falha atrás de "exit 1". */
function explicarFalhaMidia(etapa: string, r: { exitCode: number | null; stderr: string; stdout: string; timedOut?: boolean; aborted?: boolean; spawnError?: string }): string {
  const detalhes = [r.spawnError, r.stderr?.trim(), r.stdout?.trim()].filter(Boolean).join(' | ').slice(-2800);
  const estado = r.aborted ? 'interrompido' : r.timedOut ? 'tempo excedido' : `exit ${r.exitCode ?? 'desconhecido'}`;
  return `${etapa} (${estado}). ${detalhes || 'FFmpeg não retornou detalhes; confira acesso aos arquivos, espaço livre, permissões e logs do worker.'}`;
}
type TrechoLocucao = { texto: string; intencao?: 'chamada' | 'destaque' | 'pergunta' | 'natural'; velocidade?: number; pausaAposMs?: number };
function textoLocucao(t: TrechoLocucao): string {
  const frase = t.texto.trim();
  return t.intencao === 'pergunta' ? frase.replace(/[!?\.]+$/, '') + '?' : 
    (t.intencao === 'chamada' || t.intencao === 'destaque') ? frase.replace(/[!?\.]+$/, '') + '!' : frase;
}
type Narracao = { trechos?: TrechoLocucao[]; texto?: string; arquivo?: string; voz?: string; motor?: MotorNarracao; velocidade?: number; ritmo?: RitmoLocucao; pronuncias?: Pronuncias; volumeFundoSobVoz?: number };

/** Modelos de música do Google (Lyria), do mais completo ao clipe de 30 s. */
const MODELOS_MUSICA = ['lyria-3-pro-preview', 'lyria-3-clip-preview'];
const MODELOS_VOZ = ['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'];

/**
 * Junta as cenas geradas (Omni gera clipes curtos) num vídeo só, na ordem do plano, com o ffmpeg do servidor.
 * Sem IA e sem custo. Cada cena é padronizada (mesmo tamanho da primeira, 24 quadros/s, H.264 + AAC; cena
 * sem som ganha silêncio) e depois as cenas são emendadas sem perder qualidade de novo. As cenas continuam
 * na pasta (dá para trocar uma e juntar de novo).
 */
@Injectable()
export class JuntarVideosProvider implements AiProvider {
  readonly id = 'juntar-videos';
  readonly label = 'Juntar cenas em um vídeo (sistema)';
  readonly kind = 'executor' as const;

  constructor(
    private readonly video: GeminiVideoProvider,
    private readonly kokoro: KokoroTtsService,
    private readonly prisma: PrismaService,
  ) {}

  async checkAvailability(): Promise<ProviderStatus> {
    const r = await runProcess('ffmpeg', ['-hide_banner', '-version'], { cwd: os.tmpdir(), env: minimalEnv(), timeoutMs: 15_000 });
    const ok = !r.spawnError && r.exitCode === 0;
    return {
      id: this.id, label: this.label, kind: this.kind, available: ok, installed: ok, authenticated: true, limits: {},
      capabilities: ['juntar-videos'], errors: ok ? [] : ['ffmpeg não está instalado no servidor (apt install ffmpeg)'],
      checkedAt: new Date().toISOString(), isAi: false,
    };
  }

  /** Resolve um caminho do projeto: `midia/...` vai para a pasta de mídia durável (fora do git); o resto, no worktree. */
  private resolver(req: ExecutionRequest, rel: string): string {
    if (/^midia\//.test(rel) && req.projectMediaDir) return resolveInside(req.projectMediaDir, rel.replace(/^midia\//, ''));
    return resolveInside(req.cwd, rel);
  }

  /**
   * Mídia anterior já armazenada como artefato do projeto pode ser usada
   * diretamente, sem pedir upload nem copiar arquivos para midia/.
   * Exige correspondência inequívoca; nunca escolhe um áudio diferente
   * só porque foi gerado por último ou porque o pedido disse "aprovado".
   */
  private async resolverEntrada(req: ExecutionRequest, rel: string, uso: 'geral' | 'trilha' = 'geral'): Promise<string> {
    // IDs do catálogo são contratos imutáveis: não procurar nomes semelhantes.
    const exato = /^artefato\/([0-9a-f]{8}-[0-9a-f-]{27,})\/([^/]+)$/i.exec(rel);
    if (exato) {
      const job = await this.prisma.job.findUnique({ where: { id: req.jobId }, select: { projectId: true } });
      if (!job) throw new Error('Trabalho não localizado ao resolver artefato');
      const a = await this.prisma.artifact.findFirst({
        where: { id: exato[1], projectId: job.projectId, kind: 'FILE' },
        select: { name: true, storagePath: true },
      });
      if (!a || path.posix.basename(a.name) !== exato[2])
        throw new Error(`Mídia do catálogo não encontrada ou identificador inválido: ${rel}`);
      const file = resolveInside(appConfig().artifactsRoot, a.storagePath);
      if (!fs.existsSync(file) || !fs.statSync(file).size)
        throw new Error(`Arquivo do catálogo indisponível: ${a.name}`);
      req.onLog(`Mídia selecionada pelo ID do catálogo: ${a.name}`);
      return file;
    }
    const local = this.resolver(req, rel);
    if (fs.existsSync(local) && fs.statSync(local).isFile() && fs.statSync(local).size > 0) return local;

    const nome = path.posix.basename(rel);
    if (!/^[\w. -]+\.(mp4|mov|webm|mp3|wav|m4a|aac|ogg)$/i.test(nome))
      throw new Error(`Arquivo de mídia não encontrado ou nome inválido: ${rel}`);
    const job = await this.prisma.job.findUnique({ where: { id: req.jobId }, select: { projectId: true } });
    if (!job) throw new Error(`Trabalho não localizado ao recuperar mídia: ${req.jobId}`);

    const candidatos = await this.prisma.artifact.findMany({
      where: {
        projectId: job.projectId,
        kind: 'FILE',
        OR: [
          { name: rel },
          { name: nome },
          { name: { endsWith: '/' + nome } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { name: true, storagePath: true, sha256: true, sizeBytes: true, jobId: true },
    });
    // Correspondência do caminho completo é mais forte que apenas o basename.
    const exatos = candidatos.filter(a => a.name === rel);
    const disponiveis = exatos.length ? exatos : candidatos;
    const distintos = [...new Map(disponiveis.map(a => [a.sha256, a])).values()];
    if (!distintos.length) {
      if (uso === 'trilha') return this.recuperarTrilha(req, rel, job.projectId);
      throw new Error(
        `Mídia ausente no projeto: ${rel}. Não há arquivo físico nem artefato com esse nome. ` +
        'Consulte a lista de resultados e use o nome exato do arquivo existente.'
      );
    }
    if (distintos.length > 1) throw new Error(
      `Há ${distintos.length} versões diferentes para ${rel} nos resultados. ` +
      `A escolha é ambígua: ${disponiveis.slice(0, 6).map(a => `${a.jobId?.slice(0, 8) ?? '-'}:${a.name}`).join(', ')}. ` +
      'Escolha o artefato correto; o Nivoo não substituirá a locução aprovada automaticamente.'
    );
    const arquivo = resolveInside(appConfig().artifactsRoot, distintos[0].storagePath);
    if (!fs.existsSync(arquivo) || fs.statSync(arquivo).size === 0)
      throw new Error(`Artefato registrado, mas não disponível no armazenamento: ${distintos[0].name}`);
    req.onLog(`Mídia reaproveitada dos resultados do trabalho ${distintos[0].jobId?.slice(0, 8) ?? '-'}: ${distintos[0].name}`);
    return arquivo;
  }

  /**
   * Quando o plano erra o nome do MP3, procurar PRIMEIRO os áudios reais
   * deste projeto: uploads com o nome original (o disco tem UUID) e
   * artefatos FILE de trabalhos anteriores. Sem usar som de outro projeto.
   * Não gerar música paga, não escolher automaticamente se for ambíguo.
   */
  private async recuperarTrilha(req: ExecutionRequest, rel: string, projectId: string): Promise<string> {
    const fontes: FonteTrilha[] = [];
    if (req.projectMediaDir) {
      for (const m of listarVideos(req.projectMediaDir)) {
        if (m.pasta !== 'entrada' || !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(m.nome)) continue;
        const abs = this.resolver(req, m.caminho);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile() && fs.statSync(abs).size > 0) {
          fontes.push({ nome: m.nome, arquivo: abs, origem: 'midia-projeto', sha256: await sha256File(abs) });
        }
      }
    }
    const arts = await this.prisma.artifact.findMany({
      where: { projectId, kind: 'FILE' },
      orderBy: { createdAt: 'desc' },
      take: 1500,
      select: { name: true, storagePath: true, sha256: true },
    });
    for (const a of arts) {
      if (!/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(a.name)) continue;
      let abs: string;
      try { abs = resolveInside(appConfig().artifactsRoot, a.storagePath); } catch { continue; }
      if (fs.existsSync(abs) && fs.statSync(abs).isFile() && fs.statSync(abs).size > 0) {
        fontes.push({ nome: a.name, arquivo: abs, origem: 'artefato', sha256: a.sha256 });
      }
    }
    const resultado = escolherTrilha(rel, fontes);
    if (resultado.caminho && resultado.nome) {
      req.onLog('Montagem recuperada automaticamente: trilha "' + rel + '" → "' +
        resultado.nome + '" (fonte ' + resultado.origem + ', ' + resultado.motivo + '). Não refiz o vídeo 3D.');
      return resultado.caminho;
    }
    const sugestoes = resultado.alternativas.length
      ? ' Áudios existentes neste projeto: ' + resultado.alternativas.join('; ') + '.'
      : ' Nenhuma trilha de áudio física foi encontrada neste projeto.';
    if (resultado.motivo === 'ambiguo') {
      throw new Error('TRILHA_AMBIGUA: Não é seguro escolher automaticamente a trilha "' + rel +
        '".' + sugestoes + ' Selecione a gravação correta na biblioteca e retome apenas a montagem.');
    }
    throw new Error('TRILHA_NAO_LOCALIZADA: O plano apontou "' + rel +
      '" mas esse áudio não existe neste projeto.' + sugestoes +
      ' Não vou trocar por outro som, inventar mídia ou contratar Lyria sem autorização. ' +
      'O vídeo 3D mudo já renderizado será preservado. Envie ou identifique a trilha correta e retome a montagem.');
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const o = (req.options ?? {}) as { cenas?: string[]; arquivo?: string; legendas?: string[]; transicoes?: string[]; trilha?: Trilha; volumeCenas?: number; cortes?: Array<{ inicio?: number; fim?: number; velocidade?: number } | null>; narracao?: Narracao; sincronizarVideoComNarracao?: boolean };
    const cenas = o.cenas ?? [];
    if (cenas.length < 1 || !o.arquivo) return { exitCode: 1, output: '', error: 'etapa sem cenas ou sem o nome do vídeo final' };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-juntar-'));
    const ff = (args: string[], timeoutMs = 600_000) => runProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: tmp, env: minimalEnv(), timeoutMs, signal: req.signal });
    const probe = (arq: string, args: string[]) => runProcess('ffprobe', ['-v', 'error', ...args, arq], { cwd: tmp, env: minimalEnv(), timeoutMs: 60_000 });
    try {
      // Validar ENTRADAS DE ÁUDIO antes de copiar/processar vídeos. Se o
      // plano errou o nome, a recuperação do catálogo ocorre aqui, sem
      // desperdiçar uma nova renderização ou abrir sessão paga da IA.
      const trilhaResolvida = o.trilha?.arquivo
        ? await this.resolverEntrada(req, o.trilha.arquivo, 'trilha') : null;
      const narracaoResolvida = o.narracao?.arquivo
        ? await this.resolverEntrada(req, o.narracao.arquivo) : null;
      const entradas: string[] = [];
      for (const c of cenas) {
        const abs = await this.resolverEntrada(req, c);
        entradas.push(abs);
      }
      // Tamanho do vídeo final = o da primeira cena (as outras se ajustam, com faixa se a proporção for outra).
      const dim = await probe(entradas[0], ['-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x']);
      if (dim.spawnError) return { exitCode: 1, output: '', error: 'ffmpeg não está instalado no servidor (apt install ffmpeg)', resourceUnavailable: true };
      const [w, h] = dim.stdout.trim().split('x').map(Number);
      if (!w || !h) return { exitCode: 1, output: '', error: `não consegui ler o vídeo ${cenas[0]}` };
      const W = w - (w % 2);
      const H = h - (h % 2);
      req.onLog(`Juntando ${cenas.length} cena(s) em ${o.arquivo} (${W}x${H})`);
      const partes: string[] = [];
      for (let i = 0; i < entradas.length; i++) {
        if (req.signal.aborted) return { exitCode: 1, output: '', error: 'interrompido', interrupted: true };
        const temSom = (await probe(entradas[i], ['-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0'])).stdout.trim() !== '';
        const parte = path.join(tmp, `parte-${String(i).padStart(3, '0')}.mp4`);
        // Recorte (cortar início/fim) e velocidade deste clipe, se o plano pediu. Tudo reencoda igual; sem custo.
        const corte = o.cortes?.[i] ?? null;
        // Um vídeo já aprovado é reutilizado sem reencode desnecessário.
        // Só a sincronização global e a mixagem finais irão processá-lo.
        if (entradas.length === 1 && !corte) {
          fs.copyFileSync(entradas[i], parte);
          partes.push(parte);
          req.onLog(`Vídeo aprovado reaproveitado sem regenerar nem recodificar: ${cenas[i]}`);
          continue;
        }
        const ini = Number.isFinite(corte?.inicio) && (corte!.inicio as number) > 0 ? Number(corte!.inicio) : 0;
        const fim = Number.isFinite(corte?.fim) && (corte!.fim as number) > ini ? Number(corte!.fim) : null;
        const vel = Number.isFinite(corte?.velocidade) && (corte!.velocidade as number) > 0 ? Number(corte!.velocidade) : 1;
        const corteIn = ini > 0 ? ['-ss', ini.toFixed(3)] : [];
        const corteDur = fim !== null ? ['-t', (fim - ini).toFixed(3)] : [];
        const vf = [`scale=${W}:${H}:force_original_aspect_ratio=decrease`, `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`, 'setsar=1', ...(vel !== 1 ? [`setpts=PTS/${vel}`] : []), 'fps=24', 'format=yuv420p'].join(',');
        const af = vel !== 1 ? ['-af', filtroVelocidadeAudio(vel)] : [];
        const args = temSom
          ? [...corteIn, '-i', entradas[i], ...corteDur, '-map', '0:v:0', '-map', '0:a:0']
          : [...corteIn, '-i', entradas[i], ...corteDur, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-map', '0:v:0', '-map', '1:a:0', '-shortest'];
        const r = await ff([...args, '-vf', vf, ...af, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', parte]);
        if (r.exitCode !== 0) {
          if (req.signal.aborted) return { exitCode: 1, output: '', error: 'interrompido', interrupted: true };
          return { exitCode: 1, output: '', error: explicarFalhaMidia(`Preparação do vídeo ${cenas[i]}`, r) };
        }
        partes.push(parte);
        req.onLog(`cena ${i + 1}/${cenas.length} pronta: ${cenas[i]}`);
      }
      const saida = path.join(tmp, 'final.mp4');
      // Transição suave entre as cenas (fusão de imagem e de som), em vez do corte seco que deixava trancos e
      // micro-pausas no áudio. Cena curta demais para a fusão: emenda simples.
      const duracoes: number[] = [];
      for (const p of partes) duracoes.push(Number((await probe(p, ['-show_entries', 'format=duration', '-of', 'csv=p=0'])).stdout.trim()) || 0);
      const T = Number(process.env.NIVOO_VIDEO_TRANSICAO_SEG ?? 0.5);
      // Transição de cada emenda (da cena i para a i+1): a escolhida no plano, ou fade; "corte" = quase instantânea.
      const estilos = cenas.slice(1).map((_, i) => o.transicoes?.[i] ?? 'fade');
      const durT = estilos.map((e) => (e === 'corte' ? 0.04 : T));
      // Início de cada cena no vídeo final (para as legendas): sem fusão, a soma das anteriores.
      let inicios = duracoes.map((_, i) => duracoes.slice(0, i).reduce((x, y) => x + y, 0));
      let r: Awaited<ReturnType<typeof ff>> | null = null;
      if (partes.length > 1 && T > 0 && duracoes.every((d, i) => d > (durT[i - 1] ?? 0) + (durT[i] ?? 0))) {
        const filtros: string[] = [];
        let v = '0:v';
        let a = '0:a';
        let acumulado = duracoes[0];
        const com = [0];
        for (let i = 1; i < partes.length; i++) {
          const d = durT[i - 1];
          const offset = acumulado - d;
          com.push(offset);
          filtros.push(`[${v}][${i}:v]xfade=transition=${estilos[i - 1] === 'corte' ? 'fade' : estilos[i - 1]}:duration=${d}:offset=${offset.toFixed(3)}[v${i}]`);
          filtros.push(`[${a}][${i}:a]acrossfade=d=${d}:c1=tri:c2=tri[a${i}]`);
          v = `v${i}`;
          a = `a${i}`;
          acumulado += duracoes[i] - d;
        }
        inicios = com;
        r = await ff([
          ...partes.flatMap((p) => ['-i', p]),
          '-filter_complex', filtros.join(';'),
          '-map', `[${v}]`, '-map', `[${a}]`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', saida,
        ], 1_800_000);
        if (r.exitCode !== 0) req.onLog(`transição suave não deu certo (${r.stderr.trim().slice(-200)}); emendando sem transição`, 'WARN');
      }
      if (!r || r.exitCode !== 0) {
        const lista = path.join(tmp, 'lista.txt');
        fs.writeFileSync(lista, partes.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
        r = await ff(['-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', '-movflags', '+faststart', saida]);
      }
      if (r.exitCode !== 0) return { exitCode: 1, output: '', error: explicarFalhaMidia('União das cenas', r), interrupted: req.signal.aborted };
      // ÁUDIO: música de fundo (trilha) + narração (voz) por cima, montadas JUNTAS. O vídeo pode nem ter som próprio
      // (ex.: uma prévia pronta, sem áudio): então música/voz viram a trilha. O vídeo final tem o TAMANHO DO ÁUDIO —
      // se a narração passar do vídeo, a imagem segura o último quadro até a fala acabar (nunca corta pela metade).
      let custo = 0;
      let trilhaInfo = '';
      let narracaoInfo = '';
      const querAudio = !!o.trilha || !!(o.narracao?.texto?.trim() || o.narracao?.arquivo || o.narracao?.trechos?.length) || (o.volumeCenas !== undefined && o.volumeCenas < 1);
      if (querAudio) {
        const durDe = async (f: string) => Number((await probe(f, ['-show_entries', 'format=duration', '-of', 'csv=p=0'])).stdout.trim()) || 0;
        const temAudio = async (f: string) => Boolean((await probe(f, ['-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0'])).stdout.trim());
        const vDur = await durDe(saida);
        const videoTemAudio = await temAudio(saida);
        // 1) MÚSICA de fundo: um áudio do projeto, ou gerada pelo Lyria (reaproveitada quando a descrição não muda).
        let musica: string | null = null;
        if (o.trilha?.arquivo) {
          musica = trilhaResolvida;
          trilhaInfo = `trilha ${o.trilha.arquivo}`;
        } else if (o.trilha?.descricao) {
          const guardada = o.arquivo.replace(/\.mp4$/i, '-trilha.mp3');
          const meta = o.arquivo.replace(/\.mp4$/i, '-trilha.txt');
          const absG = this.resolver(req, guardada);
          const absM = this.resolver(req, meta);
          if (fs.existsSync(absG) && fs.existsSync(absM) && fs.readFileSync(absM, 'utf8').trim() === o.trilha.descricao.trim()) {
            musica = absG;
            trilhaInfo = `trilha ${guardada} (reaproveitada)`;
          } else {
            req.onLog(`Gerando a trilha de fundo com o Google (Lyria): ${o.trilha.descricao.slice(0, 120)}`);
            const g = await this.gerarMusica(o.trilha.descricao, vDur, req);
            if ('erro' in g) return { exitCode: 1, output: '', error: `não consegui gerar a trilha: ${g.erro}`, resourceUnavailable: g.indisponivel };
            fs.mkdirSync(path.dirname(absG), { recursive: true });
            fs.writeFileSync(absG, g.bytes);
            fs.writeFileSync(absM, `${o.trilha.descricao.trim()}\n`);
            musica = absG;
            custo += g.custo;
            trilhaInfo = `trilha gerada (${g.modelo}) em ${guardada}`;
          }
        }
        // 2) NARRAÇÃO (voz): áudio do projeto, Kokoro local (grátis) ou Gemini TTS (paga). O cache inclui todas
        // as escolhas que mudam o som; remontar o vídeo com a mesma locução nunca sintetiza nem cobra de novo.
        let voz: string | null = null;
        let vozInfo = '';
        if (o.narracao?.arquivo) {
          voz = narracaoResolvida;
          vozInfo = `narração ${o.narracao.arquivo}`;
        } else if (o.narracao?.texto?.trim() || o.narracao?.trechos?.length) {
          const guardada = o.arquivo.replace(/\.mp4$/i, '-narracao.mp3');
          const meta = o.arquivo.replace(/\.mp4$/i, '-narracao.txt');
          const absG = this.resolver(req, guardada);
          const absM = this.resolver(req, meta);
          const vozEscolhida = o.narracao.voz ?? (o.narracao.motor === 'gemini' ? VOZ_PADRAO_GEMINI : VOZ_PADRAO);
          const motor = o.narracao.motor ?? vozConhecida(vozEscolhida)?.motor ?? 'kokoro';
          const velocidade = o.narracao.velocidade ?? velocidadePadraoLocucao(o.narracao.ritmo ?? 'natural');
          const pronuncias = o.narracao.pronuncias ?? {};
          const trechos = motor === 'kokoro' ? (o.narracao.trechos?.length ? o.narracao.trechos : frasesDeLocucao(o.narracao.texto ?? '')) : [];
          const textoInteiro = (o.narracao.texto ?? trechos.map(t => t.texto).join(' ')).trim();
          const chaveCache = JSON.stringify({ motor, voz: vozEscolhida, velocidade, ritmo: o.narracao.ritmo ?? 'natural', pronuncias: Object.entries(pronuncias).sort(([a], [b]) => a.localeCompare(b)), texto: textoInteiro, trechos });
          if (fs.existsSync(absG) && fs.existsSync(absM) && fs.readFileSync(absM, 'utf8').trim() === chaveCache.trim()) {
            voz = absG;
            vozInfo = `narração ${guardada} (reaproveitada)`;
          } else {
            let g: { bytes: Buffer; mime: string; modelo: string; custo: number } | { erro: string; indisponivel?: boolean };
            if (motor === 'kokoro') {
              req.onLog(`Gerando a narração local, sem token, com o Kokoro (voz ${vozEscolhida}, velocidade ${velocidade}): ${textoInteiro.slice(0, 120)}`);
              try {
                // Não costurar vários MP3s: uma síntese mantém contexto
                // de prosódia do roteiro inteiro (inclusive a pergunta final).
                const textoGeracao = trechos.length ? roteiroEmUmaFala(trechos, o.narracao.ritmo ?? 'natural') : textoInteiro;
                if (trechos.some(t => t.pausaAposMs !== undefined))
                  req.onLog('Pausas solicitadas como marcadores internos do Kokoro em uma única síntese; sem concatenação de MP3.');
                if (trechos.some(t => t.velocidade !== undefined && t.velocidade !== velocidade))
                  req.onLog('Velocidades individuais ignoradas para preservar a locução contínua.', 'WARN');
                const local = await this.kokoro.gerar(textoGeracao, vozEscolhida, velocidade, pronuncias, req.signal);
                g = { bytes: local.bytes, mime: local.mime, modelo: 'Kokoro-82M locução contínua', custo: 0 };
              } catch (e: any) {
                const k = e instanceof KokoroTtsError ? e : new KokoroTtsError(String(e?.message ?? e));
                g = { erro: k.message, indisponivel: k.indisponivel };
              }
            } else {
              req.onLog(`Gerando a narração paga com a Gemini (voz ${vozEscolhida}): ${textoInteiro.slice(0, 120)}`);
              g = await this.gerarNarracaoGemini(aplicarPronuncias(textoInteiro, pronuncias), vozEscolhida, req);
            }
            if ('erro' in g) return { exitCode: 1, output: '', error: `não consegui gerar a narração: ${g.erro}`, resourceUnavailable: g.indisponivel, costUsd: custo, costEstimated: !!custo };
            fs.mkdirSync(path.dirname(absG), { recursive: true });
            const conv = await this.audioParaMp3(g.bytes, g.mime, absG, tmp);
            if (!conv) return { exitCode: 1, output: '', error: 'não consegui converter a narração para mp3', costUsd: custo, costEstimated: !!custo };
            fs.writeFileSync(absM, `${chaveCache.trim()}\n`);
            voz = absG;
            custo += g.custo;
            vozInfo = `narração gerada (${g.modelo}${motor === 'kokoro' ? ', sem token' : ''}) em ${guardada}`;
          }
        }
        const nDur = voz ? await durDe(voz) : 0;
        if (voz && !(nDur > 0)) return { exitCode: 1, output: '', error: `Não foi possível determinar a duração da locução: ${o.narracao?.arquivo ?? 'arquivo gerado'}` };
        if (!(vDur > 0)) return { exitCode: 1, output: '', error: `Não foi possível determinar a duração do vídeo: ${cenas.join(', ')}` };
        // Quando o pedido é narração sincronizada, a voz tem ritmo NATURAL.
        // Ajustamos somente a imagem para acompanhar a voz: nunca modificamos
        // o pitch, nunca aplicamos atempo na voz pronta. Sem silêncio prolongado.
        // Para vídeos de várias cenas, exigir solicitação explícita no plano.
        const ajustarPelaLocucao = !!voz && nDur > 0 &&
          (o.sincronizarVideoComNarracao === true || (cenas.length === 1 && !musica && (o.volumeCenas ?? 1) === 0));
        let duracaoFinalAlvo = Math.max(vDur, nDur);
        if (ajustarPelaLocucao) {
          if (o.cortes?.some(c => c?.velocidade && c.velocidade !== 1)) {
            req.onLog('Sincronização: a velocidade já foi modificada em cortes; o ajuste final usa a duração real da voz.', 'INFO');
          }
          const alvoVoz = Math.max(0.3, nDur + 0.15);
          const fator = vDur / alvoVoz;
          if (fator > 2.5 || fator < 0.5) {
            return { exitCode: 1, output: '', error: `Narração de ${nDur.toFixed(2)}s incompatível com vídeo de ${vDur.toFixed(2)}s (fator ${fator.toFixed(2)}x); adapte o roteiro ou replaneje a duração visual, sem acelerar artificialmente a voz.`, costUsd: custo, costEstimated: !!custo };
          }
          if (Math.abs(vDur - alvoVoz) > 0.18) {
            const sincronizado = path.join(tmp, 'sincronizado.mp4');
            const sync = await ff(['-i', saida, '-an', '-vf', `setpts=(PTS-STARTPTS)/${fator.toFixed(6)},fps=24`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', sincronizado], 1_800_000);
            if (sync.exitCode !== 0) return { exitCode: 1, output: '', error: explicarFalhaMidia('Sincronização do vídeo com a narração', sync), costUsd: custo, costEstimated: !!custo };
            fs.renameSync(sincronizado, saida);
            req.onLog(`Sincronização da imagem: ${vDur.toFixed(2)}s → ${alvoVoz.toFixed(2)}s (${fator.toFixed(2)}x); a voz natural foi preservada.`);
          }
          duracaoFinalAlvo = await durDe(saida);
          const desvio = Math.abs(duracaoFinalAlvo - nDur);
          if (desvio > 0.55) return { exitCode: 1, output: '', error: `Sincronização não conferiu: imagem ${duracaoFinalAlvo.toFixed(2)}s, narração ${nDur.toFixed(2)}s.`, costUsd: custo, costEstimated: !!custo };
        }
        // 3) ALVO = o maior entre o vídeo e a narração.

        const alvo = ajustarPelaLocucao ? Math.max(duracaoFinalAlvo, nDur) : Math.max(vDur, nDur);
        const duracaoImagemAtual = ajustarPelaLocucao ? duracaoFinalAlvo : vDur;
        if (alvo > duracaoImagemAtual + 0.05) {
          const esticado = path.join(tmp, 'esticado.mp4');
          const e = await ff(['-i', saida, '-vf', `tpad=stop_mode=clone:stop_duration=${(alvo - duracaoImagemAtual).toFixed(3)}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', ...(videoTemAudio ? ['-c:a', 'copy'] : ['-an']), '-movflags', '+faststart', esticado], 1_800_000);
          if (e.exitCode === 0) fs.renameSync(esticado, saida);
          else return { exitCode: 1, output: '', error: explicarFalhaMidia('Extensão do último quadro até a narração', e), costUsd: custo, costEstimated: !!custo };
        }
        // 4) Monta a faixa de áudio de tamanho `alvo`: música (trim/loop + fade) + áudio do vídeo + voz (com ducking).
        // O volume selecionado deve representar o volume real da música.
        // Antes: 0.3 * 0.35 * sidechain => trilha quase inaudível.
        const volM = o.trilha?.volume ?? 0.65;
        const volC = o.volumeCenas ?? 1;
        // Evitar apagar metade de uma trilha curta com fades longos.
        const fadeIn = Math.min(0.35, Math.max(0, alvo * 0.03));
        const fadeOut = Math.min(0.85, Math.max(0.25, alvo * 0.075));
        const fimFade = Math.max(0, alvo - fadeOut).toFixed(3);
        const inputs: string[] = ['-i', saida];
        const filtros: string[] = [];
        const fundos: string[] = [];
        if (videoTemAudio && volC > 0) {
          filtros.push(`[0:a]volume=${volC}[cen]`);
          fundos.push('cen');
        }
        if (musica) {
          inputs.push('-stream_loop', '-1', '-i', musica);
          const mi = inputs.filter((x) => x === '-i').length - 1;
          // Normalizar a trilha ANTES de aplicar o volume, para arquivos de origem muito baixos.
          filtros.push(`[${mi}:a]atrim=0:${alvo.toFixed(2)},asetpts=PTS-STARTPTS,loudnorm=I=-19:TP=-2:LRA=11,volume=${volM},afade=t=in:d=${fadeIn.toFixed(3)},afade=t=out:st=${fimFade}:d=${fadeOut.toFixed(3)}[mus]`);
          fundos.push('mus');
        }
        let fundo: string | null = null;
        if (fundos.length === 1) fundo = fundos[0];
        else if (fundos.length >= 2) {
          filtros.push(`[${fundos[0]}][${fundos[1]}]amix=inputs=2:duration=longest:normalize=0[fundo]`);
          fundo = 'fundo';
        }
        let rotuloFinal: string | null = null;
        if (voz) {
          inputs.push('-i', voz);
          const vi = inputs.filter((x) => x === '-i').length - 1;
          // Sem segunda redução fixa. Ducking dinâmico só enquanto a voz está presente.
          const volFundo = Number.isFinite(o.narracao?.volumeFundoSobVoz) ? Math.max(0, Math.min(1, Number(o.narracao!.volumeFundoSobVoz))) : 1;
          filtros.push(`[${vi}:a]aresample=48000,asetpts=PTS-STARTPTS,apad=whole_dur=${alvo.toFixed(2)}[narr]`);
          if (fundo) filtros.push(`[narr]asplit=2[nv][nk];[${fundo}]volume=${volFundo}[bg];[bg][nk]sidechaincompress=threshold=0.08:ratio=3:attack=30:release=300[bgd];[nv][bgd]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95[a]`);
          else filtros.push(`[narr]alimiter=limit=0.95[a]`);
          rotuloFinal = 'a';
          narracaoInfo = vozInfo;
        } else if (fundo) {
          filtros.push(`[${fundo}]alimiter=limit=0.95[a]`);
          rotuloFinal = 'a';
        }
        if (rotuloFinal) {
          const comAudio = path.join(tmp, 'com-audio.mp4');
          const m = await ff([...inputs, '-filter_complex', filtros.join(';'), '-map', '0:v', '-map', `[${rotuloFinal}]`, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', alvo.toFixed(2), '-movflags', '+faststart', comAudio], 1_800_000);
          if (m.exitCode !== 0) return { exitCode: 1, output: '', error: explicarFalhaMidia('Mixagem de vídeo, locução e trilha', m), costUsd: custo, costEstimated: !!custo };
          fs.renameSync(comAudio, saida);
        }
        if (!trilhaInfo && videoTemAudio && volC !== 1) trilhaInfo = `som das cenas em ${Math.round(volC * 100)}%`;
        if (trilhaInfo) req.onLog(`Áudio: ${trilhaInfo}${musica ? '; música abaixa sob as falas' : ''}`);
        if (narracaoInfo) req.onLog(`Áudio: ${narracaoInfo}; o fundo abaixa sob a voz`);
      }
      // Legendas: o texto de cada cena no tempo exato dela no vídeo final; gravadas na imagem e salvas em .srt.
      let srtTexto: string | null = null;
      let legendado = false;
      if (o.legendas?.some((l) => l.trim())) {
        const total = Number((await probe(saida, ['-show_entries', 'format=duration', '-of', 'csv=p=0'])).stdout.trim()) || inicios[inicios.length - 1] + duracoes[duracoes.length - 1];
        const blocos: string[] = [];
        o.legendas.forEach((texto, i) => {
          if (!texto.trim() || i >= partes.length) return;
          const de = i === 0 ? 0.2 : inicios[i] + (durT[i - 1] ?? 0) / 2;
          const ate = i === partes.length - 1 ? total - 0.2 : inicios[i + 1] + (durT[i] ?? 0) / 2;
          blocos.push(`${blocos.length + 1}\n${tempoSrt(de)} --> ${tempoSrt(Math.max(de + 0.5, ate))}\n${texto.trim()}\n`);
        });
        srtTexto = blocos.join('\n');
        fs.writeFileSync(path.join(tmp, 'legendas.srt'), srtTexto);
        const legendada = path.join(tmp, 'legendado.mp4');
        const estilo = "FontName=DejaVu Sans,Bold=1,FontSize=12,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=28";
        const l = await ff(['-i', saida, '-vf', `subtitles=legendas.srt:force_style='${estilo}'`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', legendada], 1_800_000);
        if (l.exitCode === 0) {
          fs.renameSync(legendada, saida);
          legendado = true;
        } else req.onLog(`não consegui gravar as legendas no vídeo (${l.stderr.trim().slice(-200)}); ficam só no arquivo .srt`, 'WARN');
      }
      const destino = this.resolver(req, o.arquivo);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.copyFileSync(saida, destino);
      const srtArquivo = srtTexto ? o.arquivo.replace(/\.mp4$/i, '.srt') : null;
      if (srtArquivo && srtTexto) fs.writeFileSync(this.resolver(req, srtArquivo), srtTexto);
      const dur = Number((await probe(destino, ['-show_entries', 'format=duration', '-of', 'csv=p=0'])).stdout.trim());
      const mb = (fs.statSync(destino).size / 1024 / 1024).toFixed(1);
      const resumo = `Vídeo completo: ${o.arquivo} (${cenas.length} cenas, ${Number.isFinite(dur) ? `${Math.round(dur)} s, ` : ''}${mb} MB)${legendado ? `, com legendas (${srtArquivo})` : srtArquivo ? `; legendas só em ${srtArquivo}` : ''}${trilhaInfo ? `; ${trilhaInfo}` : ''}${narracaoInfo ? `; ${narracaoInfo}` : ''}`;
      req.onLog(resumo);
      return { exitCode: 0, output: resumo, stopReason: 'completed', ...(custo ? { costUsd: custo, costEstimated: true } : {}) };
    } catch (e: any) {
      const erro = `Falha interna na montagem (sem descartar os arquivos originais): ${e?.message ?? String(e)}`;
      req.onLog(erro, 'ERROR');
      return { exitCode: 1, output: '', error: erro };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  /**
   * Música instrumental pelo Google (Lyria, API do Gemini, generateContent): pede a duração do vídeo; se vier
   * mais curta, a montagem repete (loop) e, no fim, sai em fade. Custo estimado por música gerada.
   */
  private async gerarMusica(descricao: string, segundos: number, req: ExecutionRequest): Promise<{ bytes: Buffer; modelo: string; custo: number } | { erro: string; indisponivel?: boolean }> {
    const k = this.video.chave();
    if (!k) return { erro: 'sem conexão "Gemini — chave de API" com chave salva (crie em Conexões)', indisponivel: true };
    const base = (process.env.NIVOO_GEMINI_API_BASE ?? 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    const texto = `${descricao}\n\nMúsica INSTRUMENTAL (sem voz, sem letra), trilha de fundo para um vídeo de cerca de ${Math.ceil(segundos)} segundos: ritmo constante do começo ao fim, sem pausas nem silêncio, sem final abrupto.`;
    const recusados: string[] = [];
    for (const modelo of MODELOS_MUSICA) {
      let res: Response;
      try {
        res = await fetch(`${base}/v1beta/models/${modelo}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': k.chave, 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: texto }] }], generationConfig: { responseModalities: ['AUDIO', 'TEXT'] } }),
          signal: AbortSignal.any([req.signal, AbortSignal.timeout(600_000)]),
        });
      } catch (e: any) {
        return { erro: `não foi possível falar com o Google: ${e?.cause?.code ?? e?.message}`, indisponivel: true };
      }
      const j: any = await res.json().catch(() => ({}));
      if (res.status === 404 || (res.status === 400 && /not found|not supported/i.test(String(j?.error?.message ?? '')))) {
        recusados.push(`${modelo} (${res.status})`);
        continue;
      }
      if (!res.ok) return { erro: `o Google respondeu ${res.status}: ${String(j?.error?.message ?? '').slice(0, 300)}`, indisponivel: [401, 402, 403, 429].includes(res.status) || res.status >= 500 };
      const parte = (j?.candidates?.[0]?.content?.parts ?? []).find((p: any) => /^audio\//.test(p?.inlineData?.mimeType ?? p?.inline_data?.mime_type ?? ''));
      const dados = parte?.inlineData?.data ?? parte?.inline_data?.data;
      if (!dados) return { erro: `o Google não devolveu áudio (${JSON.stringify(j).slice(0, 200)})` };
      return { bytes: Buffer.from(dados, 'base64'), modelo, custo: Number(process.env.NIVOO_LYRIA_USD_POR_MUSICA ?? 0.08) };
    }
    return { erro: `nenhum modelo de música aceitou o pedido com esta chave (${recusados.join(', ')})` };
  }

  /**
   * Narração (voz) pela Gemini (TTS, generateContent com responseModalities AUDIO + speechConfig): devolve o áudio da
   * locução do texto, na voz escolhida. Custo estimado por narração.
   */
  private async gerarNarracaoGemini(texto: string, voz: string, req: ExecutionRequest): Promise<{ bytes: Buffer; mime: string; modelo: string; custo: number } | { erro: string; indisponivel?: boolean }> {
    const k = this.video.chave();
    if (!k) return { erro: 'sem conexão "Gemini — chave de API" com chave salva (crie em Conexões)', indisponivel: true };
    const base = (process.env.NIVOO_GEMINI_API_BASE ?? 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    const recusados: string[] = [];
    for (const modelo of MODELOS_VOZ) {
      let res: Response;
      try {
        res = await fetch(`${base}/v1beta/models/${modelo}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': k.chave, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `Narre em português do Brasil, com naturalidade:\n${texto}` }] }],
            generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voz } } } },
          }),
          signal: AbortSignal.any([req.signal, AbortSignal.timeout(600_000)]),
        });
      } catch (e: any) {
        return { erro: `não foi possível falar com o Google: ${e?.cause?.code ?? e?.message}`, indisponivel: true };
      }
      const j: any = await res.json().catch(() => ({}));
      if (res.status === 404 || (res.status === 400 && /not found|not supported/i.test(String(j?.error?.message ?? '')))) {
        recusados.push(`${modelo} (${res.status})`);
        continue;
      }
      if (!res.ok) return { erro: `o Google respondeu ${res.status}: ${String(j?.error?.message ?? '').slice(0, 300)}`, indisponivel: [401, 402, 403, 429].includes(res.status) || res.status >= 500 };
      const parte = (j?.candidates?.[0]?.content?.parts ?? []).find((p: any) => /^audio\//.test(p?.inlineData?.mimeType ?? p?.inline_data?.mime_type ?? ''));
      const dados = parte?.inlineData?.data ?? parte?.inline_data?.data;
      const mime = parte?.inlineData?.mimeType ?? parte?.inline_data?.mime_type ?? '';
      if (!dados) return { erro: `o Google não devolveu áudio (${JSON.stringify(j).slice(0, 200)})` };
      return { bytes: Buffer.from(dados, 'base64'), mime, modelo, custo: Number(process.env.NIVOO_TTS_USD_POR_NARRACAO ?? 0.03) };
    }
    return { erro: `nenhum modelo de voz aceitou o pedido com esta chave (${recusados.join(', ')})` };
  }

  /** Converte o áudio devolvido pela TTS (PCM "L16" ou já em formato com cabeçalho) para mp3 no destino. */
  private async audioParaMp3(bytes: Buffer, mime: string, destino: string, tmp: string): Promise<boolean> {
    const bruto = path.join(tmp, `tts-${Date.now()}.bin`);
    fs.writeFileSync(bruto, bytes);
    const pcm = /l16|pcm|s16le/i.test(mime);
    const rate = Number(/rate=(\d+)/i.exec(mime)?.[1] ?? 24000) || 24000;
    const entrada = pcm ? ['-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', bruto] : ['-i', bruto];
    const r = await runProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...entrada, '-c:a', 'libmp3lame', '-q:a', '3', destino], { cwd: tmp, env: minimalEnv(), timeoutMs: 120_000 }).catch(() => ({ exitCode: 1 }) as any);
    fs.rmSync(bruto, { force: true });
    return (r as any).exitCode === 0 && fs.existsSync(destino) && fs.statSync(destino).size > 0;
  }
}

/** 12.5 → "00:00:12,500" (tempo do arquivo .srt). */
/** atempo do ffmpeg vale de 0,5 a 2,0; para acelerar/desacelerar mais, encadeia (ex.: 4x = 2,0 * 2,0). */
function filtroVelocidadeAudio(vel: number): string {
  const fatores: number[] = [];
  let resto = vel;
  while (resto > 2) {
    fatores.push(2);
    resto /= 2;
  }
  while (resto < 0.5) {
    fatores.push(0.5);
    resto /= 0.5;
  }
  fatores.push(Number(resto.toFixed(4)));
  return fatores.map((f) => `atempo=${f}`).join(',');
}

function tempoSrt(seg: number): string {
  const ms = Math.max(0, Math.round(seg * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const p = (n: number, t = 2) => String(n).padStart(t, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(ms % 1000, 3)}`;
}
