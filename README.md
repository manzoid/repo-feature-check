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

This tool is the mechanical half of a two-part workflow. It gives you a structured symbol index fast — Claude Code provides the intelligence.

### Recommended workflow

In Claude Code, paste:

> I want to understand the feature architecture of this codebase. Start by running `repo-feature-check` on this repo with `--json` to get a symbol index. Then iteratively:
>
> 1. Look at the directory structure and symbol distribution to identify likely feature areas
> 2. For each area, read representative source files to understand what the code actually does
> 3. Build up a feature taxonomy — group related functions/classes into named features with categories (e.g. "Payments" under "Commerce")
> 4. As you read more code, refine your taxonomy — merge, split, or rename features as your understanding deepens
> 5. When done, output a feature map: for each feature, list its name, category, description, key files, and symbol count
>
> Focus on user-facing features, not implementation details. A "Payments" feature is more useful than "StripeWebhookHandler". Shared infrastructure (utils, DB layer, auth) should be its own category.
>
> Use the git churn data (`--since` flag) to identify hotspots — features with high churn are where active development is happening.

Claude will run the tool, read the JSON output, then start reading actual source files to build up a rich feature-level understanding of the codebase.

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
