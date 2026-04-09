# List Available Skills

## Context
Show the full library catalog with install status.

## Steps

### 1. Sync the Library Repo
Pull the latest catalog before reading:
```bash
cd <LIBRARY_SKILL_DIR>
git pull
```

### 2. Read the Catalog
- Read `library.yaml`
- Parse all entries from `library.skills`, `library.agents`, and `library.prompts`

### 3. Check Install Status
For each entry:
- Determine the type and corresponding default/global directories from `default_dirs`
- Check if a directory matching the entry name exists in the **default** directory
- Check if a directory matching the entry name exists in the **global** directory
- Search recursively for name matches
- Mark as: `installed (default)`, `installed (global)`, or `not installed`

### 4. Display Results

Format the output as a table grouped by type:

```
## Skills
| Name | Description | Source | Status |
|------|-------------|--------|--------|
| skill-name | skill-description | /local/path/... | installed (default) |
| other-skill | other-description | github.com/... | not installed |

## Agents
| Name | Description | Source | Status |
|------|-------------|--------|--------|
| agent-name | agent-description | /local/path/... | installed (global) |

## Prompts
| Name | Description | Source | Status |
|------|-------------|--------|--------|
| prompt-name | prompt-description | github.com/... | not installed |
```

If a section is empty, show: `No <type> in catalog.`

### 5. Summary
At the bottom, show:
- Total entries in catalog
- Total installed locally
- Total not installed
