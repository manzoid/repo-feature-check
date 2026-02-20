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

### Setup

Add this to your `~/.claude/CLAUDE.md` so Claude Code knows about the tool in every session:

```markdown
## repo-feature-check
Globally installed CLI (`npm i -g @manzoid2/repo-feature-check`) for codebase feature analysis.
Run `repo-feature-check` with no arguments to get the full analysis prompt — then follow those instructions.
```

### Running an analysis

In Claude Code, just say:

```
repo-feature-check
```

Claude will run the tool, see the analysis instructions, and execute the full workflow — checking git history, asking you about the churn window, extracting symbols, and producing a feature architecture report.

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
