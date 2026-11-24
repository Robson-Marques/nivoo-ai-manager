'use strict';
const fs=require('node:fs');const path=require('node:path');
const {validateScene}=require('./schema');
function loadScene(scenePath, options={}) {
  const absolute = fs.realpathSync(scenePath);
  const dir = path.dirname(absolute);
  const parsed = JSON.parse(fs.readFileSync(absolute,'utf8'));
  const requestedProfile=parsed.profile;
  let validated;
  try{validated=validateScene(parsed,options);}
  catch(e){throw new Error(path.basename(scenePath)+': '+String(e?.message??e));}
  const {scene,assets}=validated;
  const binaries = {}, warnings = [];
  if (requestedProfile !== undefined && requestedProfile !== scene.profile) {
    const label=typeof requestedProfile==='string' ? requestedProfile.slice(0,80) : typeof requestedProfile;
    warnings.push('Perfil de ritmo '+JSON.stringify(label)+' interpretado como '+
      scene.profile+'; composição original preservada');
  }
  let totalBytes=0;
  const motionParent = path.basename(path.dirname(dir)) === 'motion' ? path.dirname(dir) : dir;
  const projectRoot = motionParent !== dir ? path.dirname(motionParent) : dir;
  const allowed = [motionParent, path.join(projectRoot,'contexto')];
  const withinAllowed = file => allowed.some(root=>file.startsWith(root+path.sep));
  function resolveLocalMedia(relative) {
    const expected=relative.startsWith('contexto/')
      ? path.resolve(projectRoot,relative):path.resolve(dir,relative);
    try {
      const found=fs.realpathSync(expected);
      if (!withinAllowed(found)) throw new Error('arquivo fora das pastas permitidas');
      return {file:found,recovered:false};
    } catch(error) {
      // Uma referência a um caminho proibido continua PROIBIDA, sem fallback.
      if (/fora das pastas permitidas/.test(String(error?.message??error)) ||
          path.isAbsolute(relative) || relative.split('/').filter(x=>x==='..').length>1)
        throw error;
      // O Nivo já copiou as fotografias para motion/<versão>/assets.
      // Recuperar pelo nome EXATO (sem adivinhar imagem por semelhança).
      const base=path.basename(relative);
      if(!/^[\w. -]{1,160}\.(?:png|jpe?g|webp|svg|js)$/i.test(base)) throw error;
      const dirs=[path.join(dir,'assets'),dir];
      const annexRoot=path.join(projectRoot,'contexto','anexos');
      if(fs.existsSync(annexRoot)) {
        for(const entry of fs.readdirSync(annexRoot,{withFileTypes:true}).slice(0,80))
          if(entry.isDirectory())dirs.push(path.join(annexRoot,entry.name));
      }
      for(const candidateDir of dirs) {
        let entries;
        try { entries=fs.readdirSync(candidateDir,{withFileTypes:true}); } catch { continue; }
        const names=entries.filter(e=>e.isFile() && e.name.toLowerCase()===base.toLowerCase());
        if(names.length!==1)continue;
        const found=fs.realpathSync(path.join(candidateDir,names[0].name));
        if(withinAllowed(found)) return {file:found,recovered:true};
      }
      throw error;
    }
  }
  for (const relative of assets) {
    try {
      if (relative.length > 28*1024*1024) throw new Error('referência grande demais');
      const embedded = /^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[a-zA-Z0-9+/=]+$/.test(relative);
      if (embedded) {
        if (Buffer.byteLength(relative,'utf8') > 28*1024*1024) throw new Error('imagem embutida muito grande');
        binaries[relative]=relative; continue;
      }
      if (/^[a-z][a-z\d+.-]*:/i.test(relative)) throw new Error('referência remota não suportada');
      if (relative.includes('\0') || /[\x00-\x1f]/.test(relative)) throw new Error('nome com caracteres de controle');
      const {file,recovered} = resolveLocalMedia(relative);
      if(recovered) console.warn('[NIVO_MOTION] recurso localizado nos assets existentes: '+
        path.basename(relative));
      const size=fs.statSync(file).size;
      if (size > 20*1024*1024 || (totalBytes += size) > 60*1024*1024)
        throw new Error('limite de tamanho da mídia excedido');
      const ext=path.extname(file).toLowerCase();
      if(ext==='.js') {
        // Importa recurso antigo do Studio como DADO, nunca executa JavaScript.
        const content=fs.readFileSync(file,'utf8');
        const matches=content.match(/data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+/g)??[];
        if(matches.length!==1) throw new Error('módulo não contém uma imagem base64 única');
        binaries[relative]=matches[0];
      } else {
        const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
          '.webp':'image/webp','.svg':'image/svg+xml'}[ext];
        if(!mime) throw new Error('formato de imagem não suportado');
        binaries[relative]='data:'+mime+';base64,'+fs.readFileSync(file).toString('base64');
      }
    } catch(err) {
      // Uma camada de logo mal referenciada não pode interromper o MP4 inteiro.
      // Entrega o render disponível; o usuário recebe AVISO e pode pedir ajuste.
      const reason=String(err?.message??err).slice(0,180);
      const label=/^data:image/.test(relative)?'[imagem incorporada]':relative.slice(0,160);
      warnings.push('Imagem não carregada ('+label+'): '+reason);
    }
  }
  return { scene, binaries, warnings, sourcePath:absolute };
}
/**
 * Uma foto de produto não é decoração: se não foi carregada ou desenhada,
 * o render é tecnicamente incompleto. Logos/fundos podem ser opcionais para
 * não transformar um elemento decorativo em bloqueio do vídeo inteiro.
 * `required:false` e `optional:true` continuam disponíveis ao autor.
 */
function productPhotoLayers(scene) {
  return (scene.layers ?? []).filter(layer => {
    if (layer.type !== 'image' || layer.optional === true || layer.required === false) return false;
    if (layer.required === true) return true;
    const label=[layer.id,layer.role,layer.asset,layer.name].filter(Boolean).join(' ').toLowerCase();
    return !/(?:^|[^a-z])(?:logo|logomarca|fundo|background|bg|decor|ornament|sombra|shadow|icone|icon)(?:[^a-z]|$)/.test(label);
  });
}

module.exports={loadScene,productPhotoLayers};
