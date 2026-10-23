# Releasing

A maintainer releases fluent-mediabunny from a local clone. No workflow versions or publishes the package. A release takes two commands, and you can stop after the first one.

## Before you start

Use Node 24 and pnpm 12.14.0, as for development. Publishing needs an npm login on your machine, so run `npm login` once. Versioning needs no credentials.

Start from the latest `main`:

```sh
git switch main
git pull --ff-only
pnpm install --frozen-lockfile
pnpm changeset status --verbose
```

The last command lists the pending changesets and the version they produce.

## Version the release

```sh
pnpm release:version
git show
git push origin main
```

`release:version` stops if the working tree has changes, if no pending changeset bumps the version, or if a `major` changeset is pending while the version is below 1.0. Otherwise it prints the planned version, runs `changeset version`, formats `CHANGELOG.md`, and commits `package.json`, `CHANGELOG.md`, and the consumed changesets as `chore(release): vX.Y.Z`.

Push the release commit straight to `main` with `git push origin main`. Do not open a pull request for it. A squash merge appends the pull request number, as in `chore(release): v0.2.1 (#12)`, and `release:publish` accepts only the exact `chore(release): vX.Y.Z` subject.

Pushing the release commit starts the Validate workflow on it. You can stop here. The new version stays unpublished until you run the next step.

## Publish the release

Wait until Validate passes for the release commit. Then, with the release commit checked out, run:

```sh
pnpm release:publish
```

Before it builds anything, the command checks the following and stops at the first failure:

- The working tree is clean.
- `HEAD` is the `chore(release): vX.Y.Z` commit for the version in `package.json`.
- `HEAD` is on `origin/main`.
- Validate succeeded for `HEAD`.
- `pnpm whoami` succeeds.

It then installs the locked dependencies and runs `changeset publish`, which builds through `prepublishOnly` and publishes with public access. Last, it creates the `vX.Y.Z` tag and pushes it. If your npm account uses two-factor authentication, npm asks for a one-time password.

`prepublishOnly` runs the same checks, so a `pnpm publish` that you run by hand stops at the same point.

## Rerun after a failure

You can rerun either command.

- If `release:version` stopped before it committed, its output is still in the working tree. Run `git stash --include-untracked` or discard the changes, then rerun.
- After a successful `release:version`, a rerun reports that nothing is pending and changes nothing.
- After a successful `release:publish`, a rerun publishes nothing, creates the tag only if it is missing, and pushes it.

## Review changesets

While the version is below 1.0, contributors file `minor` for breaking changes and `patch` for everything else, as the [Contributing](README.md#contributing) section says. `release:version` refuses a `major` changeset below 1.0, so ask for `minor` before you merge a pull request that carries one. To release 1.0, edit that rule in `scripts/release.mjs` in the pull request that ships 1.0.

The Changeset check looks only at `src/`, so ask for a changeset when a pull request bumps `peerDependencies`, such as the Mediabunny version.

## The first release

fluent-mediabunny has never been published to npm. The first published version is whatever the first real changeset produces, for example 0.2.1 from a `patch` changeset. Version 0.2.0 is not backfilled into `CHANGELOG.md`.
