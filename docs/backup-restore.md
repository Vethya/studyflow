# StudyFlow backup and restore

This procedure backs up the Neon PostgreSQL database from either macOS or Windows. It encrypts
the archive with `age`, uploads it to a shared Google Drive folder with `rclone`, verifies the
uploaded files, and can also copy the encrypted archive to an offline device.

The backend does not expose a backup endpoint. Vercel and Render are redeployable from GitHub;
Neon is the persistent application data store shown in the deployment architecture.

## What belongs in each copy

- GitHub stores source code, migrations, Docker files, deployment configuration, and these scripts.
- Google Drive stores encrypted Neon database archives and restore evidence.
- An offline device stores a second copy of each encrypted archive and the final thesis package.

Never commit a database dump, a database URL containing a password, an `rclone` configuration,
or an age private identity to GitHub.

## Prerequisites

### macOS

Install the PostgreSQL client, `age`, and `rclone`:

```bash
brew install libpq age rclone
export PATH="$(brew --prefix libpq)/bin:$PATH"
```

### Windows

Install native versions of these commands and add them to `PATH`:

```text
pg_dump.exe
psql.exe
age.exe
rclone.exe
git.exe
```

WSL is not required. The PowerShell script uses the same archive and encryption format as the
macOS script.

## One-time setup

### 1. Create one shared age key pair

Create one key pair for the project:

```bash
age-keygen -o studyflow-backup-private-key.txt
```

The command prints one public recipient beginning with `age1`. Put that single recipient into a
file such as `studyflow-recipients.txt`:

```text
age1...
```

The backup script reads this public file. Copy the public recipient file to both computers. Share
the private identity file with your teammate only through a secure channel, such as a password
manager, and keep a protected offline copy.

This is one shared recovery key: anyone who has the private identity file can decrypt every
backup. Keep it outside the repository and outside the Google Drive backup folder. `age` also
supports passphrase-protected identity files if the private key will be stored on a device that
needs another protection layer.

See the [age documentation](https://github.com/FiloSottile/age) for passphrase-protected identity
files.

### 2. Prepare the Neon connection

Use a direct Neon connection string for backup. The hostname must not contain `-pooler`, and the
URL must require TLS:

```text
postgresql://USER:PASSWORD@ep-example.REGION.aws.neon.tech/neondb?sslmode=require
```

The application continues to use its pooled `postgresql+psycopg` URL in Render. `pg_dump` uses a
separate direct URL because pooled connections do not support all dump operations. See the
[Neon connection pooling documentation](https://neon.com/docs/connect/connection-pooling).

If possible, create a dedicated read-only backup role instead of sharing the application role.
Store the password in a protected local configuration file or PostgreSQL password file. Do not
put it in the repository.

### 3. Configure Google Drive

Create a shared Drive folder named `Projects/StudyFlow/Production Backups` and give both teammates
permission to add files. Each person runs:

```bash
rclone config
```

Create a Google Drive remote named `studyflow-drive`. Each person should use their own Google
OAuth authorization. Do not copy one person's `rclone.conf` to the other computer. The
[rclone Google Drive documentation](https://rclone.org/drive/) describes the OAuth setup.

### 4. Create local configuration

On macOS:

```bash
cp scripts/backup.env.example scripts/backup.env
chmod 600 scripts/backup.env
```

Edit `scripts/backup.env` and set the Neon URL, recipients file, and optional USB path. Then run:

```bash
./scripts/backup-neon-to-drive.sh
```

On Windows:

```powershell
Copy-Item scripts\backup-config.ps1.example scripts\backup-config.ps1
```

Edit `scripts\backup-config.ps1`, then run:

```powershell
.\scripts\backup-neon-to-drive.ps1
```

The real configuration files are ignored by Git.

## What the script does

Each run:

1. Validates that the required tools and direct TLS database URL exist.
2. Streams or writes a custom-format `pg_dump` archive to a temporary location.
3. Encrypts the archive with the shared public age recipient.
4. Records the Git commit, migration version, archive size, and SHA-256 hash.
5. Uploads the encrypted archive, metadata, and hash file to a unique Drive folder.
6. Runs `rclone check` against the Drive copy.
7. Optionally copies the encrypted files to an offline device and verifies the hash.
8. Removes temporary files, including any unencrypted Windows archive.

With the example Drive path, each run is organized by its UTC date and unique backup identifier:

```text
Production Backups/2026/09/07/B11_StudyFlow_Neon_20260907T120000Z/
```

The folder contains the encrypted dump, metadata, and SHA-256 checksum. The optional offline
copy uses the same date structure.

Use `rclone copy`, not `rclone sync`. The scripts never delete older Drive backups.

## Restore test

Perform this test against a separate Neon Free project with the same PostgreSQL major version.
Never test restoration against the active production database.

Download a backup folder from Drive, then decrypt the archive:

```bash
age --decrypt \
  --identity /secure/path/studyflow-backup-private-key.txt \
  --output B11_StudyFlow_Neon_YYYYMMDDTHHMMSSZ.dump \
  B11_StudyFlow_Neon_YYYYMMDDTHHMMSSZ.dump.age
```

Restore it into the empty restore database:

```bash
pg_restore \
  --dbname="$RESTORE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --exit-on-error \
  B11_StudyFlow_Neon_YYYYMMDDTHHMMSSZ.dump
```

Verify the `alembic_version` value, expected tables, and important row counts. Point a local
backend at the restored database and check readiness, login, task creation, availability,
schedule generation, and session outcome recording.

Record the result using [`docs/evidence/backup-restore-template.md`](evidence/backup-restore-template.md).

## Frequency

The SPEC requires a manual backup before each review/demo and one documented restore test.
Weekly automation is optional. A calendar reminder is sufficient; macOS `launchd` or Windows
Task Scheduler can be added later without changing the backup scripts.
