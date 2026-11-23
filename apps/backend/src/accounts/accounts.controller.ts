import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ModelCatalogService } from '../providers/model-catalog.service';
import { NvidiaSpecializedService } from '../providers/nvidia-specialized.service';
import { AccountsService } from './accounts.service';

/** Tela "Conexões": quantas contas quiser de Claude, ChatGPT e Gemini, pela conta ou por chave de API. */
@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly catalog: ModelCatalogService,
    private readonly nvidia: NvidiaSpecializedService,
  ) {}

  @Get()
  list(@Query('atualizar') atualizar?: string) {
    return this.accounts.list(atualizar === '1');
  }

  /** Tipos que podem ser criados em "+ Nova". */
  @Get('tipos')
  tipos() {
    return this.accounts.tipos();
  }

  @Post()
  create(@Body() body: any) {
    return this.accounts.create(body);
  }

  /** `{ nome?, padrao? }` */
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.accounts.update(id, body);
  }

  /** Modelos disponíveis nesta IA (lidos do programa oficial quando ele informa). */
  @Get(':id/models')
  models(@Param('id') id: string) {
    return this.catalog.list(id);
  }

  /** Todas as especialidades NVIDIA, sem confundir modelos de vídeo com agentes de código. */
  @Get(':id/catalogo')
  catalogo(@Param('id') id: string) {
    return this.catalog.catalogoNvidia(id);
  }

  /** Especialidades realmente conectadas à API NVIDIA (não confundidas com o catálogo). */
  @Get(':id/nvidia/capacidades')
  capacidadesNvidia(@Param('id') id: string) {
    // A conexão só é considerada NVIDIA após a validação de tipo do serviço.
    return this.nvidia.capacidadesParaConexao(id);
  }

  @Post(':id/nvidia/conversa')
  conversaNvidia(@Param('id') id: string, @Body() body: unknown) {
    return this.nvidia.conversa(id, body);
  }

  @Post(':id/nvidia/embedding')
  embeddingNvidia(@Param('id') id: string, @Body() body: unknown) {
    return this.nvidia.embedding(id, body);
  }

  @Post(':id/nvidia/rerank')
  rerankNvidia(@Param('id') id: string, @Body() body: unknown) {
    return this.nvidia.rerank(id, body);
  }

  @Post(':id/nvidia/imagem')
  imagemNvidia(@Param('id') id: string, @Body() body: unknown) {
    return this.nvidia.imagem(id, body);
  }

  @Post(':id/nvidia/video/iniciar')
  iniciarVideoNvidia(@Param('id') id: string, @Body() body: unknown) {
    return this.nvidia.iniciarVideo(id, body);
  }

  @Get(':id/nvidia/video/:pedidoId')
  statusVideoNvidia(@Param('id') id: string, @Param('pedidoId') pedidoId: string) {
    return this.nvidia.statusVideo(id, pedidoId);
  }

  @Post(':id/login')
  startLogin(@Param('id') id: string) {
    return this.accounts.startLogin(id);
  }

  @Get(':id/login')
  loginStatus(@Param('id') id: string) {
    return this.accounts.loginStatus(id);
  }

  @Post(':id/login/code')
  code(@Param('id') id: string, @Body() body: any) {
    return this.accounts.submitCode(id, body?.code);
  }

  @Delete(':id/login')
  cancel(@Param('id') id: string) {
    return this.accounts.cancelLogin(id);
  }

  @Post(':id/key')
  key(@Param('id') id: string, @Body() body: any) {
    return this.accounts.saveKey(id, body?.key);
  }

  /** Sai da conta / apaga a chave, mantendo a conexão na lista. */
  @Post(':id/disconnect')
  disconnect(@Param('id') id: string) {
    return this.accounts.disconnect(id);
  }

  /** Exclui a conexão (recusado se algum projeto a usa). */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.accounts.remove(id);
  }
}
