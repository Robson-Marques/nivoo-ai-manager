import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { designCatalog } from './catalog';
import { DesignProfileStore } from './design-profile.store';

@Controller('design-studio')
export class DesignStudioController {
  private readonly store = new DesignProfileStore();
  @Get('catalog') catalog() { return {schemaVersion:1,sources:designCatalog}; }
  @Get('profiles') list() { return this.store.list(); }
  @Get('profiles/:id') get(@Param('id',ParseUUIDPipe) id:string) { return this.store.get(id); }
  @Post('profiles') create(@Body() body:unknown) { return this.store.create(body); }
  @Put('profiles/:id') update(@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown) { return this.store.update(id,body); }
}
