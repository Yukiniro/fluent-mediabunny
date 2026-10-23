# Documentation design

## Theme

A project homepage introduces the library, demonstrates a conversion, and links to its capabilities, setup guide, and API reference. Guides and API pages remain a technical reference with working examples and precise contracts. The original introduction lives under `guide/introduction`.

References reviewed: [Vite](https://vite.dev/guide/) for its restrained three-column reading layout; [Mediabunny](https://mediabunny.dev/guide/reading-media-files) for task-oriented guides and explicit media constraints; [Rspress](https://rspress.rs/guide/basic/custom-theme) for supported theme customization. These references inform presentation, not this library's API semantics.

## Palette

The palette follows Mediabunny's pink accent and soft neutral surfaces, with a distinct muted rose identity. Its live site was reviewed on 2026-10-23: light-mode brand tokens were `#f65586` and `#eb47a1`, with white and neutral gray surfaces; the dark-mode link accent was `#ff8aad`.

Use pure white `#ffffff` for the light-mode reading surface, neutral grays `#f5f5f5` and `#fafafa` for secondary surfaces and code blocks, and `#242424` for headings. Keep body text, dividers, and ordinary surfaces neutral. Reserve the muted rose `#b23862` for emphasis such as links, active navigation, focus rings, syntax highlighting, and the second hero line. Primary buttons use white text on rose; hover darkens to `#8f274d`. Keep the existing layout and typography rather than reproducing Mediabunny's illustration or glow.

Dark mode uses plum charcoal `#1b161c`, raised surfaces `#28202a`, and a softer rose link color `#f0a0ba`. Inline code and build-time syntax highlighting follow the same palette. Check text and button contrast in both modes. Semantic callouts keep the original Rspress colors.

## Typography

Use the local Segoe UI / system sans stack with explicit Chinese fallbacks. Use Cascadia Code / Consolas for signatures. No remote font dependency. Body text stays at 16px with a 1.8 line height, with compact navigation and smaller reference tables.

## Components

Reuse Rspress navigation, search, language switcher, outline, code copy controls, callouts, and pager. API pages present an example, a signature, parameters and defaults, return values, behavior, and errors. Builder methods get individual anchor headings. Keep existing page routes and legacy media result anchors reachable.

## Layout

Use a standalone homepage with a split introduction/code example, four task rows, and concise API principles. Keep one primary setup entry point. Omit repeated brand labels, format lists, decorative section captions, obvious flow labels, and duplicate setup calls to action. Put compatibility details in the guides; keep the example's input requirements visible. Reuse the documentation palette, type, navigation, and build-time code highlighting. Use the first-class `custom` page type for static MDX content, without a new runtime component.

Use one persistent sidebar across guides and API reference, with localized directory titles. At desktop widths, use a 264px sidebar, a bounded reading column, and a 224px outline. Tables and code scroll inside their containers. Narrow screens use the original Rspress menu and outline controls.

## Depth and motion

Use separators and surface steps instead of decorative shadows. Radius scale: 4px inline code, 8px code blocks and tables. A thin brand-colored rail marks the active sidebar item. Keep interactions to native theme transitions and focus rings; honor reduced motion.

## Do and don't

Use source-backed facts from `src/`, observable behavior in `tests/`, and contracts in `spec/`. Explain units, optional values, synchronous validation, cleanup, and null results. Do not imply npm publication, automatic codec fallback, or unsupported API features. Existing docs incorrectly rejected `rotate(0)` in copy mode; `src/config.ts` and `spec/conversion.md` permit it. Correct the docs without changing runtime behavior.

## Responsive behavior

Check desktop, 375px and 320px screens in both locales. Check dark mode, keyboard focus, search, code copying, navigation, and deep links. Keep large signatures in scrollable code blocks rather than shrinking text.

## Maintenance guide

CSS strategy: plain CSS through `theme/index.css`, using Rspress variables and public BEM classes. Avoid component ejection and new runtime components. Keep locale metadata structurally identical; localize page titles and descriptions. Run `pnpm --dir website build` to validate language parity, navigation, links, and anchors.

Keep `_nav.json` links relative to the locale root, such as `/api/` in both languages. Rspress adds the locale directory prefix automatically; manually adding `/zh` produces `/zh/zh/api/`. Explicit localized links in homepage MDX remain fully qualified.
