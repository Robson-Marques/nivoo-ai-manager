import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list() {
    return this.projects.list();
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
