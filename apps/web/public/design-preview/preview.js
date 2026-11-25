/* Nivoo adapter: actual vendor controls with shared profile tokens. */
'use strict';
const engine=new URLSearchParams(location.search).get('engine')==='liquid-glass'?'liquid-glass':'bootstrap';
const glass=engine==='liquid-glass';
const root=document.getElementById('app');
const vendorCss=document.createElement('link');vendorCss.rel='stylesheet';vendorCss.href='vendor/'+engine+'.css';document.head.prepend(vendorCss);
if(glass){const script=document.createElement('script');script.src='vendor/liquid-glass.js';document.head.append(script);}
let config=null,theme='system',current='',active='Visão geral';
const media=matchMedia('(prefers-color-scheme: dark)');
const safe=(v,fallback)=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v)?v:fallback;
const dark=()=>theme==='dark'||(theme==='system'&&media.matches);
function contrastText(hex){const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>.179?'#000000':'#FFFFFF';}
function button(label,primary=false){return '<button type="button" class="'+(glass?(primary?'glass lg-button':'plain-button'):(primary?'btn btn-primary':'btn btn-outline-secondary'))+'" '+(glass&&primary?'data-glass-interactive data-glass-tint="#2563EB"':'')+'>'+label+'</button>';}
function nav(){return '<nav class="demo-nav '+(glass?'glass':'card')+'" aria-label="Navegação da demonstração">'+['Visão geral','Clientes','Relatórios'].map(x=>button(x)).join('')+'</nav>';}
function card(html){return '<div class="'+(glass?'demo-card':'card')+'">'+html+'</div>';}
function table(){return '<div class="table-wrap"><table class="'+(glass?'':'table')+'"><thead><tr><th>Cliente</th><th>Status</th><th>Valor</th></tr></thead><tbody><tr><td>Ana Silva</td><td>Ativo</td><td>R$ 250</td></tr><tr><td>João Santos</td><td>Pendente</td><td>R$ 180</td></tr><tr><td>Maria Lima</td><td>Ativo</td><td>R$ 420</td></tr></tbody></table></div>';}
function dashboard(){return '<div class="demo-metrics">'+card('<span class="muted">Receita</span><p><strong>R$ 24.800</strong></p>')+card('<span class="muted">Clientes</span><p><strong>1.284</strong></p>')+card('<span class="muted">Crescimento</span><p><strong>18,5%</strong></p>')+'</div>'+card('<h2>Desempenho</h2><div class="chart" role="img" aria-label="Gráfico ilustrativo de crescimento">'+[22,45,36,65,52,80,68,96].map(h=>'<span style="height:'+h+'%"></span>').join('')+'</div>')+card(table());}
function form(){return card('<form class="demo-form"><label>Nome<input class="'+(glass?'':'form-control')+'" required placeholder="Nome completo"></label><label>E-mail<input type="email" class="'+(glass?'':'form-control')+'" required placeholder="cliente@exemplo.com"></label><label>Plano<select class="'+(glass?'':'form-select')+'"><option>Inicial</option><option>Profissional</option></select></label><button type="submit" class="'+(glass?'glass lg-button':'btn btn-primary')+'" '+(glass?'data-glass-interactive data-glass-tint="#2563EB"':'')+'>Salvar exemplo</button></form>');}
function controls(){return card('<h2>Controles reais</h2><div class="demo-row">'+button('Ação primária',true)+button('Ação secundária')+'</div><p><label class="'+(glass?'lg-switch':'form-check form-switch')+'"><input type="checkbox" '+(glass?'':'class="form-check-input"')+' aria-label="Notificações" checked></label> Notificações</p><div class="'+(glass?'lg-slider':'')+'"><input type="range" '+(glass?'':'class="form-range"')+' min="0" max="100" value="60" aria-label="Intensidade"></div>');}
function draw(){const component=config.component;root.innerHTML='<section class="demo '+(glass?'lg-scene':'')+'"><div class="lg-backdrop"></div>'+nav()+'<div class="demo-main"><div class="demo-row"><h1>'+({dashboard:'Visão geral',form:'Cadastro de cliente',table:'Clientes',controls:'Componentes'}[component]||'Visão geral')+'</h1>'+button('Novo',true)+'</div>'+({form,table:()=>card(table()),controls,dashboard}[component]||dashboard)()+'<p role="status" aria-live="polite"></p></div></section>';
  const demo=root.firstElementChild;
  demo.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.type==='submit')return;const text=b.textContent;if(b.closest('nav')){active=text;for(const x of demo.querySelectorAll('nav button'))x.dataset.active=String(x===b);}demo.querySelector('[role=status]').textContent='Ação demonstrativa: '+text;});
  demo.addEventListener('submit',e=>{e.preventDefault();demo.querySelector('[role=status]').textContent='Formulário demonstrativo salvo.';});
  for(const b of demo.querySelectorAll('nav button'))b.dataset.active=String(b.textContent===active);
}
function apply(){if(!config)return;const c=dark()?config.darkColors:config.colors;if(!c)return;
  const s=document.documentElement.style;for(const k of ['primary','secondary','accent','background','surface','text','muted','border','success','warning','danger'])s.setProperty('--'+k,safe(c[k],'#888888'));
  const primary=safe(c.primary,'#2563EB'),secondary=safe(c.secondary,'#4F46E5'),background=safe(c.background,'#F1F5F9');
  s.setProperty('--on-primary',contrastText(primary));s.setProperty('--lg-accent',primary);
  s.setProperty('--bs-body-bg',background);s.setProperty('--bs-body-color',safe(c.text,'#111111'));s.setProperty('--bs-border-color',safe(c.border,'#888888'));
  s.setProperty('--primary-fill',config.gradient?'linear-gradient('+Math.max(0,Math.min(360,Number(config.gradientAngle)||0))+'deg,'+primary+','+secondary+')':primary);
  s.setProperty('--backdrop',glass?'radial-gradient(ellipse at 80% 20%, '+secondary+'44, transparent 55%), radial-gradient(ellipse at 10% 60%, '+primary+'55, transparent 65%), '+background:background);
  s.setProperty('--font',({system:'system-ui,sans-serif',serif:'Georgia,serif',mono:'ui-monospace,monospace'})[config.font]||'system-ui');
  s.setProperty('--space',({compact:'8px',normal:'14px',comfortable:'20px'})[config.density]||'14px');
  s.setProperty('--radius',Math.max(0,Math.min(32,Number(config.radius)||0))+'px');
  s.setProperty('--shadow',({none:'none',soft:'0 3px 14px #0002',strong:'0 12px 28px #0004'})[config.shadow]||'none');
  document.documentElement.dataset.bsTheme=dark()?'dark':'light';document.documentElement.dataset.glassAppearance=dark()?'dark':'light';
  if(current!==config.component||!root.firstElementChild){current=config.component;draw();}
  root.firstElementChild.dataset.layout=['sidebar','topbar','bento'].includes(config.layout)?config.layout:'sidebar';
  root.firstElementChild.dataset.motion=String(config.motion!==false&&!matchMedia('(prefers-reduced-motion: reduce)').matches);
  for(const b of root.querySelectorAll('[data-glass-tint]'))b.setAttribute('data-glass-tint',primary);
}
window.addEventListener('message',e=>{if(e.source!==window.parent||e.data?.type!=='nivoo-design-preview'||!e.data.visual)return;config=e.data.visual;theme=e.data.theme;apply();});
media.addEventListener('change',apply);
