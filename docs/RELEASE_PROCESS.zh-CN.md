# 发布流程

这是 OpenGrove 的发布 checklist。只有当源码、Git tag、GitHub Release 和 npm package 都指向同一个版本时，一次发布才算完成。

## 什么算一次发布

- `main` 包含该版本对应的准确源码。
- `vX.Y.Z` 是这个源码快照的不可变 Git tag。
- GitHub Release 用人能读懂的方式说明变化。
- npm `opengrove@X.Y.Z` 是用户通过 `npm install -g opengrove` 得到的可安装包。

## 版本选择

OpenGrove 仍处于 `1.0.0` 之前，因此使用：

- Patch，用于小修复：`0.2.1`、`0.2.2`
- Minor，用于功能或架构变化：`0.3.0`、`0.4.0`
- 只有当 CLI、state shape 和核心 contracts 足够稳定，能承诺兼容性时，才发布 `1.0.0`

## 发布前检查

从干净的 `main` 开始：

```bash
git checkout main
git fetch origin main --tags
git status --short
git rev-list --left-right --count HEAD...origin/main
```

预期：

- `git status --short` 为空。
- `HEAD...origin/main` 是 `0 0`，或者你明确知道需要先 fast-forward/push。

检查当前 package version：

```bash
node -p "require('./package.json').version"
npm view opengrove version dist-tags --json
npm run check:release-notes
```

`npm run check:release-notes` 会打印从最新 Git tag 以来的 commit 列表，并检查 `CHANGELOG.md` 里有非空的 `Unreleased` section。把它当作待发布变化的缓冲区；不要求每个 commit 都有一条 entry，但用户可见变化应在 release prep 前体现出来。

## 写 Release Notes

打 tag 前先创建 release note 文件：

```bash
mkdir -p docs/releases
$EDITOR docs/releases/vX.Y.Z.md
```

从 `CHANGELOG.md#Unreleased` 起草这个文件，然后和 `npm run check:release-notes` 打印的 commit 列表对照。

建议格式：

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

## 更新版本号

更新 `package.json` 和 `package-lock.json`，但先不要创建 tag：

```bash
npm version X.Y.Z --no-git-tag-version
```

检查 diff：

```bash
git diff -- package.json package-lock.json CHANGELOG.md docs/releases/vX.Y.Z.md
```

## 验证

运行完整发布检查：

```bash
npm run release:check
```

`npm run release:check` 要求当前 package version 对应的 `docs/releases/vX.Y.Z.md` 存在，并且至少有一条有意义的 bullet。对于 docs-only patch release，最低要求是 `npm run check:release-notes`、`npm run check` 和 `npm pack --dry-run`。如果有代码变化，运行完整 release check。

## Commit、Tag、Push

```bash
git add package.json package-lock.json CHANGELOG.md docs/releases/vX.Y.Z.md
git commit -m "chore: release vX.Y.Z"
git tag -a vX.Y.Z -F docs/releases/vX.Y.Z.md
git push origin main vX.Y.Z
```

确认：

```bash
git ls-remote --tags origin "vX.Y.Z"
git rev-list --left-right --count HEAD...origin/main
```

## 创建 GitHub Release

推荐使用 GitHub CLI：

```bash
gh release create vX.Y.Z \
  --title "OpenGrove vX.Y.Z" \
  --notes-file docs/releases/vX.Y.Z.md
```

如果使用 GitHub 网站：

1. 打开 repository Releases 页面。
2. 从 tag `vX.Y.Z` 创建 draft release。
3. 标题写 `OpenGrove vX.Y.Z`。
4. 粘贴 `docs/releases/vX.Y.Z.md`。
5. 发布 release。

验证：

```bash
open "https://github.com/Olorinm/opengrove/releases/tag/vX.Y.Z"
```

## 发布 npm

确保 npm 已以 package owner 登录：

```bash
npm whoami
npm profile get
```

发布需要 npm 2FA/passkey，或拥有 publish/write 权限并允许 bypass 2FA 的 granular access token。

交互式发布：

```bash
npm publish --access public
```

当 npm 打印认证 URL 时，在浏览器打开并完成 passkey/security-key 验证。终端里的 publish 进程会在批准后继续。

验证：

```bash
npm view opengrove version dist-tags --json
```

预期：

```json
{
  "version": "X.Y.Z",
  "dist-tags": {
    "latest": "X.Y.Z"
  }
}
```

## 最终检查

```bash
git status --short
git log --oneline --decorate -3
npm view opengrove version
```

满足以下条件时，发布完成：

- GitHub `main` 位于 release commit。
- Git tag `vX.Y.Z` 已存在于 origin。
- GitHub Release 已存在于 `vX.Y.Z`。
- npm `latest` 指向 `X.Y.Z`。
- 本地 working tree 干净。

## 如果失败

- 如果 npm publish 在打印 `+ opengrove@X.Y.Z` 前失败，说明版本还没发布。修复认证或 package 问题后再次运行 `npm publish --access public`。
- 如果 npm publish 已成功，不要复用同一个版本号。修复后 bump 到下一个 patch。
- 如果 token 被粘贴进 chat、terminal 或 logs，发布后立即撤销。
- 如果 GitHub Release 缺失但 tag 已存在，就从现有 tag 创建 release。除非 tag 指向错误 commit 且 package 尚未发布，否则不要 retag。
