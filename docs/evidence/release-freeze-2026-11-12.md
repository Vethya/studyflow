# Release freeze: v0.1.0 (2026-11-12)

The demonstrated build, the repository version and the test evidence refer to one commit.

| Item | Value |
| --- | --- |
| Tag | `v0.1.0` (annotated) |
| Commit | `a6b1c207db8d7c1ea08fd4059a3469fcfbaee4d5` (tip of `master`, "Merge pull request #84 from Vethya/dev") |
| Declared version | `0.1.0` (`backend/pyproject.toml`, `frontend/package.json`) |
| Freeze rule | No feature changes after this tag |

## Deployed build matches the tag

| Component | Environment | Where the commit was read | Commit |
| --- | --- | --- | --- |
| Backend API | Production, Render service `studyflow-api` (`https://studyflow-api.vethya.com`) | Render dashboard, Deploys: manual deploy, status Live | `a6b1c20` |
| Frontend | Production, Vercel `https://studyflow-one-flax.vercel.app` | Vercel dashboard, Deployments: Production, Ready | `a6b1c20` |

Live responses on 2026-11-12:

```text
GET https://studyflow-api.vethya.com/api/v1/health
{"service":"studyflow-api","status":"ok","version":"0.1.0"}

GET https://studyflow-api.vethya.com/api/v1/ready
{"service":"studyflow-api","status":"ready","database":"reachable"}
```

The health endpoint reports the version only. The commit comes from the Render and Vercel deploy records.

## CI on the tagged commit

| Workflow | Result | Run |
| --- | --- | --- |
| Frontend CI | success | https://github.com/Vethya/studyflow/actions/runs/43193307342 |
| Storybook CI | success | https://github.com/Vethya/studyflow/actions/runs/43193307433 |

Backend CI did not run on `a6b1c20`. The workflow runs only when backend files change, and the only change since the previous production commit `0ef21ca` is a two-line edit to `frontend/stories/app/use-confirm-delete-task.stories.tsx`. The backend source at `a6b1c20` is identical to `0ef21ca`.

## Known limitations

- The scheduled `Frontend Nightly` workflow failed on `0ef21ca` (https://github.com/Vethya/studyflow/actions/runs/43133062416). It is not a required check for the release and was not re-run on `a6b1c20`.
- Earlier robustness and performance results in this folder were produced on earlier commits, as stated in each file.
