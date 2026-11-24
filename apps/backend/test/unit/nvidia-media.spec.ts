import { nvidiaMediaOptions,NVIDIA_OMNI } from '../../src/providers/nvidia-media-options';
import { mediaDeliveries } from '../../src/specialties/media/delivery';
import { dependenciasDeMontagemPorArquivo } from '../../src/jobs/workflow/media-dependencies';
describe('NVIDIA media',()=>{
  it('validates video output and links existing render to assembly',()=>{
    const opts=nvidiaMediaOptions('clip',{modo:'video',arquivo:'midia/saida/clip.mp4',referencia:'motion/pizza.png'});
    expect(opts.numFrames).toBe(49);
    expect(mediaDeliveries('nvidia-media','',opts as unknown as Record<string,unknown>)[0].path).toBe(opts.arquivo);
    const plan=dependenciasDeMontagemPorArquivo([{key:'clip',provider:'nvidia-media',providerOptions:opts},{key:'final',provider:'juntar-videos',providerOptions:{cenas:[opts.arquivo],arquivo:'midia/saida/final.mp4'}}],'codex-cli') as any[];
    expect(plan[1].dependsOn).toEqual(['clip']);
  });
  it('refuses unsafe paths and out-of-range frames',()=>{
    expect(()=>nvidiaMediaOptions('clip',{modo:'video',arquivo:'../clip.mp4'})).toThrow();
    expect(()=>nvidiaMediaOptions('clip',{modo:'video',arquivo:'midia/saida/clip.mp4',resolucao:720,numFrames:198})).toThrow();
    expect(nvidiaMediaOptions('analise',{modo:'analise',arquivo:'out/analise.md',referencia:'midia/entrada/video.mp4'}).modelo).toBe(NVIDIA_OMNI);
  });
});
