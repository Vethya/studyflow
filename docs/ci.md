# Continuous integration and merge gates

StudyFlow has three GitHub Actions workflows. Their action references are pinned to commit SHAs,
and the Postgres service image is pinned to a digest.

| Workflow | Jobs (check names) | Runs on |
| --- | --- | --- |
| `backend-ci.yml` | `Backend quality gates` | Pull requests, and pushes to `master` and `dev`, that touch backend, Compose, Render, Postman or CI files; manual runs |
| `frontend-ci.yml` | `Frontend quality gates` | Every push and pull request that touches `frontend/**` or the workflow; manual runs |
| | `Build and task-to-schedule smoke test` | Pull requests, pushes to `master` and `dev`, and manual runs (after the quality gates pass) |
| `frontend-nightly.yml` | NFR-05 browser matrix, dependency audit | Nightly at 02:00 Asia/Phnom_Penh; manual runs before each review |

`dev` is the integration branch. Its tip changes on every merge and every restack
(`scripts/stack-after-merge`), so a green result on each individual pull request does not prove
the combined history works. This is especially true when merge migrations are involved.
Pushes to `dev` therefore run the same gates as pushes to `master`.

## Verify an exact commit

Path filters skip a workflow when a push does not touch its files. For example, a restack can
rewrite commit hashes without changing any content. Before you merge `dev` into `master`, or
whenever a tip has no run, start one by hand:

1. GitHub → **Actions** → **Backend CI** → **Run workflow** → branch `dev`.
2. Do the same for **Frontend CI**.

Or use the GitHub CLI:

```bash
gh workflow run backend-ci.yml --ref dev
gh workflow run frontend-ci.yml --ref dev
gh run list --branch dev --limit 4
```

A manual run tests the branch tip at the moment it starts. Check that the run's commit SHA
matches the commit you are about to merge.

GitHub only offers **Run workflow** (and `gh workflow run`) for a workflow whose copy on the
default branch, `master`, has a `workflow_dispatch` trigger; `--ref dev` only chooses which
version runs once dispatch is enabled. The `master` versions of both workflows gain that trigger
only when this change reaches `master`. Until then, use these instead:

- Pushes to `dev` that touch the workflow paths start the gates automatically. Check that the
  latest run on `dev` is for the exact commit you plan to merge.
- The `dev` → `master` pull request runs both workflows on its own head, because it changes
  backend and frontend files.

Manual runs are for verifying a commit. They do not satisfy required checks on a pull request;
see [Branch protection](#branch-protection-repository-settings).

## Before merging `dev` into `master`

- Open the `dev` → `master` pull request and wait for every check above to pass on its head
  commit. Merge only that commit.
- Review files that exist on only one side. For example, `frontend/components/quick-add-task.tsx`
  and `README.md` exist on `master` but not on `dev`. Confirm that each deletion is intended
  before the merge removes it from `master`.
- If `master` gains migrations, follow the production release runbook.

## Branch protection (repository settings)

These are GitHub settings, not files. A repository admin applies them under **Settings →
Branches** (or **Rules → Rulesets**) for both `master` and `dev`:

- Require a pull request before merging. On `dev`, the stack maintainer also needs to push
  restacked history, because `scripts/stack-after-merge` runs `git push --force-with-lease`.
  Bypassing the pull-request requirement is not enough: protected branches reject force pushes
  unless they are allowed separately. Pick one:
  - Branch protection rule on `dev`: turn on **Allow force pushes** → **Specify who can force
    push** and add only the maintainer, and add the maintainer to **Allow specified actors to
    bypass required pull requests**. If `dev` also requires status checks or up-to-date
    branches, the maintainer needs to be able to bypass those too, for example by leaving
    **Do not allow bypassing the above settings** off.
  - Ruleset on `dev`: add the maintainer (or an admin role) to the bypass list with **Always
    allow**, so the ruleset's "Block force pushes" and other rules do not apply to restacks.
  - Or protect only `master`.
- Require status checks to pass: `Backend quality gates`, `Frontend quality gates` and
  `Build and task-to-schedule smoke test`.
- Require branches to be up to date before merging.
- Block force pushes and deletions on `master`.

Path filters interact with required checks. A pull request that touches no backend files never
starts `Backend quality gates`, so a required check would stay pending and block the merge. A
manual run does not help: GitHub ignores checks from `workflow_dispatch` runs when it evaluates
a pull request's required checks. The `dev` → `master` pull request touches both halves, so
requiring all three checks works on `master` as long as changes reach it that way. On `dev`,
where pull requests usually touch only one half, either require no path-filtered checks or have
an admin merge pull requests whose checks were skipped by path filters. Requiring the checks on
every pull request would need each workflow to trigger on all pull requests and skip its
expensive steps inside the job when nothing relevant changed.
