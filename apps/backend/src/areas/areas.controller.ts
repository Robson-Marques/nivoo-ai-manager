import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
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

  @Post(':area/instructions')
  instructions(@Param('area') area: string, @Body() body: any) {
    return this.areas.newInstructions(area, body);
  }

  @Get(':area/base/file')
  async file(@Param('area') area: string, @Query('path') p: string, @Res() res: Response) {
    const content = await this.areas.readFile(area, p);
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(/\.(md|txt|csv|json|py|ts|js|html|css|svg)$/i.test(p) ? 'text/plain; charset=utf-8' : 'application/octet-stream');
    res.send(content);
  }

  @Put(':area/base/file')
  write(@Param('area') area: string, @Body() body: any) {
    return this.areas.writeFile(area, body);
  }

  @Delete(':area/base/file')
  remove(@Param('area') area: string, @Query('path') p: string, @Query('author') author?: string) {
    return this.areas.deleteFile(area, p, author);
  }

  @Post(':area/base/import')
  importFiles(@Param('area') area: string, @Body() body: any) {
    return this.areas.importFiles(area, body);
  }

  @Post(':area/base/from-artifact')
  fromArtifact(@Param('area') area: string, @Body() body: any) {
    return this.areas.fromArtifact(area, body);
  }
}
