import { BadRequestException } from '@nestjs/common';
import type { CriterionKind, Prisma } from '@prisma/client';
import { oneOf,reqString } from '../../common/validate';
import { evaluatePolicy } from '../../security/policy';
import { validarSaidaMotion } from './media-paths';

const CRITERION_KINDS = ['COMMAND', 'FILE_EXISTS', 'ARTIFACT_PRESENT', 'METRIC_THRESHOLD', 'MANUAL_APPROVAL'] as const;
export function parseCriteria(raw: unknown, existingKeys: string[] = [], media = true) {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new BadRequestException('criteria deve ser uma lista');
    const keys = new Set(existingKeys);
    return raw.map((c: any) => {
      const key = reqString(c, 'key', 60);
      if (keys.has(key)) throw new BadRequestException(`Critério duplicado: ${key}`);
      keys.add(key);
      const kind = oneOf(c, 'kind', CRITERION_KINDS) as CriterionKind;
      const config = { ...(c.config ?? {}) } as Record<string, unknown>;
      if (kind === 'COMMAND') {
        reqString(config, 'command');
        config.command = validarSaidaMotion(String(config.command), `Critério ${key}`);
        const pol = evaluatePolicy(String(config.command));
        if (!pol.allowed) throw new BadRequestException(`Comando do critério ${key} não permitido: ${pol.reasons.join('; ')}`);
      }
      if (kind === 'FILE_EXISTS') {
        const destino = reqString(config, 'path');
        if (media && /^out\/.+\.(?:mp4|mov|mkv|webm|m4v)$/i.test(destino)) {
          throw new BadRequestException(`Critério ${key}: vídeos devem ser verificados em midia/saida/, nunca out/`);
        }
      }
      if (kind === 'ARTIFACT_PRESENT' && !config.name && !config.pattern) throw new BadRequestException(`Critério ${key}: informe name ou pattern`);
      if (kind === 'METRIC_THRESHOLD') {
        reqString(config, 'path');
        if (!['>', '>=', '<', '<=', '==', '!='].includes(String(config.op ?? '>='))) throw new BadRequestException(`Critério ${key}: operador inválido`);
        if (config.value === undefined || config.value === null || typeof config.value === 'boolean' ||
            (typeof config.value === 'string' && !config.value.trim()) || !Number.isFinite(Number(config.value)))
          throw new BadRequestException(`Critério ${key}: config.value numérico obrigatório para METRIC_THRESHOLD. Se a verificação é textual, escolha COMMAND; não invente um número`);
        config.value = Number(config.value);
      }
      return { key, description: reqString(c, 'description', 2000), kind, config: config as Prisma.InputJsonValue };
    });
  }

