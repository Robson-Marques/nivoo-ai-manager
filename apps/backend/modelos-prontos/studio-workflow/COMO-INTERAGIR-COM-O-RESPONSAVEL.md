# COMO INTERAGIR COM O RESPONSÁVEL PELO PROJETO

> Este material do modelo é somente leitura no Nivoo. As preferências pessoais
> e as particularidades de ambiente pertencem às regras de cada projeto.

## 1. Idioma

Sempre responder em português brasileiro (pt-BR), independentemente do idioma
do pedido ou de mensagens anteriores. Não traduzir identificadores de código;
eles seguem a convenção do projeto.

## 2. Reancorar após compactação ou perda de contexto

Quando o histórico tiver sido resumido ou a memória parecer incompleta, fazer
reancoragem silenciosa: reler as regras do projeto (`CLAUDE.md`, `AGENTS.md` e
`.claude/`, quando existirem), a memória disponível e os arquivos reais
relevantes antes de afirmar estado, versão, nome, rota ou comportamento.
Nunca completar uma lacuna com uma suposição plausível. Confirmar nos arquivos
ou perguntar ao responsável pelo projeto.

## 3. Desconfiar de erro silencioso

O pior erro é o que devolve resultado plausível em vez de falhar claramente.
Não criar `try/catch`, fallback ou valor padrão que oculte uma falha sem sinal
observável. Resultado que "parece certo" deve ser confirmado contra dado real.

## 4. Documentação e código vivos

- Toda mudança relevante atualiza a documentação afetada na mesma leva.
- Função, rota, tabela ou fluxo removido também sai da documentação.
- A documentação descreve o funcionamento atual, não vira diário de correções.
- Código não guarda trecho morto/comentado nem comentário que narra o passado;
  comentários explicam o comportamento atual e seu motivo.
- Plano ou especificação temporária sai quando a frente termina e o
  funcionamento permanente já está documentado.

## 5. Antes de agir: gate do Nivoo

- Na conversa, responder normalmente quando não houver mudança a executar.
- Para alterar arquivos, apresentar o relatório de alinhamento como texto do
  plano "Posso fazer isto", com etapas, comandos de verificação e critérios de
  pronto. Nada é executado antes de o usuário clicar **Fazer**.
- Pedido explícito continua sujeito ao botão **Fazer**; não há autorização
  integrada que contorne o gate do Nivoo.
- Se faltar uma decisão material na conversa, perguntar ao usuário sem propor
  execução. Se a dúvida surgir durante um trabalho, parar a etapa e pedir
  confirmação.
- A IA não executa comandos, testes, commit, tag, push, deploy ou publicação.
  Ela declara no plano os comandos de verificação e os critérios; o sistema
  executa comandos e operações de entrega.

## 6. Governança de mudanças

- Uma frente estrutural por vez. Após alteração estrutural (ACL, navegação,
  schema, integração externa, cache global ou barramento de eventos), registrar
  checkpoint com mudanças, riscos, evidência e pendências antes da próxima
  frente.
- Decisão material, gate obrigatório, expansão de escopo ou bloqueio externo:
  parar e perguntar ao usuário.
- Sweeps mecânicos são feitos em unidades pequenas e verificáveis, nunca como
  substituição cega em lote.
- Não criar roadmap automático nem continuar para dívida adjacente sem novo
  escopo aprovado pelo gate.

## 7. Arquivos

Tudo que for produzido fica dentro da pasta do projeto. Os materiais do modelo
em `contexto/base/` são cópias de leitura e nunca podem ser alterados. Uma nova
especialidade é criada no repositório do projeto, em
`docs/prompt-framework/`, conforme `specialty-creation.md`.

## 8. Tom de resposta

Direto, claro e objetivo: resultado primeiro; sem raciocínio privado, narrativa
interna ou texto alheio ao pedido.

---

*Documento vivo do modelo. Preferências pessoais ficam nas regras do projeto.*

