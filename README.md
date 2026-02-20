# repo-feature-check

Extract every function, method, and class from a codebase using [universal-ctags](https://ctags.io/). Designed as a fast structural index that feeds into AI-assisted codebase analysis.

## Install

```bash
npm install -g @manzoid2/repo-feature-check
```

### Prerequisites

Requires universal-ctags:

```bash
brew install universal-ctags
```

## Usage

```bash
# Basic symbol extraction
repo-feature-check /path/to/repo

# Export as JSON for further analysis
repo-feature-check /path/to/repo --json /tmp/symbols.json

# Include git churn data for hotspot analysis
repo-feature-check /path/to/repo --json /tmp/symbols.json --since 2024-06-01

# With a feature config for path-based classification
repo-feature-check /path/to/repo --config features.json
```

### Options

| Flag | Description |
|------|-------------|
| `--json <path>` | Write full symbol data as JSON |
| `--since <date>` | Overlay git churn data (e.g. `2024-01-01`) |
| `--config <path>` | Optional feature config for path-based classification |
| `--help` | Show help with full usage instructions |

## What it extracts

- **Functions** — named functions, arrow functions exported as constants, React components (PascalCase), hooks (`use*`)
- **Methods** — class/object methods
- **Classes** — classes, objects, structs

Filters out noise: lambdas, anonymous functions, `__` prefixed internals, plain constants.

### Supported languages

TypeScript, JavaScript, Kotlin, Java, Python, Go, Rust

## Output

The text report goes to stdout. JSON (via `--json`) includes:

- Full symbol list with file, line number, scope, and kind
- Feature classification (if `--config` provided)
- Git churn per feature and top hotspot files (if `--since` provided)

## Usage with Claude Code

This tool is the mechanical half of a two-part workflow. It extracts a structured symbol index fast — Claude Code provides the intelligence by reading actual source files and building a feature taxonomy.

### Recommended workflow

Paste the following prompt into Claude Code. It will run the tool, analyze the codebase, and produce a complete feature architecture report without stopping to ask questions.

```
Analyze the feature architecture of this codebase end-to-end. Do not
stop to ask me questions — complete the entire analysis autonomously.

Step 1: Run repo-feature-check . --json /tmp/symbols.json --since 2024-01-01

Step 2: Read the JSON. Look at the directory tree and symbol distribution
to identify feature areas. Group files by directory clusters.

Step 3: For each directory cluster, read 2-3 representative source files
to understand what the code actually does. Build a feature taxonomy as
you go — named features grouped into categories (e.g. "Payments" under
"Commerce"). As you read more code, refine the taxonomy: merge, split,
or rename features as your understanding deepens.

Step 4: When you have covered all major areas, produce the final report
in exactly this format:

# Feature Architecture: <repo-name>
Analyzed <date> | <total> symbols | <n> features | <n> categories

## Feature Map
| Category | Feature | Symbols | F | M | C | Churn | Hotspot | Description |
|----------|---------|--------:|--:|--:|--:|------:|---------|-------------|
(one row per feature, F=functions M=methods C=classes, Hotspot=LOW/MED/HIGH)

## Top 20 Hotspot Files
| Churn | Commits | Feature | File |
|------:|--------:|---------|------|

## Cross-Cutting Concerns
| Concern | Used By | Notes |
|---------|---------|-------|
(shared infrastructure, auth, utils, DB layer, etc.)

## Architectural Observations
| Observation | Affected Features | Severity |
|-------------|-------------------|----------|
(coupling issues, abstraction gaps, refactoring opportunities)

Fill in every section. Focus on user-facing features, not implementation
details. Use the churn data to identify hotspots and flag risks.
```

## Feature config (optional)

If you already know your feature areas, you can provide a config file to get path-based classification without AI:

```json
{
  "name": "my-app",
  "excludePaths": ["*.test.*", "__tests__"],
  "excludeChurn": ["pnpm-lock.yaml", "generated/"],
  "features": [
    { "id": "payments", "name": "Payments", "category": "Commerce", "paths": ["/payments/", "/billing/"] },
    { "id": "auth", "name": "Authentication", "category": "Users", "paths": ["/auth/", "/login/"] }
  ]
}
```

See `examples/` for a full example config.

## License

MIT
