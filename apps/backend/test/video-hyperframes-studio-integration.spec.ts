import { MOTION_PRESETS, trustedMotionHtml, validateMotionRequest } from '../src/video-studio/hyperframes-motion';
import { runVideoTool } from '../src/video/video-tool-adapters';
import * as os from 'node:os';

describe('Nivoo HyperFrames motion integration',()=>{
  it('exposes only trusted motion presets',()=>{
    expect(MOTION_PRESETS.map(p=>p.id)).toEqual(['kinetic-title','neon-title','brush-reveal','zoom-impact','slide-reveal','soft-fade']);
    expect(MOTION_PRESETS.every(p=>p.origin==='nivoo-reviewed'&&p.version===1&&p.durationSeconds===3.2)).toBe(true);
    expect(()=>validateMotionRequest({preset:'../../secret',title:'olá'})).toThrow('desconhecido');
    expect(()=>validateMotionRequest({preset:'neon-title',title:'x'.repeat(101)})).toThrow('inválido');
    expect(()=>validateMotionRequest({preset:'neon-title',title:'olá\nmundo'})).toThrow('inválido');
  });
  it('escapes input without accepting browser code or remote assets',()=>{
    const html=trustedMotionHtml('brush-reveal','</div><script>alert("x")</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert("x")');
    expect(html).toContain('window.__timelines["nivoo-motion"]');
    expect(html).toContain('gsap.timeline({paused:true})');
    expect(html).toContain('<script src="gsap.min.js"></script>');
    expect(html).not.toContain('https://');
    expect(html).toContain('data-composition-id="nivoo-motion"');
    expect(html).toContain('data-duration="3.2"');
  });
  it('exposes seekable HTML presets with a fixed composition clock',()=>{
    for(const preset of MOTION_PRESETS){
      const html=trustedMotionHtml(preset.id,'Oi');
      expect(html).toContain('data-width="540"');
      expect(html).toContain('data-height="960"');
      expect(html).toContain('data-fps="24"');
      expect(html).toContain('data-track-index="0"');
      expect(html).toContain('window.__timelines["nivoo-motion"]');
      expect(html).toContain('gsap.timeline({paused:true})');
      expect(html).not.toContain('https://');
      expect(html).not.toContain('window.setInterval');
    }
  });
  it('accepts bounded larger catalog output while keeping default tool log bounds',async()=>{
    const code='process.stdout.write("a".repeat(25000))';
    const bounded=await runVideoTool(process.execPath,['-e',code],os.tmpdir(),5000,
      undefined,{PATH:process.env.PATH},128*1024);
    expect(bounded.exitCode).toBe(0);
    expect(bounded.stdout).toHaveLength(25000);
    expect(bounded.stdoutTruncated).toBe(false);
    const regular=await runVideoTool(process.execPath,['-e',code],os.tmpdir(),5000);
    expect(regular.stdoutTruncated).toBe(true);
    expect(regular.stdout.length).toBeLessThanOrEqual(16_384);
  });
  it('can spawn a CLI with an isolated environment',async()=>{
    const previous=process.env.NIVOO_HF_PRIVATE_TEST;
    process.env.NIVOO_HF_PRIVATE_TEST='do-not-leak';
    try{
      const result=await runVideoTool(process.execPath,[
        '-e','process.stdout.write(process.env.NIVOO_HF_PRIVATE_TEST || "isolated")',
      ],os.tmpdir(),5000,undefined,{PATH:process.env.PATH});
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('isolated');
    }finally{
      if(previous===undefined)delete process.env.NIVOO_HF_PRIVATE_TEST;
      else process.env.NIVOO_HF_PRIVATE_TEST=previous;
    }
  });
});
