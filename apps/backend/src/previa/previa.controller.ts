import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { PreviaService } from './previa.service';

/** Prévia do projeto (site ou sistema rodando, para ver ao lado da conversa). */
@Controller('projects/:pid/previa')
export class PreviaController {
  constructor(private readonly previa: PreviaService) {}

  @Get()
  estado(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.previa.estado(pid);
  }

  @Post('ligar')
  ligar(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.previa.ligar(pid);
  }

  @Post('desligar')
  desligar(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.previa.desligar(pid);
  }
}
