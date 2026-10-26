# Fluent API and specification review

Research date: 2026-10-23. This is a design assessment, not a new public contract or runtime validation report. The local dependency baseline is Mediabunny 1.61.6. Other libraries' live documentation is used for design comparisons, not as proof of behavior in that pinned dependency.

## Recommendation

Keep a concise normative contract for behavior that types cannot express. Keep the existing immutable conversion builder and standalone read operations. There is no demonstrated need for another DSL, parser, public plan model, or fluent variant of every operation. Reduce duplication and delivery history in the existing specifications instead of deleting their behavioral guarantees.

This recommendation distinguishes three questions:

| Question                                                     | Assessment                                                                                                                             |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Does fluent chaining alone justify the wrapper?              | No. Chaining is syntax; the wrapper must also remove repeated caller responsibilities.                                                 |
| Does this wrapper have responsibilities worth centralizing?  | Yes: selected-track integrity, metadata policy, deterministic defaults, cancellation, file commit, and resource ownership.             |
| Must those responsibilities live in documents named `spec/`? | No. They need one maintained normative home and corresponding behavioral tests; the directory name and proposal template are optional. |

## Practices supported by primary sources

### 1. Design complete expressions, not chains for their own sake

Martin Fowler describes fluent interfaces as internal DSLs and explicitly warns that method chaining alone does not make an interface fluent. His expression-builder pattern places fluent expression construction over an ordinary command/query interface. [Fluent Interface](https://martinfowler.com/bliki/FluentInterface.html), [Expression Builder](https://martinfowler.com/dslCatalog/expressionBuilder.html).

Application here: `media(source).format(...).resize(...).run()` describes a configurable conversion. `thumbnail(source, options)` and `getEmbeddedPicture(source, options)` already describe complete read operations. Requiring a builder for these reads would introduce questions about conversion settings and lifetime without a demonstrated caller benefit. This is a design inference, consistent with the [thumbnail contract](../spec/thumbnails.md).

### 2. Make mutation and repeated-call semantics explicit

Kysely requires assignment of the returned builder when conditionally adding a clause. Zod documents an immutable interface whose methods return new instances. These are established examples of reusable immutable descriptions, not a rule that all fluent libraries must be immutable. [Kysely getting started](https://kysely.dev/docs/getting-started), [Zod introduction](https://zod.dev/).

The local builder follows that model: [`MediaBuilder.with`](../src/index.ts) creates a new builder. Its contract additionally distinguishes replacement, field merge, and metadata-instruction replacement. In particular, repeated `metadata()` calls do not accumulate patches; its `merge` option means merging with source metadata. Those rules cannot be inferred from the return type. Keep the [override table](../spec/conversion.md#configuration).

### 3. Specify whether a chain describes configuration or execution order

Sharp permits one resize per pipeline, with previous resize calls ignored. Its rotation documentation says rotation/extraction order can change the result, while auto-orientation and flip have their own ordering rules. This demonstrates why a familiar chain syntax does not establish a universal execution model. [Sharp resize](https://sharp.pixelplumbing.com/api-resize/), [Sharp operations](https://sharp.pixelplumbing.com/api-operation/).

Here, geometry has a fixed order: source orientation/flip, additional rotation, additional flip, crop, then resize, regardless of call order. Keep that explicit [contract](../spec/conversion.md#encoding-and-geometry). Do not imitate Sharp's operation order merely because both interfaces are fluent. A useful review example is whether `crop(...).rotate(...)` and `rotate(...).crop(...)` intentionally resolve to the same configuration.

### 4. Keep construction and execution separate without exporting every internal stage

Kysely exposes query building, compilation, and execution separately because SQL compilation is a supported use case. Mediabunny separates `Conversion.init()` from `execute()`. These examples establish that configuration and effects can have distinct lifecycles; they do not establish that every wrapper needs a public `compile()` or `plan()`. [Kysely compilation](https://kysely.dev/docs/recipes/splitting-query-building-and-execution), [Mediabunny conversion guide](https://mediabunny.dev/guide/converting-media-files).

Here, builder methods produce configuration and `run()` executes. The extraction iterator has a different contract: synchronous validation and snapshotting, followed by deferred I/O on first iteration. Retain these observable timing rules and cancellation semantics. Keep internal planning private unless an actual caller needs a stable independently useful result.

### 5. Centralize policy that upstream deliberately leaves to callers

The pinned Mediabunny source states that a conversion can remain valid after discarding tracks when the remaining tracks form a valid output. The current guide also exposes `discardedTracks` and `utilizedTracks` for caller inspection. [Mediabunny 1.61.6 conversion source](https://github.com/Vanilagy/mediabunny/blob/v1.61.6/src/conversion.ts), [conversion guide](https://mediabunny.dev/guide/converting-media-files).

The wrapper deliberately enforces a stricter contract: [`run.ts`](../src/run.ts) checks selected-track retention and reports `TRACK_LOSS`; [`target.ts`](../src/target.ts) and [`scope.ts`](../src/scope.ts) separate output completion from file commit and cancellation. Those responsibilities would reappear in application code if the wrapper were removed. Its value therefore extends beyond renaming upstream options. Preserve the rules and rationale, while avoiding a duplicate description of every upstream primitive.

### 6. Use types to prevent mistakes, but document runtime semantics independently

Kysely documents a concrete limitation: assigning a conditionally extended selection back to a previously typed variable can lose result-type information. Its conditional helper exists to preserve that information. Zod likewise combines static inference with runtime parsing. Fluent syntax and TypeScript do not by themselves prove runtime correctness. [Kysely conditional selects](https://kysely.dev/docs/recipes/conditional-selects), [Zod introduction](https://zod.dev/).

The local contract still needs runtime rules for frame coverage, null versus error, cancellation precedence, owned result bytes, and resource cleanup. Preserve these rather than replacing them with declarations alone. Conversely, repeated copies of full TypeScript declarations can be replaced with links to the maintained public types when they add no semantic explanation.

## What the existing specifications should retain

- Conversion replacement/merge behavior, fixed geometry order, defaults, track retention, metadata projection, cancellation and commit rules.
- Extraction origin and half-open frame coverage, interval sampling, duplicate/missing positions, validation timing, iterator termination and owned results.
- Embedded-picture eligibility, deterministic selection, one-result cardinality, null semantics and owned bytes.
- Observable behavior, with tests and execution evidence maintained separately in the [conversion](validation.md) and [extraction](thumbnail-validation.md) validation records.
- Rationale for deliberate departures from upstream and from established library conventions.

Keep execution evidence separate from the development contracts.

## What can be reduced or moved

| Existing material                                                                       | Suggested treatment                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repeated full declarations and introductory examples across spec, README and guides     | Maintain declarations in source and usage in guides; keep only examples that explain unusual contract semantics in the spec.                                                                                      |
| Planned implementation sequences and likely touchpoints after delivery                  | Archive as design history or remove after retaining the relevant rationale. They need not constrain later refactoring.                                                                                            |
| Implementation prescriptions such as `data.slice()` and an internal picture-label table | Keep the public ownership, byte-range, and deterministic-selection guarantees in the contract; keep implementation-specific safeguards in code and regression tests, with enough rationale to prevent recurrence. |
| Operator authorization dates and conversational delivery history                        | Remove from the current API contract or retain only in historical records. They do not help callers understand behavior.                                                                                          |
| Broad capability inventory and unapproved future batches                                | Keep separately as nonbinding roadmap information, or omit until needed. They are not current requirements.                                                                                                       |
| Document version labels and package-version tracking                                    | Name contracts by capability and describe current behavior. Git tracks document history; Changesets and the changelog track releases.                                                                             |
| English and Chinese copies                                                              | Maintain one normative source and identify the other as a translation, or maintain explicit synchronization. Avoid two competing authorities.                                                                     |

The contracts are organized by [conversion](../spec/conversion.md), [thumbnails](../spec/thumbnails.md), and [embedded pictures](../spec/embedded-picture.md). They retain interfaces, behavior, and boundaries without requirement IDs, acceptance checklists, implementation plans, or release tracking.

## Verification and limits

Reviewed the public builder and configuration validation, relevant track/target/scope code, the original specifications, existing extraction guide, validation-document structure, and selected tests. Consulted the primary sources linked above. The subsequent documentation reorganization changes no production code, types, tests, exports, fixtures, or dependency configuration.

No runtime, browser, performance, or full conformance tests were run. Source inspection establishes design intent and implementation shape, not complete runtime compliance. No new abstraction or dependency is recommended.
