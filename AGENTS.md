# fluent-mediabunny

A fluent API that makes Mediabunny easier to understand and use, drawing on its public capabilities beyond Conversion. The implementation is browser-only and uses Mediabunny 1.61.6. Read spec/design-v1.md for conversion and spec/spec-design-v0-2.md for video image extraction before changing public behavior. Keep conversion one input, one output; extraction supports bounded image batches; no presets, FFmpeg runtime, timeline, server, or automatic permissions.

Use Vite+ for formatting, lint, types, tests, dev server and library packaging. Scripts: `vp check`, `vp test run`, `vp pack`; `pnpm test:browser` requires built dist and Playwright browsers. `pnpm fixtures` regenerates local synthetic media using FFmpeg (test-only dependency).

Keep file close behind the commit barrier. Cancellation before commit must abort the actual file stream. Never wire StreamTarget directly to a user file stream. Do not loosen the exact codec/rate/channel checks or silently drop selected tracks. Changes to these contracts need focused lifecycle tests and browser evidence.

Record unsupported codec cases separately from successful encoding. OPFS and automated WebKit do not prove native picker or Safari/iOS behavior. Do not publish packages without user instruction.
