#!/usr/bin/env python3
"""Behavior tests for scripts/stack-after-merge."""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "stack-after-merge"


def create_stack_repository(root: Path) -> dict[str, str]:
    subprocess.run(["git", "init", "-b", "main", root], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", root, "config", "user.email", "test@example.com"], check=True
    )
    subprocess.run(["git", "-C", root, "config", "user.name", "Test"], check=True)
    (root / "README.md").write_text("trunk\n")
    subprocess.run(["git", "-C", root, "add", "README.md"], check=True)
    subprocess.run(
        ["git", "-C", root, "commit", "-m", "trunk"], check=True, capture_output=True
    )
    for branch, contents in (
        ("feature/merged", "merged"),
        ("feature/child", "child"),
        ("feature/top", "top"),
    ):
        subprocess.run(
            ["git", "-C", root, "switch", "-c", branch], check=True, capture_output=True
        )
        (root / "README.md").write_text(f"{contents}\n")
        subprocess.run(["git", "-C", root, "add", "README.md"], check=True)
        subprocess.run(
            ["git", "-C", root, "commit", "-m", contents],
            check=True,
            capture_output=True,
        )
    subprocess.run(
        ["git", "-C", root, "switch", "main"], check=True, capture_output=True
    )
    (root / ".git" / ".graphite_repo_config").write_text('{"trunk":"main"}\n')
    (root / ".git" / "info" / "exclude").write_text("bin/\n")
    fake_bin = root / "bin"
    fake_bin.mkdir()
    gt = fake_bin / "gt"
    gt.write_text(
        "#!/bin/sh\n"
        'if [ "$1" = log ]; then\n'
        "  printf '◉  main\\n◯  feature/merged\\n"
        "◯  feature/child\\n◯  feature/top\\n'\n"
        "elif [ \"$1\" = --version ]; then printf '1.8.6\\n'\n"
        "fi\n"
    )
    gt.chmod(0o755)
    env = os.environ.copy()
    env["PATH"] = f"{fake_bin}:{env['PATH']}"
    return env


class StackAfterMergeTests(unittest.TestCase):
    def test_help_works_outside_a_git_repository(self) -> None:
        result = subprocess.run(
            [SCRIPT, "--help"],
            cwd="/tmp",
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("stack-after-merge <merged-branch>", result.stdout)
        self.assertIn("--dry-run", result.stdout)
        self.assertIn("--setup", result.stdout)

    def test_setup_dry_run_offers_official_homebrew_install(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fake_bin = root / "bin"
            fake_bin.mkdir()
            brew = fake_bin / "brew"
            brew.write_text("#!/bin/sh\nexit 0\n")
            brew.chmod(0o755)
            env = os.environ.copy()
            env["PATH"] = f"{fake_bin}:/usr/bin:/bin"

            result = subprocess.run(
                [SCRIPT, "--setup", "--dry-run", "--yes"],
                cwd=root,
                env=env,
                check=False,
                capture_output=True,
                text=True,
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("brew install withgraphite/tap/graphite", result.stdout)
        self.assertIn(
            "Run this command again after Graphite is installed", result.stdout
        )

    def test_setup_dry_run_initializes_graphite_with_detected_trunk(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(
                ["git", "init", "-b", "main", root],
                check=True,
                capture_output=True,
                text=True,
            )
            fake_bin = root / "bin"
            fake_bin.mkdir()
            gt = fake_bin / "gt"
            gt.write_text("#!/bin/sh\nprintf '1.8.6\\n'\n")
            gt.chmod(0o755)
            env = os.environ.copy()
            env["PATH"] = f"{fake_bin}:{env['PATH']}"

            result = subprocess.run(
                [SCRIPT, "--setup", "--dry-run", "--yes"],
                cwd=root,
                env=env,
                check=False,
                capture_output=True,
                text=True,
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("gt init --trunk main", result.stdout)

    def test_setup_offers_to_track_existing_stack_from_current_tip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(
                ["git", "init", "-b", "main", root], check=True, capture_output=True
            )
            subprocess.run(
                ["git", "-C", root, "config", "user.email", "test@example.com"],
                check=True,
            )
            subprocess.run(
                ["git", "-C", root, "config", "user.name", "Test"], check=True
            )
            (root / "README.md").write_text("test\n")
            subprocess.run(["git", "-C", root, "add", "README.md"], check=True)
            subprocess.run(
                ["git", "-C", root, "commit", "-m", "initial"],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                ["git", "-C", root, "switch", "-c", "feature/one"],
                check=True,
                capture_output=True,
            )
            (root / ".git" / ".graphite_repo_config").write_text('{"trunk":"main"}\n')
            fake_bin = root / "bin"
            fake_bin.mkdir()
            gt = fake_bin / "gt"
            gt.write_text(
                "#!/bin/sh\n"
                "if [ \"$1\" = log ]; then printf '◉  main\\n'; "
                "else printf '1.8.6\\n'; fi\n"
            )
            gt.chmod(0o755)
            env = os.environ.copy()
            env["PATH"] = f"{fake_bin}:{env['PATH']}"

            result = subprocess.run(
                [SCRIPT, "--setup", "--dry-run", "--yes"],
                cwd=root,
                env=env,
                check=False,
                capture_output=True,
                text=True,
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("gt track feature/one --force", result.stdout)

    def test_dry_run_plans_restack_and_atomic_lease_push_for_descendants(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = create_stack_repository(root)

            result = subprocess.run(
                [SCRIPT, "feature/merged", "--dry-run", "--yes"],
                cwd=root,
                env=env,
                check=False,
                capture_output=True,
                text=True,
            )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("git fetch origin", result.stdout)
        self.assertIn("git switch main", result.stdout)
        self.assertIn("git pull --ff-only origin main", result.stdout)
        self.assertIn("gt delete feature/merged --force", result.stdout)
        self.assertIn("gt restack --branch feature/child --upstack", result.stdout)
        self.assertIn(
            "git push --atomic --force-with-lease origin feature/child feature/top",
            result.stdout,
        )
        self.assertNotIn("push --atomic --force-with-lease origin main", result.stdout)
        self.assertNotIn(
            "push --atomic --force-with-lease origin feature/merged", result.stdout
        )

    def test_refuses_to_detach_a_worktree_with_changes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"
            root.mkdir()
            env = create_stack_repository(root)
            child_worktree = Path(directory) / "child-worktree"
            subprocess.run(
                ["git", "-C", root, "worktree", "add", child_worktree, "feature/child"],
                check=True,
                capture_output=True,
            )
            (child_worktree / "README.md").write_text("uncommitted\n")

            result = subprocess.run(
                [SCRIPT, "feature/merged", "--dry-run", "--yes"],
                cwd=root,
                env=env,
                check=False,
                capture_output=True,
                text=True,
            )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("has changes; refusing to detach feature/child", result.stderr)
        self.assertNotIn("gt delete", result.stdout)

    def test_dry_run_plans_detaching_clean_linked_worktree(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"
            root.mkdir()
            env = create_stack_repository(root)
            child_worktree = Path(directory) / "child-worktree"
            subprocess.run(
                ["git", "-C", root, "worktree", "add", child_worktree, "feature/child"],
                check=True,
                capture_output=True,
            )

            result = subprocess.run(
                [SCRIPT, "feature/merged", "--dry-run", "--yes", "--no-push"],
                cwd=root,
                env=env,
                check=False,
                capture_output=True,
                text=True,
            )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(
            f"git -C {child_worktree.resolve()} switch --detach", result.stdout
        )
        self.assertIn("Push skipped (--no-push)", result.stdout)

    def test_aborts_when_a_remote_descendant_changed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / "repo"
            root.mkdir()
            env = create_stack_repository(root)
            remote = base / "remote.git"
            subprocess.run(
                ["git", "init", "--bare", remote], check=True, capture_output=True
            )
            subprocess.run(
                ["git", "-C", root, "remote", "add", "origin", remote], check=True
            )
            subprocess.run(
                ["git", "-C", root, "push", "origin", "--all"],
                check=True,
                capture_output=True,
            )

            collaborator = base / "collaborator"
            subprocess.run(
                ["git", "clone", remote, collaborator], check=True, capture_output=True
            )
            subprocess.run(
                ["git", "-C", collaborator, "switch", "feature/child"],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                [
                    "git",
                    "-C",
                    collaborator,
                    "config",
                    "user.email",
                    "other@example.com",
                ],
                check=True,
            )
            subprocess.run(
                ["git", "-C", collaborator, "config", "user.name", "Other"], check=True
            )
            (collaborator / "REMOTE.md").write_text("remote change\n")
            subprocess.run(["git", "-C", collaborator, "add", "REMOTE.md"], check=True)
            subprocess.run(
                ["git", "-C", collaborator, "commit", "-m", "remote change"],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                ["git", "-C", collaborator, "push", "origin", "feature/child"],
                check=True,
                capture_output=True,
            )

            result = subprocess.run(
                [SCRIPT, "feature/merged", "--yes", "--no-push"],
                cwd=root,
                env=env,
                check=False,
                capture_output=True,
                text=True,
            )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "origin/feature/child differs in content from local feature/child",
            result.stderr,
        )
        self.assertNotIn("gt delete", result.stdout)

    def test_submodule_change_is_not_hidden_by_git_diff_config(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / "repo"
            root.mkdir()
            env = create_stack_repository(root)
            child_sha = subprocess.run(
                ["git", "-C", root, "rev-parse", "feature/child"],
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
            merged_sha = subprocess.run(
                ["git", "-C", root, "rev-parse", "feature/merged"],
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
            subprocess.run(
                ["git", "-C", root, "switch", "feature/top"],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                [
                    "git",
                    "-C",
                    root,
                    "update-index",
                    "--add",
                    "--cacheinfo",
                    "160000",
                    child_sha,
                    "vendor/dependency",
                ],
                check=True,
            )
            subprocess.run(
                ["git", "-C", root, "commit", "--amend", "--no-edit"],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                ["git", "-C", root, "switch", "main"],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                ["git", "-C", root, "config", "diff.ignoreSubmodules", "all"],
                check=True,
            )

            remote = base / "remote.git"
            subprocess.run(
                ["git", "init", "--bare", remote], check=True, capture_output=True
            )
            subprocess.run(
                ["git", "-C", root, "remote", "add", "origin", remote], check=True
            )
            subprocess.run(
                ["git", "-C", root, "push", "origin", "--all"],
                check=True,
                capture_output=True,
            )

            collaborator = base / "collaborator"
            subprocess.run(
                ["git", "clone", remote, collaborator], check=True, capture_output=True
            )
            subprocess.run(
                ["git", "-C", collaborator, "switch", "feature/top"],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                [
                    "git",
                    "-C",
                    collaborator,
                    "config",
                    "user.email",
                    "other@example.com",
                ],
                check=True,
            )
            subprocess.run(
                ["git", "-C", collaborator, "config", "user.name", "Other"],
                check=True,
            )
            subprocess.run(
                [
                    "git",
                    "-C",
                    collaborator,
                    "update-index",
                    "--cacheinfo",
                    "160000",
                    merged_sha,
                    "vendor/dependency",
                ],
                check=True,
            )
            subprocess.run(
                ["git", "-C", collaborator, "commit", "--amend", "--no-edit"],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                [
                    "git",
                    "-C",
                    collaborator,
                    "push",
                    "--force",
                    "origin",
                    "feature/top",
                ],
                check=True,
                capture_output=True,
            )

            result = subprocess.run(
                [SCRIPT, "feature/merged", "--yes", "--no-push"],
                cwd=root,
                env=env,
                check=False,
                capture_output=True,
                text=True,
            )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "origin/feature/top differs in content from local feature/top",
            result.stderr,
        )
        self.assertNotIn("gt delete", result.stdout)

    def test_accepts_a_remote_history_rewrite_with_identical_content(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / "repo"
            root.mkdir()
            env = create_stack_repository(root)
            remote = base / "remote.git"
            subprocess.run(
                ["git", "init", "--bare", remote], check=True, capture_output=True
            )
            subprocess.run(
                ["git", "-C", root, "remote", "add", "origin", remote], check=True
            )
            subprocess.run(
                ["git", "-C", root, "push", "origin", "--all"],
                check=True,
                capture_output=True,
            )

            collaborator = base / "collaborator"
            subprocess.run(
                ["git", "clone", remote, collaborator], check=True, capture_output=True
            )
            subprocess.run(
                ["git", "-C", collaborator, "switch", "feature/child"],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                [
                    "git",
                    "-C",
                    collaborator,
                    "config",
                    "user.email",
                    "other@example.com",
                ],
                check=True,
            )
            subprocess.run(
                ["git", "-C", collaborator, "config", "user.name", "Other"],
                check=True,
            )
            subprocess.run(
                [
                    "git",
                    "-C",
                    collaborator,
                    "commit",
                    "--amend",
                    "--no-edit",
                    "--date=2000-01-01T00:00:00Z",
                ],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                [
                    "git",
                    "-C",
                    collaborator,
                    "push",
                    "--force",
                    "origin",
                    "feature/child",
                ],
                check=True,
                capture_output=True,
            )

            result = subprocess.run(
                [SCRIPT, "feature/merged", "--yes", "--no-push"],
                cwd=root,
                env=env,
                check=False,
                capture_output=True,
                text=True,
            )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(
            "feature/child: accepting remote history rewrite with identical content",
            result.stdout,
        )
        self.assertIn("gt delete feature/merged --force", result.stdout)


if __name__ == "__main__":
    unittest.main()
