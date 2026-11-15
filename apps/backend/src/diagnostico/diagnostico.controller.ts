import { Controller, Get, Header, Param, ParseUUIDPipe } from '@nestjs/common';
import { DiagnosticoService } from './diagnostico.service';

/** Diagnósticos em texto (Markdown), prontos para colar no suporte; sem segredos. */
@Controller()
export class DiagnosticoController {
  constructor(private readonly diag: DiagnosticoService) {}

  @Get('projects/:pid/jobs/:jid/diagnostico')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  trabalho(@Param('pid', ParseUUIDPipe) pid: string, @Param('jid', ParseUUIDPipe) jid: string) {
    return this.diag.doTrabalho(pid, jid);
  }

  @Get('system/diagnostico')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  sistema() {
    return this.diag.doSistema();
  }
}
