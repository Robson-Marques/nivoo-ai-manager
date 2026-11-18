import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as fs from 'node:fs';
import { sendKnowledgeFile } from '../common/knowledge-upload';
import { ProjectsService } from './projects.service';
import { PreviaService } from '../previa/previa.service';
import { VOZES_NARRACAO } from '../providers/vozes';

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

  /** Catálogo de vozes da narração (para o seletor da tela): nome, gênero (feminina/masculina) e estilo. */
  @Get('vozes-narracao')
  vozes() {
    return VOZES_NARRACAO;
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

  // Vídeos do projeto (modo edição): enviar por streaming (arquivo grande), listar, baixar e apagar. Fora do git.
  @Get(':pid/videos')
  videos(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.projects.videos(pid);
  }

  @Post(':pid/videos')
  async enviarVideo(@Param('pid', ParseUUIDPipe) pid: string, @Query('nome') nome: string, @Req() req: Request) {
    return this.projects.salvarVideo(pid, nome, req);
  }

  /** Upload em PEDAÇOS (arquivo grande, robusto): cada pedaço termina rápido; o último (final=1) fecha o vídeo. */
  @Post(':pid/videos/chunk')
  async enviarPedacoDeVideo(
    @Param('pid', ParseUUIDPipe) pid: string,
    @Query('nome') nome: string,
    @Query('id') id: string,
    @Query('offset') offset: string,
    @Query('final') final: string,
    @Req() req: Request,
  ) {
    return this.projects.salvarPedacoDeVideo(pid, nome, id, Number(offset), final === '1' || final === 'true', req);
  }

  /** Envia um .zip (streaming) e o servidor extrai todos os vídeos de dentro para a mídia do projeto. */
  @Post(':pid/videos/zip')
  async enviarZipDeVideos(@Param('pid', ParseUUIDPipe) pid: string, @Query('nome') nome: string, @Req() req: Request) {
    return this.projects.salvarVideoZip(pid, nome, req);
  }

  /** Procura vídeos que o usuário colocou na pasta do projeto no servidor (SCP/FTP) e os importa para a mídia. */
  @Post(':pid/videos/importar-da-pasta')
  importarVideosDaPasta(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.projects.importarVideosDaPasta(pid);
  }

  @Delete(':pid/videos/:vid')
  apagarVideo(@Param('pid', ParseUUIDPipe) pid: string, @Param('vid') vid: string) {
    return this.projects.apagarVideo(pid, vid);
  }

  @Get(':pid/midia/content')
  async midiaContent(@Param('pid', ParseUUIDPipe) pid: string, @Query('path') caminho: string, @Res() res: Response) {
    const abs = await this.projects.arquivoDeMidia(pid, caminho);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(/\.webm$/i.test(abs) ? 'video/webm' : /\.mov$/i.test(abs) ? 'video/quicktime' : 'video/mp4');
    fs.createReadStream(abs).pipe(res);
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
