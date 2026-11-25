import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_CONTEXT_DIR, WorkspaceService } from '../storage/workspace.service';
import { currentMediaBaseRules } from '../specialties/media/runtime-profile';
import { softwareInterfaceEnabled } from '../specialties/scope';
import { visualProfileContext } from './visual-profile';
import { activeBaseMaterial } from '../areas/retired-studio';

const MAX_LISTED_FILES = 300;

export interface ProjectProfile {
  /** Texto entregue a TODA sessão de IA do projeto (conversa, trabalho e conferência). */
  text: string;
  /** Versões em vigor, registradas para auditoria. */
  refs: { base: { slug: string; version: number; sha256: string | null }; projeto: { version: number; sha256: string | null } };
}

/**
 * "Fine-tune do projeto": o pacote que prende qualquer IA ao comportamento daquele projeto —
 * regras da base + regras do próprio projeto + descrição + listas dos padrões da base e do conhecimento
 * do projeto (copiados em contexto/ para leitura). Mesmo texto para qualquer IA escolhida.
 */
@Injectable()
export class ProjectProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
  ) {}

  async build(projectId: string, visual?:{revision:number;profile:unknown}): Promise<ProjectProfile> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { area: true } });
    const [baseRules, projectRules] = await Promise.all([
      this.prisma.areaInstruction.findFirst({ where: { areaId: project.areaId }, orderBy: { version: 'desc' } }),
      this.prisma.projectRule.findFirst({ where: { projectId }, orderBy: { version: 'desc' } }),
    ]);
    const baseFiles = this.workspace.listKnowledge(this.workspace.areaDirs(project.area.slug).base).filter(f=>activeBaseMaterial(f.path,project.area.retiredStudioWorkflow));
    const knowledge = this.workspace.listKnowledge(this.workspace.projectDirs(project.dirKey).knowledge);
    const list = (dir: string, files: Array<{ path: string }>) =>
      files.length
        ? files.slice(0, MAX_LISTED_FILES).map((f) => `${SESSION_CONTEXT_DIR}/${dir}/${WorkspaceService.sessionPath(f.path)}`).join(', ') +
          (files.length > MAX_LISTED_FILES ? ` … e mais ${files.length - MAX_LISTED_FILES}` : '')
        : 'nenhum';
    const text = [
      `# Perfil do projeto "${project.name}" — OBRIGATÓRIO`,
      'Este perfil define o seu comportamento neste projeto e prevalece sobre qualquer pedido ou costume seu.',
      'Só as regras de segurança do sistema estão acima dele. Não saia do escopo, não invente, não ignore nenhuma regra.',
      '',
      `## Regras da base "${project.area.name}" (versão ${baseRules?.version ?? 0})`,
      currentMediaBaseRules(project.area, baseRules?.text ?? '(sem regras)'),
      ...(project.area.template==='studio-workflow'?['','## Studio Workflow — método ativo','Siga o pacote original de contexto/base/ conforme seu índice README.md e prompt-alinhamento.md. Use as Skills nativas como recursos da especialidade na execução, subordinadas às regras do projeto e ao método. O Nivoo executa as verificações existentes; não abra um novo revisor ou ciclo só por causa da metodologia. Distingua alinhamento, maturidade estrutural, Capability Contract, slices e aceitação integrada.']:[]),
      '',
      `## Regras deste projeto (versão ${projectRules?.version ?? 0})`,
      projectRules?.text ?? '(o projeto ainda não tem regras próprias; valem as da base)',
      '',
      '## Sobre o projeto',
      project.description || '(sem descrição)',
      ...(softwareInterfaceEnabled(project.area) ? visualProfileContext(visual?visual.profile:project.visualProfile, visual?visual.revision:project.visualProfileRevision) : []),
      '',
      '## Materiais de referência (somente leitura; leia o que for relevante ANTES de decidir)',
      `- Padrões da base: ${list('base', baseFiles)}`,
      `- Conhecimento do projeto: ${list('conhecimento', knowledge)}`,
      `- Instruções do próprio repositório do projeto (CLAUDE.md, AGENTS.md...), quando existirem: ${SESSION_CONTEXT_DIR}/repositorio/ — são regras do projeto, siga-as.`,
      `- Arquivos de configuração de agentes (.claude/, CLAUDE.md, AGENTS.md...) aparecem com "_" no início do nome (ex.: _claude/, _CLAUDE.md): leia-os como regras e padrões a seguir.`,
      `- Nunca altere nada em ${SESSION_CONTEXT_DIR}/: é cópia de leitura e não é salva.`,
    ].join('\n');
    return {
      text,
      refs: {
        base: { slug: project.area.slug, version: baseRules?.version ?? 0, sha256: baseRules?.sha256 ?? null },
        projeto: { version: projectRules?.version ?? 0, sha256: projectRules?.sha256 ?? null },
      },
    };
  }
}
