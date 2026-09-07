#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(CDPATH= cd -- "$script_dir/.." && pwd)"
config_file="${STUDYFLOW_BACKUP_CONFIG:-$script_dir/backup.env}"

if [[ -f "$config_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$config_file"
  set +a
fi

usage() {
  cat <<'EOF'
Usage: ./scripts/backup-neon-to-drive.sh

Required configuration:
  STUDYFLOW_BACKUP_NEON_URL
  STUDYFLOW_BACKUP_AGE_RECIPIENTS_FILE

Optional configuration:
  STUDYFLOW_BACKUP_RCLONE_REMOTE  (default: studyflow-drive)
  STUDYFLOW_BACKUP_RCLONE_PATH    (default: Projects/StudyFlow/Production Backups)
  STUDYFLOW_BACKUP_OFFLINE_DIR    mounted folder for a second local copy
  STUDYFLOW_BACKUP_ID              override the generated backup identifier
EOF
}

die() {
  printf 'backup failed: %s\n' "$1" >&2
  exit 1
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

for command_name in pg_dump psql age rclone git shasum; do
  command -v "$command_name" >/dev/null 2>&1 || die "required command not found: $command_name"
done

database_url="${STUDYFLOW_BACKUP_NEON_URL:-}"
recipients_file="${STUDYFLOW_BACKUP_AGE_RECIPIENTS_FILE:-}"
rclone_remote="${STUDYFLOW_BACKUP_RCLONE_REMOTE:-studyflow-drive}"
rclone_path="${STUDYFLOW_BACKUP_RCLONE_PATH:-Projects/StudyFlow/Production Backups}"
offline_dir="${STUDYFLOW_BACKUP_OFFLINE_DIR:-}"
backup_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_date_path="${backup_timestamp:0:4}/${backup_timestamp:4:2}/${backup_timestamp:6:2}"
created_at_utc="${backup_timestamp:0:4}-${backup_timestamp:4:2}-${backup_timestamp:6:2}T${backup_timestamp:9:2}:${backup_timestamp:11:2}:${backup_timestamp:13:2}Z"
backup_id="${STUDYFLOW_BACKUP_ID:-B11_StudyFlow_Neon_$backup_timestamp}"

[[ -n "$database_url" ]] || die "STUDYFLOW_BACKUP_NEON_URL is not set"
[[ -n "$recipients_file" ]] || die "STUDYFLOW_BACKUP_AGE_RECIPIENTS_FILE is not set"
[[ -r "$recipients_file" ]] || die "recipients file is not readable: $recipients_file"
[[ "$database_url" != *-pooler* ]] || die "use Neon direct connection, not a -pooler URL"
[[ "$database_url" == postgresql://* || "$database_url" == postgres://* ]] || \
  die "STUDYFLOW_BACKUP_NEON_URL must use postgresql:// or postgres://"
[[ "$database_url" == *"sslmode=require"* || "$database_url" == *"sslmode=verify-ca"* || \
  "$database_url" == *"sslmode=verify-full"* ]] || die "Neon connection must require TLS"
[[ "$backup_id" =~ ^[A-Za-z0-9._-]+$ ]] || die "backup identifier contains unsupported characters"

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/studyflow-backup.XXXXXX")"
cleanup() {
  rm -rf -- "$work_dir"
}
trap cleanup EXIT

encrypted_dump="$work_dir/$backup_id.dump.age"
metadata_file="$work_dir/$backup_id.metadata.txt"
upload_dir="$work_dir/upload"
mkdir -p "$upload_dir"

printf 'Creating encrypted PostgreSQL dump: %s\n' "$backup_id"
pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --verbose \
  "$database_url" \
  | age --encrypt --recipients-file "$recipients_file" --output "$encrypted_dump"

archive_bytes="$(wc -c < "$encrypted_dump" | tr -d '[:space:]')"
archive_sha256="$(shasum -a 256 "$encrypted_dump" | awk '{print $1}')"
migration_version="unavailable"
if migration_query_output="$(psql "$database_url" --no-psqlrc --tuples-only --no-align \
  --command="SELECT version_num FROM alembic_version LIMIT 1;" 2>/dev/null)"; then
  migration_query_output="$(printf '%s' "$migration_query_output" | tr -d '\r' | sed '/^[[:space:]]*$/d' | head -n 1)"
  [[ -n "$migration_query_output" ]] && migration_version="$migration_query_output"
fi

git_branch="$(git -C "$repo_root" branch --show-current 2>/dev/null || true)"
git_commit="$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || true)"
[[ -n "$git_branch" ]] || git_branch="detached-or-unavailable"
[[ -n "$git_commit" ]] || git_commit="unavailable"
git_worktree_clean=true
if [[ -n "$(git -C "$repo_root" status --short --untracked-files=all 2>/dev/null || true)" ]]; then
  git_worktree_clean=false
fi

printf '%s\n' \
  "backup_id=$backup_id" \
  "created_at_utc=$created_at_utc" \
  "git_branch=$git_branch" \
  "git_commit=$git_commit" \
  "git_worktree_clean=$git_worktree_clean" \
  "migration_version=$migration_version" \
  "archive_filename=$(basename "$encrypted_dump")" \
  "archive_bytes=$archive_bytes" \
  "archive_sha256=$archive_sha256" \
  > "$metadata_file"

cp -- "$encrypted_dump" "$upload_dir/"
cp -- "$metadata_file" "$upload_dir/"
printf '%s  %s\n' "$archive_sha256" "$(basename "$encrypted_dump")" > "$upload_dir/$backup_id.sha256"

remote_path="${rclone_remote}:${rclone_path%/}/$backup_date_path/$backup_id"
printf 'Uploading to %s\n' "$remote_path"
rclone copy "$upload_dir" "$remote_path" --immutable
rclone check "$upload_dir" "$remote_path"

if [[ -n "$offline_dir" ]]; then
  offline_path="$offline_dir/$backup_date_path/$backup_id"
  [[ ! -e "$offline_path" ]] || die "offline backup already exists: $offline_path"
  mkdir -p "$offline_path"
  cp -- "$upload_dir"/* "$offline_path/"
  (
    cd "$offline_path"
    shasum -a 256 -c "$backup_id.sha256"
  )
  printf 'Verified offline copy at %s\n' "$offline_path"
fi

printf 'Backup complete: %s\n' "$backup_id"
