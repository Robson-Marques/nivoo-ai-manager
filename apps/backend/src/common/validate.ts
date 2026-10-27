import { BadRequestException } from '@nestjs/common';

export function reqString(obj: any, key: string, max = 20000): string {
  const v = obj?.[key];
  if (typeof v !== 'string' || v.trim() === '') throw new BadRequestException(`Campo obrigatório: ${key}`);
  if (v.length > max) throw new BadRequestException(`Campo ${key} excede ${max} caracteres`);
  return v.trim();
}

export function optString(obj: any, key: string, max = 20000): string | undefined {
  const v = obj?.[key];
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw new BadRequestException(`Campo ${key} deve ser texto`);
  if (v.length > max) throw new BadRequestException(`Campo ${key} excede ${max} caracteres`);
  return v.trim();
}

export function optNumber(obj: any, key: string, min: number, max: number): number | undefined {
  const v = obj?.[key];
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new BadRequestException(`Campo ${key} deve estar entre ${min} e ${max}`);
  return n;
}

export function oneOf<T extends string>(obj: any, key: string, values: readonly T[], fallback?: T): T {
  const v = obj?.[key] ?? fallback;
  if (!values.includes(v)) throw new BadRequestException(`Campo ${key} deve ser um de: ${values.join(', ')}`);
  return v;
}

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
