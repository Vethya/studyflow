# Use zero-cost Render and Neon deployment

StudyFlow will deploy its Dockerized React/FastAPI service on Render Free and use Neon Free as managed PostgreSQL, with Resend Free for transactional email. This keeps operating cost at zero and avoids Render Free PostgreSQL's expiration, while accepting that Render may sleep after inactivity and incur a cold start. The three-second page requirement will therefore be measured on a warm production-like service, cold-start latency will be documented as a free-hosting limitation, the service will be awakened before demonstrations, and manual pre-review backups remain required.

## Amendment (2026-08-22): frontend served from Vercel through a same-origin proxy

The original wording described one Render service serving both React and FastAPI. The
adopted deployment splits them: FastAPI runs on Render Free and the React application runs
on Vercel Hobby, which proxies every `/api/*` request to the Render service via a rewrite.
The browser therefore still sees exactly one HTTPS origin, so SPEC §6.6 (one origin,
`__Host-` cookies, `SameSite=Strict`, CSRF double-submit) remains satisfied without any
authentication-code changes. This split keeps frontend and backend deployable independently,
matches the frontend team's Vercel-based workflow, and avoids tying either half to a
personal domain. Operational details live in `docs/deployment.md`.
