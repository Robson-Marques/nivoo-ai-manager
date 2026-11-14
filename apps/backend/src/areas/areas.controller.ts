import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sendKnowledgeFile } from '../common/knowledge-upload';
import { AreasService } from './areas.service';

@Controller('areas')
export class AreasController {
  constructor(private readonly areas: AreasService) {}

  @Get()
  list() {
    return this.areas.list();
  }

  @Get('templates')
  templates() {
    return this.areas.templates();
  }

  @Post()
  create(@Body() body: any) {
    return this.areas.create(body);
  }

  @Get(':area')
  get(@Param('area') area: string) {
    return this.areas.get(area);
  }

  @Patch(':area')
  update(@Param('area') area: string, @Body() body: any) {
    return this.areas.update(area, body);
  }

  @Post(':area/instructions')
  instructions(@Param('area') area: string, @Body() body: any) {
    return this.areas.newInstructions(area, body);
  }

  @Get(':area/base/file')
  async file(@Param('area') area: string, @Query('path') p: string, @Res() res: Response) {
    sendKnowledgeFile(res, p, await this.areas.readFile(area, p));
  }

  @Delete(':area/base/file')
  remove(@Param('area') area: string, @Query('path') p: string, @Query('author') author?: string) {
    return this.areas.deleteFile(area, p, author);
  }

  @Post(':area/base/import')
  importFiles(@Param('area') area: string, @Body() body: any) {
    return this.areas.importFiles(area, body);
  }
}
