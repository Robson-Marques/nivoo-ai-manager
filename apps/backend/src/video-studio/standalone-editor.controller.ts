import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { VideoStudioService } from './video-studio.service';
import { inspectStudioRuntime } from './studio-runtime-capabilities';

/** Editor para produções audiovisuais independentes. */
@Controller('studio/projects/:pid/edits')
export class StandaloneStudioEditorController {
  constructor(private readonly studio: VideoStudioService) {}

  @Get('runtime/capabilities')
  capabilities() { return inspectStudioRuntime(); }

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

  @Post(':id/zones/detect')
  zoneDetect(@Param('pid', ParseUUIDPipe) pid: string, @Param('id') id: string) {
    return this.studio.detectZones(pid,id);
  }

  @Get(':id/zones/detect')
  zoneStatus(@Param('pid', ParseUUIDPipe) pid: string, @Param('id') id: string) {
    return this.studio.zoneStatus(pid,id);
  }

  @Post(':id/zones/apply')
  zoneApply(@Param('pid', ParseUUIDPipe) pid: string, @Param('id') id: string, @Body() body: {updatedAt:string}) {
    return this.studio.applyZones(pid,id,body.updatedAt);
  }

  @Post(':id/ai/plan')
  aiPlan(@Param('pid', ParseUUIDPipe) pid: string, @Param('id') id: string, @Body() body: {brief?:string}) {
    return this.studio.aiPlan(pid,id,body?.brief);
  }

  @Get(':id/ai/plan')
  aiStatus(@Param('pid', ParseUUIDPipe) pid: string, @Param('id') id: string) {
    return this.studio.aiStatus(pid,id);
  }

  @Post(':id/ai/revise')
  revisePlan(@Param('pid',ParseUUIDPipe) pid:string,@Param('id') id:string,@Body() body:{removeIndex:number}) {
    return this.studio.aiRevise(pid,id,body?.removeIndex);
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

  @Get('motion/catalog')
  motionCatalog(@Param('pid', ParseUUIDPipe) pid:string,@Query('query') query:string){
    return this.studio.motionCatalog(pid,query);
  }

  @Get('motion/presets')
  motionPresets(@Param('pid', ParseUUIDPipe) pid:string) {
    return this.studio.motionPresets(pid);
  }
  @Post(':id/motion')
  motionStart(@Param('pid', ParseUUIDPipe) pid:string,@Param('id') id:string,@Body() body:unknown) {
    return this.studio.motionStart(pid,id,body);
  }
  @Get(':id/motion')
  motionStatus(@Param('pid', ParseUUIDPipe) pid:string,@Param('id') id:string) {
    return this.studio.motionStatus(pid,id);
  }
  @Post(':id/motion/cancel')
  motionCancel(@Param('pid', ParseUUIDPipe) pid:string,@Param('id') id:string) {
    return this.studio.motionCancel(pid,id);
  }

  @Post(':id/render')
  render(@Param('pid', ParseUUIDPipe) pid: string, @Param('id') id: string,
    @Body() body?: {engine?:'ffmpeg'|'remotion'}) {
    return this.studio.render(pid,id,body?.engine??'ffmpeg');
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
