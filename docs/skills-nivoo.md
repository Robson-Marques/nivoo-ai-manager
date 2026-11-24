# Skills Nivoo — primeira implantação

Banco interno versionado e integrado ao planejador e ao contexto do executor. As competências são selecionadas pela solicitação atual ou pela etapa atual; executores determinísticos não recebem prompt. As orientações detalhadas ficam em contexto/skills-nivoo/<id>/SKILL.md, no diretório descartável da sessão. O backend não instala scripts, hooks, modelos, pacotes ou APIs externas. Não é uma instalação nativa de skills no CODEX_HOME ou Claude Code.

Retomada usa dados do banco, worktree, checkpoints e notas existentes. contexto/estado-etapa.md é uma projeção por sessão, não uma nova memória autoritativa. O histórico exclui a tentativa corrente. O registro do prompt e dos logs permite avaliar seleção e consumo; não há redução medida ainda.

## Referências

Orientações originais do Nivoo inspiradas em NVIDIA Agent Skills (Apache-2.0 nos cabeçalhos consultados), versão 71e61c7209cb4ca64cba247a7d20a5438b30aef5, NVIDIA Corporation e colaboradores:
- https://github.com/NVIDIA/skills/tree/71e61c7209cb4ca64cba247a7d20a5438b30aef5/skills/nemo-rl-session-memory
- https://github.com/NVIDIA/skills/tree/71e61c7209cb4ca64cba247a7d20a5438b30aef5/skills/tao-token-efficient-execution
- https://github.com/NVIDIA/skills/tree/71e61c7209cb4ca64cba247a7d20a5438b30aef5/skills/nemo-relay-debug-runtime-integration

Não importamos código ou scripts upstream. O catálogo completo continua externo. As competências de arte, motion, locução e código são próprias, adequadas aos contratos Nivoo. Não prometemos os resultados de benchmarks TAO para o Nivoo. APIs de trial não são autorizadas para produção por esta mudança.

## Implantação por frentes

1. Catálogo, seleção por etapa, materialização protegida, metadados e logs (esta versão).
2. Continuidade: estado real, checkpoints, notas, recuperação e contexto de trabalho.
3. Código e arquivos: contratos de ferramentas, leitura, escrita e edição, binários, publicação, isolamento.
4. Ferramentas e executores: parâmetros reais, dependências, roteamento, responsabilidades.
5. Diagnóstico e recuperação: causa comprovada, evitar repetir falhas, preservar resultado.
6. Contexto e tokens: carregar apenas instruções necessárias, medir por tipo de etapa; não multiplicar sessões.
7. Mídia: autoria, geração visual, Motion, áudio e entrega, com motores existentes.
8. Integração: compatibilidade dos provedores, testes focados e atualização pelo fluxo normal do servidor.

Cada frente é uma alteração verificável no mesmo branch. Não abrir CI/PR adicional ou instalar novas APIs. Não confundir seleção de skills com suporte nativo de uma ferramenta; a skill não concede recursos ou permissões. A frente 1 inclui a orientação inicial de arquivos; a auditoria da implementação de gravação vem na frente 3. Nenhuma economia de tokens ou qualidade artística foi medida ainda.

## Frente 2 — continuidade

As tentativas interrompidas recuperam notas válidas do worktree. Checkpoints também são registrados antes de reagendar falhas e após indisponibilidade de recurso. A conclusão de uma etapa e seu checkpoint são persistidos juntos quando o Git confirma o commit. Erros do Git não são tratados como commit confirmado. O estado de retomada distingue o último checkpoint do job do último checkpoint específico da etapa. Notas são validadas, deduplicadas e associadas à etapa e à tentativa; não importamos texto inválido como memória. A detecção de progresso usa conteúdo de arquivos em out/, em vez de horários de modificação. Não há novos serviços, APIs, chamadas de IA ou migração de banco.

Se o worker cair entre registrar SUCESSO e concluir a etapa, a retomada só finaliza automaticamente quando a tentativa mais recente pertence à execução atual e o hash do worktree coincide com o estado verificado. Caso contrário, preserva os arquivos e informa o impedimento. O caminho de recuperação de mídia continua separado e usa a proveniência dos artefatos. A comparação do hash é uma inspeção local de integridade, não uma nova conferência por IA.

## Frente 3 — ferramentas de código e arquivos

NVIDIA, OpenRouter e Groq usam o mesmo adaptador de texto, com listagem paginada, leitura UTF-8 por trechos, hash para edição condicional, substituição única, gravação atômica e proteção de links. Skills e estado de retomada ficam disponíveis por leitura; registro de notas tem ferramenta própria. Claude, Codex e Gemini mantêm suas ferramentas nativas e políticas. Arquivos binários continuam responsabilidade de executores especializados; nenhum novo endpoint externo. Alterações reais são contadas separadamente de gravações idênticas. A proteção e publicação de artefatos são tratadas na mesma frente.

O contrato das ferramentas de texto não depende mais do provedor NVIDIA: OpenRouter e Groq consomem diretamente o mesmo módulo. O catálogo de artefatos publica arquivos por conteúdo em área temporária no filesystem de destino, valida o hash antes de disponibilizar um blob novo e não sobrescreve um blob já existente. Links não são seguidos na coleta de entregas. Não é uma validação artística ou uma chamada de IA. A correção de movimentações destrutivas, permissões e roteamento fica na frente 4.

## Frente 4 — contratos e executores

Etapas adicionadas a jobs existentes passam pela compilação e validação dos contratos, associam dependências físicas aos produtores já persistidos e validam o grafo completo antes de inserir. Não reescrevem comandos ou dependências de etapas anteriores. As operações de arquivos têm caminhos protegidos em qualquer nível, recusam sobreposição, links, destinos existentes e movimentação entre discos; validam o lote antes de executar. Operações sobre mídia durável ou out/ exigem aprovação explícita, inclusive nos jobs antigos; o diário da IA não pode executar essas operações. A rotina normal de código continua sem segunda confirmação. Os contratos de mídia vinculam referências e entradas aos produtores, aceitam cenas estruturadas e rejeitam entrada igual à saída. Sem novos provedores ou chamadas de IA.

## Frente 5 — diagnóstico e recuperação

Erros de comando, parâmetros ou permissões conhecidos não repetem o mesmo comando. Reparos automáticos exigem mudança real da árvore de código, não apenas relatório em out/. A limitação de sessões é avaliada antes da recaptura. Sessão de código encerrada pelo limite de tempo/turnos pode concluir se a verificação real passar. A reserva não troca etapas com visualAsset ou modelo explícito, não altera outros jobs automaticamente, e não muda o provedor de etapas em execução; preserva o defaultProvider dos jobs existentes. Mantém a preferência do projeto para futuros trabalhos. OpenRouter/Groq propagam Retry-After. Nenhuma nova conferência por IA, API ou dependência.

## Frente 6 — contexto e tokens

O perfil integral é enviado uma vez: no canal de sistema em Claude/NVIDIA/OpenRouter/Groq, ou no prompt dos demais. O prompt de auditoria conserva o texto completo. O planejador não repete a mensagem atual no histórico e fixa o limite temporal à mensagem que está atendendo; histórico e memória completos ficam em páginas de contexto somente leitura, com índice. A memória da execução acima do limite normal de leitura também tem espelho paginado. O reparo de JSON não corta o plano ao meio. As APIs de texto eliminam apenas cópias idênticas de respostas de leitura/listagem na mesma sessão; chamadas, respostas mais recentes, escritas, erros e conteúdo original são preservados. Os logs medem caracteres do prompt-base, omissões, abreviações e tokens reais quando o provedor os informa. Não há economia percentual medida ainda; não há nova chamada de IA para resumir contexto. O orçamento é flexível para regras e objetivos obrigatórios.

## Frente 7 — especialização audiovisual

A montagem local preserva o FPS racional da primeira cena (por exemplo, 30000/1001) ou o FPS inteiro solicitado e propaga esse contrato até a inspeção técnica existente. Não há mais fps=24 fixo na preparação ou sincronização. Ajuste global de duração exige sincronizarVideoComNarracao:true; false preserva duração e impede cortar uma locução longa. Sem opção explícita, a montagem ainda pode estender o último quadro, sem acelerar toda a composição. A linha do tempo de legendas acompanha a alteração autorizada de velocidade. O compilador evita classificar entregas estáticas ou relatórios como composição Motion, respeita seleção híbrida e preserva o modo após a primeira compilação. A skill de montagem e orientações de direção artística e movimento usam os motores já existentes. Não instalamos modelos, não criamos chamadas externas, não adicionamos revisão artística automática. A qualidade criativa continua dependente de ativos, briefing e capacidade do agente; precisa de teste real.

## Frente 8 — integração e atualização

A conferência de operações de arquivos usa a mesma resolução física do executor, inclusive mídia fora do Git; somente os testes shell gerados (atuais e legados) são substituídos, sem dispensar testes personalizados. A aprovação de executores inclui os parâmetros exatos; aprovações antigas de executores podem precisar de nova confirmação. A retomada por hash do worktree não substitui prova da mídia durável nem reexecuta operações destrutivas automaticamente. Ferramentas de texto compartilhadas do planejador são limitadas a leitura, inclusive em reparos do plano. O grafo completo rejeita dependências inexistentes. As Skills continuam versionadas em código e carregadas sob demanda; nenhuma instalação de Skills externas, API nova ou CI.

A integração deve passar pelo procedimento habitual `nivoo update`, que compila o backend e executa os smoke tests existentes antes do reinício. Não considerar funcionamento em produção confirmado antes do resultado da atualização e de trabalhos reais de programação/arquivo, retomada e mídia. Não há porcentagem de economia medida. Manter os trabalhos anteriores e arquivos aprovados.

### Integração de edição pontual (1.2.1)

O marcador de edição Motion seleciona as Skills de retomada e Motion, preserva a disponibilização das fontes anteriores e substitui a orientação geral de criação visual por instruções de alteração delimitada. Busca localiza código, leitura dos contratos e consumidores fundamenta mudanças; compilação e execução são evidências distintas. O instalador vigente compila o sistema, mas não executa os smokes de desenvolvimento. Os testes de regressão permanecem versionados.

## Nivoo Software Engineering — frente 1/10 (Skills 1.3.0)

O catálogo existente passa a incluir oito especializações de software: arquitetura, backend, frontend, dados, integrações, segurança, qualidade e manutenção. As nove Skills anteriores permanecem disponíveis; codigo continua a base transversal. Os IDs são estáveis para as próximas frentes. O seletor comum do planejador e do executor recebe somente a intenção atual normalizada e as permissões de domínio já existentes. Não carrega especializações de software para autoria Motion explícita, geração nativa de imagem ou execução determinística. A seleção por termos é inicial e não comprova a arquitetura real; a próxima frente trabalha leitura e dependências. As orientações detalhadas continuam em contexto/skills-nivoo, somente quando selecionadas. Não há nova chamada de IA, novo agente, pacote externo, migração ou CI. As adaptações de FastGen, NeMo Relay e MCore são práticas de engenharia, não instalação dos runtimes. Dados e segurança são orientações locais. As próximas frentes aprofundam cada especialização, sem declarar que o catálogo sozinho implementa essas capacidades.

### Software Engineering — frente 2/10: compreensão de código e arquitetura

Planejador e executor utilizam o mapa local quando a Skill codigo é selecionada. O mapa é gerado a partir da cópia/worktree real da sessão, não da main presumida, sem baixar repositório ou invocar IA adicional. O índice sob demanda lista manifestos, documentação arquitetural e arquivos reais; nomes ambíguos não são escolhidos automaticamente. Se a tarefa cita arquivos, o parser TypeScript já usado pelo projeto, quando disponível, rastreia referências relativas literais diretas de JS/TS com resolução única. A cobertura é deliberadamente limitada a 12 alvos, 450 fontes, 8 MiB e inventário de 12 mil entradas; aliases, frameworks, reflexão e outras linguagens exigem leitura manual. O mapa não prova compreensão, compilação ou ausência de dependências. Não grava fontes, não segue links durante inventário, não inclui conteúdo de arquivos no índice e não bloqueia o trabalho se indisponível. O agente deve ler implementação, contratos e consumidores reais na mesma sessão produtiva. Sem nova etapa de auditoria, CI ou runtime externo.

### Software Engineering — frente 3/10: backend (1.3.2)

A Skill software-backend mantém o identificador anterior e agora possui contrato operacional próprio. O roteamento reconhece pedidos e nomes de fontes de backend, sem pressupor a existência do componente. Planejador e executor acrescentam orientação compacta somente quando a Skill foi selecionada, com seis focos de tarefa: entrada/saída, negócio, processamento assíncrono, estados, concorrência e falhas. A orientação completa continua no SKILL.md. Não cria filas, serviços, agentes, validações extras ou infraestrutura; não transforma palavras em comandos. O objetivo é entregar comportamento real, rastrear entrada/decisão/efeito/resposta, preservar contratos e distinguir falhas transitórias, permanentes e resultados incertos. A seleção é heurística e não valida o código de terceiros. As conferências existentes continuam responsáveis por compilar e testar. Adaptação metodológica local, inspirada em FastGen; sem dependência do runtime NVIDIA.

### Software Engineering — frente 4/10: frontend (1.3.3)

A Skill software-frontend preserva seu ID e recebe contrato próprio de implementação e seis focos seletivos: componentes/navegação, estado, formulários, API, responsividade e acessibilidade. O planejador e o executor adicionam orientação específica no contexto somente quando a Skill é selecionada. O roteamento reconhece frameworks, arquivos de interface e intenções explícitas sem confundir toda interface TypeScript com uma tela. O agente deve preservar os padrões do projeto, ligar controles a operações reais, distinguir carregamento/vazio/erro/sucesso, lidar com resposta obsoleta e preservar foco/valor de campos. A evidência usa os recursos existentes (nivoo-previa.json, nivoo-roteiros, nivoo-conferir-telas), conforme o contrato e a disponibilidade; foto não comprova persistência. Não há nova instalação, executor, sessão, revisor ou conferência obrigatória além das existentes. Emulação não comprova comportamento no dispositivo físico. Roteamento é heurístico, não inspeção do comportamento de aplicações. Adaptação local de práticas de engenharia FastGen, não instalação NVIDIA.
