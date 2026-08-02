# Token-free stacked PR maintenance

Use [`scripts/stack-after-merge`](../scripts/stack-after-merge) after the lowest
open PR in a Graphite stack is squash-merged on GitHub. It updates the trunk,
removes the merged local branch from Graphite, restacks every descendant, and
pushes the rewritten branches with lease protection.

```bash
scripts/stack-after-merge feature/password-security
```

The command prints the affected stack and asks before installing Graphite,
detaching clean linked worktrees, or pushing. It stops instead of overwriting:

- changes in the current or linked worktrees;
- remote branch updates that are not present locally;
- a non-linear or invalid Graphite stack;
- a non-fast-forward trunk update.

The final push uses `--atomic --force-with-lease`, so either every remaining
branch is updated or none is.

## First-time setup

```bash
scripts/stack-after-merge --setup
```

If `gt` is missing, the script offers Graphite's official Homebrew installation
(`brew install withgraphite/tap/graphite`) or npm installation
(`npm install -g @withgraphite/graphite-cli@stable`). It then initializes the
repository using the detected trunk. To import existing branches, check out the
tip of the stack and rerun `--setup`; Graphite tracks the ancestral stack using
`gt track --force`.

No Graphite authentication token is required because PR branches are pushed
with Git rather than `gt submit`.

## Options

```text
--dry-run  Print mutations without running them
--no-push  Restack locally without pushing
--setup    Install, initialize, or validate Graphite only
--yes      Accept prompts for non-interactive use
```

Preview a merge cleanup safely:

```bash
scripts/stack-after-merge feature/password-security --dry-run
```
