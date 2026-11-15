import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { listarMcp, MCP_PRONTOS, paraTela, removerMcp, salvarMcp, testarMcp } from './mcp';

/** Ferramentas MCP das IAs (tela Conexões → Ferramentas). Segredos entram por aqui e nunca saem. */
@Controller('mcp')
export class McpController {
  @Get()
  lista() {
    return { ferramentas: listarMcp().map(paraTela), prontos: MCP_PRONTOS };
  }

  @Post()
  criar(@Body() body: any) {
    return paraTela(salvarMcp(body));
  }

  @Patch(':id')
  editar(@Param('id') id: string, @Body() body: any) {
    return paraTela(salvarMcp(body, id));
  }

  @Delete(':id')
  remover(@Param('id') id: string) {
    removerMcp(id);
    return { ok: true };
  }

  @Post(':id/testar')
  testar(@Param('id') id: string) {
    return testarMcp(id);
  }
}
