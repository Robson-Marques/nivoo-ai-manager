import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ModelCatalogService } from '../providers/model-catalog.service';
import { AccountsService } from './accounts.service';

/** Tela "Contas de IA": conectar Claude, ChatGPT e Gemini pelo navegador. */
@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly catalog: ModelCatalogService,
  ) {}

  @Get()
  list() {
    return this.accounts.list();
  }

  /** Modelos disponíveis nesta IA (lidos do programa oficial quando ele informa). */
  @Get(':id/models')
  models(@Param('id') id: string) {
    return this.catalog.list(id);
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

  @Delete(':id')
  disconnect(@Param('id') id: string) {
    return this.accounts.disconnect(id);
  }
}
