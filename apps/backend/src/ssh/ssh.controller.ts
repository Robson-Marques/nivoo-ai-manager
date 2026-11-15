import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Logger, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { acharServidor, executarNoServidor, listarServidores, novaChave, removerServidor, salvarServidor } from './servidores';

/** Servidores SSH (Conexões) e os pedidos de comando das IAs, que só rodam com a permissão do usuário. */
@Controller()
export class SshController {
  private readonly logger = new Logger('SSH');
  constructor(private readonly prisma: PrismaService) {}

  @Get('ssh/servidores')
  servidores() {
    return listarServidores();
  }

  @Post('ssh/servidores')
  criar(@Body() body: any) {
    return salvarServidor(body);
  }

  @Patch('ssh/servidores/:id')
  editar(@Param('id') id: string, @Body() body: any) {
    return salvarServidor(body, id);
  }

  @Delete('ssh/servidores/:id')
  remover(@Param('id') id: string) {
    removerServidor(id);
    return { ok: true };
  }

  @Post('ssh/servidores/:id/nova-chave')
  chave(@Param('id') id: string) {
    return novaChave(id);
  }

  /** Teste feito pelo próprio usuário (não é a IA): confere login e mostra quem/onde. */
  @Post('ssh/servidores/:id/testar')
  async testar(@Param('id') id: string) {
    acharServidor(id);
    const r = await executarNoServidor(id, 'echo "nivoo-ok $(whoami)@$(hostname)"', 30_000);
    const ok = r.exitCode === 0 && /nivoo-ok/.test(r.saida);
    return { ok, saida: r.saida.trim().slice(0, 1000), dica: ok ? undefined : /Permission denied|publickey/i.test(r.saida) ? 'O servidor recusou a chave: cole a chave pública no ~/.ssh/authorized_keys do usuário certo.' : undefined };
  }

  /** Pedidos de comando do projeto (pendentes primeiro). */
  @Get('projects/:pid/ssh/pedidos')
  pedidos(@Param('pid', ParseUUIDPipe) pid: string, @Query('status') status?: string) {
    return this.prisma.sshPedido.findMany({
      where: { projectId: pid, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** Permitir (roda o comando agora, em segundo plano) ou recusar. Cada pedido só é decidido uma vez. */
  @Post('projects/:pid/ssh/pedidos/:id/decidir')
  async decidir(@Param('pid', ParseUUIDPipe) pid: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: any) {
    const p = await this.prisma.sshPedido.findFirst({ where: { id, projectId: pid } });
    if (!p) throw new NotFoundException('Pedido não encontrado');
    if (typeof body?.permitir !== 'boolean') throw new BadRequestException('Informe permitir: true ou false');
    const por = String(body?.por ?? 'usuário').slice(0, 100);
    const r = await this.prisma.sshPedido.updateMany({
      where: { id, status: 'PENDENTE' },
      data: { status: body.permitir ? 'APROVADO' : 'RECUSADO', decididoPor: por, decididoEm: new Date(), ...(body.permitir ? {} : { terminadoEm: new Date() }) },
    });
    if (!r.count) throw new ConflictException('Este pedido já foi decidido ou expirou');
    if (body.permitir) {
      // Em segundo plano: a tela não fica presa; a IA recebe a saída quando terminar.
      void executarNoServidor(p.servidorId, p.comando)
        .then((x) => this.prisma.sshPedido.update({ where: { id }, data: { status: x.exitCode === 0 ? 'EXECUTADO' : 'FALHOU', exitCode: x.exitCode, saida: x.saida, terminadoEm: new Date() } }))
        .catch((e) => this.prisma.sshPedido.update({ where: { id }, data: { status: 'FALHOU', exitCode: -1, saida: String(e?.message ?? e), terminadoEm: new Date() } }))
        .catch((e) => this.logger.error(`pedido ${id}: ${e?.message ?? e}`));
    }
    return this.prisma.sshPedido.findUnique({ where: { id } });
  }
}
