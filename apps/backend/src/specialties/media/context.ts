import type { PrismaService } from '../../prisma/prisma.service';
import type { WorkspaceService } from '../../storage/workspace.service';
import { listarVideos } from '../../projects/midia';
import { descreverVoz } from '../../providers/vozes';
import { nvidiaTtsConfigurado } from '../../providers/magpie-tts.service';

export interface MediaProjectContext {
  id:string;
  dirKey:string;
  vozNarracao:string;
  motorNarracao:string;
  velocidadeNarracao:number;
  pronunciasNarracao:unknown;
  modoTrilha:string;
}

/** Vídeos que o usuário enviou/editou (modo edição): a IA os referencia por midia/entrada|saida/<arquivo>. */
function textoDosVideos(videos: ReturnType<typeof listarVideos>): string[] {
  const enviados = videos.filter((v) => v.pasta === 'entrada');
  if (!enviados.length) return [];
  const mb = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
  return [
    `Vídeos e áudios (trilha/narração) que o usuário já enviou para EDITAR/MONTAR (use estes caminhos; .wav/.mp3 é trilha ou locução própria, use como áudio na montagem; são ffmpeg, sem Omni e sem custo): ${enviados
      .slice(0, 40)
      .map((v) => `${v.caminho} (${v.nome}, ${mb(v.bytes)})`)
      .join('; ')}. O vídeo editado sai em midia/saida/<nome>.mp4 (fora do git).`,
  ];
}


export async function buildMediaPlannerContext(prisma: PrismaService, workspace: WorkspaceService, project: MediaProjectContext): Promise<string[]> {
    // Os resultados de jobs anteriores vivem no catálogo de artefatos, não necessariamente em midia/.
    // A IA deve saber que o executor juntar-videos os resolve diretamente por nome.
    const artefatosRecentes = await prisma.artifact.findMany({
      where: { projectId: project.id, kind: 'FILE' },
      select: { name: true, sha256: true, jobId: true, sizeBytes: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const arquivosDeMidia = artefatosRecentes
      .filter(a => /\.(mp4|mov|webm|mp3|wav|m4a|aac|ogg)$/i.test(a.name))
      .filter((a, i, arr) => arr.findIndex(b => b.name === a.name && b.sha256 === a.sha256) === i)
      .slice(0, 80);
    const arquivosPorNome = new Map<string, Set<string>>();
    for (const a of arquivosDeMidia) {
      const nome = a.name.split('/').at(-1) ?? a.name;
      const hashes = arquivosPorNome.get(nome) ?? new Set<string>();
      hashes.add(a.sha256);
      arquivosPorNome.set(nome, hashes);
    }
  return [
      'Uma correção pontual em composição aprovada é edição, não refação geral. Preserve todo elemento não solicitado e o formato de autoria existente; localize o arquivo exato da versão selecionada. Não transforme uma alteração de pizza, relógio ou texto em criação de novo anúncio.',
      'Reutilize somente ativos e composições realmente acessíveis. Uma criação visual rejeitada não é aprovada: preserve fundo, logo, fotos, conteúdo e identidade válidos, mas crie a composição visual corrigida. "Veio errado", "é o mesmo", "faltam elementos gráficos/3D" ou "faça de novo" após rejeição exigem autoria visual e renderização da nova fonte, não somente exportação. Inclua a solicitação mais recente no objetivo do job e use saída distinta.',
      ...textoDosVideos(listarVideos(workspace.projectDirs(project.dirKey).midia)),
      '## Arquivos de mídia reutilizáveis dos trabalhos anteriores (catálogo REAL do projeto)',
      arquivosDeMidia.length
        ? arquivosDeMidia.map(a => `- ${a.name} (${a.sizeBytes} bytes, trabalho ${a.jobId?.slice(0, 8) ?? 'sem trabalho'})${(arquivosPorNome.get(a.name.split('/').at(-1) ?? a.name)?.size ?? 0) > 1 ? ' — ATENÇÃO: há versões com hashes diferentes deste nome; não escolha sem identificar qual foi aprovada' : ''}`).join('\n')
        : '(nenhum MP4/MP3 encontrado no catálogo desta lista recente)',
      'ATENÇÃO: os arquivos acima pertencem ao catálogo do Nivoo, mesmo que não estejam em midia/.',
      'O executor OFICIAL juntar-videos localiza automaticamente por nome exato no catálogo do projeto.',
      'Não diga que o arquivo precisa ser importado para midia/ nem que o executor o rejeita por estar em resultados.',
      'Não confunda arquivos listados com seleção aprovada: escolha apenas os identificados claramente no pedido/histórico.',
      'PROIBIDO INVENTAR NOMES DE ARQUIVO DE TRILHA OU NARRAÇÃO: em juntar-videos, trilha.arquivo e narracao.arquivo devem copiar o NOME OU CAMINHO REAL de mídia do projeto ou de artefato listado acima.',
      'Se uma música instrumental foi pedida mas NÃO há MP3/WAV real compatível na mídia/catálogo, NÃO crie o nome hipotético black-na-sua-quinta-trilha-instrumental.mp3 nem qualquer outro.',
      'Detecte a falta ANTES de propor um plano de composição/renderização caro. Informe que a trilha original não existe e peça o arquivo OU uma escolha explícita de gerar música (Lyria pode cobrar).',
      'Quando uma trilha existe mas seu nome difere do pedido, use exatamente o nome registrado na lista, ou o ID de artefato inequívoco. Não substitua por outro áudio de campanha.',
      'Se houver um único vídeo e áudios inequívocos já aprovados, proponha diretamente um plano de juntar-videos.',
      'Somente peça esclarecimento se o arquivo estiver AUSENTE do catálogo e da mídia, ou se houver versões ambíguas.',
      `Locução deste projeto: motor ${project.motorNarracao === 'gemini' ? 'Gemini TTS paga (usa token)' : project.motorNarracao==='nvidia' ? 'NVIDIA Magpie (API, sujeita a cotas)' : 'Kokoro local (grátis, sem token)'}, voz ${descreverVoz(project.vozNarracao)}, velocidade ${project.velocidadeNarracao}. Pronúncias: ${JSON.stringify(project.pronunciasNarracao ?? {})}. Quando houver narração por texto, copie estas escolhas para narracao.motor, narracao.voz, narracao.velocidade e narracao.pronuncias, salvo pedido explícito mais recente de outro motor/voz. NVIDIA Magpie: ${nvidiaTtsConfigurado()?'chave NVIDIA configurada; acesso à síntese será confirmado no uso':'sem chave NVIDIA configurada'}. Se escolher outro motor, selecione voz compatível.`,
      `Trilha padrão do projeto: ${project.modoTrilha === 'ia' ? 'gerar com IA/Lyria (paga)' : project.modoTrilha === 'arquivo' ? 'usar um arquivo de música enviado pelo usuário' : 'sem trilha no MP4 (o usuário pode adicionar música depois no Instagram)'}. Locução e trilha são independentes.`,
  ];
}
