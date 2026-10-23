---
"fluent-mediabunny": patch
---

Aggregate each waveform bin in one pass so multi-hour, high-sample-rate audio does not repeat timestamp math for every PCM frame.
