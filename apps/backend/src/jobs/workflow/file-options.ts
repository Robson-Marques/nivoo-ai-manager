import { BadRequestException } from '@nestjs/common';
import { caminhoDoProjeto } from '../../common/path-guard';

/** Lista de apagar/mover de uma etapa "arquivos-projeto", validada (só caminhos do projeto, nada protegido). */
export function operacoesDeArquivos(key: string, o: any): { remover: string[]; mover: Array<{ de: string; para: string }> } {
  const ok = (p: unknown) => {
    const r = caminhoDoProjeto(p);
    if (!r) throw new BadRequestException(`Etapa ${key}: caminho inválido ou protegido: ${String(p)}`);
    return r;
  };
  const remover = Array.isArray(o.remover) ? o.remover.map(ok) : [];
  const mover = Array.isArray(o.mover) ? o.mover.map((m: any) => ({ de: ok(m?.de), para: ok(m?.para) })) : [];
  if (!remover.length && !mover.length) throw new BadRequestException(`Etapa ${key}: informe "remover" e/ou "mover"`);
  if (remover.length + mover.length > 2000) throw new BadRequestException(`Etapa ${key}: no máximo 2000 itens por etapa`);
  return { remover, mover };
}

