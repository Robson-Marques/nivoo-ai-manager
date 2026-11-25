import { randomBytes } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { nomeAmbientePrevia } from '../accounts/secrets';

export interface PreviewLogin { usuario:string; senha:string; segredo:string; cookieSeguro?:string }
/** The app declares the variables it actually consumes; no guesses, no production credentials. */
export function parsePreviewLogin(value:unknown):PreviewLogin|undefined{
  if(value===undefined||value===false)return undefined;
  const config=value===true?{usuario:'OPERATOR_USERNAME',senha:'OPERATOR_PASSWORD',segredo:'SESSION_SECRET',cookieSeguro:'COOKIE_SECURE'}:value;
  if(!config||typeof config!=='object'||Array.isArray(config))throw new BadRequestException('loginTeste inválido em nivoo-previa.json.');
  const raw=config as Record<string,unknown>;
  const keys=['usuario','senha','segredo',...(raw.cookieSeguro===undefined?[]:['cookieSeguro'])];
  const names=keys.map(k=>typeof raw[k]==='string'?nomeAmbientePrevia('PREVIA_ENV_'+raw[k]):null);
  if(names.some(n=>!n)||new Set(names).size!==names.length)throw new BadRequestException('loginTeste exige nomes distintos e válidos de variáveis próprias da aplicação.');
  return {usuario:names[0]!,senha:names[1]!,segredo:names[2]!,...(names[3]?{cookieSeguro:names[3]}:{})};
}
export function createPreviewLogin(config:PreviewLogin){
  const usuario='operador',senha=randomBytes(16).toString('hex');
  const env:Record<string,string>={[config.usuario]:usuario,[config.senha]:senha,[config.segredo]:randomBytes(32).toString('hex')};
  if(config.cookieSeguro)env[config.cookieSeguro]='false';
  return {env,credentials:{usuario,senha}};
}
