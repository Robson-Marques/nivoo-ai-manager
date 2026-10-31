# Relatório — experimento `gap300-janela60-validacao`

> **AVISO: este relatório usa DADOS SINTÉTICOS.** Não são dados de mercado e
> nenhum resultado aqui vale como evidência sobre o mercado real.

## 1. Objetivo

Medir, no conjunto de **validação sintético**, as métricas especificadas e
produzir um relatório reproduzível que sirva de base para decidir as hipóteses
H1 e H2 pelas regras pré-registradas. **Este relatório não declara a decisão
sobre as hipóteses:** quem aplica as regras é o sistema (backend Nivoo).

Hipóteses (registradas pelo operador):

- **H1:** depois de um |gap| >= 300 pts, a primeira hora reverte o gap.
- **H2:** volume alto na primeira hora antecipa um dia de alta.

## 2. Dados

| Campo | Valor |
|---|---|
| Arquivo | `dados/win_sintetico_validacao.csv` |
| Ativo | WIN (simulado) |
| Papel | VALIDAÇÃO |
| Natureza | **DADOS SINTÉTICOS**, gerados por `gerar_dados.py` (não são dados de mercado) |
| sha256 | `81d68863476a6c644214480187d64efb9b04e1209973a25fd09aed47cc462f07` |
| Formato | barras de 5 min: `timestamp,open,high,low,close,volume` |

Segundo a especificação do gerador, o efeito plantado nos dados é a
**reversão pós-gap**, e **não há efeito de volume**. O script `gerar_dados.py`
não está neste workspace.

## 3. Método

Implementação: `src/experimento.py` (Python 3, só biblioteca padrão,
determinístico, com saída JSON em `sort_keys`).

Parâmetros: `limiar_gap = 300`, `barras_janela = 12` (12 barras de 5 min = 60 min).

Pré-processamento:

- As barras são agrupadas por dia (10 primeiros caracteres do `timestamp`), na ordem do arquivo.
- O primeiro dia fica de fora porque não tem fechamento anterior para calcular o gap.

Variáveis por dia *d*:

- `gap = open(1ª barra de d) − close(última barra de d−1)`
- `ret60 = close(12ª barra de d) − open(1ª barra de d)`
- `vol1h = soma do volume das 12 primeiras barras de d`
- `ret_dia = close(última barra de d) − open(1ª barra de d)`

Métricas:

- `n_dias_total`: número de dias com variáveis calculadas.
- `n_dias_gap`: número de dias com `|gap| >= 300`.
- **`taxa_reversao`** (H1): entre os dias com gap, fração com `gap · ret60 < 0`, ou seja, a primeira hora andou contra o gap. Arredondada a 4 casas.
- `reversao_media_pts` (H1): média de `−sinal(gap) · ret60` nos dias com gap. Valor positivo indica reversão. Arredondada a 2 casas.
- `mediana_vol1h`: mediana de `vol1h` em todos os dias.
- `n_dias_volume_alto`: número de dias com `vol1h > mediana_vol1h`.
- **`taxa_acerto_volume`** (H2): entre os dias de volume alto, fração com `ret_dia > 0`. Arredondada a 4 casas.

Casos de borda, que **não foram especificados** pelo operador:

- Se um dia tiver menos de 12 barras, o script usa as barras disponíveis.
- Se não houver dias elegíveis, a métrica correspondente sai `null`.
- Dias com `ret60 = 0` ou `ret_dia = 0` não contam como acerto.

## 4. Resultados

Valores copiados exatamente de `out/metrics.json`:

| Métrica | Valor |
|---|---|
| n_dias_total | 249 |
| n_dias_gap | 114 |
| **taxa_reversao** | **0.8509** |
| reversao_media_pts | 226.32 |
| n_dias_volume_alto | 124 |
| mediana_vol1h | 14509.0 |
| **taxa_acerto_volume** | **0.5242** |
| parametros | `{"barras_janela": 12, "limiar_gap": 300}` |

## 5. Regras de decisão pré-registradas

As hipóteses registradas pelo operador são estas:

- **H1:** depois de |gap| >= 300 pts, a primeira hora reverte o gap. A métrica principal é `taxa_reversao`, e a auxiliar é `reversao_media_pts`.
- **H2:** volume alto na primeira hora antecipa dia de alta. A métrica principal é `taxa_acerto_volume`.

**Os limiares e critérios numéricos de aceitação/rejeição pré-registrados
para H1 e H2 não estão disponíveis neste workspace.** Eles não constam na
memória do projeto, nas notas nem nos arquivos do repositório. Por isso este
relatório **não** reproduz nem inventa esses limiares. A regra pré-registrada
é aplicada pelo sistema (backend Nivoo) sobre os valores da seção 4. Este
relatório não declara se as hipóteses foram aceitas ou rejeitadas.

## 6. Como reproduzir

Na raiz do workspace:

```bash
sha256sum dados/win_sintetico_validacao.csv
# esperado: 81d68863476a6c644214480187d64efb9b04e1209973a25fd09aed47cc462f07

python3 src/experimento.py dados/win_sintetico_validacao.csv out/metrics.json
```

O script é determinístico: a mesma entrada gera um `out/metrics.json` idêntico
byte a byte. O `out/metrics.json` usado neste relatório tem sha256 com prefixo
`1d300da63c00`.
