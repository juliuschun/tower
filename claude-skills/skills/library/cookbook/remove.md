# Remove an Entry from the Library

## Context
The user wants to remove a skill, agent, or prompt from the library catalog and optionally delete the local copy.

## Input
The user provides a skill name or description.

## Steps

### 1. Sync the Library Repo
Pull the latest catalog before modifying:
```bash
cd <LIBRARY_SKILL_DIR>
git pull
```

### 2. Find the Entry
- Read `library.yaml`
- Search across all sections for the matching entry
- Determine the type (skill, agent, or prompt)
- If no match, tell the user the item wasn't found in the catalog

### 3. Confirm with User
Show the entry details and ask:
- "Remove **<name>** from the library catalog?"
- If installed locally, also ask: "Also delete the local copy at `<path>`?"

### 4. Remove from library.yaml
- Remove the entry from the appropriate section (`library.skills`, `library.agents`, or `library.prompts`)
- If other entries depend on this one (via `requires`), warn the user before proceeding

### 5. Delete Local Copy (if requested)
If the user confirmed local deletion:
- Check the default directory for the type (from `default_dirs`)
- Check the global directory
- Remove the directory or file:
  ```bash
  rm -rf <target_directory>/<name>
  ```

### 6. Commit and Push
```bash
cd <LIBRARY_SKILL_DIR>
git add library.yaml
git commit -m "library: removed <type> <name>"
git push
```

### 7. Confirm
Tell the user:
- The entry has been removed from the catalog
- Whether the local copy was also deleted
- If other entries depended on it, remind them to update those entries
