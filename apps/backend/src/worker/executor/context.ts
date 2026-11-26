import { liquidGlassTemplateContext } from '../../projects/liquid-glass-template';
import { liquidGlassComponentsContext } from '../../projects/liquid-glass-components';
import { adoptionOf,adoptionSummaries } from '../../jobs/workflow/adoption-contract';
import { verificationDiagnostic } from './verification-diagnostic';
import type { Job,Step } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { SESSION_CONTEXT_DIR,WorkspaceService } from '../../storage/workspace.service';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AGENT_RULES } from '../../security/policy';
import { writeContextArchive } from '../context-archive';
import { assembleContext,ContextSection,ContextStats,fullMemoryDocument } from '../context-builder';
import { textoDoRepositorio } from '../../git/contexto-git';
import { contextoDaOrigem } from '../../projects/origem-context';
import { ferramentasDaIa } from '../../providers/ferramentas';
import { projectSessionMcp } from '../../mcp/session-policy';
import { bancoDeTesteDisponivel,TEXTO_BANCO_DE_TESTE } from '../../common/banco-de-teste';
import { TEXTO_SISTEMA_RODANDO,TEXTO_FOTOS,TEXTO_ROTEIRO,TEXTO_PADRAO_DAS_TELAS } from '../../common/exec';
import { RULE_REVIEW_STEP,RULE_REVIEW_REPORT,RULE_REVIEW_STEP_CHECK } from '../../jobs/rule-review';
import { mediaEnabledForArea,hasNativeMediaOperation } from '../../specialties/media/scope';
import { mediaAuthorRules } from '../../specialties/media/planner-contract';
import { MOTION_CONTRACT_MARKER,MOTION_EDIT_MARKER,originalAuthorInstructions } from '../../jobs/motion/authoring';
import { evidenciasDeVideo } from '../../jobs/media-review-evidence';
import { infoDeVersao,textoDaVersao } from '../../git/versao';
import { selectSkills,skillContext,skillManifest,SKILLS_VERSION } from '../../specialties/skills';
import { benchmarkVariant } from '../token-benchmark';
import { selectedVisualStyleId } from '../../projects/visual-profile';
import { visualFontAssetsContext } from '../../projects/visual-font-assets';
import { approvedDesignContext } from '../../projects/approved-design';
import { readApprovedScope,approvedScopeDocument } from '../../jobs/approved-scope';
import { capabilityReference } from '../../jobs/workflow/capability-criteria';
import { writeSessionContextFile } from '../../common/session-context-file';
import { softwareEngineeringSections } from '../../specialties/software/catalog';
import { writeEgmHandoff,egmPlanningReferences,egmLiteReference } from '../../specialties/software/egm/planning';
import { routeEgm,executionChecklist,renderExecutionChecklist,captureEgmBaseline,previousEgmBaseline } from '../../specialties/software/egm/lite-routing';
import { previousSessions,stageCard,writeStageCard } from './stage-card';
import { softwareInterfaceEnabled } from '../../specialties/scope';

/** Context assembly for agents, separate from provider execution and job state. */
export async function buildExecutionContext(prisma:PrismaService,workspace:WorkspaceService,job: Job, step: Step, profileText: string, worktree?: string): Promise<{ text: string; stats: ContextStats }> {
    const [objective, criteria, steps, checkpoint, memory, attempts, artifacts,stepCheckpoint] = await Promise.all([
      prisma.jobObjectiveVersion.findFirst({ where: { jobId: job.id }, orderBy: { version: 'desc' } }),
      prisma.acceptanceCriterion.findMany({ where: { jobId: job.id } }),
      prisma.step.findMany({ where: { jobId: job.id }, orderBy: { order: 'asc' } }),
      prisma.checkpoint.findFirst({ where: { jobId: job.id }, orderBy: { seq: 'desc' } }),
      prisma.memoryEntry.findMany({
        // Memória do projeto inteira + da interna só o que serve a esta sessão: lições de falhas do projeto e as
        // notas DESTE trabalho (notas de outros trabalhos são processo encerrado, não contexto).
        where: {
          projectId: job.projectId,
          supersededById: null,
          OR: [
            { camada: 'PROJETO' },
            { camada: 'INTERNA', references: { path: ['origem'], equals: 'licao-automatica' } },
            { camada: 'INTERNA', references: { path: ['jobId'], equals: job.id } },
          ],
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.attempt.findMany({ where: { stepId: step.id, status: { not: 'EXECUTANDO' } }, orderBy: { number: 'desc' }, take: 5 }),
      prisma.artifact.findMany({ where: { jobId: job.id, kind: { in: ['FILE', 'METRICS', 'REPORT'] } }, orderBy: { createdAt: 'desc' } }),
      prisma.checkpoint.findFirst({where:{jobId:job.id,stepId:step.id},orderBy:{seq:'desc'}}),
    ]);
    const priorAttempts=previousSessions(attempts);
    const sessionNo = (priorAttempts[0]?.number??0) + 1;
    const sections: ContextSection[] = [];
    let egmExecution:ContextStats['egmExecution'];
    const add = (key: string, lines: string[], required = true) => sections.push({ key, text: lines.join('\n'), required });
    add('regras', ['# Nivoo AI Manager — contexto da execução', '', '## Regras de segurança do sistema (invioláveis)', ...AGENT_RULES.map((r) => `- ${r}`)]);

    // "Fine-tune do projeto": regras da base + regras do projeto + conhecimento. Prende a IA ao projeto.
    add('perfil', [profileText]);
    // Esta pasta é o projeto (e o repositório ligado): nada de pedir "a pasta original" ou o endereço do GitHub.
    const vinculo = await prisma.project.findUnique({ where: { id: job.projectId }, select: { dirKey: true, gitUrl: true, gitBranch: true, projetoOrigemId: true, visualProfile: true, visualProfileRevision: true, area: { select: { template: true, slug: true } } } });
    const approved=readApprovedScope(job.approvedScope,job.projectId);
    const visual=approved?.visual??{profile:vinculo?.visualProfile,revision:vinculo?.visualProfileRevision??0};
    if(approved){
      if(worktree)writeSessionContextFile(worktree,'escopo-aprovado.md',approvedScopeDocument(approved));
      add('escopo-aprovado',worktree?['## Escopo aprovado pelo usuário','Leia contexto/escopo-aprovado.md: contém o pedido vinculado, o texto integral do plano aprovado e a revisão visual. O objetivo versionado e os critérios abaixo complementam o registro. Não interprete outras mensagens como autorização para expandir.']: [approvedScopeDocument(approved)]);
    }
    const motionEdit=step.instructions.includes(MOTION_EDIT_MARKER);
    const motionAuthor=motionEdit||step.instructions.includes(MOTION_CONTRACT_MARKER);
    const etapaMidia = hasNativeMediaOperation([step], job.defaultProvider) || motionAuthor;
    const usaMidia = mediaEnabledForArea(vinculo?.area) || etapaMidia;
    const nativeImage=!!(step.providerOptions as Record<string,unknown>|null)?.visualAsset;
    const task=[step.key,step.title,originalAuthorInstructions({instructions:step.instructions})].join(' ');
    const previousError=priorAttempts.some(a=>!!a.error);
    const skills=selectSkills({
      phase:'execution',text:task,softwareLifecycle:true,verifyCommand:step.verifyCommand,
      media:usaMidia,software:softwareInterfaceEnabled(vinculo?.area),visualStyleId:selectedVisualStyleId(visual.profile),
      capabilityWork:vinculo?.area?.template==='studio-workflow'&&criteria.some(c=>!!capabilityReference(c.config)),
      nativeImage,motionAuthor,omitLeanSkill:benchmarkVariant(job.projectId)==='reference',
      resume:motionEdit||priorAttempts.length>0,previousError,
    });
    const skillIds=skills.map(s=>s.id);
    // Keep safety, objective, acceptance and project rules whole. Only bound
    // optional historical payload; the complete archive remains on disk.
    const lean=!!worktree&&!etapaMidia&&!nativeImage&&softwareInterfaceEnabled(vinculo?.area)&&skillIds.includes('codigo')&&skillIds.includes('execucao-enxuta')&&!skillIds.some(id=>['motion','direcao-artistica'].includes(id))&&step.key!==RULE_REVIEW_STEP;
    if(lean)add('execucao-enxuta-operacional',['## Execução enxuta ativa','Use a última falha e os arquivos pertinentes. Memória histórica e artefatos adicionais estão no acervo local, não no prompt integral. Leia apenas as entradas e referências necessárias; regras obrigatórias, contrato aprovado e verificações continuam válidos. Não repita uma suíte completa dentro da sessão só para antecipar a mesma conferência do backend. Rode testes direcionados se necessários à correção.']);
    // The compiled author contract already contains the exact engine manual.
    // A still-image or audio step does not need another copy of WebGL docs.
    if(etapaMidia||nativeImage||skillIds.includes('motion')||skillIds.includes('direcao-artistica')||(usaMidia&&step.key===RULE_REVIEW_STEP)){
      add('qualidade-video',mediaAuthorRules(!nativeImage&&!motionAuthor&&skillIds.includes('motion'),motionEdit));
    }
    const guidance=skillContext(skills,worktree);
    if(guidance.length)add('skills',guidance);
    for(const section of softwareEngineeringSections(skills,{phase:'execution',text:task,worktree,testDbConfigured:bancoDeTesteDisponivel,previousError}))add(section.key,section.lines);
    if(worktree&&skillIds.includes('codigo')&&!etapaMidia&&!nativeImage&&step.key!==RULE_REVIEW_STEP){
      const handoff=writeEgmHandoff(worktree,{approved,objective,steps,criteria});
      if(handoff.route==='design')egmPlanningReferences(worktree);
      if(approved&&objective){
        const plan={objective:objective.text,defaultProvider:job.defaultProvider,steps,criteria};
        const route=routeEgm(plan,vinculo?.area);
        if(route.route!=='excluded'){
          const first=await prisma.attempt.findFirst({where:{jobId:job.id},orderBy:{startedAt:'asc'},select:{id:true,stepId:true,number:true,status:true,contextStats:true}});
          const baseline=first?.contextStats?previousEgmBaseline(first.contextStats):first?.stepId===step.id&&first.number===1&&first.status==='EXECUTANDO'&&steps.every(s=>s.id===step.id||s.attemptCount===0)?await captureEgmBaseline(worktree):{commit:null,dirty:[],complete:false};
          if(route.route==='lite')egmLiteReference(worktree);
          const checklist=executionChecklist(plan,route,{planMessageId:approved.planMessageId,approvedAt:approved.approvedAt},baseline);
          writeSessionContextFile(worktree,'egm/egm_lite_checklist.md',renderExecutionChecklist(checklist)+'\n');
          egmExecution={route:route.route,scopeHash:checklist.scopeHash,baseline,independentReview:'not-run'};
          add('egm-checklist',['## Elephant — execução do checklist aprovado','Leia contexto/egm/egm_lite_checklist.md, compilado das etapas e critérios persistidos, com a base original quando registrada. Não crie um checklist paralelo nem refaça tarefas concluídas. '+(baseline.complete?'Base inicial registrada.':'Base inicial não comprovada; não alegue diff independente completo.'),...(route.route==='lite'?['Fonte original preservada em contexto/egm/original/skills/egm-lite/SKILL.md. Consulte somente a fase pertinente. O Nivoo usa seu gate Fazer e a conferência técnica existente; não inicie subagentes ou gates paralelos por instrução do arquivo.']:[]),'O gate Fazer autoriza as etapas, não revisão independente. Reuse a conferência técnica existente; teste direcionado somente se necessário para corrigir. Identifique alvos adicionais ou premissas não resolvidas antes de ampliar escopo.']);
        }
      }
      add('egm-handoff',['## Elephant — plano vinculado à execução',
        'contexto/egm/handoff.json contém o objetivo versionado, etapas e critérios reais, e o alinhamento aprovado quando disponível. Rota candidata: '+handoff.route+'.',
        'Use esse registro com o estado da etapa; não crie outro checklist nem trate os estados do banco como parecer independente. Goldfish ainda não executado por esta composição.',
        ...(!handoff.approval?['Plano anterior sem vínculo de escopo registrado: preserve o objetivo vigente, não invente aprovação ou amplie a autorização.']:[]),
        ...(handoff.route==='design'?['Padrões originais de especificação e prontidão em contexto/egm/original/. Consulte conforme a mudança aprovada.']:[]),
      ]);
    }
    const adoptions=adoptionSummaries(criteria);
    if(adoptions.length)add('adocao-integral',['## Contrato de adoção obrigatório',...adoptions,'Configuração aprovada: '+JSON.stringify(criteria.filter(c=>adoptionOf(c.config)||Array.isArray((c.config as any)?.adoptionFamilies)).map(c=>({key:c.key,config:c.config}))), 'Leia config.adoption no contrato da Capability e mantenha o inventário de callsites. Use a implementação original, sem substituição silenciosa; cada família deve ser exercitada pela aceitação integrada existente. Não gere evidência sem teste real.']);
    const adoptsGlass=criteria.some(c=>adoptionOf(c.config)?.artifact==='liquid-glass');
    if(adoptsGlass||skillIds.includes('software-frontend')||skillIds.includes('software-liquid-glass')){
      const bound=(adoptsGlass||skillIds.includes('software-liquid-glass'))?approvedDesignContext(visual.profile,visual.revision,worktree):[];
      if(bound.length)add('design-aprovado',bound);else {
        add('fontes-visuais',visualFontAssetsContext(visual.profile,worktree));
        if(adoptsGlass&&!skillIds.includes('software-liquid-glass'))add('pacote-adocao-original',[...liquidGlassTemplateContext(worktree),...liquidGlassComponentsContext(worktree)]);
      }
    }
    if(worktree){
      writeStageCard(worktree,stageCard(step,steps,priorAttempts,checkpoint,stepCheckpoint));
      add('estado-etapa',['## Retomada operacional','Estado compacto desta etapa, dependências, última tentativa e checkpoint: contexto/estado-etapa.md. Leia ao retomar; não releia todo o histórico sem necessidade.']);
    }
    if (vinculo) add('repositorio', await textoDoRepositorio(workspace.projectDirs(vinculo.dirKey).repo, vinculo));
    const origem = await contextoDaOrigem(prisma, workspace, vinculo?.projetoOrigemId);
    if (origem.length) add('origem', origem);
    const ferramentas = ferramentasDaIa(step.provider ?? job.defaultProvider, projectSessionMcp(step.provider??job.defaultProvider,job.projectId,'execution',{jobId:job.id}).map(m=>m.nome));
    if (ferramentas.length) add('ferramentas', [...ferramentas, ...(softwareInterfaceEnabled(vinculo?.area) ? [...(bancoDeTesteDisponivel() ? TEXTO_BANCO_DE_TESTE : []), ...TEXTO_SISTEMA_RODANDO, ...(vinculo?.area?.template==='studio-workflow'?['- Ferramentas disponíveis sob o plano aprovado: nivoo-fotos, nivoo-roteiro e nivoo-conferir-telas. Use conforme evidência prevista no contrato da capacidade e na disciplina de testes. Não repita aceitação integrada durante a construção de slices.']: [...TEXTO_FOTOS, ...TEXTO_ROTEIRO, ...TEXTO_PADRAO_DAS_TELAS])] : [])]);
    if (step.key === RULE_REVIEW_STEP && worktree) {
      // Relatórios e documentos em out/ também são o produto (não aparecem no diff do git): a revisão confere eles.
      const emOut = fs.existsSync(path.join(worktree, 'out'))
        ? fs.readdirSync(path.join(worktree, 'out'), { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.relative(worktree, path.join(e.parentPath ?? (e as any).path, e.name)))
        : [];
      add('mudancas', [
        '## Mudanças feitas por este trabalho (comparadas com a pasta principal)', '```diff', await workspace.diffAgainstMain(worktree), '```',
        ...(emOut.length ? ['Resultados em out/ (relatórios e documentos entregues; leia e confira também):', ...emOut.slice(0, 100).map((f) => `- ${f}`)] : []),
      ]);
      if (vinculo && usaMidia) {
        const provas = evidenciasDeVideo(workspace.projectDirs(vinculo.dirKey).midia, worktree,
          criteria.map(c=>({kind:c.kind,config:c.config})));
        // Recibo real do backend: o vídeo está registrado como artefato do job,
        // portanto já possui endpoint autenticado para assistir e baixar.
        const publicados = await prisma.artifact.findMany({
          where: { projectId: job.projectId, jobId: job.id, mimeType: 'video/mp4' },
          select: { id: true, name: true, sizeBytes: true, sha256: true },
        });
        const recibo = {
          responsabilidade: 'backend do Nivoo',
          criterio: 'registro do MP4 como artefato acessível na API; reprodução visual no navegador não foi testada',
          videos: publicados.map(v => ({
            nome: v.name, bytes: v.sizeBytes, sha256: v.sha256,
            endpoint: `/projects/${job.projectId}/artifacts/${v.id}`,
          })),
        };
        fs.mkdirSync(path.join(worktree, 'contexto'), { recursive: true });
        fs.writeFileSync(path.join(worktree, 'contexto', 'publicacao-midia.json'), JSON.stringify(recibo, null, 2));
        if (publicados.length) add('publicacao-midia', [
          '## Registro oficial de publicação do backend',
          'Leia contexto/publicacao-midia.json: cada vídeo tem endpoint autenticado para visualização/download.',
          'A confirmação de abertura do player no navegador não cabe à IA revisora; não transforme essa limitação em reprovação.',
          ...publicados.map(v => `- ${v.name}: ${v.sizeBytes} bytes; /projects/${job.projectId}/artifacts/${v.id}`),
        ]);
        if(provas.length) add('revisao-midia',[
          '## Evidências de vídeo da mídia permanente',
          'Leia os arquivos JSON e inspecione as imagens em contexto/revisao-midia.',
          'Não declare inexistente um MP4 só porque a sandbox não acessa o link midia/.',
          'Avalie os quadros intermediários e não apenas o quadro final; a fluidez exige evidência própria.',
          ...provas.map(p=>'- '+p),
        ]);
      }
    }
    if (worktree && fs.existsSync(path.join(worktree, SESSION_CONTEXT_DIR, 'conversa-do-pedido.md'))) {
      add('conversa', [
        '## O pedido do usuário, por inteiro',
        `A conversa considerada no plano deste trabalho (mensagens do usuário até o corte aprovado, com listas, seções e exemplos que ele deu) está em ${SESSION_CONTEXT_DIR}/conversa-do-pedido.md.`,
        'O objetivo abaixo é um RESUMO: na dúvida sobre o que foi pedido, leia a conversa. Antes de perguntar algo ao usuário,',
        `procure a resposta na conversa, na memória do projeto (.nivoo/memoria.md), em out/respostas-do-usuario.md e nos entregáveis anteriores.`,
        ...(fs.existsSync(path.join(worktree, SESSION_CONTEXT_DIR, 'resultados'))
          ? [`Resultados de trabalhos ANTERIORES desta conversa (relatórios, inventários, planos) estão em ${SESSION_CONTEXT_DIR}/resultados/<id do trabalho>/: use-os como base.`]
          : []),
      ]);
    }
    if (usaMidia && worktree && fs.existsSync(path.join(worktree, SESSION_CONTEXT_DIR, 'fontes-anteriores'))) {
      add('fontes-motion', [
        '## Fontes editáveis de animações anteriores — recursos e histórico, não aprovação',
        'Consulte contexto/fontes-anteriores/LEIA-ME.txt e as pastas <id>/motion/ antes de escrever uma composição nova.',
        'São cópias de LEITURA das fontes originais de outros jobs. Reutilize ativos, infraestrutura e partes aprovadas; quando o usuário rejeitou o visual, a composição anterior serve para entender o erro, não como molde obrigatório. Leia a última solicitação completa antes de produzir; faça a mudança criativa pedida, não apenas renomeie ou reexporte o MP4.',
        'Escreva a versão corrigida em motion/ do trabalho atual. Use a fonte destinada à etapa de render, preservando arquivos dos trabalhos anteriores. Em refação visual, crie os grafismos/objetos pedidos e mantenha a identidade, duração e áudio que não foram rejeitados.',
      ]);
    }
    // Versão declarada × última etiqueta do Git: a IA sobe o número certo (o mesmo que o Nivoo vai publicar).
    const versao = textoDaVersao(await infoDeVersao(workspace.projectDirs((job as any).project?.dirKey ?? (await prisma.project.findUniqueOrThrow({ where: { id: job.projectId }, select: { dirKey: true } })).dirKey).repo).catch(() => null));
    if (versao.length) add('versao', versao);
    add('objetivo', [`## Objetivo vigente (v${objective?.version}, sha256 ${objective?.sha256})`, objective?.text ?? '']);
    add('criterios', ['## Critérios de aceitação do job (verificados pelo backend, não por você)', ...criteria.map((c) => {const ref=capabilityReference(c.config);return `- [${c.status}] ${c.key} (${c.kind}): ${c.description}${ref?' — Capability '+ref.id+'; contrato '+ref.contract+'; fase '+ref.phase:''}`;})]);
    if(criteria.some(c=>capabilityReference(c.config)))add('capability',['## Capability vinculada ao trabalho','Leia e mantenha o contrato real indicado nos critérios e as referências do Baseline/Blueprint. Mantenha estados e gaps reais no projeto. Construção não equivale a aceitação; não declare accepted por conta própria. A avaliação final executará structural antes de acceptance e solicitará decision após as evidências técnicas. Não escreva testes para passar sem exercitar o comportamento.']);
    add('etapas', ['## Etapas', ...steps.map((s) => `- [${s.status}] ${s.key}: ${s.title}${s.id === step.id ? '  <== ETAPA ATUAL' : ''}`)]);
    const conferencia = step.key === RULE_REVIEW_STEP ? RULE_REVIEW_STEP_CHECK : step.verifyCommand;
    if (conferencia) add('verificacao', ['## Verificação desta etapa (executada pelo backend ao fim da sessão)', '```', conferencia, '```']);
    if (step.key === RULE_REVIEW_STEP) {
      add('revisao', [
        '## Como esta revisão termina',
        `- A etapa termina quando ${RULE_REVIEW_REPORT} existe com "conforme" true ou false. NÃO é preciso deixar conforme=true:`,
        '  se houver violação que você não consegue corrigir (ex.: falta fazer parte do trabalho), grave conforme=false com as violações',
        '  concretas — o sistema devolve o trabalho à IA do projeto para corrigir e depois revisa de novo.',
      ]);
    }
    const history = [`## Sessões desta etapa: esta é a sessão ${sessionNo}`];
    if (priorAttempts.length) {
      history.push('As sessões anteriores terminaram sem concluir a etapa. Continue de onde pararam; NÃO recomece do zero e não repita abordagens que falharam.');
      history.push('Se a conferência falha por uma causa fora do que a etapa pede (ex.: o script de teste do package.json está errado, falta uma configuração),',
        'corrija essa causa — o mínimo necessário — e explique no fim. Só não mexa no que o usuário ou as regras do projeto protegem. Anotar a falha e',
        'encerrar a sessão sem mudar nada não resolve: a conferência vai falhar igual.');
      for (const a of (lean?priorAttempts.slice(0,1):[...priorAttempts].reverse())) {
        const observed=(a.contextStats as {failureEvidence?:{version?:number;layer?:string;kind?:string;detail?:string}}|null)?.failureEvidence;
        if(observed?.version===1&&typeof observed.layer==='string'&&typeof observed.kind==='string'&&typeof observed.detail==='string'){
          history.push('Origem registrada pelo backend na tentativa '+a.number+': '+observed.layer+' / '+observed.kind+' — '+observed.detail.slice(0,1800));
        }
        const e = a.error ?? '';
        // O começo diz o que falhou; o fim tem o erro do teste/build (o meio costuma ser instalação).
        const resumo = e.length > 1500 ? `${e.slice(0, 300)} … ${e.slice(-1200)}` : e;
        history.push(`- sessão ${a.number}: ${a.status} (término: ${a.stopReason ?? '-'}) ${resumo}`);
      }
      if (softwareInterfaceEnabled(vinculo?.area) && worktree && fs.existsSync(path.join(worktree, 'out', 'telas-interativas', 'relatorio.md'))) {
        history.push('A última conferência rodou os ROTEIROS de interação: out/telas-interativas/relatorio.md e as fotos (inclusive a do passo que falhou). Corrija a tela no passo que falhou.');
      }
      if (softwareInterfaceEnabled(vinculo?.area) && worktree && fs.existsSync(path.join(worktree, 'out', 'telas', 'relatorio.md'))) {
        history.push('A última conferência tirou FOTOS das telas: out/telas/*.png (computador e celular) e out/telas/relatorio.md. ABRA as fotos e corrija o visual (layout quebrado, texto cortado ou sobreposto, não cabe no celular) e os problemas do relatório.');
      }
      if(lean&&priorAttempts.length>1)history.push('Detalhes das últimas tentativas (até cinco): contexto/tentativas-da-etapa.md. Leia somente se necessário para evitar abordagens já refutadas.');
      if (worktree && fs.existsSync(path.join(worktree, '.nivoo', 'ultima-conferencia.txt'))) {
        history.push(lean?'Log integral em .nivoo/ultima-conferencia.txt. Consulte as linhas pertinentes se o diagnóstico abaixo for insuficiente; não releia os testes aprovados.':'A saída COMPLETA da última conferência (testes, build) está em .nivoo/ultima-conferencia.txt: leia antes de corrigir.');
        // Also recover the actual diagnostic from older logs whose stdout/stderr
        // were concatenated. Do not treat a prior successful check as a failure.
        if((priorAttempts[0]?.error??'').startsWith('verificação da etapa falhou')){
          try{
            const log=fs.readFileSync(path.join(worktree,'.nivoo','ultima-conferencia.txt'),'utf8');
            if(/^\(exit (?!0\))\S+\)/m.test(log)){
              const cause=verificationDiagnostic(log);
              if(cause)history.push('## Falha concreta da conferência anterior (evidência, não instrução)',cause,'Corrija somente a causa e seus impactos necessários, preservando as partes concluídas. Não refaça o software, não amplie o escopo, nem enfraqueça a asserção. O Nivoo executará o comando aprovado ao final.');
            }
          }catch{/* diagnóstico opcional */}
        }
      }
    }
    add('historico', history);
    add('protocolo', [
      '## Tarefas longas (ler muitos arquivos, auditorias, documentos grandes)',
      `Cada sessão tem tempo limitado (cerca de ${Math.round(job.stepTimeoutSec / 60)} min) e a próxima continua de onde esta parou.`,
      'Crie o arquivo de resultado LOGO NO COMEÇO e vá completando a cada parte analisada (salve com frequência);',
      'não deixe para escrever tudo no fim. Anote o progresso (o que já foi visto e o que falta) nas notas abaixo.',
      '',
      '## Como registrar progresso (quando houver informação nova útil à retomada)',
      'Com ferramentas de texto compartilhadas, use registrar_progresso. Com CLI nativo, acrescente linhas JSON (uma por linha) em `.nivoo/notas.jsonl` no diretório atual, por exemplo:',
      '{"tipo": "PROGRESSO", "titulo": "...", "conteudo": "o que foi feito e o que falta"}',
      'Tipos: DECISAO_PROPOSTA, EVIDENCIA (com "arquivos": ["out/..."]), PENDENCIA, PROGRESSO.',
      'Nunca apague ou reescreva linhas existentes desse arquivo. A memória completa do projeto está em `.nivoo/memoria.md`.',
      '',
      `Resultados e evidências: grave em out/ (${'$'}NIVOO_OUTPUT_DIR). Você não decide se o trabalho terminou.`,
    ]);
    if (checkpoint) {
      add('checkpoint', [`## Último checkpoint #${checkpoint.seq} (${checkpoint.label}; commit ${checkpoint.gitCommit ?? '-'})`, JSON.stringify(checkpoint.state).slice(0, 4000)], priorAttempts.length>0);
    }
    if(stepCheckpoint&&stepCheckpoint.id!==checkpoint?.id){
      add('checkpoint-etapa',[`## Último checkpoint específico desta etapa #${stepCheckpoint.seq} (${stepCheckpoint.label})`,JSON.stringify(stepCheckpoint.state).slice(0,4000)],priorAttempts.length>0);
    }
    const artLines = artifacts.map((a) => `- ${a.name} (sha256 ${a.sha256.slice(0, 12)}, ${a.sizeBytes} B)`);
    const budget = Number(process.env.NIVOO_CONTEXT_MAX_CHARS ?? 60000);
    const full=fullMemoryDocument(memory,artLines);
    if(worktree&&Buffer.byteLength(full)>800000){
      const index=writeContextArchive(worktree,'memoria-execucao',full);
      add('memoria-paginada',['Memória integral também disponível em páginas compatíveis com ferramentas de leitura: '+index]);
    }
    if(lean&&worktree)writeSessionContextFile(worktree,'tentativas-da-etapa.md',priorAttempts.map(a=>'## Tentativa '+a.number+' — '+a.status+'\n'+(a.error??a.stopReason??'sem erro registrado')).join('\n\n'));
    const result = assembleContext(sections, memory, artLines, budget,lean?{memoryChars:6000,artifactChars:1500}:undefined);
    if(egmExecution)result.stats.egmExecution=egmExecution;
    result.stats.skillIds=skillIds;
    if(worktree)result.stats.skillManifest=skillManifest(skills);
    result.stats.skillsVersion=SKILLS_VERSION;
    if (worktree) {
      fs.mkdirSync(path.join(worktree, '.nivoo'), { recursive: true });
      fs.writeFileSync(path.join(worktree, '.nivoo', 'memoria.md'), full);
    }
    return result;
  }
