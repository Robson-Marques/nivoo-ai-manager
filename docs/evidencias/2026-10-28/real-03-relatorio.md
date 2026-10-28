# Relatório — experimento gap300-janela60-validacao

## Objetivo

Medir, no conjunto de **VALIDAÇÃO sintético**, as métricas especificadas para as
hipóteses H1 e H2 e registrar os valores de forma reproduzível, para que a
decisão sobre H1 e H2 seja aplicada pelo sistema conforme as regras
pré-registradas. Este relatório **não** declara a decisão das hipóteses.

## Dados

- Arquivo: `dados/win_sintetico_validacao.csv`
- Ativo: WIN; papel: VALIDAÇÃO
- sha256: `81d68863476a6c644214480187d64efb9b04e1209973a25fd09aed47cc462f07`
- **DADOS SINTÉTICOS — não são dados de mercado.** Gerados por `gerar_dados.py`.
  Segundo a descrição do dataset, o gerador planta um efeito de reversão pós-gap
  e nenhum efeito de volume. Os resultados abaixo não devem ser interpretados
  como evidência sobre o mercado real.
- Formato: barras de 5 minutos com colunas `timestamp,open,high,low,close,volume`.

## Método

Implementação: `src/experimento.py` (Python 3, somente biblioteca padrão,
determinístico).

Parâmetros: `limiar_gap = 300` pontos; `barras_janela = 12` (12 barras de
5 min = 60 min).

1. As barras são agrupadas por dia (10 primeiros caracteres do `timestamp`), na
   ordem do arquivo. O primeiro dia é descartado por não ter fechamento anterior.
2. Para cada dia restante:
   - `gap` = open da 1ª barra do dia − close da última barra do dia anterior;
   - `ret60` = close da 12ª barra − open do dia (se o dia tiver menos de 12
     barras, usa-se o close da última barra disponível);
   - `vol1h` = soma do volume das 12 primeiras barras;
   - `ret_dia` = close da última barra do dia − open do dia.
3. Métricas:
   - `n_dias_total`: número de dias avaliados (todos menos o primeiro);
   - `n_dias_gap`: dias com |gap| ≥ 300;
   - `taxa_reversao` (H1): fração dos dias de gap em que `gap × ret60 < 0`
     (a primeira hora se move contra o gap), 4 casas decimais;
   - `reversao_media_pts` (H1): média de `−sinal(gap) × ret60` nos dias de gap,
     em pontos, 2 casas decimais (positivo = reversão);
   - `mediana_vol1h`: mediana de `vol1h` sobre todos os dias avaliados;
   - `n_dias_volume_alto`: dias com `vol1h` estritamente acima da mediana;
   - `taxa_acerto_volume` (H2): fração dos dias de volume alto com
     `ret_dia > 0`, 4 casas decimais.
   - Denominador zero ⇒ métrica `null`.

## Resultados

Valores exatos de `out/metrics.json`:

| Métrica | Valor |
|---|---|
| n_dias_total | 249 |
| n_dias_gap | 114 |
| taxa_reversao | 0.8509 |
| reversao_media_pts | 226.32 |
| mediana_vol1h | 14509.0 |
| n_dias_volume_alto | 124 |
| taxa_acerto_volume | 0.5242 |
| parametros | limiar_gap = 300, barras_janela = 12 |

## Regras de decisão pré-registradas

As hipóteses registradas pelo operador são:

- **H1**: após |gap| ≥ 300 pts, a primeira hora reverte o gap. Métricas
  associadas: `taxa_reversao` (e, como apoio, `reversao_media_pts`).
- **H2**: volume alto na primeira hora antecipa dia de alta. Métrica associada:
  `taxa_acerto_volume`.

Os limiares numéricos das regras de decisão pré-registradas não constam no
contexto disponível a esta sessão; por isso não são reproduzidos aqui. A
decisão sobre H1 e H2 é aplicada pelo sistema, comparando os valores da tabela
acima com essas regras.

## Como reproduzir

```
python3 src/experimento.py dados/win_sintetico_validacao.csv out/metrics.json
```

Antes, confira a integridade do dataset:

```
sha256sum dados/win_sintetico_validacao.csv
# esperado: 81d68863476a6c644214480187d64efb9b04e1209973a25fd09aed47cc462f07
```

O script é determinístico (sem aleatoriedade; JSON gravado com chaves
ordenadas), de modo que a reexecução deve gerar `out/metrics.json` idêntico.
