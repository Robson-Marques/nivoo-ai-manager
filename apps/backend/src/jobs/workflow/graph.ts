import { BadRequestException } from '@nestjs/common';

export function assertAcyclic(all: Array<{ key: string; dependsOn: string[] }>): void {
    const map = new Map(all.map((s) => [s.key, s.dependsOn]));
    const state = new Map<string, number>();
    const visit = (k: string) => {
      if (state.get(k) === 2) return;
      if (state.get(k) === 1) throw new BadRequestException(`Dependência cíclica envolvendo ${k}`);
      state.set(k, 1);
      for (const d of map.get(k) ?? []) visit(d);
      state.set(k, 2);
    };
    for (const k of map.keys()) visit(k);
  }

