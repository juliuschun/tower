#!/usr/bin/env python3
"""Scan Claude Code sessions across all projects.

Outputs a markdown report grouped by project, showing:
- Session count per project
- Last 4 sessions per project (chronological)
- Last 5 user messages per session
- Open processes (running Claude instances)

Usage: python3 scan_sessions.py [--max-projects 15] [--sessions-per-project 4] [--messages-per-session 5]
"""

import json
import os
import glob
import subprocess
import sys
from datetime import datetime
from collections import defaultdict
from pathlib import Path


def parse_args():
    args = {
        "max_projects": 15,
        "sessions_per_project": 4,
        "messages_per_session": 5,
    }
    i = 1
    while i < len(sys.argv):
        if sys.argv[i] == "--max-projects" and i + 1 < len(sys.argv):
            args["max_projects"] = int(sys.argv[i + 1]); i += 2
        elif sys.argv[i] == "--sessions-per-project" and i + 1 < len(sys.argv):
            args["sessions_per_project"] = int(sys.argv[i + 1]); i += 2
        elif sys.argv[i] == "--messages-per-session" and i + 1 < len(sys.argv):
            args["messages_per_session"] = int(sys.argv[i + 1]); i += 2
        else:
            i += 1
    return args


def friendly_project_name(dirname):
    """Convert directory encoding to readable project name."""
    name = dirname.replace("-Users-julius-Documents-", "")
    # Tag client projects
    if name.startswith("01-Clients-"):
        name = "CLIENT:" + name.replace("01-Clients-", "")
    elif name.startswith("02-Dev-"):
        name = name.replace("02-Dev-", "")
    elif name.startswith("03-Business"):
        name = "BIZ:" + name.replace("03-Business-", "")
    # Clean up remaining hyphens that were path separators
    # But keep natural hyphens in project names
    return name


def get_running_sessions():
    """Find running Claude CLI processes and their working directories."""
    running = defaultdict(list)
    try:
        result = subprocess.run(
            ["ps", "-eo", "pid,comm,lstart,tty"],
            capture_output=True, text=True, timeout=5
        )
        for line in result.stdout.strip().split("\n")[1:]:
            if "claude" not in line.lower():
                continue
            parts = line.split()
            if len(parts) < 4:
                continue
            pid = parts[0]
            tty = parts[-1]
            if tty == "??":
                continue
            # Get cwd
            try:
                lsof = subprocess.run(
                    ["lsof", "-p", pid],
                    capture_output=True, text=True, timeout=5
                )
                for lline in lsof.stdout.split("\n"):
                    if "cwd" in lline:
                        cwd = lline.split()[-1]
                        running[cwd].append(pid)
                        break
            except:
                pass
    except:
        pass
    return running


def extract_user_messages(filepath, max_messages=5):
    """Extract last N user messages from a JSONL session file."""
    messages = []
    try:
        with open(filepath) as f:
            for line in f:
                try:
                    d = json.loads(line.strip())
                    if d.get("type") != "user":
                        continue
                    ts = d.get("timestamp", "")
                    msg = d.get("message", {})
                    content = msg.get("content", "")

                    if isinstance(content, str) and len(content.strip()) > 10:
                        # Skip system content
                        if any(skip in content for skip in [
                            "<system-reminder>", "tool_result",
                            "<task-notification>", "<command-name>",
                            "<local-command"
                        ]):
                            continue
                        clean = content.replace("\\\n", " ").replace("\n", " ").strip()
                        messages.append((ts[:16], clean[:150]))
                except:
                    pass
    except:
        pass
    return messages[-max_messages:]


def scan_all_sessions(args):
    """Main scan: find all sessions, group by project."""
    projects_dir = os.path.expanduser("~/.claude/projects")
    if not os.path.isdir(projects_dir):
        return {}

    # Collect all session files grouped by project
    project_sessions = defaultdict(list)

    for jsonl in glob.glob(f"{projects_dir}/*/*.jsonl"):
        if "/subagents/" in jsonl:
            continue
        size = os.path.getsize(jsonl)
        if size < 500:
            continue
        mtime = os.stat(jsonl).st_mtime
        dirname = os.path.basename(os.path.dirname(jsonl))
        project = friendly_project_name(dirname)
        session_id = os.path.basename(jsonl).replace(".jsonl", "")[:8]
        project_sessions[project].append({
            "path": jsonl,
            "mtime": mtime,
            "size": size,
            "session_id": session_id,
        })

    # Sort sessions within each project by mtime
    for project in project_sessions:
        project_sessions[project].sort(key=lambda x: x["mtime"])

    return project_sessions


def format_report(project_sessions, running_sessions, args):
    """Format the markdown report."""
    lines = []
    now = datetime.now()
    lines.append(f"# Session Report — {now.strftime('%Y-%m-%d %H:%M')}")
    lines.append("")

    # Summary table
    total_sessions = sum(len(s) for s in project_sessions.values())
    total_running = sum(len(pids) for pids in running_sessions.values())
    lines.append(f"> {len(project_sessions)} projects | {total_sessions} sessions | {total_running} running processes")
    lines.append("")

    # Overview table
    lines.append("## Overview")
    lines.append("| Project | Sessions | Last Active | Running |")
    lines.append("|---------|----------|-------------|---------|")

    # Sort projects by most recent session
    sorted_projects = sorted(
        project_sessions.items(),
        key=lambda x: max(s["mtime"] for s in x[1]),
        reverse=True
    )[:args["max_projects"]]

    for project, sessions in sorted_projects:
        latest = max(s["mtime"] for s in sessions)
        latest_str = datetime.fromtimestamp(latest).strftime("%m-%d %H:%M")
        # Check if any running session matches this project
        running_count = 0
        for cwd, pids in running_sessions.items():
            if project.replace("CLIENT:", "").replace("BIZ:", "").replace("-", "") in cwd.replace("/", "").replace("-", "").lower():
                running_count += len(pids)
        running_str = f"{running_count}" if running_count > 0 else "—"
        lines.append(f"| **{project}** | {len(sessions)} | {latest_str} | {running_str} |")

    lines.append("")

    # Per-project detail
    lines.append("## Project Details")
    lines.append("")

    for project, sessions in sorted_projects:
        latest = max(s["mtime"] for s in sessions)
        age_days = (now.timestamp() - latest) / 86400

        if age_days < 1:
            status = "active"
        elif age_days < 3:
            status = "recent"
        elif age_days < 7:
            status = "cooling"
        else:
            status = "stale"

        lines.append(f"### {project} ({len(sessions)} sessions, {status})")
        lines.append("")

        # Take last N sessions chronologically
        recent_sessions = sessions[-args["sessions_per_project"]:]

        for sess in recent_sessions:
            sess_time = datetime.fromtimestamp(sess["mtime"]).strftime("%m-%d %H:%M")
            size_kb = sess["size"] // 1024
            lines.append(f"**Session {sess['session_id']}** — {sess_time} ({size_kb}KB)")

            msgs = extract_user_messages(sess["path"], args["messages_per_session"])
            if msgs:
                for ts, msg in msgs:
                    lines.append(f"- `{ts}` {msg}")
            else:
                lines.append("- (no user messages extracted)")
            lines.append("")

    # Running processes section
    if running_sessions:
        lines.append("## Running Processes")
        lines.append("")
        for cwd, pids in sorted(running_sessions.items()):
            dirname = cwd.replace(os.path.expanduser("~"), "~")
            lines.append(f"- **{dirname}** — {len(pids)} process(es)")
        stale = total_running - 2  # assume current session + 1 other active
        if stale > 0:
            lines.append("")
            lines.append(f"> {total_running} total processes. Consider closing stale sessions to free resources.")

    lines.append("")
    return "\n".join(lines)


def main():
    args = parse_args()
    project_sessions = scan_all_sessions(args)
    running_sessions = get_running_sessions()
    report = format_report(project_sessions, running_sessions, args)
    print(report)


if __name__ == "__main__":
    main()
