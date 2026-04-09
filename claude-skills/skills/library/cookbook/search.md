# Search the Library

## Context
Find entries in the catalog by keyword when the user doesn't remember the exact name.

## Input
The user provides a keyword or description.

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

### 3. Search
- Match the keyword (case-insensitive) against:
  - Entry `name`
  - Entry `description`
- A match is any entry where the keyword appears as a substring in either field
- Collect all matches across all types

### 4. Display Results

If matches found, format as:

```
## Search Results for "<keyword>"

| Type | Name | Description | Source |
|------|------|-------------|--------|
| skill | matching-skill | description... | source... |
| agent | matching-agent | description... | source... |
```

If no matches:
```
No results found for "<keyword>".

Tip: Try broader keywords or run `/library list` to see the full catalog.
```

### 5. Suggest Next Step
If matches were found, suggest: `Run /library use <name> to install one of these.`
