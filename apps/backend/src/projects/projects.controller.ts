import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@Query('area') area?: string) {
    return this.projects.list(area);
  }

  /** Arquivos da pasta principal do projeto (tudo o que os jobs concluídos incorporaram). */
  @Get(':pid/files')
  files(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.projects.files(pid);
  }

  @Get(':pid/files/content')
  async fileContent(@Param('pid', ParseUUIDPipe) pid: string, @Query('path') p: string, @Res() res: Response) {
    const content = await this.projects.fileContent(pid, p);
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('text/plain; charset=utf-8');
    res.send(content);
  }

  @Post()
  create(@Body() body: any) {
    return this.projects.create(body);
  }

  @Get(':pid')
  get(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.projects.get(pid);
  }
}
