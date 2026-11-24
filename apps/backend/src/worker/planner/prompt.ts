import type { PrismaService } from '../../prisma/prisma.service';
import type { WorkspaceService } from '../../storage/workspace.service';
import type { ProviderRegistry } from '../../providers/provider-registry.service';
import { SESSION_CONTEXT_DIR } from '../../storage/workspace.service';
import { AGENT_RULES } from '../../security/policy';
import { ferramentasDaIa } from '../../providers/ferramentas';
import { mcpDoProjeto } from '../../mcp/mcp';
import { textoDoRepositorio } from '../../git/contexto-git';
import { contextoDaOrigem } from '../../projects/origem-context';
import { infoDeVersao,textoDaVersao } from '../../git/versao';
import { selectPlannerCapabilities } from './capabilities';
import { buildMediaPlannerContext } from '../../specialties/media/context';
import { collectPlannerContext } from './context';
import { selectSkills,skillContext } from '../../specialties/skills';
import { architectureContext } from '../../specialties/software/architecture-context';
import { backendEngineeringContext } from '../../specialties/software/backend';
import { frontendEngineeringContext } from '../../specialties/software/frontend';
import { dataEngineeringContext } from '../../specialties/software/data';
import { integrationEngineeringContext } from '../../specialties/software/integration';
import { securityEngineeringContext } from '../../specialties/software/security';
import { qualityEngineeringContext } from '../../specialties/software/quality';
import { maintenanceEngineeringContext } from '../../specialties/software/maintenance';
import { bancoDeTesteDisponivel } from '../../common/banco-de-teste';
import { plannerRules } from './contract';
import type { PlannerRequest } from './types';

/** Composition root for the planner prompt. No queue, persistence or AI invocation. */
export async function buildPlannerPrompt(prisma:PrismaService,workspace:WorkspaceService,registry:ProviderRegistry,request:PlannerRequest):Promise<string>{
  const {project,profileText,providerId,resultados,entrega}=request;
  const capabilities=await selectPlannerCapabilities(project.area,registry,providerId);
  const midia=capabilities.media;
  const {fileIndex,indiceTrabalhos,memTxt,conversa,currentMessage}=await collectPlannerContext(prisma,workspace,request);
  const task=entrega??currentMessage.join('\n');
  const skills=selectSkills({phase:'planner',text:task,media:midia,software:capabilities.softwareInterface});
    return [
      '# Você é a IA deste projeto no Nivoo',
      '',
      '## Regras de segurança do sistema (invioláveis)',
      ...AGENT_RULES.map((r) => `- ${r}`),
      '- Este diretório é uma CÓPIA DESCARTÁVEL da pasta do projeto: leia o que precisar, mas NÃO crie, altere nem apague arquivos.',
      '- Você não executa o trabalho: você conversa e, quando fizer sentido, propõe um plano. O usuário aprova; então o trabalho é executado.',
      '',
      profileText,
      '',
      ...ferramentasDaIa(providerId, mcpDoProjeto(project.id).map((m) => m.nome)),
      '- Nas instruções das etapas do plano, nunca proíba comandos de LEITURA (ls, cat, rg…): o ChatGPT só lê arquivos com eles.',
      '  Proíba, se for o caso, testes, build, instalação, commit, push e apagar — isso é do sistema.',
      '',
      ...(await textoDoRepositorio(workspace.projectDirs(project.dirKey).repo, project, { semPastaGit: true })),
      '',
      fileIndex,
      '## Trabalhos anteriores deste PROJETO — inclusive de outras conversas',
      ...(indiceTrabalhos.length ? indiceTrabalhos : ['(nenhum trabalho anterior)']),
      'Estes estados são fatos do banco: CONCLUIDO confirma a etapa; BLOQUEADO/FALHOU não confirma entrega. Não invente que um arquivo existe só porque uma etapa diz CONCLUIDO.',
      'Ao ouvir "terminar", "continuar", "ajustar", "refazer" ou pedido curto, leia primeiro o objetivo atual, os trabalhos recentes, os arquivos principais e o catálogo antes de decidir se deve preservar ou criar algo.',
      ...(midia ? await buildMediaPlannerContext(prisma, workspace, project) : []),
      ...(await contextoDaOrigem(prisma, workspace, project.projetoOrigemId)),
      '',
      '## Memória do projeto (decisões, restrições, lições, pendências)',
      memTxt || '(vazia)',
      '',
      ...textoDaVersao(await infoDeVersao(workspace.projectDirs(project.dirKey).repo).catch(() => null)),
      '',
      '## Conversa até aqui',
      conversa || '(primeira mensagem)',
      '',
      ...skillContext(skills,request.worktree),
      ...(skills.some(s=>s.id==='codigo')?architectureContext(request.worktree,task):[]),
      ...(skills.some(s=>s.id==='software-backend')?backendEngineeringContext('planner',task):[]),
      ...(skills.some(s=>s.id==='software-frontend')?frontendEngineeringContext('planner',task):[]),
      ...(skills.some(s=>s.id==='software-dados')?dataEngineeringContext('planner',task,bancoDeTesteDisponivel()):[]),
      ...(skills.some(s=>s.id==='software-integracoes')?integrationEngineeringContext('planner',task):[]),
      ...(skills.some(s=>s.id==='software-seguranca')?securityEngineeringContext('planner',task):[]),
      ...(skills.some(s=>s.id==='software-qualidade')?qualityEngineeringContext('planner',task):[]),
      ...(skills.some(s=>s.id==='software-manutencao')?maintenanceEngineeringContext('planner',task):[]),
      ...plannerRules(capabilities),
      ...(resultados.length
        ? [
            '- RESULTADOS dos trabalhos desta conversa (relatórios, inventários, planos que a IA gravou em out/; ficam fora da pasta',
            '  do projeto) estão para leitura em contexto/resultados/<id do trabalho>/. LEIA-OS quando o assunto for o resultado:',
            ...resultados.slice(0, 60).map((r) => `  - ${SESSION_CONTEXT_DIR}/resultados/${r}`),
            '  Num plano que continua um trabalho anterior (ex.: executar a limpeza proposta), as etapas também recebem esses arquivos',
            '  em contexto/resultados/ — cite o caminho na instrução da etapa.',
          ]
        : []),
      '- Anexos do chat ficam em contexto/anexos/ (leitura). Para colocar um anexo DENTRO do projeto (ex.: o logo',
      '  enviado vira public/logo.png), inclua no job "anexosNoProjeto":[{"anexo":"contexto/anexos/<id>/<arquivo>","para":"public/logo.png"}]:',
      '  o sistema copia o arquivo antes de o trabalho começar. Nunca tente recriar uma imagem escrevendo o arquivo.',
      '',
      '## Memória do projeto (obrigatório)',
      'Em qualquer dos dois formatos, inclua "memoria": [...] SÓ com o que precisa ser lembrado para sempre neste projeto:',
      'decisões CONCRETAS do usuário, preferências e regras que ele expressou, fatos do projeto que ele informou e pendências combinadas.',
      'Formato: {"tipo":"DECISAO|PREFERENCIA|FATO|PENDENCIA","titulo":"assunto curto e estável","conteudo":"frase completa e autossuficiente"}.',
      'O título é o ASSUNTO (ex.: "Banco de dados", "Tom das peças"): para mudar algo já guardado, use EXATAMENTE o mesmo título',
      'da memória acima com o conteúdo novo — o sistema atualiza o item (não cria outro). Uma pendência resolvida: mesmo título,',
      'conteúdo dizendo como foi resolvida.',
      'NÃO guarde: andamento ou resumo de trabalho, o que a IA fez ou vai fazer, planos, suposições suas, dúvidas, o que já está',
      'na memória com o mesmo sentido, nem detalhes que estão nos arquivos do projeto. Na dúvida, não guarde. Lista vazia é o normal.',
      '',
      ...(entrega
        ? [
            '## AGORA: apresente a ENTREGA do trabalho que acabou de terminar (o usuário ainda não viu o resultado)',
            entrega,
            'Leia os arquivos novos/alterados e os resultados acima e responda em linguagem simples:',
            '1) O que foi feito (poucas linhas) e como foi conferido (as conferências que o SISTEMA rodou estão acima; não diga',
            '   que nada foi testado se uma conferência rodou testes).',
            '2) Onde está: os caminhos exatos dos arquivos principais (o usuário abre pela tela clicando neles).',
            ...(midia ? ['   Vídeo: o resultado é o vídeo COMPLETO (…-completo.mp4, com player e "baixar" na conversa); cite as cenas só como peças.'] : []),
            '3) SE FALTA PARTE DO PEDIDO do usuário (veja a conversa e o objetivo) e nada bloqueia: NÃO pare. Responda com',
            '   {"tipo":"plano","continuacao":true,...} com o plano do que falta: o sistema começa sozinho. Se falta uma resposta do',
            '   usuário que bloqueia, NÃO mande plano: só as perguntas (tipo "resposta"); o plano vem depois que ele responder.',
            '4) Perguntas: SÓ o que bloqueia e só o usuário decide — no campo "perguntas" (cartões com opções). Nada de pedir para ele rodar',
            '   testes, build, comandos ou atualizar o servidor quando o sistema pode fazer isso (conferências e ferramenta SSH).',
            '   Se tudo foi feito e não há bloqueio: só o resumo, sem perguntas. Pedido totalmente concluído: {"tipo":"resposta"}.',
          ]
        : [
      '## Mensagem atual do usuário',
      ...currentMessage,

          ]),
    ].join('\n');
}
