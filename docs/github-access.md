# GitHub 访问说明（内部环境）

本机访问 GitHub 需要走本地代理，直连会被重置。

## 现状

```
git config --global http.proxy  →  http://127.0.0.1:7897
```

`git` 已配置代理，所以 `clone` / `push` / `pull` 直接可用。

但 **`gh` CLI 与 `curl` 不读 git 的代理配置**，直连会失败：

```bash
# ❌ 直连失败：Recv failure: Connection was reset
gh auth status

# ✅ 需要显式指定代理
export HTTPS_PROXY=http://127.0.0.1:7897
export HTTP_PROXY=http://127.0.0.1:7897
gh auth status
```

## 常用命令

```bash
# 查看仓库
export HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897
gh repo view Ha1fice/weShare

# 查看 CI 状态
gh run list --repo Ha1fice/weShare

# 查看某次运行的注解（job 日志页匿名不可读，注解可读）
gh api repos/Ha1fice/weShare/check-runs --jq '.check_runs[] | {name, conclusion}'
```

## 凭据

Windows 凭据管理器（`credential.helper=manager`）中存有 GitHub 账号 `Ha1fice` 的 PAT，
该 PAT 具备 `workflow` scope —— 这是推送 `.github/workflows/` 下文件的必要条件。

> 若 `gh` 的 OAuth token 报 `refusing to allow an OAuth App to create or update workflow`
> 而 `git push` 却正常，说明两者用的是不同凭据：`gh` 用 keyring 里的 OAuth token，
> `git` 用凭据管理器里的 PAT。**推 CI 文件请用 `git push`，或给 `gh` 补 `workflow` scope。**

## 代理失效时

若代理端口变化（如 Clash 重启后端口改变），同步更新：

```bash
git config --global http.proxy http://127.0.0.1:<新端口>
```
