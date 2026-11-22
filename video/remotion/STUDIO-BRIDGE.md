# Studio timeline to Remotion bridge

`studioToRemotionComposition` converts the existing saved Studio edit schema
to the portable `VideoComposition` contract. It preserves sequential clips,
source offsets, audio volume, overlays, caption timing/animations, karaoke
words and protected zones, while deduplicating project media.

This conversion is intentionally **fail-closed** on unsupported semantics:
looping soundtracks are rejected until the Remotion renderer reproduces their
behavior, and compositions exceeding one hour are not accepted by the portable
schema. The trusted caller must verify media ownership, validate the Studio
edit and supply the actual output dimensions before invoking this function.

The existing Studio render endpoint is unchanged and remains FFmpeg-based.
The bridge is not a claim of visual parity or production readiness.

Media IDs are now bounded SHA-256 identifiers derived from the authorized Studio media reference. They do not reveal the original source path and remain stable across repeated edits. The converter rejects nonfinite clip timing before projection.

## Looping soundtrack (implemented in source)

The Studio soundtrack is now projected as a full-duration audio layer with `loop: true` and its original volume. The composition uses Remotion's native `<Audio loop>` prop. The portable manifest, props serialization and parity checker propagate the loop contract. `audio-loop` remains an unverified feature in production until a rendered MP4 is audibly compared to the existing FFmpeg export; the worker will refuse it when parity is not explicitly verified.
