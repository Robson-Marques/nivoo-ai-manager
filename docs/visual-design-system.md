# Nivoo Visual Design System — plano de expansão

## Frente 01/10 — perfil visual persistente

Fonte única: Project.visualProfile (JSONB nullable) e Project.visualProfileRevision (inteiro de concorrência, inicial 0). Schema JSON v1: mode guided (preferências explícitas, ausentes não decididas) ou delegated (IA escolhe somente o que ainda não foi definido); IDs opcionais de estilo, paleta, layout, fonte de títulos/texto/mono; tema light/dark/system, densidade compact/balanced/spacious e uso desktop/mobile/both. A ausência não altera projeto antigo. IDs são sintaticamente validados nesta frente; existência, tokens e licença do catálogo serão validados nas frentes seguintes. O campo não contém CSS, URLs, instruções livres, chaves ou fontes binárias.

GET /api/projects/:pid já devolve os dois campos. PATCH /api/projects/:pid/visual-profile recebe {expectedRevision,profile}; substituição completa, null explicitamente limpa. Rev antiga ou alteração concorrente de área retorna 409; perfil inválido retorna 400. A gravação é explícita pela API de projetos, não pela saída textual da IA ou por memória automática. Não há histórico de conteúdo de perfis nesta frente; revision é controle de concorrência, não armazenamento de versões anteriores. O perfil compartilhado existente inclui apenas as preferências presentes em projetos compatíveis com software; em área audiovisual fica inativo sem apagar o valor armazenado. Não há geração de UI, aplicação automática de Liquid Glass nem catálogo funcional nesta frente.

A migração é aditiva. 26 Skills v1.4.9 preservadas. Sem novo provedor, serviço, fila, dependência ou CI. Claude, Codex e Gemini permanecem prioritários. Build, migration deploy e Jest dependem do ambiente de instalação/teste; não afirmar que passaram sem execução.

## Sequência aprovada

1. Perfil visual persistente.
2. Catálogo de estilos.
3. Catálogo tipográfico.
4. Cores e tokens.
5. Skill Liquid Glass.
6. Template Liquid Glass.
7. Componentes.
8. Assistente de definição visual.
9. Interface e prévia.
10. Integração, consolidação e preparação da validação prática.

## Validação prática após frente 10 (não substituir por novas implementações)

Executar nivoo update e confirmar saúde, migração, versão e logs. Em projeto descartável, criar um sistema pequeno porém funcional de cadastro de clientes, CRUD, filtros, persistência, dashboard, estados, identidade e responsividade. Testar com Claude, Codex e Gemini prioritários e Goldfish somente onde suportado. Conferir resultado real e as Skills pertinentes, com cenários complementares para as que não forem exercitadas pelo CRUD; não forçar todas no mesmo prompt.

Experimento controlado de eficiência: comparar configuração habitual com execução enxuta/seleção de contexto ativada e uma configuração de referência que desabilite somente a orientação avaliada (isoladamente, em ambiente de teste), mantendo versão do modelo, provedor, briefing, estado inicial, ferramentas, critérios e condições iguais. Alternar ordem e repetir em projetos/cópias equivalentes para reduzir variância; não misturar modelos no cálculo. Registrar tokens de entrada e saída efetivamente reportados, cache/razão quando disponíveis, custo reportado, tempo, número de sessões, falhas e critérios de aceitação. Não estimar tokens a partir de caracteres como se fossem contagens reais nem confundir custo de assinatura com cobrança por token. Ausência de contagem = dado indisponível, não zero. Comparar primeiro qualidade funcional e visual equivalente; economia percentual = (tokens referência - tokens variante) / tokens referência quando referência > 0, por provedor. Medir total do trabalho incluindo planejamento e novas tentativas, não só a sessão mais barata. Nenhuma promessa de economia antes de medição. A instrumentação ou opção de comparação isolada será tratada na frente de integração, se necessária; ainda não existe nesta alteração.

## Frente 02/10 — catálogo de estilos

Catálogo inicial de autoria local, versão 1, IDs estáveis: liquid-glass (Liquid Glass), minimalist (Minimalista), corporate (Corporativo), premium-dark (Premium Dark). GET /api/projects/visual-styles devolve metadados estáticos: descrição, casos de uso indicados, tema recomendado, descritores para prévia futura e orientação compacta. O tema recomendado não altera a preferência explícita; nenhum estilo, cor, fonte ou densidade é aplicado automaticamente. O perfil visual valida a existência do estilo em novas gravações; valores legados desconhecidos permanecem legíveis, sem aplicar instruções inventadas ou substituição automática. O contexto compartilhado contém apenas a orientação do estilo escolhido, sem carregar o catálogo inteiro. Não há integração com serviço externo, cópia de prompts, fontes, imagens, CSS ou componentes de terceiros. Os descritores da prévia não são uma renderização nem tokens reais; os templates, tipografia, tokens e seletor serão desenvolvidos nas respectivas frentes. O catálogo é extensível por código, não por cadastro dinâmico nesta etapa. Sem migração adicional, dependência, serviço, fila ou alteração das 26 Skills. Build, Jest, API real e avaliação visual pendentes; benchmark de tokens permanece previsto após frente 10.

## Frente 03/10 — catálogo de tipografia

Catálogo v1 com 8 opções (system-sans, system-serif, system-mono, inter, manrope, ibm-plex-sans, ibm-plex-serif, ibm-plex-mono) e cinco combinações opcionais: native, inter-ui, geometric, plex-technical e plex-editorial. GET /api/projects/visual-typography entrega metadados, papéis, stacks CSS de fallback, disponibilidade, licença/fonte de referência e combinações com estilos sugeridos. A edição OFL de Manrope é a publicada no Google Fonts. O perfil valida IDs e papéis em novas gravações; valores legados continuam legíveis, com aviso sem substituição automática. Combinações são sugestões: persistem-se os IDs por papel, sem defaults silenciosos ou combinação fechada. Contexto compartilhado inclui apenas famílias escolhidas, deduplicadas, e orientação compacta. Sem download, CDN, assets, dependências, fontes incorporadas ou prévias reais nesta etapa; não afirmar que fallback renderiza fonte nominal. Licenciamento documentado em docs/third-party/typography/. Sem migração adicional ou alteração das 26 Skills. Build, Jest, API real e avaliação tipográfica em navegador pendentes. Benchmark de tokens permanece após frente 10.
