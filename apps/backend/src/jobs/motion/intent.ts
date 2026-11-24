// Explicit visual rejection, not an ordinary technical retry or soundtrack edit.
export function pedeRevisaoVisual(text: string): boolean {
  const t=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if (/\b(?:somente|apenas|so)\s+(?:o |a )?(?:audio|trilha|musica|narracao|locucao)\b/.test(t)) return false;
  const rejection=/\b(?:veio errado|video (?:e|esta|ficou) (?:o )?(?:mesmo|ruim|errado)|mesmo video|nao (?:criou|mudou|alterou|evoluiu)|faltam? (?:os |as )?(?:elementos graficos|grafismos|imagens|objetos|3d))\b/;
  if(rejection.test(t))return true;
  const request=t.replace(/\b(?:nao|sem|evitar)\s+(?:refazer|refaca|recriar|recriacao|fazer de novo)\b/g,'').replace(/\brefazer (?:a |o )?(?:renderizacao|render|exportacao)\b/g,'');
  return /\b(?:refa(?:zer|ca)|recria(?:r|cao)|faca de novo|nova composicao)\b/.test(request);
}
export function pedeGrafismos(text: string): boolean {
  return /\b(?:premium|grafismos|elementos gr[aá]ficos|dire[çc][aã]o de arte|identidade visual animada|ilustra[çc][aã]o animada)\b/i.test(text);
}

/**
 * "sem geometria 3D" e "não quero WebGL" NÃO solicitam geometria 3D.
 * A classificação considera o briefing da pessoa, nunca a terminologia
 * técnica que o próprio Nivo injetou na validação anterior do plano.
 */
export function pedeGeometria3D(texto: string): boolean {
  const limpo = texto
    .replace(/\b(?:sem|dispensar|dispensa|dispensando|evitar|evite|evitando)\s+(?:(?:qualquer|nenhuma?|uma?|de|geometria|malhas?|objetos?|efeitos?|visual|real|em)\s+){0,5}(?:3[\s-]*d|webgl)\b/gi, ' ')
    .replace(/\bn[aã]o\s+(?:quero|queremos|preciso|precisamos|usar|utilizar|inclua?|incluir|faça|fazer|criar|crie|tem|ter|tenha)\s+(?:(?:de|qualquer|nenhuma?|uma?|geometria|malhas?|objetos?|efeitos?|visual|real|em)\s+){0,5}(?:3[\s-]*d|webgl)\b/gi, ' ');
  return /\b3[\s-]*d\b|\bwebgl\b|\bextrud(?:ado|ada|idos?|idas?|ir|a(?:ç[aã]o|s))?\b/i.test(limpo);
}


/** Only a known existing composition plus a preservation request qualifies.
 * A general request to redo an artwork remains a creative revision. */
export function pedeEdicaoPontual(text:string):boolean{
  const t=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/\b(?:nova composicao|do zero|recrie tudo|refaca tudo|redesenhe tudo|troque o motor|migre para)\b/.test(t))return false;
  return /\b(?:corrig\w*|corr[eé]c\w*|ajust\w*|alter\w*|edit\w*|recuper\w*|substitu\w*|troqu\w*|retom\w*)\b/.test(t)&&
    /\b(?:preserv\w*|mantenh\w*|manter|reaproveit\w*|sem recriar|sem refazer|mesma composicao|mesma animacao|composicao existente|ja aprovad\w*|apenas|somente|so)\b/.test(t);
}
