# Third-party notices

The MIT license in this repository applies to fluentbunny's original source, documentation, and synthetic fixtures. It does not replace third-party licenses.

## Mediabunny 1.62.1

- Copyright: Vanilagy and contributors; see the upstream notices.
- License: [Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/).
- Source: <https://github.com/Vanilagy/mediabunny/tree/v1.62.1>.
- Upstream license: <https://github.com/Vanilagy/mediabunny/blob/v1.62.1/LICENSE>.

Mediabunny is an external peer dependency. This wrapper uses its public APIs and does not vendor or modify its source files. Preserve upstream notices and meet the MPL requirements when distributing Mediabunny, including in an application bundle. Mozilla's [MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) explains the file-level boundary and source-availability requirements.

## Development tools and fixtures

Vite+, TypeScript, Playwright, and other development dependencies retain their own licenses, provided with their packages. They are not included in the library's runtime bundle.

Media fixtures are generated from FFmpeg's synthetic test patterns and sine waves using `scripts/fixtures.mjs`. No third-party recordings are included. FFmpeg is an external development/validation tool, not a runtime dependency or a bundled executable.
