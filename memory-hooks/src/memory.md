Search and manage Claude's persistent memory database.

Usage: /memory <query or flag>

Examples:
- `/memory JWT 인증` — Search memories for "JWT 인증"
- `/memory --recent` — Show last 20 memories
- `/memory --stats` — Show database statistics
- `/memory --summaries` — Show recent session summaries

Execute the search by running:
```
node ~/.claude/hooks/memory/search.mjs $ARGUMENTS
```

Then present the results to the user in a readable format. If the search returns no results, suggest alternative queries or check with `--stats` to see what's available.
