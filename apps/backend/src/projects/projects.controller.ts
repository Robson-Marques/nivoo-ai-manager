import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as fs from 'node:fs';
import { sendKnowledgeFile } from '../common/knowledge-upload';
import { ProjectsService } from './projects.service';
import { PreviaService } from '../previa/previa.service';
import { VOZES_NARRACAO } from '../providers/vozes';
import { streamMedia } from '../common/media-stream';
import { KokoroTtsError, KokoroTtsService } from '../providers/kokoro-tts.service';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly previa: PreviaService,
    private readonly kokoro: KokoroTtsService,
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

  /** Estado do serviço local e vozes pt-BR realmente instaladas. */
  @Get('narracao/status')
  statusDaNarracao() {
    return this.kokoro.status();
  }

  @Get(':pid')
  get(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.projects.get(pid);
  }

  @Patch(':pid')
  update(@Param('pid', ParseUUIDPipe) pid: string, @Body() body: any) {
    return this.projects.update(pid, body);
  }

  /** Amostra curta para escolher voz e conferir pronúncia antes de renderizar o vídeo. */
  @Post(':pid/narracao/teste')
  async testarNarracao(@Param('pid', ParseUUIDPipe) pid: string, @Body() body: any, @Res() res: Response) {
    const projeto = await this.projects.get(pid);
    if (projeto.motorNarracao !== 'kokoro') throw new BadRequestException('A amostra local está disponível quando o motor selecionado é Kokoro');
    const texto = String(body?.texto ?? 'Olá. Esta é uma amostra da narração do seu vídeo.').trim().slice(0, 500);
    let audio: Awaited<ReturnType<KokoroTtsService['gerar']>>;
    try {
      audio = await this.kokoro.gerar(texto, projeto.vozNarracao, projeto.velocidadeNarracao, (projeto.pronunciasNarracao ?? {}) as Record<string, string>);
    } catch (e: any) {
      if (e instanceof KokoroTtsError && e.indisponivel) throw new ServiceUnavailableException(e.message);
      throw new BadRequestException(e?.message ?? String(e));
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', String(audio.bytes.length));
    res.setHeader('Cache-Control', 'no-store');
    res.send(audio.bytes);
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
    @Query('tamanho') tamanho: string | undefined,
    @Query('final') final: string,
    @Req() req: Request,
  ) {
    return this.projects.salvarPedacoDeVideo(pid, nome, id, Number(offset), tamanho === undefined ? undefined : Number(tamanho), final === '1' || final === 'true', req);
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
  async midiaContent(@Param('pid', ParseUUIDPipe) pid: string, @Query('path') caminho: string, @Req() req: Request, @Res() res: Response) {
    const abs = await this.projects.arquivoDeMidia(pid, caminho);
    const tipo = /\.png$/i.test(abs) ? 'image/png' : /\.jpe?g$/i.test(abs) ? 'image/jpeg' : /\.webp$/i.test(abs) ? 'image/webp' : /\.webm$/i.test(abs) ? 'video/webm' : /\.mov$/i.test(abs) ? 'video/quicktime' : /\.mp3$/i.test(abs) ? 'audio/mpeg' : /\.(wav|flac)$/i.test(abs) ? 'audio/wav' : /\.(m4a|aac)$/i.test(abs) ? 'audio/mp4' : /\.ogg$/i.test(abs) ? 'audio/ogg' : 'video/mp4';
    streamMedia(req, res, abs, tipo);
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
