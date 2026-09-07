#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(CDPATH= cd -- "$script_dir/.." && pwd)"
config_file="${STUDYFLOW_RESTORE_CONFIG:-$script_dir/restore.env}"

if [[ -f "$config_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$config_file"
  set +a
fi

usage() {
  cat <<'EOF'
Usage: ./scripts/restore-backup.sh [options]

Required configuration or options:
  STUDYFLOW_RESTORE_BACKUP_DIR / --backup-dir
  STUDYFLOW_RESTORE_DATABASE_URL / --target-url
  STUDYFLOW_RESTORE_AGE_IDENTITY_FILE / --identity

Options:
  --backup-dir PATH       downloaded backup folder
  --target-url URL        PostgreSQL restore target; never written to evidence
  --identity PATH         age private identity file
  --target-label TEXT     safe label written to evidence
  --evidence-file PATH    output Markdown evidence file
  --allow-remote          permit a non-local PostgreSQL target
  --allow-destructive     pass --clean --if-exists to pg_restore
  --yes                   confirm the remote/destructive operation
  -h, --help              show this help

The script restores into the explicitly supplied target and never selects a production
database implicitly. It prefers local PostgreSQL tools and falls back to the repository's
Docker Compose postgres service when pg_restore or psql is unavailable.
EOF
}

die() {
  failure_message="$1"
  restore_result="fail"
  printf 'restore failed: %s\n' "$failure_message" >&2
  exit 1
}

backup_dir="${STUDYFLOW_RESTORE_BACKUP_DIR:-}"
target_url="${STUDYFLOW_RESTORE_DATABASE_URL:-}"
identity_file="${STUDYFLOW_RESTORE_AGE_IDENTITY_FILE:-}"
target_label="${STUDYFLOW_RESTORE_TARGET_LABEL:-target database (credentials omitted)}"
operator="${STUDYFLOW_RESTORE_OPERATOR:-${USER:-not recorded}}"
source_environment="${STUDYFLOW_RESTORE_SOURCE_ENVIRONMENT:-production}"
source_project="${STUDYFLOW_RESTORE_SOURCE_NEON_PROJECT:-not recorded}"
source_branch="${STUDYFLOW_RESTORE_SOURCE_NEON_BRANCH:-not recorded}"
drive_path="${STUDYFLOW_RESTORE_GOOGLE_DRIVE_PATH:-not recorded}"
offline_path="${STUDYFLOW_RESTORE_OFFLINE_COPY_PATH:-not recorded}"
evidence_file="${STUDYFLOW_RESTORE_EVIDENCE_FILE:-}"
allow_remote=false
allow_destructive=false
confirmed=false

while (($# > 0)); do
  case "$1" in
    --backup-dir)
      (($# >= 2)) || die "--backup-dir requires a path"
      backup_dir="$2"
      shift 2
      ;;
    --target-url)
      (($# >= 2)) || die "--target-url requires a PostgreSQL URL"
      target_url="$2"
      shift 2
      ;;
    --identity)
      (($# >= 2)) || die "--identity requires a path"
      identity_file="$2"
      shift 2
      ;;
    --target-label)
      (($# >= 2)) || die "--target-label requires a label"
      target_label="$2"
      shift 2
      ;;
    --evidence-file)
      (($# >= 2)) || die "--evidence-file requires a path"
      evidence_file="$2"
      shift 2
      ;;
    --allow-remote)
      allow_remote=true
      shift
      ;;
    --allow-destructive)
      allow_destructive=true
      shift
      ;;
    --yes)
      confirmed=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

restore_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -z "$evidence_file" ]]; then
  evidence_file="$repo_root/docs/evidence/backup-restore-$restore_timestamp.md"
fi

[[ -n "$backup_dir" ]] || die "backup directory is not set"
[[ -d "$backup_dir" ]] || die "backup directory does not exist: $backup_dir"
[[ -n "$target_url" ]] || die "restore target URL is not set"
[[ -n "$identity_file" ]] || die "age identity file is not set"
[[ -r "$identity_file" ]] || die "age identity file is not readable: $identity_file"
[[ ! -e "$evidence_file" ]] || die "evidence file already exists: $evidence_file"
[[ "$target_url" == postgresql://* || "$target_url" == postgres://* ]] || \
  die "restore target must use postgresql:// or postgres://"
[[ "$target_url" != *-pooler* ]] || die "restore target must use a direct URL, not a -pooler URL"

command -v age >/dev/null 2>&1 || die "required command not found: age"
command -v shasum >/dev/null 2>&1 || die "required command not found: shasum"

target_is_local=false
if [[ "$target_url" == *"@localhost:"* || "$target_url" == *"@127.0.0.1:"* || \
  "$target_url" == *"@::1:"* || "$target_url" == *"@postgres:"* ]]; then
  target_is_local=true
fi

if [[ "$target_is_local" != true && "$allow_remote" != true ]]; then
  die "target is remote; re-run with --allow-remote after confirming it is not production"
fi

if [[ "$target_is_local" != true || "$allow_destructive" == true ]]; then
  [[ "$confirmed" == true ]] || die "re-run with --yes to confirm the selected target and restore mode"
fi

compose_file="$repo_root/compose.yaml"
compose_args=(docker compose -f "$compose_file")

find_one() {
  local pattern="$1"
  local count
  count="$(find "$backup_dir" -maxdepth 1 -type f -name "$pattern" -print | wc -l | tr -d '[:space:]')"
  [[ "$count" == 1 ]] || die "expected exactly one $pattern in $backup_dir; found $count"
  find "$backup_dir" -maxdepth 1 -type f -name "$pattern" -print -quit
}

encrypted_dump="$(find_one '*.dump.age')"
metadata_file="$(find_one '*.metadata.txt')"
hash_file="$(find_one '*.sha256')"

metadata_value() {
  sed -n "s/^$1=//p" "$metadata_file" | head -n 1 | tr -d '\r'
}

backup_id="$(metadata_value backup_id)"
[[ -n "$backup_id" ]] || backup_id="$(basename "$encrypted_dump" .dump.age)"
[[ "$backup_id" =~ ^[A-Za-z0-9._-]+$ ]] || die "backup identifier contains unsupported characters"

metadata_created_at="$(metadata_value created_at_utc)"
metadata_git_branch="$(metadata_value git_branch)"
metadata_git_commit="$(metadata_value git_commit)"
metadata_git_clean="$(metadata_value git_worktree_clean)"
metadata_migration="$(metadata_value migration_version)"
metadata_archive_filename="$(metadata_value archive_filename)"
metadata_archive_sha256="$(metadata_value archive_sha256 | tr '[:upper:]' '[:lower:]')"
archive_filename="$(basename "$encrypted_dump")"
archive_bytes="$(wc -c < "$encrypted_dump" | tr -d '[:space:]')"
archive_sha256="$(awk 'NR == 1 { print $1; exit }' "$hash_file" | tr -d '\r' | tr '[:upper:]' '[:lower:]')"
hash_filename="$(awk 'NR == 1 { print $2; exit }' "$hash_file" | tr -d '\r')"

[[ -n "$metadata_archive_filename" ]] || die "backup metadata does not record the archive filename"
[[ -n "$metadata_archive_sha256" ]] || die "backup metadata does not record the archive checksum"
[[ "$metadata_archive_filename" == "$archive_filename" ]] || die "backup metadata does not match the selected archive"
[[ "$hash_filename" == "$archive_filename" ]] || die "checksum file does not match the selected archive"
[[ "$metadata_archive_sha256" == "$archive_sha256" ]] || die "backup metadata does not match the checksum file"

hash_result="not tested"
decrypt_result="not tested"
connection_result="not tested"
restore_result="not tested"
migration_result="not tested"
table_result="not tested"
row_result="not tested"
table_count="not recorded"
postgres_version="not recorded"
migration_version="not recorded"
row_counts="not recorded"
failure_message="none"
work_dir=""

write_evidence() {
  local result="$restore_result"
  [[ -n "$result" ]] || result="fail"
  mkdir -p "$(dirname "$evidence_file")" 2>/dev/null || true
  cat > "$evidence_file" <<EOF
# StudyFlow backup and restore evidence

Generated by scripts/restore-backup.sh.

## Backup record

- Backup identifier: ${backup_id:-not recorded}
- Date and time UTC: ${metadata_created_at:-not recorded}
- Operator: ${operator}
- Source environment: ${source_environment}
- Source Neon project and branch: ${source_project} / ${source_branch}
- Git branch: ${metadata_git_branch:-not recorded}
- Git commit: ${metadata_git_commit:-not recorded}
- Git worktree clean: ${metadata_git_clean:-not recorded}
- Migration version in backup metadata: ${metadata_migration:-not recorded}
- Encrypted archive filename: ${archive_filename:-not recorded}
- Encrypted archive size: ${archive_bytes:-not recorded} bytes
- Encrypted archive SHA-256: ${archive_sha256:-not recorded}
- Google Drive path: ${drive_path}
- Offline copy path: ${offline_path}

## Restore record

- Restore test date and time UTC: ${restore_timestamp}
- Restore operator: ${operator}
- Restore target: ${target_label}
- PostgreSQL major version: ${postgres_version}
- Encrypted archive checksum: ${hash_result}
- Archive decryption: ${decrypt_result}
- Restore database connection: ${connection_result}
- Restore command completed: ${restore_result}
- alembic_version verified: ${migration_result}
- Expected tables verified: ${table_result} (${table_count} public tables)
- Important row counts verified: ${row_result} (${row_counts})
- Backend readiness verified: not tested
- Login verified: not tested
- Task creation verified: not tested
- Availability verified: not tested
- Schedule generation verified: not tested
- Session outcome recording verified: not tested

## Result

- Overall database restore result: ${result}
- Problems found: ${failure_message}
- Corrective action: none
- Evidence links or screenshots: terminal output and generated report
EOF
}

cleanup() {
  if [[ -n "$work_dir" && -d "$work_dir" ]]; then
    rm -rf -- "$work_dir"
  fi
  write_evidence || true
}
trap cleanup EXIT

if (cd "$backup_dir" && tr -d '\r' < "$hash_file" | shasum -a 256 -c - >/dev/null); then
  hash_result="pass"
else
  hash_result="fail"
  die "encrypted archive checksum does not match"
fi

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/studyflow-restore.XXXXXX")"
decrypted_dump="$work_dir/$backup_id.dump"

if age --decrypt --identity "$identity_file" --output "$decrypted_dump" "$encrypted_dump"; then
  decrypt_result="pass"
else
  decrypt_result="fail"
  die "age could not decrypt the backup"
fi

run_psql() {
  if command -v psql >/dev/null 2>&1; then
    psql --no-psqlrc "$target_url" "$@"
  elif command -v docker >/dev/null 2>&1; then
    "${compose_args[@]}" exec -T postgres psql --no-psqlrc "$target_url" "$@"
  else
    die "psql is not installed and Docker is unavailable for the fallback"
  fi
}

if run_psql --tuples-only --no-align --command='SELECT current_database();' >/dev/null; then
  connection_result="pass"
else
  connection_result="fail"
  die "could not connect to restore target"
fi

postgres_version="$(run_psql --tuples-only --no-align --command='SHOW server_version;' | tr -d '\r' | sed '/^[[:space:]]*$/d' | head -n 1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"

restore_options=(--dbname="$target_url" --no-owner --no-acl --exit-on-error)
if [[ "$allow_destructive" == true ]]; then
  restore_options+=(--clean --if-exists)
fi

restore_with_host_tools() {
  pg_restore "${restore_options[@]}" "$decrypted_dump"
}

restore_with_compose_tools() {
  local container_id="temp"
  local container_dump="/tmp/studyflow-restore-$backup_id.dump"
  container_id="$("${compose_args[@]}" ps -q postgres 2>/dev/null || true)"
  [[ -n "$container_id" ]] || die "pg_restore is unavailable; start the Docker Compose postgres service first"
  docker cp "$decrypted_dump" "$container_id:$container_dump"
  set +e
  "${compose_args[@]}" exec -T postgres pg_restore "${restore_options[@]}" "$container_dump"
  local restore_exit=$?
  set -e
  "${compose_args[@]}" exec -T postgres rm -f "$container_dump" >/dev/null 2>&1 || true
  return "$restore_exit"
}

if command -v pg_restore >/dev/null 2>&1; then
  if restore_with_host_tools; then
    restore_result="pass"
  else
    restore_result="fail"
    die "pg_restore failed"
  fi
else
  if restore_with_compose_tools; then
    restore_result="pass"
  else
    restore_result="fail"
    die "Docker pg_restore failed"
  fi
fi

expected_tables=(
  academic_tasks
  alembic_version
  authentication_email_tokens
  authentication_identities
  authentication_oidc_link_challenges
  authentication_oidc_states
  authentication_rate_limits
  authentication_registrations
  authentication_sessions
  availability_windows
  proposal_task_allocations
  recovery_snapshot_outcomes
  recovery_task_work
  schedule_proposals
  schedule_recovery_snapshots
  student_accounts
  study_session_outcomes
  study_sessions
  task_deadline_history
  unavailable_periods
)

missing_tables=()
for table in "${expected_tables[@]}"; do
  exists="$(run_psql --tuples-only --no-align --command="SELECT to_regclass('public.$table') IS NOT NULL;" | tr -d '[:space:]')"
  [[ "$exists" == t ]] || missing_tables+=("$table")
done

table_count="$(run_psql --tuples-only --no-align --command="SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';" | tr -d '[:space:]')"
if ((${#missing_tables[@]} == 0)); then
  table_result="pass"
else
  table_result="fail"
  die "missing expected tables: ${missing_tables[*]}"
fi

migration_version="$(run_psql --tuples-only --no-align --command='SELECT version_num FROM alembic_version LIMIT 1;' | tr -d '\r' | sed '/^[[:space:]]*$/d' | head -n 1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
if [[ -n "$migration_version" ]]; then
  migration_result="pass"
else
  migration_result="fail"
  die "alembic_version did not contain a migration version"
fi

important_tables=(student_accounts academic_tasks availability_windows study_sessions)
row_count_values=()
for table in "${important_tables[@]}"; do
  count="$(run_psql --tuples-only --no-align --command="SELECT count(*) FROM public.$table;" | tr -d '[:space:]')"
  row_count_values+=("$table=$count")
done
row_counts="${row_count_values[*]}"
row_result="pass"
restore_result="pass"
