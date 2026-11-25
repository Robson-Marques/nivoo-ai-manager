/** Sources are explicit: a reference is not an executable renderer. */
export type DesignSource = {
  id: string; name: string; style: string; kind: 'library' | 'reference' | 'registry';
  url: string; docs: string; install?: string; requirements: string[];
  status: 'reference' | 'adapter-pending' | 'ready';
  adapter?: 'liquid-glass' | 'bootstrap';
  related?: string[];
};
export const designCatalog: readonly DesignSource[] = [
  {id:'asimov-glass',name:'Liquid Glass — Asimov Academy',style:'Liquid Glass com refração',kind:'library',url:'https://github.com/asimov-academy/liquid-glass-skill',docs:'https://github.com/asimov-academy/liquid-glass-skill/blob/main/skills/liquid-glass/SKILL.md',requirements:['HTML, CSS e JavaScript'],status:'ready',adapter:'liquid-glass'},
  {id:'liqui',name:'Liqui Design',style:'Liquid Glass',kind:'registry',url:'https://liqui.design/',docs:'https://liqui.design/docs',install:'npx shadcn@latest add https://liqui.design/r/button.json',requirements:['React 18/19','Tailwind CSS 4','shadcn registry'],status:'adapter-pending',related:['liquid-glass-prompts','react-bits','asimov-glass']},
  {id:'liquid-glass-prompts',name:'Liquid Glass Design — Prompts',style:'Liquid Glass',kind:'reference',url:'https://liquidglassdesign.com/prompts',docs:'https://liquidglassdesign.com/',requirements:[],status:'reference'},
  {id:'react-bits',name:'React Bits',style:'Motion e efeitos',kind:'registry',url:'https://reactbits.dev/',docs:'https://reactbits.dev/get-started/index',requirements:['React','Dependências específicas do componente'],status:'adapter-pending'},
  {id:'material',name:'Material UI',style:'Material Design',kind:'library',url:'https://mui.com/material-ui/',docs:'https://mui.com/material-ui/getting-started/',install:'npm install @mui/material @emotion/react @emotion/styled',requirements:['React'],status:'adapter-pending'},
  {id:'fluent',name:'Fluent UI',style:'Fluent Design',kind:'library',url:'https://react.fluentui.dev/',docs:'https://react.fluentui.dev/',install:'npm install @fluentui/react-components',requirements:['React'],status:'adapter-pending'},
  {id:'shadcn',name:'shadcn/ui',style:'Minimalista e modular',kind:'registry',url:'https://ui.shadcn.com/',docs:'https://ui.shadcn.com/docs',requirements:['Framework e configuração compatíveis'],status:'adapter-pending'},
  {id:'ant',name:'Ant Design',style:'Enterprise',kind:'library',url:'https://ant.design/',docs:'https://ant.design/docs/react/introduce',install:'npm install antd',requirements:['React'],status:'adapter-pending'},
  {id:'mantine',name:'Mantine',style:'Moderno e personalizável',kind:'library',url:'https://mantine.dev/',docs:'https://mantine.dev/getting-started/',install:'npm install @mantine/core @mantine/hooks',requirements:['React'],status:'adapter-pending'},
  {id:'carbon',name:'Carbon Design System',style:'Enterprise e dados',kind:'library',url:'https://carbondesignsystem.com/',docs:'https://carbondesignsystem.com/developing/frameworks/react/',install:'npm install @carbon/react',requirements:['React'],status:'adapter-pending'},
  {id:'chakra',name:'Chakra UI',style:'Modular e acessível',kind:'library',url:'https://chakra-ui.com/',docs:'https://chakra-ui.com/docs/get-started/installation',install:'npm install @chakra-ui/react @emotion/react',requirements:['React'],status:'adapter-pending'},
  {id:'radix',name:'Radix Primitives',style:'Componentes sem estilo',kind:'library',url:'https://www.radix-ui.com/primitives',docs:'https://www.radix-ui.com/primitives/docs/overview/introduction',requirements:['React'],status:'adapter-pending'},
  {id:'bootstrap',name:'Bootstrap',style:'Clássico responsivo',kind:'library',url:'https://getbootstrap.com/',docs:'https://getbootstrap.com/docs/5.3/getting-started/introduction/',install:'npm install bootstrap',requirements:['CSS/JavaScript'],status:'ready',adapter:'bootstrap'},
];
export function findDesignSource(id: string) { return designCatalog.find(source => source.id === id); }
