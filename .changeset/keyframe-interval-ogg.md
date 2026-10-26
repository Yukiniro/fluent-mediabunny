---
"fluentbunny": patch
---

Add `video({ keyFrameInterval })` to request the number of seconds between video key frames, where `0` makes every frame a key frame and any value re-encodes the video while audio still copies when it can. Add `format("ogg")` for audio-only Ogg output with exactly one track, which encodes Opus or copies Opus and Vorbis, writes metadata as Vorbis comments, and reports the `audio/ogg` MIME type.
