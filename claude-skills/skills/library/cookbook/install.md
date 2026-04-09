# Install The Library

## Context
First-time setup of The Library on a new device. The user either has the template repo cloned directly, or has already forked it to their own private repo.

## Steps

### 1. Check Prerequisites
- Verify `git` is installed: `git --version`
- Verify the global skills directory exists or can be created: `~/.claude/skills/`

### 2. Determine Fork Status
Ask the user: **"Is this the template repo or your own fork?"**

**If template repo (hasn't forked yet):**
- Instruct the user to create a private fork on GitHub
- Once forked, update the remote URL:
  ```bash
  cd <LIBRARY_SKILL_DIR>
  git remote set-url origin <fork_url>
  ```
- Verify with: `git remote -v`

**If already forked:**
- Skip this step — the remote is already pointing to their fork

### 3. Clone to Global Skills Directory
If the repo isn't already cloned locally:
```bash
mkdir -p <LIBRARY_SKILL_DIR>
cd <LIBRARY_SKILL_DIR>
git clone <fork_url> .
```

If already cloned (e.g., user cloned the template first), just update the remote per step 2.

### 4. Update Variables
- Open `SKILL.md` in the library directory
- Take note of your current working directory.
- Update the `## Variables` section:
  - **LIBRARY_REPO_URL**: Set to the user's fork URL
  - **LIBRARY_YAML_PATH**: Confirm path (default: `~/.claude/skills/library/library.yaml`)
  - **LIBRARY_SKILL_DIR**: Confirm path (default: `~/.claude/skills/library/`)

### 5. Verify Installation
- Confirm SKILL.md exists at `<LIBRARY_SKILL_DIR>/SKILL.md`
- Confirm library.yaml exists at `<LIBRARY_SKILL_DIR>/library.yaml`
- Confirm the `/library` command is now available

### 6. Done
Tell the user:
- The Library is now globally available
- `/library list` will show the catalog (empty by default)
- `/library add` to start adding skills, agents, and prompts
- The `justfile` in the library directory has shorthand commands
