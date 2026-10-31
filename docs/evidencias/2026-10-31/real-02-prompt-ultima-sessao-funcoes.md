# Nivoo AI Manager — contexto da execução

## Regras invioláveis
- Você está executando dentro de um workspace isolado. Não acesse arquivos fora do diretório atual.
- É PROIBIDO executar operações financeiras reais, enviar ordens, acessar corretoras ou contas reais.
- Não execute ações destrutivas (remoções recursivas, git push --force, reset --hard, DROP).
- Não altere a branch main. Trabalhe apenas na branch atual.
- Você NÃO decide se o trabalho está concluído: o backend verifica critérios e evidências.
- Grave resultados verificáveis (dados, código, parâmetros, métricas) no diretório indicado em NIVOO_OUTPUT_DIR.

## Objetivo original (v1, sha256 6098e2abd7d60e3d542fb5d336ac466dbad21e7b2319743ffe08625c6206b295)
Implementar em Python as funções de indicadores media_movel, desvio_padrao e zscore (uma por arquivo em src/) usando a janela padrão definida nas decisões aprovadas do projeto, e documentar em out/resumo.md citando a hipótese em investigação. [marcador-objetivo: OBJ-CONT-91X]

## Critérios de aceitação do job (verificados pelo backend, não por você)
- [PENDENTE] arquivos (FILE_EXISTS): código versionado
- [PENDENTE] resumo (ARTIFACT_PRESENT): resumo cita hipótese e decisão
- [PENDENTE] testes (COMMAND): funções corretas com janela 20

## Etapas
- [EXECUTANDO] funcoes: funcoes  <== ETAPA ATUAL
- [PENDENTE] resumo: resumo

## Verificação desta etapa (executada pelo backend ao fim da sessão)
```
cd src && python3 -c "import inspect,media_movel as a,desvio_padrao as b,zscore as c; assert all(inspect.signature(f).parameters['n'].default==20 for f in (a.media_movel,b.desvio_padrao,c.zscore)); xs=[float(i) for i in range(1,41)]; assert abs(a.media_movel(xs)-30.5)<1e-9; assert abs(b.desvio_padrao(xs)-5.766281297335398)<1e-6; assert abs(c.zscore(xs)-(40-30.5)/5.766281297335398)<1e-6"
```

## Sessões desta etapa: esta é a sessão 4
As sessões anteriores terminaram sem concluir a etapa. Continue de onde pararam; NÃO recomece do zero e não repita abordagens que falharam.
- sessão 1: SESSAO_ENCERRADA (término: max_turns) verificação da etapa falhou (exit 1): Traceback (most recent call last):
  File "<string>", line 1, in <module>
    import inspect,media_movel as a,desvio_padrao as b,zscore as c; assert all(inspect.signature(f).parameters['n'].default==20 for f in (a.media_movel,b.desvio_padrao,c.zscore)); xs=[float(i) for i in range(1,41)]; assert abs(a.media_movel(xs)-30.5)<1e-9; assert abs(b.desvio_padrao(xs)-
- sessão 2: INTERROMPIDA (término: -) worker perdido (worker-A-real); lease expirado
- sessão 3: EXECUTANDO (término: -) 

## Como registrar progresso (obrigatório antes de terminar a sessão)
Acrescente linhas JSON (uma por linha) em `.nivoo/notas.jsonl` no diretório atual, por exemplo:
{"tipo": "PROGRESSO", "titulo": "...", "conteudo": "o que foi feito e o que falta"}
Tipos: HIPOTESE, DECISAO_PROPOSTA, EVIDENCIA (com "arquivos": ["out/..."]), PENDENCIA, PROGRESSO.
Nunca apague ou reescreva linhas existentes desse arquivo. A memória completa do projeto está em `.nivoo/memoria.md`.

Resultados e evidências: grave em out/ ($NIVOO_OUTPUT_DIR). Você não decide se o trabalho terminou.

## Memória do projeto (fonte da verdade, por prioridade; inclui notas e lições de sessões anteriores)
- [DECISAO_APROVADA] D-JAN-20: janela padrão: Decisão D-JAN-20: a janela padrão dos indicadores é 20 períodos. (autor operador)
- [ESPECIFICACAO] Especificação inicial: Projeto de teste continuidade real (autor operador)
- [HIPOTESE_INVESTIGACAO] H-CONT-7Q: o z-score de 20 períodos identifica excessos que revertem: código de rastreio H-CONT-7Q (autor operador)
- [PENDENCIA] media_movel criada: [progresso] Sessão 2: criado src/media_movel.py com media_movel(xs, n=20) (D-JAN-20). Falta: src/desvio_padrao.py e src/zscore.py. (autor agente:claude-code-cli:sessao:d74a2614-7a78-4b22-bbcc-62d68713070e)

## Último checkpoint #1 (sessão 1 encerrada sem concluir funcoes; commit 5bcb54dc7d8fc036726ead3b5ef25b553e6de2f1)
{"etapa":"funcoes","notas":1,"etapas":{"resumo":"PENDENTE","funcoes":"EXECUTANDO"},"progresso":true,"tentativa":1}

## Tarefa desta etapa
Crie, UM ARQUIVO POR VEZ e nesta ordem, src/media_movel.py (função media_movel(xs, n=JANELA)), src/desvio_padrao.py (função desvio_padrao(xs, n=JANELA), desvio populacional) e src/zscore.py (função zscore(xs, n=JANELA) = (último - média)/desvio da janela final; importe das outras com "from media_movel import media_movel" e "from desvio_padrao import desvio_padrao").
JANELA é o valor padrão definido na decisão aprovada do projeto. Cada função recebe lista de floats e calcula sobre os últimos n valores.
Não explore o diretório: o contexto (checkpoint, notas e memória) diz o que sessões anteriores já fizeram. Se estiver em dúvida, use no máximo um Glob em src/.
Logo após criar cada arquivo, acrescente uma nota PROGRESSO em .nivoo/notas.jsonl dizendo o que foi feito e o que falta.
