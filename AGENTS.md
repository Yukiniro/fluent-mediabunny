# Agent Guidelines

## Language

- Use English for commit messages, pull request titles and descriptions, code comments, identifiers, test descriptions, and documentation, except explicitly localized content.

## Understand the Task

- Before making changes, read the relevant code, callers, and tests to understand the requirements and impact.
- For changes to public behavior, consult the relevant design documents and explicitly identify any conflicts.
- Solve only the current task; avoid unrelated refactoring and speculative features.

## Public interfaces

- Before naming a new public function or choosing its result shape, read the interfaces mature libraries already use for that same job. Prefer an established operation name and the same cardinality, such as one picture or a list.
- Name the libraries you checked in the design note or spec. Depart from them only to preserve a contract this library already has, such as `MediaInput`, `AbortSignal`, or an owned byte copy.
- Do not coin a function name from a roadmap noun when those libraries already share a different word.

## Implementation

- Solve the whole problem with the smallest clear implementation, prioritizing readability.
- Reuse existing implementations, conventions, and dependencies first.
- Introduce new abstractions or concepts only when the existing structure cannot meet the current requirements, and explain why.
- Fix the root cause and update affected callers, tests, and documentation.
- Preserve necessary validation, error handling, and resource cleanup when simplifying code.

## Testing and Verification

- When adding or fixing behavior, write or extend tests first, confirm they fail for the expected reason, then implement the change and make them pass.
- Test observable behavior and important edge cases. Extend existing tests where possible and avoid coupling tests to implementation details.
- Documentation-only and formatting changes need no new tests; refactoring must keep existing behavior tests passing.
- Do not hide problems by deleting tests, weakening assertions, or skipping failures. When requirements change, update tests to reflect the new requirements.
- Run the project's existing checks appropriate to the impact of the change. Report actual results, unverified areas, and pre-existing failures clearly.

## Commits

- Each commit should contain one complete, reviewable logical change, including its tests and necessary documentation.
- Review the full diff before committing and exclude unrelated changes, temporary files, and debugging code.
- Use Conventional Commits: `type(scope): description`, with an optional scope. Describe the concrete change; explain the reason and compatibility impact in the body when needed.
- Commit, push, and publish only within the user's authorization. Preserve the user's existing uncommitted work.

## Release

- Contributors with a `src/` change run `pnpm changeset` and commit the file it adds under `.changeset/`.
- Maintainers follow [RELEASING.md](RELEASING.md). The publish command is `pnpm release:publish`.
