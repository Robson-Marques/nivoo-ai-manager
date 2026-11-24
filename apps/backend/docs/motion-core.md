# Nivoo Motion Core v1 — compositor reutilizável

## Objetivo
A IA deve especificar **o conteúdo da cena**; o núcleo deve desenhar fotos, manter camadas independentes, aplicar sombras, profundidade e ritmo. O renderer não deve exigir que cada modelo implemente manualmente WebGL para foto de produto, nem repetir render por reprovação artística.

## Formatos integrados ao mesmo `nivoo-renderizar-motion`

### Composição declarativa (recomendada)
Em `motion/<nome>/scene.json`, criar um JSON com `version:1`, `width`, `height`, `duration`, `background`, `profile` e `layers`.

Exemplo executável sem assets: `apps/backend/examples/motion-scene-v1.json`.

```json
{
  "version": 1,
  "width": 1080, "height": 1920, "duration": 20,
  "profile": "energetic",
  "background": "#090402",
  "pacing": { "sourceDuration": 25, "openingEnd": 7.15, "openingSeconds": 3.5 },
  "layers": [
    { "id": "base", "type": "shape", "shape": "ellipse",
      "x": 540, "y": 1250, "z": 10, "width": 690, "height": 220,
      "fill": "#713a17" },
    { "id": "produto", "type": "image", "asset": "assets/produto.png",
      "x": 540, "y": 1040, "z": 5, "supportZ": 10, "width": 620, "height": 620,
      "keys": [
        { "at": 13, "x": -350, "opacity": 0 },
        { "at": 15, "x": 540, "opacity": 1, "easing": "out" }
      ] }
  ]
}
```

O motor:
- Lê imagens locais (`png`, `jpeg`, `webp`) e módulos `.js` legados que contenham exatamente **uma** `data:image/...;base64`; o módulo é interpretado como dado, sem execução de JavaScript.
- Permite caminho de asset para pasta irmã somente dentro do mesmo `motion/`; bloqueia travessia para fora, symlinks externos e downloads da internet.
- Desenha cada fotografia RGBA uma única vez, sem produzir cópias escurecidas.
- Define `z >= supportZ + 1` para o produto ficar à frente do suporte. A sombra acompanha a própria imagem; não gira a foto em um plano que atravessa malhas opacas.
- Aceita `shape` (rect, roundRect, ellipse), `text`, `image`, `neon`; propriedades de animação por `keys`: `at`, `x`, `y`, `rotation` (graus), `opacity`, `scale`, `easing`.
- Controla tempos por `pacing`; perfil energético com néon pode antecipar a revelação para ~3,5 s, se a composição não definir outro valor.
- Valida a estrutura e a existência dos assets ANTES de capturar o primeiro quadro. Erros técnicos são descritos; não se cria outra sessão de revisão por IA.

### Geometria 3D customizada (WebGL + camada de fotos)
Quando realmente precisar de malhas 3D, continue usando `motion/<nome>/index.html` para as malhas, câmera e iluminação. Na mesma pasta crie `overlays.json` no formato acima, contendo fotografias/logos que devem estar **na frente da geometria**.

O Nivoo injeta um canvas transparente por cima do WebGL e desenha as fotografias e sombras **com a mesma duração e o tempo exato dos quadros**. Não desenhar outra cópia da fotografia dentro do shader/malha WebGL.

A modalidade híbrida preserva WebGL real, mas um overlay fica visualmente acima da cena 3D. Se um produto precisa circular *entre* malhas em diferentes profundidades, isso ainda exige modelagem/oclusão específica da cena e avaliação do resultado pelo usuário.

### Compatibilidade
Projetos antigos que têm somente `index.html` continuam renderizando como antes. Projetos com `scene.json` usam o núcleo; com `index.html` + `overlays.json` usam o híbrido. A migração de HTML 3D antigo não é automática, pois não se pode identificar geometria arbitrária com segurança nem remover desenhos antigos sem conhecer a cena.

## Uso
```bash
nivoo-renderizar-motion motion/minha-cena --saida midia/saida/minha-cena-v2.mp4 --segundos 20 --tamanho 1080x1920
```

O destino deve ser novo; os MP4 anteriores não são sobrescritos. O motor utiliza cache de quadros do próprio renderizador.

## Verificação, limites e aprovação
Checagens técnicas (arquivo MP4, áudio quando solicitado, duração, resolução e codec) são responsabilidade do Nivoo. Avaliação de estética, ritmo, legibilidade, composição ou necessidade de regravar é do usuário. Não gerar parecer artístico de IA obrigatório nem recomeçar um MP4 devido a resultado visual subjetivo.

**Limite explícito:** motor v1 cobre motion design estruturado e overlays sobre WebGL. Não substitui modelador 3D geral nem garante que código WebGL arbitrário não contenha erros de geometria. O objetivo é reduzir a necessidade de gerar esse código nos casos que o motor nativo suporta.

### Composição HTML com overlay vazio

`scene.json` continua exigindo de 1 a 180 camadas. `overlays.json` é complementar: uma lista `layers: []` explicitamente vazia, com metadados v1 válidos, não monta canvas adicional e não impede o render do HTML. Isso permite deformação de fotos no Canvas e reaproveitamento de composições anteriores sem duplicar a pizza/queijo. JSON ausente quando exigido, lista inválida e excesso de camadas continuam sendo erros. O diagnóstico identifica o arquivo e o número recebido. O modo HTML explícito é respeitado, e instruções de deformação/Canvas favorecem autoria gráfica em vez de impor uma cena declarativa. A qualidade dos pixels e os insumos do HTML continuam dependentes da composição real.
