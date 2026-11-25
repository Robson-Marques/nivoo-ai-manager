import {nomeAmbientePrevia,variaveisDaPrevia,variaveisDaConferencia,gravarVariavelDaConferencia} from '../../src/accounts/secrets';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
describe('Ambiente sintético da prévia',()=>{
  it('separa segredos por finalidade e não permite substituir infraestrutura',()=>{
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nivoo-previa-env-'));
    const old=process.env.NIVOO_SECRETS_FILE;
    process.env.NIVOO_SECRETS_FILE=path.join(temp,'segredos.json');
    try{
      gravarVariavelDaConferencia('p','PREVIA_ENV_OPERATOR_USERNAME','operador');
      gravarVariavelDaConferencia('p','PREVIA_ENV_SESSION_SECRET','valor-sintetico');
      gravarVariavelDaConferencia('p','PREVIA_ENV_DATABASE_URL','proibido');
      gravarVariavelDaConferencia('p','GITLAB_PACKAGE_TOKEN','somente-conferencia');
      expect(variaveisDaPrevia('p')).toEqual({OPERATOR_USERNAME:'operador',SESSION_SECRET:'valor-sintetico'});
      expect(variaveisDaConferencia('p')).toEqual({GITLAB_PACKAGE_TOKEN:'somente-conferencia'});
      expect(variaveisDaPrevia('outro')).toEqual({});
      for(const k of ['PORT','DATABASE_URL','NODE_OPTIONS','LD_PRELOAD','PGPASSWORD','NIVOO_API_TOKEN','PATH'])expect(nomeAmbientePrevia('PREVIA_ENV_'+k)).toBeNull();
    }finally{if(old===undefined)delete process.env.NIVOO_SECRETS_FILE;else process.env.NIVOO_SECRETS_FILE=old;fs.rmSync(temp,{recursive:true,force:true});}
  });
});
