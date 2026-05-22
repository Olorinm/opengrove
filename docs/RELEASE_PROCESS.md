# Release Process

This is the release checklist for OpenGrove. A release is not complete until the source, Git tag, GitHub Release, and npm package all point at the same version.

## What A Release Means

- `main` contains the exact source code for the release.
- `vX.Y.Z` is an immutable Git tag for that source snapshot.
- GitHub Release explains what changed for humans.
- npm `opengrove@X.Y.Z` is the installable package users get with `npm install -g opengrove`.

## Version Choice

OpenGrove is still pre-`1.0.0`, so use:

- Patch, for small fixes: `0.2.1`, `0.2.2`
- Minor, for features or architecture changes: `0.3.0`, `0.4.0`
- `1.0.0` only when the CLI, state shape, and core contracts are stable enough to promise compatibility.

## Preflight

Start on `main` with a clean working tree.

```bash
git checkout main
git fetch origin main --tags
git status --short
git rev-list --left-right --count HEAD...origin/main
```

Expected:

- `git status --short` is empty.
- `HEAD...origin/main` is `0 0`, or you intentionally fast-forward/push before releasing.

Check the current package version:

```bash
node -p "require('./package.json').version"
npm view opengrove version dist-tags --json
npm run check:release-notes
```

`npm run check:release-notes` prints the commit list since the latest Git tag and
verifies that `CHANGELOG.md` has a non-empty `Unreleased` section. Use that as
the running buffer for release-worthy changes; commits do not need one entry
each, but user-visible changes should be represented before release prep starts.

## Write Release Notes

Create a release note file before tagging:

```bash
mkdir -p docs/releases
$EDITOR docs/releases/vX.Y.Z.md
```

Draft this file from `CHANGELOG.md#Unreleased`, then compare it with the commit
list printed by `npm run check:release-notes`.

Use this shape:

```md
# OpenGrove vX.Y.Z

## Highlights

- ...

## Configuration Notes

- ...

## Verification

- `npm run check`
- `npm run test:harness`
- `npm run build:web`
- `npm pack --dry-run`
```

## Bump Version

Update `package.json` and `package-lock.json` without creating a tag yet:

```bash
npm version X.Y.Z --no-git-tag-version
```

Review the diff:

```bash
git diff -- package.json package-lock.json CHANGELOG.md docs/releases/vX.Y.Z.md
```

## Verify

Run the full release checks:

```bash
npm run release:check
```

`npm run release:check` requires `docs/releases/vX.Y.Z.md` to exist for the
current package version and have at least one meaningful bullet. For docs-only
patch releases, `npm run check:release-notes`, `npm run check`, and
`npm pack --dry-run` are the minimum. For code changes, run the full release
check.

## Commit, Tag, Push

```bash
git add package.json package-lock.json CHANGELOG.md docs/releases/vX.Y.Z.md
git commit -m "chore: release vX.Y.Z"
git tag -a vX.Y.Z -F docs/releases/vX.Y.Z.md
git push origin main vX.Y.Z
```

Confirm:

```bash
git ls-remote --tags origin "vX.Y.Z"
git rev-list --left-right --count HEAD...origin/main
```

## Create GitHub Release

Preferred, with GitHub CLI:

```bash
gh release create vX.Y.Z \
  --title "OpenGrove vX.Y.Z" \
  --notes-file docs/releases/vX.Y.Z.md
```

If using the GitHub website:

1. Open the repository Releases page.
2. Draft a new release from tag `vX.Y.Z`.
3. Title it `OpenGrove vX.Y.Z`.
4. Paste `docs/releases/vX.Y.Z.md`.
5. Publish the release.

Verify:

```bash
open "https://github.com/Olorinm/opengrove/releases/tag/vX.Y.Z"
```

## Publish npm

Make sure npm is logged in as the package owner:

```bash
npm whoami
npm profile get
```

Publishing requires npm 2FA/passkey or a granular access token with publish/write permission and bypass 2FA enabled.

Interactive publish:

```bash
npm publish --access public
```

When npm prints an authentication URL, open it and complete passkey/security-key verification in the browser. The terminal publish process will continue after approval.

Verify:

```bash
npm view opengrove version dist-tags --json
```

Expected:

```json
{
  "version": "X.Y.Z",
  "dist-tags": {
    "latest": "X.Y.Z"
  }
}
```

## Final Sanity Check

```bash
git status --short
git log --oneline --decorate -3
npm view opengrove version
```

Release is done when:

- GitHub `main` is at the release commit.
- Git tag `vX.Y.Z` exists on origin.
- GitHub Release exists for `vX.Y.Z`.
- npm `latest` points to `X.Y.Z`.
- Local working tree is clean.

## If Something Fails

- If npm publish fails before `+ opengrove@X.Y.Z`, the version was not published. Fix auth or package issues and run `npm publish --access public` again.
- If npm publish succeeds, never reuse the same version number. Bump to the next patch for fixes.
- If a token is pasted into chat, terminal, or logs, revoke it immediately after use.
- If the GitHub Release is missing but the tag exists, create the release from the existing tag. Do not retag unless the tag points at the wrong commit and no package has been published.
