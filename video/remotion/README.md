# Nivoo Remotion renderer (experimental)

This is the first **real Remotion composition source**, not a claimed validated export.
The registered composition ID is `NivooStudio`, independent of the edit UUID.
It implements timeline layering, video/image/audio, source trims, basic transforms,
text styling, karaoke highlighting and several caption animations. Protected zones
are **not** automatically avoided, and no feature parity is claimed without visual
comparison against the Studio's established FFmpeg output.

Dependencies are exact-versioned in package.json. Generate and commit a lockfile
after a trusted local npm install, then use `npm ci` and `npm run bundle`.
Do not run unpinned npm installs in the production update. The existing Studio
FFmpeg renderer remains the default until this bundle and the rendering path
are independently validated. Do not expose user-controlled source or scripts.

The renderer currently accepts Remotion-served asset URLs only. Existing project media
resolution and bundle static-file provisioning must be connected before the API can
route a user export here. The fixed composition ID resolves a CLI mismatch, but does
not validate the output or enable the experimental renderer.

## Renderer contract hardening

The composition now resolves **only** `/assets/<safe-filename>` via Remotion `staticFile()`; arbitrary URLs, absolute disk paths and network hosts are not accepted. The CLI runner checks this contract before executing Chromium. Video and audio trims use the actual composition FPS, and layer ordering is deterministic for identical z-index values. A trusted asset staging mechanism is still required to copy project-owned media into the Remotion bundle's static asset directory before rendering; **do not enable production rendering before that exists**.

## Staging seguro de mídia Remotion (rodada de integração)

O backend agora oferece `stageRemotionMedia`: recebe apenas caminhos relativos dentro de um workspace autorizado, verifica symlinks, tipos e tamanho, copia as mídias para uma pasta `public/assets` isolada e gera URLs `/assets/<hash>.<ext>` aceitas pela composição. O processo deve ocorrer **antes do bundle** Remotion, em diretório privado e exclusivo por execução. O staging não está exposto diretamente ao navegador e não altera o exportador FFmpeg atual. A conexão do staging ao provisionamento do bundle e ao job de exportação ainda é necessária; a função não habilita Remotion automaticamente. Não executar CI nesta etapa.
