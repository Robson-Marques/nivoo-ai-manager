import { FiltroDeErros } from './diagnostico/filtro-erros';
import { NestExpressApplication } from '@nestjs/platform-express';

/** Configuração HTTP comum à API real e aos testes (prefixo e limite de corpo). */
export function configureHttp(app: NestExpressApplication): void {
  app.setGlobalPrefix('api');
  // Erros inesperados (500) vão para o registro de erros do sistema (tela Diagnóstico).
  app.useGlobalFilters(new FiltroDeErros(app.getHttpAdapter()));
  // Importação de pastas para a base de conhecimento envia arquivos em base64: limite maior que o padrão (100 KB).
  app.useBodyParser('json', { limit: process.env.NIVOO_BODY_LIMIT ?? '60mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '1mb' });
}
