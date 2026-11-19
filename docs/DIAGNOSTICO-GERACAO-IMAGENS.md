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
