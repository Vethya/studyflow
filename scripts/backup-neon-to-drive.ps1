#requires -Version 5.1

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scriptDir = $PSScriptRoot
$repoRoot = Split-Path -Parent $scriptDir
$configFile = if ($env:STUDYFLOW_BACKUP_CONFIG) {
    $env:STUDYFLOW_BACKUP_CONFIG
} else {
    Join-Path $scriptDir "backup-config.ps1"
}

if (Test-Path -LiteralPath $configFile) {
    . $configFile
}

function Fail([string]$Message) {
    throw "backup failed: $Message"
}

if ($args.Count -gt 0 -and ($args[0] -eq "-h" -or $args[0] -eq "--help")) {
    @"
Usage: .\scripts\backup-neon-to-drive.ps1

Required configuration:
  STUDYFLOW_BACKUP_NEON_URL
  STUDYFLOW_BACKUP_AGE_RECIPIENTS_FILE

Optional configuration:
  STUDYFLOW_BACKUP_RCLONE_REMOTE  (default: studyflow-drive)
  STUDYFLOW_BACKUP_RCLONE_PATH    (default: Projects/StudyFlow/Production Backups)
  STUDYFLOW_BACKUP_OFFLINE_DIR    mounted folder for a second local copy
  STUDYFLOW_BACKUP_ID              override the generated backup identifier
"@
    exit 0
}

$requiredCommands = @("pg_dump.exe", "psql.exe", "age.exe", "rclone.exe", "git.exe")
$commandPaths = @{}
foreach ($commandName in $requiredCommands) {
    $command = Get-Command $commandName -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        Fail "required command not found: $commandName"
    }
    $commandPaths[$commandName] = $command.Source
}

$databaseUrl = if ($env:STUDYFLOW_BACKUP_NEON_URL) { $env:STUDYFLOW_BACKUP_NEON_URL } else { "" }
$recipientsFile = if ($env:STUDYFLOW_BACKUP_AGE_RECIPIENTS_FILE) { $env:STUDYFLOW_BACKUP_AGE_RECIPIENTS_FILE } else { "" }
$rcloneRemote = if ($env:STUDYFLOW_BACKUP_RCLONE_REMOTE) { $env:STUDYFLOW_BACKUP_RCLONE_REMOTE } else { "studyflow-drive" }
$rcloneBasePath = if ($env:STUDYFLOW_BACKUP_RCLONE_PATH) { $env:STUDYFLOW_BACKUP_RCLONE_PATH } else { "Projects/StudyFlow/Production Backups" }
$offlineDir = if ($env:STUDYFLOW_BACKUP_OFFLINE_DIR) { $env:STUDYFLOW_BACKUP_OFFLINE_DIR } else { "" }
$backupNow = (Get-Date).ToUniversalTime()
$backupTimestamp = $backupNow.ToString('yyyyMMddTHHmmssZ')
$backupDatePath = $backupNow.ToString('yyyy/MM/dd')
$createdAtUtc = $backupNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
$backupId = if ($env:STUDYFLOW_BACKUP_ID) {
    $env:STUDYFLOW_BACKUP_ID
} else {
    "B11_StudyFlow_Neon_$backupTimestamp"
}

if ([string]::IsNullOrWhiteSpace($databaseUrl)) { Fail "STUDYFLOW_BACKUP_NEON_URL is not set" }
if ([string]::IsNullOrWhiteSpace($recipientsFile)) { Fail "STUDYFLOW_BACKUP_AGE_RECIPIENTS_FILE is not set" }
if (-not (Test-Path -LiteralPath $recipientsFile -PathType Leaf)) { Fail "recipients file is not readable: $recipientsFile" }
if ($databaseUrl -like "*-pooler*") { Fail "use Neon direct connection, not a -pooler URL" }
if (-not ($databaseUrl.StartsWith("postgresql://") -or $databaseUrl.StartsWith("postgres://"))) {
    Fail "STUDYFLOW_BACKUP_NEON_URL must use postgresql:// or postgres://"
}
if (-not ($databaseUrl -like "*sslmode=require*" -or $databaseUrl -like "*sslmode=verify-ca*" -or $databaseUrl -like "*sslmode=verify-full*")) {
    Fail "Neon connection must require TLS"
}
if ($backupId -notmatch '^[A-Za-z0-9._-]+$') { Fail "backup identifier contains unsupported characters" }

$workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("studyflow-backup." + [Guid]::NewGuid().ToString("N"))
$encryptedDump = Join-Path $workDir "$backupId.dump.age"
$rawDump = Join-Path $workDir "$backupId.dump"
$metadataFile = Join-Path $workDir "$backupId.metadata.txt"
$uploadDir = Join-Path $workDir "upload"

New-Item -ItemType Directory -Path $uploadDir -Force | Out-Null

try {
    Write-Host "Creating encrypted PostgreSQL dump: $backupId"
    & $commandPaths["pg_dump.exe"] `
        --format=custom `
        --no-owner `
        --no-acl `
        --verbose `
        --file=$rawDump `
        $databaseUrl
    if ($LASTEXITCODE -ne 0) { Fail "pg_dump exited with code $LASTEXITCODE" }

    & $commandPaths["age.exe"] `
        --encrypt `
        --recipients-file $recipientsFile `
        --output $encryptedDump `
        $rawDump
    if ($LASTEXITCODE -ne 0) { Fail "age exited with code $LASTEXITCODE" }
    Remove-Item -LiteralPath $rawDump -Force

    $archiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $encryptedDump).Hash.ToLowerInvariant()
    $archiveBytes = (Get-Item -LiteralPath $encryptedDump).Length
    $migrationVersion = "unavailable"
    try {
        $migrationOutput = & $commandPaths["psql.exe"] $databaseUrl `
            --no-psqlrc --tuples-only --no-align `
            --command="SELECT version_num FROM alembic_version LIMIT 1;" 2>$null
        $migrationValue = ($migrationOutput | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1).Trim()
        if (-not [string]::IsNullOrWhiteSpace($migrationValue)) { $migrationVersion = $migrationValue }
    } catch {
        $migrationVersion = "unavailable"
    }

    $gitBranchValue = & $commandPaths["git.exe"] -C $repoRoot branch --show-current 2>$null | Select-Object -First 1
    $gitBranch = if ($null -eq $gitBranchValue) { "" } else { $gitBranchValue.ToString().Trim() }
    $gitCommit = (& $commandPaths["git.exe"] -C $repoRoot rev-parse HEAD 2>$null | Select-Object -First 1).Trim()
    $gitStatus = (& $commandPaths["git.exe"] -C $repoRoot status --short --untracked-files=all 2>$null)
    if ([string]::IsNullOrWhiteSpace($gitBranch)) { $gitBranch = "detached-or-unavailable" }
    if ([string]::IsNullOrWhiteSpace($gitCommit)) { $gitCommit = "unavailable" }
    $gitWorktreeClean = [string]::IsNullOrWhiteSpace(($gitStatus -join "`n"))

    @(
        "backup_id=$backupId"
        "created_at_utc=$createdAtUtc"
        "git_branch=$gitBranch"
        "git_commit=$gitCommit"
        "git_worktree_clean=$($gitWorktreeClean.ToString().ToLowerInvariant())"
        "migration_version=$migrationVersion"
        "archive_filename=$(Split-Path -Leaf $encryptedDump)"
        "archive_bytes=$archiveBytes"
        "archive_sha256=$archiveHash"
    ) | Set-Content -LiteralPath $metadataFile -Encoding ascii

    Copy-Item -LiteralPath $encryptedDump -Destination $uploadDir
    Copy-Item -LiteralPath $metadataFile -Destination $uploadDir
    "$archiveHash  $(Split-Path -Leaf $encryptedDump)" | Set-Content `
        -LiteralPath (Join-Path $uploadDir "$backupId.sha256") -Encoding ascii

    $remotePath = "${rcloneRemote}:$($rcloneBasePath.TrimEnd('/'))/$backupDatePath/$backupId"
    Write-Host "Uploading to $remotePath"
    & $commandPaths["rclone.exe"] copy $uploadDir $remotePath --immutable
    if ($LASTEXITCODE -ne 0) { Fail "rclone copy exited with code $LASTEXITCODE" }
    & $commandPaths["rclone.exe"] check $uploadDir $remotePath
    if ($LASTEXITCODE -ne 0) { Fail "rclone check exited with code $LASTEXITCODE" }

    if (-not [string]::IsNullOrWhiteSpace($offlineDir)) {
        $offlineDatePath = $backupDatePath -replace '/', '\'
        $offlinePath = Join-Path (Join-Path $offlineDir $offlineDatePath) $backupId
        if (Test-Path -LiteralPath $offlinePath) { Fail "offline backup already exists: $offlinePath" }
        New-Item -ItemType Directory -Path $offlinePath -Force | Out-Null
        Copy-Item -Path (Join-Path $uploadDir "*") -Destination $offlinePath
        $offlineHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $offlinePath "$backupId.dump.age")).Hash.ToLowerInvariant()
        if ($offlineHash -ne $archiveHash) { Fail "offline copy hash does not match" }
        Write-Host "Verified offline copy at $offlinePath"
    }

    Write-Host "Backup complete: $backupId"
} finally {
    if (Test-Path -LiteralPath $workDir) {
        Remove-Item -LiteralPath $workDir -Recurse -Force
    }
}
