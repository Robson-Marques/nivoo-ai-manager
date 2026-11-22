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
