import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { registrarErro } from './erros';

/** Erro inesperado da API (500): fica no registro de erros do sistema; a resposta segue o padrão do Nest. */
@Catch()
export class FiltroDeErros extends BaseExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) {
    const status = e instanceof HttpException ? e.getStatus() : 500;
    if (status >= 500) {
      const req = host.switchToHttp().getRequest<{ method?: string; url?: string }>();
      registrarErro('api', `${req?.method ?? '?'} ${String(req?.url ?? '?').split('?')[0]}: ${(e as any)?.message ?? e}`, e);
    }
    super.catch(e, host);
  }
}
