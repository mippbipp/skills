---
name: checking-repos
description: Use when the user names a GitHub or upstream repo, says "check their issues/PRs/branches", or asks whether a repo implemented something.
compatibility: Requires the gh CLI. git is the fallback for non-GitHub hosts.
---

# Checking repos

A repo mention is the trigger. Start checking with `gh` right away, without asking whether to look or which tool to use.

1. **Resolve OWNER/REPO from context before asking.** Check the working repo's `git remote -v`, then its lockfiles, then earlier mentions in the conversation. Ask only when all three come up empty.
2. **Search issues and PRs separately before answering a yes/no question** such as "was recursive search implemented?". For a feature question, also check merged PRs (`gh search prs --merged`) and the file tree, and read past the first page of results.
3. **Cite the evidence.** Every claim about the repo names the issue or PR number, branch, or file path it came from.

## Gotchas

- `gh search issues` returns issues only. Adding `--include-prs` fails with HTTP 422 ("Query must include 'is:issue' or 'is:pull-request'") as of gh 2.103, so run `gh search prs` as its own search.

## Fallback order

Use `gh` for anything on GitHub. Use `git ls-remote` or `git clone --depth 1` for repos on other git hosts. Use web fetch only when neither `gh` nor `git` is installed.
