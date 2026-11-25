# Liqui Design — integração original
Fonte: https://github.com/leefanv/liqui-design/tree/27fea1b66069fcb8dcce133486c6fe5f49744db9
Versão do núcleo: 0.8.0. Licença MIT, Copyright (c) 2026 Fan Li.
O código de packages/glass/src está preservado em apps/web/src/vendor/liqui, com LICENSE original. O adaptador nivoo.tsx e nivoo-layout.css são integração Nivoo, não o motor.
Os 38 componentes React e os auxiliares originais do registry estão em apps/web/vendor/liqui-registry, fora da compilação do Nivoo. O registry inclui dependências e metadados originais. Para usá-los, o projeto destino precisa de React 18/19, Tailwind v4, Base UI e demais dependências indicadas. O núcleo não exige Tailwind e é compilado com o React existente.
O Prism usa prismGlassTheme oficial, Frosted usa defaultGlassTheme, Crystal e Dark adaptam parâmetros do mesmo núcleo. Os IDs persistidos são preservados. A prévia utiliza LiquiBackdrop e LiquiGlass do código original. Chromium permite refração do backdrop; Safari/Firefox usam copy quando há fundo conhecido ou frost/clear, conforme detecção do núcleo.
Não copiamos fotografias do site, prompts da galeria, nem tecnologia proprietária Apple. O fundo da prévia é uma composição geométrica diagnóstica, não uma imitação de refração.
O núcleo e os componentes são fornecidos localmente às sessões da Skill; verifique licença, tecnologia, contraste, funcionamento, desempenho e renderização real antes da entrega. Nenhum pacote adicional instalado no Nivoo. A integração completa dos componentes do registry em um produto depende de sua pilha e dependências.
