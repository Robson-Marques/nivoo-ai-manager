# Gerador de imagem sem saída binária — tratamento seguro

## Incidente observado (2026-11-19)

Em `video pizzaria`, a etapa `fotos` tentou gerar duas fotos pelo skill interno
do Codex, mas a ferramenta não entregou arquivos locais em
`motion/black-quinta-previa/pizza-lombo.png` e
`motion/black-quinta-previa/pizza-peru-amora.png`.
O relatório mencionou imagens geradas fora do workspace; **isso não é prova de
que seus bytes estejam acessíveis ao Nivoo**. O teste de arquivos falhou três
vezes. O limite rígido de sessões interrompeu o ciclo, mas não recuperou fotos.

## Alteração no Nivoo

O preflight em `worker/image-output-guard.ts` bloqueia, **antes da primeira
chamada cobrada de IA**, etapas que combinem: (a) geração de fotos/imagens
inéditas; (b) conector Codex/Claude sem bridge de exportação; e (c) testes
`test -s` que exigem PNG/JPG/WEBP ainda ausentes. Reporta destinos faltantes
e não dispara sessões que não podem produzir os binários.

Isso **não implementa** exportação automática do skill de imagem, pois sua
saída não expõe uma API/arquivo local confiável. Não inventar downloads,
caminhos temporários ou arquivos falsos para satisfazer a conferência.

## Fluxo suportado enquanto não existir bridge binária

1. Usuário fornece as imagens como anexos reais (PNG/JPG/WEBP) na conversa.
2. O planejamento identifica cada anexo em `contexto/anexos/` e cria uma
   etapa de importação determinística (executor local) com destino explícito.
3. A conferência valida existência, dimensões, formato, diferença entre
   arquivos e, se exigido, transparência real; sem comprová-la, não concluir.
4. Só então executar montagem/renderização com os arquivos do projeto.

## Próxima capacidade técnica para habilitar geração automática

Criar um provedor explícito de imagens que devolva bytes, com contrato de
destino no workspace, verificação de formato/alpha e erro de capacidade
antes do planejamento. Habilitar por capability verificada, não por prompt.
A implantação desse provedor dependerá de ferramenta com API de exportação
real, credenciais, custos conhecidos e testes de integração.

## Teste

`npm test --workspace @nivoo/backend -- --runInBand image-output-guard`

A mudança afeta somente o preflight, o texto do planejador e as instruções
de ferramenta. Não remove anexos, snapshots ou o trabalho já bloqueado.

## Executor local de importação

O comando `nivoo-importar-imagem` recebe uma imagem existente em
`contexto/anexos/<mensagem>/<arquivo>` e a entrega no caminho exigido pela
montagem, sem abrir outra sessão de IA. A etapa `local-shell` com esse comando
recebe automaticamente os anexos reais do chat no worktree. O importador
restringe a origem a anexos do projeto e o destino ao projeto, rejeita
travessia, sobrescrita e arquivos que não são imagem.

Exemplo (o identificador da mensagem e nome do arquivo são os reais do anexo):

```bash
nivoo-importar-imagem "contexto/anexos/<id>/lombo.png" "motion/black-quinta-previa/pizza-lombo.png"
nivoo-importar-imagem "contexto/anexos/<id>/peru.png" "motion/black-quinta-previa/pizza-peru-amora.png"
```

PNG é copiado como PNG; JPEG/WEBP são convertidos com FFmpeg quando o destino
for PNG. O comando não remove fundo automaticamente nem fabrica transparência:
essa exigência continua dependendo de processamento real e validação visual.
