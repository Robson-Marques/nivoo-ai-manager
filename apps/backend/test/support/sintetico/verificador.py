#!/usr/bin/env python3
"""
Verificador de referência do OPERADOR (fica no diretório de dados do projeto, fora do alcance do agente).
Recalcula as métricas especificadas a partir do CSV e compara com as métricas produzidas pelo experimento.

Uso:
  verificador.py <dados.csv> <metrics.json> [limiar_gap=300] [barras_janela=12]   -> exit 0 se coincidem
  verificador.py --calcular <dados.csv> [limiar_gap] [barras_janela]             -> imprime as métricas
"""
import csv
import json
import statistics
import sys
from collections import OrderedDict


def metricas(caminho, limiar=300, janela=12):
    dias = OrderedDict()
    with open(caminho) as f:
        for r in csv.DictReader(f):
            dias.setdefault(r["timestamp"][:10], []).append(r)
    chaves = list(dias)
    gaps, rets, vols, rdia = [], [], [], []
    for i in range(1, len(chaves)):
        hoje, ontem = dias[chaves[i]], dias[chaves[i - 1]]
        gap = float(hoje[0]["open"]) - float(ontem[-1]["close"])
        ret60 = float(hoje[janela - 1]["close"]) - float(hoje[0]["open"])
        gaps.append(gap)
        rets.append(ret60)
        vols.append(sum(float(b["volume"]) for b in hoje[:janela]))
        rdia.append(float(hoje[-1]["close"]) - float(hoje[0]["open"]))
    sel = [(g, r) for g, r in zip(gaps, rets) if abs(g) >= limiar]
    rev = [1 for g, r in sel if g * r < 0]
    med = statistics.median(vols)
    altos = [rd for v, rd in zip(vols, rdia) if v > med]
    return {
        "n_dias_total": len(gaps),
        "n_dias_gap": len(sel),
        "taxa_reversao": round(len(rev) / len(sel), 4) if sel else 0.0,
        "reversao_media_pts": round(sum((-1 if g > 0 else 1) * r for g, r in sel) / len(sel), 2) if sel else 0.0,
        "taxa_acerto_volume": round(sum(1 for rd in altos if rd > 0) / len(altos), 4) if altos else 0.0,
    }


def main():
    if sys.argv[1] == "--calcular":
        args = sys.argv[2:]
        print(json.dumps(metricas(args[0], *(float(a) for a in args[1:2]), *(int(a) for a in args[2:3])), indent=2))
        return
    dados, arq = sys.argv[1], sys.argv[2]
    limiar = float(sys.argv[3]) if len(sys.argv) > 3 else 300
    janela = int(sys.argv[4]) if len(sys.argv) > 4 else 12
    esperado = metricas(dados, limiar, janela)
    obtido = json.load(open(arq))
    erros = []
    for k, v in esperado.items():
        if k not in obtido:
            erros.append(f"{k}: ausente")
        elif abs(float(obtido[k]) - float(v)) > 1e-3 * max(1.0, abs(float(v))):
            erros.append(f"{k}: obtido {obtido[k]} != referência {v}")
    print(json.dumps({"referencia": esperado, "obtido": obtido, "divergencias": erros}, ensure_ascii=False))
    sys.exit(1 if erros else 0)


if __name__ == "__main__":
    main()
