# StudyFlow production release runbook

Use this runbook every time `master` gains database migrations, and for the first merge of `dev`
into `master`. That merge adds the `20260901_15` to `20261018_25` revisions: nine schema changes
and two merge revisions, all of them additive.

## How releases are wired

- `render.yaml` sets `autoDeployTrigger: "off"` for `studyflow-api`. Before the first release,
  turn off the service's Auto-Deploy by hand as described in step 2. Merging to
  `master` builds nothing and deploys nothing until someone starts a deploy by hand, **as long as
  the Blueprint's Auto Sync is also off**. With Auto Sync on, a push that changes `render.yaml`
  makes Render sync the Blueprint and redeploy every service whose entry changed, whatever its
  `autoDeployTrigger`. If such a deploy reaches an unmigrated database, the boot gate refuses to
  start it and Render keeps serving the previous deploy, but the release no longer happens on
  your schedule. Set Auto Sync to **No** (Blueprint → Settings) and use **Manual Sync** during
  step 8 instead.
- `STUDYFLOW_MIGRATE_ON_START` is set to `"false"` for production in `render.yaml`. A dashboard
  override takes effect when deployed, and `boot` honors it. A Blueprint sync resets it to the
  file's value.
- With that setting false, the container does not migrate production. Its `CMD` runs
  `python -m studyflow.cli.release boot`
  before Uvicorn. That gate validates settings and exits non-zero if the database is behind the
  build's migrations. A failed start fails the deploy, and Render keeps serving the previous deploy.
- Production migrations are an explicit step: `python -m studyflow.cli.release migrate`. A
  PostgreSQL advisory lock in `backend/migrations/env.py` serializes concurrent runs.
- `studyflow-api-dev` sets `STUDYFLOW_MIGRATE_ON_START=true`, so every push to `dev` still
  rehearses its migrations on the dev database.
- Render's pre-deploy command is not used because it only exists on paid instance types
  (ADR 0005 keeps the deployment at zero cost).

All `release` commands run from `backend/` with `uv run`, read `STUDYFLOW_*` variables from the
environment, and never print configured values.

| Command | What it does | Touches the database |
| --- | --- | --- |
| `check-settings [--require-production]` | Runs every settings validator, plus release-only checks (SMTP credentials, sender address, proxy hops) | No |
| `check-schema` | Compares `alembic_version` with this build's heads | Reads only |
| `migrate` | Validates settings, then runs `alembic upgrade head` under the advisory lock | Writes |
| `boot` | Container gate: settings, optional migration, schema check | Reads (writes only when `STUDYFLOW_MIGRATE_ON_START=true`) |

## Before the release

1. **CI on the exact commit.** Open the `dev` → `master` pull request and wait for Backend CI
   and Frontend CI to pass on its head commit. Backend CI applies every migration to an empty
   PostgreSQL, runs `alembic check`, and runs the release schema gate.
2. **Turn off production auto-deploy before merging to master.** Open
   `studyflow-api` → Settings → Auto-Deploy in the Render Dashboard and set it to **Off**.
   Also open the Blueprint → Settings and set **Auto Sync** to **No**. Confirm both settings
   before step 6. On the first release, `master` has no `autoDeployTrigger` field, and with
   Auto Sync off the new file does not apply until the Manual Sync in step 8. Both dashboard
   settings must be off to prevent production from deploying before step 7 has migrated it.
3. **Back up production.** Follow [`backup-restore.md`](backup-restore.md) and run
   `./scripts/backup-neon-to-drive.sh` (or the PowerShell script) against the production
   **direct** Neon URL. Write down the backup identifier and the migration version recorded in
   its metadata. The first `dev` merge should show `20260903_15`.
4. **Rehearse on a Neon branch of production.** In the Neon console, create a branch of the
   production project's main branch from current data (for example `release-YYYYMMDD`). Copy its
   **direct** connection string and convert it as in [`deployment.md`](deployment.md), with the
   `postgresql+psycopg` scheme and `?sslmode=require`. Then run from a checkout of the pull
   request's head commit:

   ```bash
   cd backend
   export STUDYFLOW_ENVIRONMENT=test
   export STUDYFLOW_DATABASE_URL='postgresql+psycopg://USER:PASSWORD@ep-BRANCH.REGION.aws.neon.tech/neondb?sslmode=require'
   uv run python -m studyflow.cli.release check-schema   # expect: behind (20260903_15)
   uv run python -m studyflow.cli.release migrate
   uv run python -m studyflow.cli.release check-schema   # expect: current (20261018_25)
   uv run alembic check                                  # expect: no new upgrade operations
   ```

   Optionally start the API locally against the branch (`uv run uvicorn studyflow.app:app`) and
   spot-check login, tasks and schedules with existing production data. If the rehearsal fails,
   stop: fix the migration on `dev` and repeat. Delete the branch when you finish.
5. **Check the production settings.** Copy the production service's environment variables from
   the Render Dashboard into a temporary file outside the repository (`chmod 600`), then run:

   ```bash
   cd backend
   set -a; . /secure/path/studyflow-api.env; set +a
   uv run python -m studyflow.cli.release check-settings --require-production
   ```

   Fix every `error:` line in the Render Dashboard before continuing, and review the `warning:`
   lines. Delete the temporary file afterwards. The new validators require, among others:
   `sslmode=require` (or `verify-ca`/`verify-full`) on the database URL, an HTTPS public app URL,
   `STUDYFLOW_SMTP_START_TLS=true`, HTTPS Google redirect URIs, all three Google OIDC values
   together, and those OIDC values whenever `STUDYFLOW_GOOGLE_IMPORT_REDIRECT_URI` is set.

## Release

6. **Merge** the pull request. Nothing deploys yet.
7. **Migrate production.** Prepare for the interval before step 8:

   For the first release, the current production build has no boot gate and does not support
   `STUDYFLOW_ACCEPTED_NEWER_SCHEMA_REVISIONS`. An already-running instance keeps working
   because these migrations are additive. A cold start, including waking from sleep on the
   free plan, fails on the unknown revision because that build runs `alembic upgrade head`
   directly at start. The allowlist cannot help it. There is an outage risk between migrating
   and deploying the new build. Keep this window short and proceed to step 8 immediately after
   migration. Once the database has moved, do not use an ordinary Render rollback to this
   pre-gate build.

   For later releases where both builds have the gate, first set
   `STUDYFLOW_ACCEPTED_NEWER_SCHEMA_REVISIONS` on `studyflow-api` to the new head revision,
   such as `20261018_25`, after confirming the migrations are additive. Choose **Save and
   deploy** and wait for the existing build to deploy successfully before migrating. Record
   this deploy as the rollback target. Render's [environment variable documentation](https://render.com/docs/configure-environment-variables)
   says **Save only** leaves the value unused until the next deploy. **Save and deploy**
   redeploys the existing build with the new value. Do not choose **Save, rebuild, and deploy**
   here, since the latest code requires the migration first. The prepared build can then
   cold-start on the new revision with a warning. Remove the variable after step 9 with
   **Save and deploy**.

   Run with the production **direct** Neon URL:

   ```bash
   cd backend
   export STUDYFLOW_ENVIRONMENT=test
   export STUDYFLOW_DATABASE_URL='postgresql+psycopg://USER:PASSWORD@ep-PRODUCTION.REGION.aws.neon.tech/neondb?sslmode=require'
   uv run python -m studyflow.cli.release migrate
   uv run python -m studyflow.cli.release check-schema
   ```

8. **Deploy.** If `render.yaml` changed, run the Blueprint's **Manual Sync** first. Then, in the
   Render Dashboard, open `studyflow-api` → Manual Deploy → **Deploy latest commit**. The deploy log should show
   `Database schema is current (20261018_25).` before Uvicorn starts.
9. **Verify** with the post-deployment checklist in [`deployment.md`](deployment.md), against
   `https://studyflow-api.onrender.com` directly. The shared frontend still uses the dev API
   (see below).

## Rolling back

- **Code:** after the first release's migration, do not use an ordinary Render rollback to the
  pre-gate build. It runs Alembic directly at start and fails on the unknown revision, even with
  an allowlist value. Fix forward with a build that has the gate. For later releases where both
  builds have the gate, roll back to the deploy prepared in step 7 with the release's head in
  `STUDYFLOW_ACCEPTED_NEWER_SCHEMA_REVISIONS`. Render [restores the target deploy's environment variables](https://render.com/docs/rollbacks#service-specific-config),
  so changing the current dashboard value alone does not prepare an older rollback target.
  The gate rejects unknown revisions unless they are listed; list only revisions you know are
  additive.
- **Schema:** do not run `alembic downgrade` on production. Several downgrades drop columns and
  tables, which destroys data written since the release.
- **Data:** if data was damaged, restore the backup from step 3 into a new Neon branch or project
  with `./scripts/restore-backup.sh --allow-remote --yes`, verify it, and only then repoint
  `STUDYFLOW_DATABASE_URL`. Never restore into the active production database.

## Decision point: switching the frontend to the production API

The shared frontend (`https://studyflow.vercel.app`) currently proxies `/api/v1/*` to
`studyflow-api-dev`. Existing users' accounts, sessions and tasks therefore live in the **dev**
database, and the production database may hold little or no live data. Switching Vercel's
`BACKEND_ORIGIN` to `https://studyflow-api.onrender.com` is a separate, deliberate step. Do not
combine it with a release. Decide first:

1. **Which data survives.** Either start production fresh (users re-register), or move the dev
   database into production. Moving it means taking a backup of the dev database with the same
   scripts, restoring it into a new Neon branch or project at the same migration version, and
   pointing production at it. Do not merge two live databases.
2. **Configuration.** Production needs the same `STUDYFLOW_PUBLIC_APP_URL`, SMTP sender and
   Google OIDC client as the frontend uses. The Google console must list the production callback
   path through the frontend origin.
3. **What dev becomes.** After the switch, give dev its own frontend origin (for example a Vercel
   preview) and its own `STUDYFLOW_PUBLIC_APP_URL`, so dev emails and sessions stop reaching real
   users (issue M2).

Run `check-settings --require-production` and the post-deployment checklist again right after
any switch.
