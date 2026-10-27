# Relatório — experimento gap300-janela60-validacao

> **ATENÇÃO: DADOS SINTÉTICOS.** Os dados usados neste experimento não são dados de
> mercado. Foram gerados por `gerar_dados.py` com efeito plantado de reversão pós-gap
> e sem efeito de volume. Os resultados servem apenas para validar o pipeline e as
> regras de decisão, não para tirar conclusões sobre o ativo real.

## 1. Objetivo

Medir, no conjunto de **validação sintético**, as métricas especificadas e produzir um
relatório reproduzível que permita ao sistema decidir as hipóteses H1 e H2 pelas regras
pré-registradas. Este relatório **não declara** a decisão das hipóteses; ela é aplicada
pelo sistema.

- **H1:** após |gap| >= 300 pts, a primeira hora reverte o gap.
- **H2:** volume alto na primeira hora antecipa dia de alta.

## 2. Dados

| Campo | Valor |
|---|---|
| Arquivo | `dados/win_sintetico_validacao.csv` |
| Ativo | WIN |
| Papel | VALIDACAO |
| Natureza | **DADOS SINTÉTICOS** (gerados por `gerar_dados.py`; não são dados de mercado) |
| Efeito plantado | reversão pós-gap; sem efeito de volume |
| sha256 | `81d68863476a6c644214480187d64efb9b04e1209973a25fd09aed47cc462f07` |

O arquivo tem 250 dias de pregão em barras de 5 minutos (todos os dias têm as barras de
09:00 a 09:55, ou seja, pelo menos 12 barras). O primeiro dia é descartado porque não
tem fechamento anterior, o que deixa 249 dias na análise.

## 3. Método

Implementação: `src/experimento.py` (Python 3, só biblioteca padrão, determinístico).

Parâmetros: `limiar_gap = 300` pts, `barras_janela = 12` (12 barras de 5 min = 60 min).

Para cada dia *d* (barras agrupadas pelos 10 primeiros caracteres do `timestamp`, na
ordem do arquivo; o primeiro dia é ignorado):

- `gap` = open da 1ª barra de *d* − close da última barra de *d−1*
- `ret60` = close da 12ª barra de *d* − open da 1ª barra de *d*
- `vol1h` = soma do volume das 12 primeiras barras de *d*
- `ret_dia` = close da última barra de *d* − open da 1ª barra de *d*

Métricas:

- `n_dias_total`: número de dias analisados.
- `n_dias_gap`: número de dias com |gap| >= `limiar_gap`.
- `taxa_reversao` (H1): fração dos dias de gap em que `gap * ret60 < 0`, ou seja, em que a
  primeira hora anda contra o gap. Arredondada a 4 casas.
- `reversao_media_pts` (H1): média, nos dias de gap, de `−sign(gap) * ret60` (pontos
  revertidos; positivo = reversão). Arredondada a 2 casas.
- `taxa_acerto_volume` (H2): entre os dias com `vol1h` estritamente acima da mediana de
  `vol1h` (via `statistics.median`, calculada sobre todos os dias analisados), fração com
  `ret_dia > 0`. Arredondada a 4 casas.

Casos de borda: um dia com menos de 12 barras gera erro explícito (isso não acontece
nestes dados). Uma métrica sem denominador sai como `null`.

## 4. Resultados

Valores exatos de `out/metrics.json`:

| Métrica | Valor |
|---|---|
| n_dias_total | 249 |
| n_dias_gap | 114 |
| taxa_reversao | 0.8509 |
| reversao_media_pts | 226.32 |
| taxa_acerto_volume | 0.5242 |
| parametros.limiar_gap | 300 |
| parametros.barras_janela | 12 |

```json
{
  "n_dias_gap": 114,
  "n_dias_total": 249,
  "parametros": {
    "barras_janela": 12,
    "limiar_gap": 300
  },
  "reversao_media_pts": 226.32,
  "taxa_acerto_volume": 0.5242,
  "taxa_reversao": 0.8509
}
```

## 5. Regras de decisão pré-registradas

A memória do projeto registra os enunciados das hipóteses (autor: operador). A métrica
usada para cada uma é:

- **H1**, "após |gap| >= 300 pts, a primeira hora reverte o gap": avaliada por
  `taxa_reversao`, com `reversao_media_pts` como apoio, sobre os `n_dias_gap` dias com
  |gap| >= 300.
- **H2**, "volume alto na primeira hora antecipa dia de alta": avaliada por
  `taxa_acerto_volume` (dias com `vol1h` acima da mediana).

**Pendência:** os limiares numéricos de aceitação/rejeição de H1 e H2 não estão
transcritos no workspace (README, notas e código). Por isso este relatório não os
reproduz nem propõe valores. A decisão é aplicada pelo sistema com as regras
pré-registradas do operador sobre os valores da seção 4.

## 6. Como reproduzir

A partir da raiz do repositório:

```bash
sha256sum dados/win_sintetico_validacao.csv
# esperado: 81d68863476a6c644214480187d64efb9b04e1209973a25fd09aed47cc462f07

python3 src/experimento.py dados/win_sintetico_validacao.csv out/metrics.json
```

O script é determinístico (`json.dump` com `sort_keys=True`, sem aleatoriedade), então
rodar de novo sobre o mesmo arquivo gera um `out/metrics.json` idêntico.
