---
name: review-api
description: >-
  Review a proposed fluentbunny public API and stop implementation until the
  author agrees. Use when designing, adding, or changing an exported function,
  builder method, option, result type, or error code. 设计或新增公开 API 时先审核，作者同意前不要写实现。
---

# Review a public API

Do not edit `src/`, `spec/`, tests, docs, or the changelog for a public API until the author agrees with the review below. A public API is a new or changed export, builder method, option, result field, or error code.

## Write the review

Post the review in the conversation before any of those edits. Score each axis from 1 to 5. Put one sentence of advice under each score. End with one verdict. The verdict is `proceed`, `revise`, or `stop`.

Score 1 when the axis fails. Score 5 when it holds. A 1 on any axis forces `stop`. Any other score below 4 forces `revise`. `proceed` requires every score to be 4 or 5.

1. Design idea. Name the existing contract this proposal extends. The contracts are conversion `trim`, `thumbnail`, `thumbnails`, `probe`, `getEmbeddedPicture`, `getWaveformData`, and `renderWaveform`. If the proposal reuses a word from those contracts for a different meaning, score 1.
2. User need. Name the caller job. Name the existing call that already does that job. If that call exists, score 1.
3. Developer experience. State the arguments, the return value, and what the caller keeps after the call returns. A second function needs a separate job. If it does not have one, score 1.
4. Other libraries. Follow the Public interfaces section of `AGENTS.md`. Name each library and the operation you compared, including how many values it returns. If no compared library uses that name and cardinality, score 1.

Write the review in the language the author is using.

## Wait

Do not implement while the verdict is `revise` or `stop`. Do not implement a `proceed` review until the author accepts it in their own words. Silence is not acceptance. After `revise`, write a new review.

## Open verdict

`audioBuffer` and `audioBuffers` are `stop`. Do not implement that proposal. A playable PCM or `AudioBuffer` excerpt was not accepted. Saving a time range stays on `media().trim()`. Peaks stay on `getWaveformData` and `renderWaveform`. A later idea still needs a new review and a new acceptance.
