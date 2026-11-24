import { BadRequestException } from '@nestjs/common';
import { validateFileOperations, type FileOperations } from '../../common/file-operations';
export function operacoesDeArquivos(key:string,o:unknown):FileOperations{
  try{return validateFileOperations(o);}
  catch(e){throw new BadRequestException('Etapa '+key+': '+String((e as Error).message));}
}
