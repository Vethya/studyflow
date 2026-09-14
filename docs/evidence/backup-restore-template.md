# StudyFlow backup and restore evidence

Copy this file to a dated record after completing the restore test, or let the restore script
generate the record. Do not include passwords, database URLs containing passwords, OAuth tokens,
private age identities, or raw database dumps.

## Backup record

- Backup identifier:
- Date and time UTC:
- Operator:
- Source environment: production / staging / development
- Source Neon project and branch:
- Git branch:
- Git commit:
- Git worktree clean: yes / no
- Migration version:
- Encrypted archive filename:
- Encrypted archive size:
- Encrypted archive SHA-256:
- Google Drive path:
- Offline copy path:

## Restore record

- Restore test date and time UTC:
- Restore operator:
- Restore target:
- PostgreSQL major version:
- Encrypted archive checksum: pass / fail
- Archive decryption: pass / fail
- Restore database connection: pass / fail
- Restore command completed: pass / fail
- `alembic_version` verified: pass / fail
- Expected tables verified: pass / fail / not tested
- Important row counts verified: pass / fail / not tested
- Backend readiness verified: pass / fail / not tested
- Login verified: pass / fail / not tested
- Task creation verified: pass / fail / not tested
- Availability verified: pass / fail / not tested
- Schedule generation verified: pass / fail / not tested
- Session outcome recording verified: pass / fail / not tested

## Result

- Overall database restore result: pass / fail
- Problems found:
- Corrective action:
- Evidence links or screenshots:
