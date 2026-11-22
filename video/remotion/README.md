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

The composition now resolves **only** `/assets/<safe-filename>` via Remotion `staticFile()`; arbitrary URLs, absolute disk paths and network hosts are not accepted. The CLI runner checks this contract before executing Chromium. Video and audio trims use the actual composition FPS, and layer ordering is deterministic for identical z-index values. The trusted backend now stages project-owned media inside a **private per-job bundle** before invoking the renderer. The worker must still create/copy the trusted bundle for each job and install the pinned CLI. **Do not enable production rendering before that exists and visual parity is validated.**

## Staging seguro de mídia Remotion (rodada de integração)

O backend agora oferece `stageRemotionMedia`: recebe apenas caminhos relativos dentro de um workspace autorizado, verifica symlinks, tipos e tamanho, copia as mídias para uma pasta `public/assets` isolada e gera URLs `/assets/<hash>.<ext>` aceitas pela composição. O processo deve ocorrer **antes do bundle** Remotion, em diretório privado e exclusivo por execução. O staging não está exposto diretamente ao navegador e não altera o exportador FFmpeg atual. A conexão do staging ao provisionamento do bundle e ao job de exportação ainda é necessária; a função não habilita Remotion automaticamente. Não executar CI nesta etapa.

### Connected execution path

`executeVerifiedRemotionRender` now resolves project-owned media, stages them in the private bundle, creates props from staged URLs and invokes the CLI. `renderRemotionComposition` verifies that every referenced staged asset exists before invoking Chromium. The bundle is **required to be unique per job**: shared bundles must never be modified by render jobs. A trusted worker must provision the bundle and verify the engine before enabling this path. The existing Studio export route remains on FFmpeg.

### Per-job bundle provisioning

The backend provides `provisionPrivateRemotionBundle`, which copies an operator-provisioned trusted bundle into a new, private workspace job directory. It refuses existing target directories and symlinked job paths. A caller must allocate a fresh job directory and run this before `executeVerifiedRemotionRender`. The CLI and trusted bundle installation are not yet wired into `nivoo update`; the FFmpeg export remains the only production route.

### Atomic Remotion output

The execution adapter now renders to a hidden per-output partial MP4, runs independent inspection on that partial, and only then renames it to the public output name. Failed or cancelled jobs remove the partial file. The runner permits this private partial filename. The trusted bundle copy fails closed on symlinks rather than silently omitting executable assets. Asset staging uses exclusive copy semantics to reject collisions.

### Last-mile hardening

Render partials now carry a per-attempt UUID to avoid collision between interrupted jobs; duration/FPS bounds are enforced before invoking the CLI, and trusted bundle copying refuses source/target directory nesting. The backend adapter is **not** yet wired to the legacy Studio edit schema or production update; the production FFmpeg renderer remains enabled. This is an integration boundary, not proof of end-to-end export.

### Trusted worker orchestration

`runPreparedRemotionJob` now allocates a per-run directory, copies the trusted bundle, stages authorized media, invokes the render adapter, inspects the MP4 and removes its temporary directory on both success and failure. It requires the caller to supply authorization, lease, quotas and verified feature support. It is intentionally **not exposed as a public route** until the legacy Studio edit model is mapped and the update installs the pinned Remotion CLI and trusted bundle.

### Trusted Studio worker adapter

`renderStudioEditWithRemotion` connects the saved Studio edit format to the private Remotion job orchestration. It performs the pure conversion, passes authorized project media references and delegates to the isolated bundle, staging, CLI and MP4 inspection chain. It deliberately does not alter the existing HTTP render endpoint: that endpoint must continue using FFmpeg until the trusted production installer provisions Remotion and a verified feature support map. A user-provided capabilities map must never enable rendering.
