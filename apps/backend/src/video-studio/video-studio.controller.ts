import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { VideoStudioService } from './video-studio.service';

/** Editor manual e pós-produção com projetos preservados fora do git. */
@Controller('projects/:pid/studio')
export class VideoStudioController {
  constructor(private readonly studio: VideoStudioService) {}

  @Get()
  list(@Param('pid', ParseUUIDPipe) pid: string) { return this.studio.list(pid); }

  @Post()
  create(@Param('pid', ParseUUIDPipe) pid: string, @Body() body: { title?: string }) {
    return this.studio.create(pid, body?.title);
  }

  @Get(':id')
  get(@Param('pid', ParseUUIDPipe) pid: string, @Param('id') id: string) {
    return this.studio.get(pid,id);
  }

  @Patch(':id')
  save(@Param('pid', ParseUUIDPipe) pid: string, @Param('id') id: string, @Body() body: unknown) {
    return this.studio.save(pid,id,body);
  }

  @Delete(':id')
  remove(@Param('pid', ParseUUIDPipe) pid: string, @Param('id') id: string) {
    return this.studio.remove(pid,id);
  }

  @Post(':id/ai/plan')
  aiPlan(@Param('pid', ParseUUIDPipe) pid: string, @Param('id') id: string, @Body() body: {brief?:string}) {
    return this.studio.aiPlan(pid,id,body?.brief);
  }

  @Get(':id/ai/plan')
  aiStatus(@Param('pid', ParseUUIDPipe) pid: string, @Param('id') id: string) {
    return this.studio.aiStatus(pid,id);
  }

  @Post(':id/ai/apply')
  aiApply(@Param('pid', ParseUUIDPipe) pid: string, @Param('id') id: string, @Body() body: {updatedAt:string}) {
    return this.studio.aiApply(pid,id,body.updatedAt);
  }

  @Post(':id/captions/auto')
  captions(@Param('pid', ParseUUIDPipe) pid: string, @Param('id') id: string, @Body() body: {script?:string}) {
    return this.studio.autoCaptions(pid,id,body?.script);
  }

  @Get(':id/captions/auto')
  captionStatus(@Param('pid', ParseUUIDPipe) pid: string, @Param('id') id: string) {
    return this.studio.captionsStatus(pid,id);
  }

  @Post(':id/render')
  render(@Param('pid', ParseUUIDPipe) pid: string, @Param('id') id: string) {
    return this.studio.render(pid,id);
  }

  @Get(':id/render')
  status(@Param('pid', ParseUUIDPipe) pid: string, @Param('id') id: string) {
    return this.studio.state(pid,id);
  }

  @Post(':id/cancel')
  cancel(@Param('pid', ParseUUIDPipe) pid: string, @Param('id') id: string) {
    return this.studio.cancel(pid,id);
  }
}
