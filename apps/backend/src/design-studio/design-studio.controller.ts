import { BadRequestException, NotFoundException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { designCatalog } from './catalog';
import { defaultVisual, palettes } from './visual';
import { DesignProfileStore } from './design-profile.store';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from '../storage/workspace.service';
import { inspectFrontend } from './frontend-analysis';

@Controller('design-studio')
export class DesignStudioController {
  private readonly store = new DesignProfileStore();
  constructor(private readonly prisma:PrismaService,private readonly workspace:WorkspaceService){}
  private async assertTarget(raw:unknown){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return;
    const id=(raw as Record<string,unknown>).projectId;
    if(id===undefined||id===null)return;
    if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))throw new BadRequestException('Projeto inválido');
    const p=await this.prisma.project.findUnique({where:{id},select:{id:true,archivedAt:true}});
    if(!p||p.archivedAt)throw new BadRequestException('Selecione um projeto ativo do Nivoo');
  }
  @Get('projects/:id/analysis') async analyze(@Param('id',ParseUUIDPipe) id:string){
    const p=await this.prisma.project.findUnique({where:{id},select:{id:true,name:true,dirKey:true,gitUrl:true,gitBranch:true,archivedAt:true}});
    if(!p||p.archivedAt)throw new NotFoundException('Projeto ativo não encontrado');
    return {project:{id:p.id,name:p.name,url:p.gitUrl,branch:p.gitBranch},...(await inspectFrontend(this.workspace.projectDirs(p.dirKey).repo))};
  }
  @Get('catalog') catalog() { return {schemaVersion:1,sources:designCatalog,palettes,defaultVisual}; }
  @Get('profiles') list() { return this.store.list(); }
  @Get('profiles/:id') get(@Param('id',ParseUUIDPipe) id:string) { return this.store.get(id); }
  @Post('profiles') async create(@Body() body:unknown) { await this.assertTarget(body);return this.store.create(body); }
  @Put('profiles/:id') async update(@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown) { await this.assertTarget(body);return this.store.update(id,body); }
}
