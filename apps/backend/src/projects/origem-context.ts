import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from '../storage/workspace.service';

/**
 * Projeto de vídeo/design "enxerga" o projeto de ORIGEM: o contexto da IA ganha o nome, a descrição, as regras, o
 * conhecimento e os arquivos/telas da origem, para o vídeo ser sobre o app de verdade — sem embolar os dois projetos.
 */
export async function contextoDaOrigem(prisma: PrismaService, workspace: WorkspaceService, origemId: string | null | undefined): Promise<string[]> {
  if (!origemId) return [];
  const origem = await prisma.project.findUnique({ where: { id: origemId }, include: { area: { select: { name: true } } } });
  if (!origem) return [];
  const [rules, arquivos] = await Promise.all([
    prisma.projectRule.findFirst({ where: { projectId: origemId }, orderBy: { version: 'desc' } }),
    workspace.listMainFiles(origem.dirKey).catch(() => [] as Array<{ path: string; size: number }>),
  ]);
  const conhecimento = workspace.listKnowledge(workspace.projectDirs(origem.dirKey).knowledge).map((k) => k.path);
  const MAX = 60;
  const linhas = [
    '## Projeto de ORIGEM (faça o vídeo SOBRE este projeto; não altere o software dele)',
    `- Nome: ${origem.name}${origem.area?.name ? ` (agente ${origem.area.name})` : ''}`,
    ...(origem.description ? [`- Do que se trata: ${origem.description.slice(0, 2000)}`] : []),
    ...(rules?.text ? ['- Regras/identidade da origem:', rules.text.slice(0, 3000)] : []),
    conhecimento.length ? `- Conhecimento da origem (consulte se precisar; pela aba do projeto de origem): ${conhecimento.slice(0, 40).join(', ')}` : '- A origem não tem conhecimento anexado.',
    arquivos.length
      ? `- Telas/arquivos da origem (${arquivos.length}): ${arquivos.slice(0, MAX).map((f) => f.path).join(', ')}${arquivos.length > MAX ? ` … e mais ${arquivos.length - MAX}` : ''}`
      : '- A origem ainda não tem arquivos.',
    '- Use o nome e a descrição certos no vídeo. Se precisar de uma TELA animada, recrie o visual pela descrição/arquivos da origem',
    '  (o vídeo é um projeto separado; você não roda o app da origem daqui).',
  ];
  return linhas;
}
