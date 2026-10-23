---
"fluent-mediabunny": minor
---

Add probe track selection, source track metadata and opt-in prefix frame-rate estimates. Add per-channel Float32 waveform envelopes with bounded result size and single-PNG rendering from reusable data.

Require Mediabunny 1.62.1 instead of 1.61.6, updating the exact peer dependency. Existing conversion reports retain their track shape; probe now rejects an empty track selection.
