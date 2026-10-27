#!/usr/bin/env python3
"""
DADOS SINTÉTICOS — NÃO SÃO DADOS DE MERCADO REAIS.

Gera barras de 5 minutos no formato WIN (pontos, tick 5, pregão 09:00–18:25) com semente fixa,
para testar o fluxo científico do Nivoo AI Manager. Efeitos PLANTADOS (conhecidos de antemão):

  H1 (verdadeiro): após gap de abertura com |gap| >= 300 pontos, a primeira hora tende a
      reverter ~40% do gap (taxa de reversão esperada bem acima de 0,6).
  H2 (falso): volume da primeira hora NÃO tem relação com o sinal do retorno do dia
      (taxa esperada ~0,5).

Uso: gerar_dados.py <saida.csv> <semente> <n_dias> <data_inicial AAAA-MM-DD>
"""
import csv
import datetime as dt
import random
import sys


def tick(x):
    return int(round(x / 5.0)) * 5


def main():
    saida, semente, n_dias, inicio = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    rnd = random.Random(semente)
    dia = dt.date.fromisoformat(inicio)
    preco = 130000.0
    with open(saida, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["timestamp", "open", "high", "low", "close", "volume"])
        feitos = 0
        while feitos < n_dias:
            if dia.weekday() >= 5:
                dia += dt.timedelta(days=1)
                continue
            gap = rnd.gauss(0, 400)
            abertura = preco + gap
            alvo_reversao = -0.4 * gap if abs(gap) >= 300 else 0.0
            p = abertura
            t = dt.datetime.combine(dia, dt.time(9, 0))
            for i in range(114):  # 09:00 .. 18:25
                deriva = alvo_reversao / 12.0 if i < 12 else 0.0
                o = p
                c = o + deriva + rnd.gauss(0, 60)
                hi = max(o, c) + abs(rnd.gauss(0, 30))
                lo = min(o, c) - abs(rnd.gauss(0, 30))
                vol = int(rnd.lognormvariate(7, 0.5))
                w.writerow([t.strftime("%Y-%m-%dT%H:%M:%S"), tick(o), tick(hi), tick(lo), tick(c), vol])
                p = c
                t += dt.timedelta(minutes=5)
            preco = p
            feitos += 1
            dia += dt.timedelta(days=1)


if __name__ == "__main__":
    main()
