import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, StreamableFile } from '@nestjs/common';
import { PreviaService } from './previa.service';

/** Prévia do projeto (site ou sistema rodando, para ver ao lado da conversa). */
@Controller('projects/:pid/previa')
export class PreviaController {
  constructor(private readonly previa: PreviaService) {}

  @Get()
  estado(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.previa.estado(pid);
  }

  @Get('fontes')
  fontes(@Param('pid', ParseUUIDPipe) pid: string) { return this.previa.fontes(pid); }

  @Post('ligar')
  ligar(@Param('pid', ParseUUIDPipe) pid: string, @Body() body?:{jobId?:unknown}) {
    return this.previa.ligar(pid,body?.jobId);
  }

  @Post('visualizador/quadro')
  @Header('Cache-Control', 'no-store')
  async quadro(@Param('pid', ParseUUIDPipe) pid: string, @Body() body: { id?: unknown; tamanho?: unknown }) {
    const dados = await this.previa.quadroVisual(pid, body?.id, body?.tamanho);
    return new StreamableFile(dados, { type: 'image/jpeg' });
  }
  @Post('visualizador/acao')
  acao(@Param('pid', ParseUUIDPipe) pid: string, @Body() body: { id?: unknown; comando?: unknown }) {
    return this.previa.acaoVisual(pid, body?.id, body?.comando);
  }
  @Post('visualizador/fechar')
  fechar(@Param('pid', ParseUUIDPipe) pid: string, @Body() body: { id?: unknown }) {
    return this.previa.fecharVisual(pid, body?.id);
  }

  @Post('desligar')
  desligar(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.previa.desligar(pid);
  }
}
