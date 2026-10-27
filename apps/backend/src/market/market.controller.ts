import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { MarketService } from './market.service';

@Controller('market/assets')
export class AssetsController {
  constructor(private readonly market: MarketService) {}

  @Get()
  list() {
    return this.market.listAssets();
  }

  @Get(':code')
  get(@Param('code') code: string) {
    return this.market.getAsset(code);
  }

  @Patch(':code')
  update(@Param('code') code: string, @Body() body: any) {
    return this.market.updateAsset(code, body);
  }
}

@Controller('projects/:pid')
export class ResearchController {
  constructor(private readonly market: MarketService) {}

  @Get('datasets')
  datasets(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.market.listDatasets(pid);
  }

  @Post('datasets')
  createDataset(@Param('pid', ParseUUIDPipe) pid: string, @Body() body: any) {
    return this.market.createDataset(pid, body);
  }

  @Post('datasets/:did/validate')
  validate(@Param('pid', ParseUUIDPipe) pid: string, @Param('did', ParseUUIDPipe) did: string) {
    return this.market.validateDataset(pid, did);
  }

  @Post('datasets/:did/request-release')
  requestRelease(@Param('pid', ParseUUIDPipe) pid: string, @Param('did', ParseUUIDPipe) did: string, @Body() body: any) {
    return this.market.requestRelease(pid, did, body);
  }

  @Get('researches')
  researches(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.market.listResearches(pid);
  }

  @Post('researches')
  createResearch(@Param('pid', ParseUUIDPipe) pid: string, @Body() body: any) {
    return this.market.createResearch(pid, body);
  }

  @Get('researches/:rid')
  research(@Param('pid', ParseUUIDPipe) pid: string, @Param('rid', ParseUUIDPipe) rid: string) {
    return this.market.getResearch(pid, rid);
  }

  @Post('researches/:rid/hypotheses')
  createHypothesis(@Param('pid', ParseUUIDPipe) pid: string, @Param('rid', ParseUUIDPipe) rid: string, @Body() body: any) {
    return this.market.createHypothesis(pid, rid, body);
  }

  @Patch('hypotheses/:hid')
  updateHypothesis(@Param('pid', ParseUUIDPipe) pid: string, @Param('hid', ParseUUIDPipe) hid: string, @Body() body: any) {
    return this.market.updateHypothesis(pid, hid, body);
  }

  @Put('hypotheses/:hid/decision-rule')
  setRule(@Param('pid', ParseUUIDPipe) pid: string, @Param('hid', ParseUUIDPipe) hid: string, @Body() body: any) {
    return this.market.setDecisionRule(pid, hid, body);
  }

  @Post('hypotheses/:hid/decide')
  decide(@Param('pid', ParseUUIDPipe) pid: string, @Param('hid', ParseUUIDPipe) hid: string, @Body() body: any) {
    return this.market.decideByRule(pid, hid, body);
  }

  @Post('researches/:rid/close')
  close(@Param('pid', ParseUUIDPipe) pid: string, @Param('rid', ParseUUIDPipe) rid: string) {
    return this.market.closeResearch(pid, rid);
  }

  @Get('researches/:rid/experiments/compare')
  compare(@Param('pid', ParseUUIDPipe) pid: string, @Param('rid', ParseUUIDPipe) rid: string, @Query('ids') ids?: string) {
    return this.market.compareExperiments(pid, rid, ids ? ids.split(',').filter(Boolean) : undefined);
  }
}
