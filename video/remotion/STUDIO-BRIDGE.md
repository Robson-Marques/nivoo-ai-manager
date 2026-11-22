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
