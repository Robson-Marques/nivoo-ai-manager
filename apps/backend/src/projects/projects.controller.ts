import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sendKnowledgeFile } from '../common/knowledge-upload';
import { ProjectsService } from './projects.service';
import { PreviaService } from '../previa/previa.service';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly previa: PreviaService,
  ) {}

  @Get()
  list() {
    return this.projects.list();
  }

  @Post()
  create(@Body() body: any) {
    return this.projects.create(body);
  }

  @Get(':pid')
  get(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.projects.get(pid);
  }

  @Patch(':pid')
  update(@Param('pid', ParseUUIDPipe) pid: string, @Body() body: any) {
    return this.projects.update(pid, body);
  }

  @Delete(':pid')
  async remove(@Param('pid', ParseUUIDPipe) pid: string) {
    await this.previa.desligar(pid).catch(() => undefined); // a prévia não fica rodando sem projeto
    return this.projects.remove(pid);
  }

  @Post(':pid/rules')
  rules(@Param('pid', ParseUUIDPipe) pid: string, @Body() body: any) {
    return this.projects.newRules(pid, body);
  }

  @Get(':pid/conferencia-env')
  conferenciaEnv(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.projects.variaveisDaConferencia(pid);
  }

  @Post(':pid/conferencia-env')
  gravarConferenciaEnv(@Param('pid', ParseUUIDPipe) pid: string, @Body() body: any) {
    return this.projects.gravarVariavelDaConferencia(pid, body);
  }

  @Get(':pid/rules/history')
  rulesHistory(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.projects.rulesHistory(pid);
  }

  @Post(':pid/knowledge/import')
  importKnowledge(@Param('pid', ParseUUIDPipe) pid: string, @Body() body: any) {
    return this.projects.importKnowledge(pid, body);
  }

  @Get(':pid/knowledge/file')
  async knowledgeFile(@Param('pid', ParseUUIDPipe) pid: string, @Query('path') p: string, @Res() res: Response) {
    sendKnowledgeFile(res, p, await this.projects.knowledgeFile(pid, p));
  }

  @Delete(':pid/knowledge/file')
  deleteKnowledge(@Param('pid', ParseUUIDPipe) pid: string, @Query('path') p: string, @Query('by') by?: string) {
    return this.projects.deleteKnowledge(pid, p, by);
  }

  /** Arquivos da pasta principal do projeto (tudo o que os trabalhos concluídos incorporaram). */
  @Get(':pid/files')
  files(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.projects.files(pid);
  }

  @Get(':pid/files/content')
  async fileContent(@Param('pid', ParseUUIDPipe) pid: string, @Query('path') p: string, @Res() res: Response) {
    sendKnowledgeFile(res, p, await this.projects.fileContent(pid, p));
  }
}
