import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type {Request,Response} from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { KokoroTtsService } from '../providers/kokoro-tts.service';
import { streamMedia } from '../common/media-stream';
import { gravarPedacoDeVideo, listarVideos, arquivoDaMidia, apagarVideoEnviado } from '../projects/midia';
import { createProduction, getProduction, listProductions, productionDir, updateProduction } from './standalone-projects';

@Controller('studio')
export class StudioProductionsController {
  constructor(private readonly kokoro:KokoroTtsService){}
  private media(pid:string):string {
    getProduction(pid);
    return path.join(productionDir(pid),'midia');
  }
  @Get('productions')
  list(){return listProductions();}
  @Post('productions')
  create(@Body() body:{title?:string}) {return createProduction(body?.title||'Novo vídeo');}
  @Get('productions/:pid')
  get(@Param('pid',ParseUUIDPipe) pid:string){return getProduction(pid);}
  @Patch('productions/:pid')
  rename(@Param('pid',ParseUUIDPipe) pid:string,@Body() body:{title?:string}) {
    return updateProduction(pid,body?.title??'');
  }
  @Get('projects/:pid/videos')
  videos(@Param('pid',ParseUUIDPipe) pid:string){return {videos:listarVideos(this.media(pid))};}
  @Post('projects/:pid/videos/chunk')
  chunk(@Param('pid',ParseUUIDPipe) pid:string,@Query('nome') nome:string,@Query('id') id:string,
    @Query('offset') offset:string,@Query('tamanho') tamanho:string|undefined,@Query('final') final:string,@Req() req:Request){
    return gravarPedacoDeVideo(this.media(pid),nome,id,Number(offset),
      tamanho===undefined?undefined:Number(tamanho),final==='1'||final==='true',req);
  }
  @Get('projects/:pid/midia/content')
  content(@Param('pid',ParseUUIDPipe) pid:string,@Query('path') source:string,@Req() req:Request,@Res() res:Response){
    const abs=arquivoDaMidia(this.media(pid),source);
    if(!abs)throw new BadRequestException('Arquivo da produção não encontrado');
    const mime=/\.mp3$/i.test(abs)?'audio/mpeg':/\.wav$/i.test(abs)?'audio/wav':
      /\.m4a$/i.test(abs)?'audio/mp4':/\.ogg$/i.test(abs)?'audio/ogg':
      /\.png$/i.test(abs)?'image/png':/\.jpe?g$/i.test(abs)?'image/jpeg':
      /\.webp$/i.test(abs)?'image/webp':/\.webm$/i.test(abs)?'video/webm':'video/mp4';
    streamMedia(req,res,abs,mime);
  }
  @Delete('projects/:pid/videos/:vid')
  removeMedia(@Param('pid',ParseUUIDPipe) pid:string,@Param('vid') vid:string){
    const media=this.media(pid);
    const source='midia/entrada/'+vid;
    const studio=path.join(media,'studio');
    if(fs.existsSync(studio))for(const item of fs.readdirSync(studio).filter(n=>/^[a-f0-9-]{36}\.json$/i.test(n))){
      let doc:any;
      try{doc=JSON.parse(fs.readFileSync(path.join(studio,item),'utf8'))}
      catch{throw new ConflictException('Não é seguro excluir: edição não pôde ser lida')}
      if(doc.clips?.some((a:any)=>a.source===source)||doc.assets?.some((a:any)=>a.source===source)||
        doc.audioTracks?.some((a:any)=>a.source===source)||doc.soundtrack?.source===source)
        throw new ConflictException('Arquivo está sendo usado em uma edição salva');
    }
    if(!apagarVideoEnviado(media,vid))throw new BadRequestException('Arquivo não encontrado');
    return {videos:listarVideos(media)};
  }
  @Post('projects/:pid/narration')
  async narration(@Param('pid',ParseUUIDPipe) pid:string,@Body() body:{script?:string;voice?:string;speed?:number}) {
    const media=this.media(pid);
    const script=String(body?.script??'').trim();
    if(script.length<3||script.length>5000)throw new BadRequestException('Roteiro deve ter de 3 a 5.000 caracteres');
    const voice=String(body?.voice||'pf_dora');
    const speed=body?.speed===undefined?1:Number(body.speed);
    const audio=await this.kokoro.gerar(script,voice,speed);
    if(audio.bytes.length>30*1024*1024)throw new BadRequestException('Narração ultrapassou 30 MB');
    const id=randomUUID()+'.mp3';
    const dir=path.join(media,'entrada');
    fs.mkdirSync(dir,{recursive:true});
    const filename=path.join(dir,id);
    fs.writeFileSync(filename,audio.bytes,{flag:'wx'});
    fs.writeFileSync(filename+'.nome','Narração - '+new Date().toISOString().slice(0,16).replace('T',' ')+'.mp3');
    // O roteiro original acompanha a mídia, sem sobrescrever edições existentes.
    fs.writeFileSync(filename+'.roteiro.txt',script);
    return {id,nome:fs.readFileSync(filename+'.nome','utf8'),bytes:audio.bytes.length,
      caminho:'midia/entrada/'+id,pasta:'entrada'};
  }
  @Get('narration/voices')
  voices(){return this.kokoro.catalogo();}
}
