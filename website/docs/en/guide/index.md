---
title: Guides
description: Task-oriented guides for installing fluentbunny and working with browser media.
---

# Guides

Build a browser media workflow, then use the API reference for exact types and validation rules.

## Set up

[Get started](/guide/getting-started) covers the source build, installation, and your first conversion. [Inputs and outputs](/guide/inputs-and-outputs) explains URL requirements, file permissions, cancellation, and commit states.

## Convert media

[Convert a file](/guide/convert) walks through format selection, copy versus transcode, trim, geometry, audio extraction, and metadata editing.

## Read images and metadata

[Extract thumbnails](/guide/thumbnails) covers a single poster, batches, frame timing, image sizing, and iterator cleanup.

For duration and track inspection, start with the [probe example](/api/probe#example). For an audio peak image, follow [probe, then waveform data, then one PNG](/api/waveforms#example). For cover art, use [getEmbeddedPicture](/api/embedded-picture#example). A cover image, a waveform PNG, and a decoded video frame are separate operations.

## Handle failures

Use [MediaError](/api/errors) to distinguish invalid options, unavailable codecs, cancellation, and file write failures. Read [Execution and results](/api/run) before treating progress as proof that a file was saved.
