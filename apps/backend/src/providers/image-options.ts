import { BadRequestException } from '@nestjs/common';
import { caminhoDoProjeto } from '../common/path-guard';

export interface ImageOptions {
  arquivo:string;
  proporcao:string;
  tamanho:'1K'|'2K';
  referencias:string[];
}
export function imageOptions(key:string, raw:Record<string,unknown>):ImageOptions {
  const arquivo=caminhoDoProjeto(raw.arquivo);
  if(!arquivo||!/^motion\/[A-Za-z0-9._/-]+\.png$|^out\/[A-Za-z0-9._/-]+\.png$/i.test(arquivo))
    throw new BadRequestException('Etapa '+key+': imagem exige arquivo PNG em motion/ ou out/.');
  const proporcao=String(raw.proporcao??'9:16');
  if(!['1:1','2:3','3:2','3:4','4:3','4:5','5:4','9:16','16:9','21:9'].includes(proporcao))
    throw new BadRequestException('Etapa '+key+': proporção de imagem inválida.');
  const tamanho=String(raw.tamanho??'1K');
  if(tamanho!=='1K'&&tamanho!=='2K')throw new BadRequestException('Etapa '+key+': tamanho deve ser 1K ou 2K.');
  const refs=raw.referencias??[];
  if(!Array.isArray(refs)||refs.length>4)throw new BadRequestException('Etapa '+key+': use até quatro referências locais.');
  const referencias=refs.map((r:unknown)=>{
    const file=caminhoDoProjeto(r);
    if(!file||!/\.(png|jpe?g|webp)$/i.test(file)||file===arquivo)throw new BadRequestException('Etapa '+key+': referência de imagem inválida.');
    return file;
  });
  return {arquivo,proporcao,tamanho,referencias:[...new Set(referencias)]};
}
