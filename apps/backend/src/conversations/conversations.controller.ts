import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Res } from '@nestjs/common';
import * as path from 'node:path';
import { TIPOS_IMAGEM } from './attachments';
import { ConversationsService } from './conversations.service';

@Controller('projects/:pid/conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  list(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.conversations.list(pid);
  }

  @Post()
  create(@Param('pid', ParseUUIDPipe) pid: string, @Body() body: any) {
    return this.conversations.create(pid, body);
  }

  @Get(':cid')
  get(@Param('pid', ParseUUIDPipe) pid: string, @Param('cid', ParseUUIDPipe) cid: string) {
    return this.conversations.get(pid, cid);
  }

  @Patch(':cid')
  update(@Param('pid', ParseUUIDPipe) pid: string, @Param('cid', ParseUUIDPipe) cid: string, @Body() body: any) {
    return this.conversations.update(pid, cid, body);
  }

  @Post(':cid/move')
  move(@Param('pid', ParseUUIDPipe) pid: string, @Param('cid', ParseUUIDPipe) cid: string, @Body() body: any) {
    return this.conversations.move(pid, cid, body?.targetProjectId);
  }

  @Delete(':cid')
  remove(@Param('pid', ParseUUIDPipe) pid: string, @Param('cid', ParseUUIDPipe) cid: string) {
    return this.conversations.remove(pid, cid);
  }

  @Post(':cid/cancel')
  cancel(@Param('pid', ParseUUIDPipe) pid: string, @Param('cid', ParseUUIDPipe) cid: string) {
    return this.conversations.cancel(pid, cid);
  }

  @Post(':cid/messages')
  send(@Param('pid', ParseUUIDPipe) pid: string, @Param('cid', ParseUUIDPipe) cid: string, @Body() body: any) {
    return this.conversations.send(pid, cid, body);
  }

  /** Anexo de uma mensagem: imagens com o tipo certo (para a miniatura); o resto como texto. Nunca executa. */
  @Get(':cid/messages/:mid/anexos/:nome')
  async attachment(@Param('pid', ParseUUIDPipe) pid: string, @Param('cid', ParseUUIDPipe) cid: string, @Param('mid', ParseUUIDPipe) mid: string, @Param('nome') nome: string, @Res() res: any) {
    const a = await this.conversations.attachment(pid, cid, mid, nome);
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.type(TIPOS_IMAGEM[path.extname(a.nome).toLowerCase()] ?? 'text/plain; charset=utf-8');
    res.send(a.conteudo);
  }

  @Post(':cid/messages/:mid/approve')
  approve(@Param('pid', ParseUUIDPipe) pid: string, @Param('cid', ParseUUIDPipe) cid: string, @Param('mid', ParseUUIDPipe) mid: string, @Body() body: any) {
    return this.conversations.approve(pid, cid, mid, body);
  }
}

/** Projetos e conversas arquivados de todos os projetos (o botão "Arquivados" do menu). */
@Controller('arquivados')
export class ArquivadosController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  list() {
    return this.conversations.arquivados();
  }
}
