import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { MemoryService } from './memory.service';

@Controller('projects/:pid/memory')
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  @Get()
  list(@Param('pid', ParseUUIDPipe) pid: string, @Query('category') category?: string, @Query('all') all?: string, @Query('camada') camada?: string) {
    return this.memory.list(pid, category, all === '1', camada ?? 'PROJETO');
  }

  @Post()
  create(@Param('pid', ParseUUIDPipe) pid: string, @Body() body: any) {
    return this.memory.create(pid, body);
  }

  @Delete(':mid')
  forget(@Param('pid', ParseUUIDPipe) pid: string, @Param('mid', ParseUUIDPipe) mid: string, @Query('by') by?: string) {
    return this.memory.forget(pid, mid, by);
  }

  @Post(':mid/supersede')
  supersede(@Param('pid', ParseUUIDPipe) pid: string, @Param('mid', ParseUUIDPipe) mid: string, @Body() body: any) {
    return this.memory.supersede(pid, mid, body);
  }
}
