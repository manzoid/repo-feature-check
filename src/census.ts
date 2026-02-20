#!/usr/bin/env node
/**
 * Codebase Census — Extract and categorize every function, method, and class
 * in a codebase using universal-ctags for reliable AST-level parsing.
 *
 * Usage:
 *   repo-feature-check /path/to/repo --config features.json [--json output.json] [--since 2025-01-01]
 *
 * Requires: universal-ctags (brew install universal-ctags)
 *
 * What it does:
 *   1. Runs ctags to extract all symbols with full scope chains
 *   2. Filters to meaningful symbols (functions, methods, classes)
 *   3. Categorizes each symbol by feature using path-based rules from config
 *   4. Optionally overlays git churn data to identify hotspots
 *   5. Outputs a structured report
 */

import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CtagsEntry {
  name: string;
  path: string;
  line: number;
  kind: string;
  scope?: string;
  scopeKind?: string;
  pattern?: string;
}

interface Symbol {
  name: string;
  kind: 'function' | 'method' | 'class';
  file: string;          // relative to repo root
  line: number;
  scope?: string;        // parent class/module
  signature?: string;    // pattern from ctags
  feature: string;       // assigned feature id
  featureName: string;
}

interface FeatureRule {
  id: string;
  name: string;
  category: string;
  paths: string[];       // path substrings that indicate this feature
}

interface FeatureConfig {
  name: string;
  description?: string;
  excludePaths?: string[];   // paths to skip entirely
  excludeChurn?: string[];   // path patterns to exclude from churn analysis
  features: FeatureRule[];
}

interface FeatureReport {
  id: string;
  name: string;
  category: string;
  functions: number;
  methods: number;
  classes: number;
  total: number;
  // churn (if --since provided)
  commits?: number;
  churn?: number;
  hotspotScore?: number;
  topFiles?: { path: string; commits: number; churn: number }[];
}

// ─── ctags runner ────────────────────────────────────────────────────────────

function findCtags(): string {
  // Prefer homebrew universal-ctags
  const candidates = [
    '/opt/homebrew/bin/ctags',
    '/usr/local/bin/ctags',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const ver = spawnSync(c, ['--version'], { encoding: 'utf-8' });
      if (ver.stdout?.includes('Universal Ctags')) return c;
    }
  }
  // Try PATH
  const which = spawnSync('which', ['ctags'], { encoding: 'utf-8' });
  if (which.stdout?.trim()) {
    const ver = spawnSync(which.stdout.trim(), ['--version'], { encoding: 'utf-8' });
    if (ver.stdout?.includes('Universal Ctags')) return which.stdout.trim();
  }
  console.error('Error: universal-ctags not found. Install with: brew install universal-ctags');
  process.exit(1);
}

function runCtags(ctagsBin: string, repoRoot: string, excludePaths: string[]): CtagsEntry[] {
  const excludeArgs = [
    '--exclude=node_modules',
    '--exclude=.next',
    '--exclude=dist',
    '--exclude=build',
    '--exclude=.git',
    '--exclude=*.d.ts',
    '--exclude=__pycache__',
    '--exclude=.gradle',
    '--exclude=target',
    '--exclude=coverage',
    ...excludePaths.map(p => `--exclude=${p}`),
  ];

  const result = spawnSync(ctagsBin, [
    '--output-format=json',
    '--languages=TypeScript,Kotlin,JavaScript,Python,Go,Rust,Java',
    '--kinds-TypeScript=fcmgM',   // function, class, constant(component), method, generator
    '--kinds-Kotlin=cfmoC',       // class, function, method, object, constant
    '--kinds-JavaScript=fcmgM',
    '--kinds-Python=cfm',         // class, function, method/member
    '--kinds-Go=ftsm',            // function, type, struct, method
    '--kinds-Rust=fsPtm',         // function, struct, impl, trait, method
    '--kinds-Java=cmi',           // class, method, interface
    '--fields=+KZSn',             // Kind, scope, scopeKind, line number
    '--extras=+q',                // qualified names
    ...excludeArgs,
    '-R',
    repoRoot,
  ], {
    encoding: 'utf-8',
    maxBuffer: 200 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.error) {
    console.error('ctags failed:', result.error.message);
    process.exit(1);
  }

  const entries: CtagsEntry[] = [];
  for (const line of (result.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      entries.push({
        name: obj.name,
        path: obj.path,
        line: obj.line || 0,
        kind: obj.kind || 'unknown',
        scope: obj.scope,
        scopeKind: obj.scopeKind,
        pattern: obj.pattern,
      });
    } catch {}
  }
  return entries;
}

// ─── Symbol filtering ────────────────────────────────────────────────────────

const FUNCTION_KINDS = new Set(['function', 'generator']);
const METHOD_KINDS = new Set(['method']);
const CLASS_KINDS = new Set(['class', 'object']);

// Filter out noise: lambdas, anonymous, internal framework symbols
const NOISE_NAMES = new Set(['<lambda>', '<anonymous>', 'anonymous', 'module.exports']);

function filterSymbols(entries: CtagsEntry[], repoRoot: string): Symbol[] {
  const symbols: Symbol[] = [];

  for (const entry of entries) {
    // Skip noise
    if (NOISE_NAMES.has(entry.name)) continue;
    if (entry.name.startsWith('__')) continue;

    // Determine normalized kind
    let kind: Symbol['kind'] | null = null;
    if (FUNCTION_KINDS.has(entry.kind)) kind = 'function';
    else if (METHOD_KINDS.has(entry.kind)) kind = 'method';
    else if (CLASS_KINDS.has(entry.kind)) kind = 'class';
    // ctags marks exported arrow functions / React components as 'constant'
    // — include them if they look like components (PascalCase) or hooks (use*)
    else if (entry.kind === 'constant') {
      if (/^[A-Z][a-zA-Z0-9]+$/.test(entry.name) || /^use[A-Z]/.test(entry.name)) {
        kind = 'function'; // treat components and hooks as functions
      } else {
        continue; // skip plain constants
      }
    }
    else continue;

    const relPath = path.relative(repoRoot, entry.path);

    symbols.push({
      name: entry.name,
      kind,
      file: relPath,
      line: entry.line,
      scope: entry.scope,
      signature: entry.pattern?.replace(/^\/\^/, '').replace(/\$\/$/, '').trim(),
      feature: '',
      featureName: '',
    });
  }

  return symbols;
}

// ─── Feature classification ─────────────────────────────────────────────────

function classifySymbol(relPath: string, features: FeatureRule[]): { id: string; name: string; category: string } {
  const normalized = '/' + relPath.replace(/\\/g, '/');
  for (const feat of features) {
    for (const p of feat.paths) {
      if (normalized.includes(p)) {
        return { id: feat.id, name: feat.name, category: feat.category };
      }
    }
  }
  return { id: 'uncategorized', name: 'Uncategorized', category: 'Unknown' };
}

// ─── Git churn ──────────────────────────────────────────────────────────────

interface FileChurn {
  path: string;
  commits: number;
  additions: number;
  deletions: number;
  churn: number;
}

function getGitChurn(repoRoot: string, since: string, excludePatterns: string[]): FileChurn[] {
  const commitLog = execSync(
    `git -C "${repoRoot}" log --since=${since} --format=format: --name-only | sort | uniq -c | sort -rn`,
    { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
  );

  const commitCounts = new Map<string, number>();
  for (const line of commitLog.trim().split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (m) commitCounts.set(m[2], parseInt(m[1]));
  }

  const numstatLog = execSync(
    `git -C "${repoRoot}" log --since=${since} --numstat --format=format: | awk '{if($1 != "-") a[$3]+=$1; if($2 != "-") d[$3]+=$2} END {for(f in a) print a[f], d[f], f}'`,
    { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
  );

  const results: FileChurn[] = [];
  for (const line of numstatLog.trim().split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const adds = parseInt(parts[0]) || 0;
    const dels = parseInt(parts[1]) || 0;
    const filePath = parts.slice(2).join(' ');
    if (!filePath) continue;

    // Apply exclusions
    if (excludePatterns.some(ex => filePath.includes(ex))) continue;

    results.push({
      path: filePath,
      commits: commitCounts.get(filePath) || 0,
      additions: adds,
      deletions: dels,
      churn: adds + dels,
    });
  }

  return results.sort((a, b) => b.churn - a.churn);
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const repoRoot = args.find(a => !a.startsWith('--'));
  const configIdx = args.indexOf('--config');
  const configFile = configIdx >= 0 ? args[configIdx + 1] : null;
  const jsonIdx = args.indexOf('--json');
  const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
  const sinceIdx = args.indexOf('--since');
  const since = sinceIdx >= 0 ? args[sinceIdx + 1] : null;

  if (!repoRoot) {
    console.error('Usage: repo-feature-check /path/to/repo [--config features.json] [--json out.json] [--since 2025-01-01]');
    process.exit(1);
  }

  const absRoot = path.resolve(repoRoot);

  // Load config
  let config: FeatureConfig;
  if (configFile) {
    config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
  } else {
    config = { name: 'default', features: [], excludePaths: [], excludeChurn: [] };
  }

  // 1. Run ctags
  const ctagsBin = findCtags();
  console.error(`Running ctags on ${absRoot}...`);
  const rawEntries = runCtags(ctagsBin, absRoot, config.excludePaths || []);
  console.error(`  ctags found ${rawEntries.length.toLocaleString()} raw entries`);

  // 2. Filter to meaningful symbols
  const symbols = filterSymbols(rawEntries, absRoot);
  console.error(`  Filtered to ${symbols.length.toLocaleString()} symbols (functions, methods, classes)`);

  // 3. Classify each symbol
  for (const sym of symbols) {
    const { id, name, category } = classifySymbol(sym.file, config.features);
    sym.feature = id;
    sym.featureName = name;
  }

  // 4. Aggregate by feature
  const featureMap = new Map<string, FeatureReport>();
  for (const feat of config.features) {
    featureMap.set(feat.id, {
      id: feat.id, name: feat.name, category: feat.category,
      functions: 0, methods: 0, classes: 0, total: 0,
    });
  }
  featureMap.set('uncategorized', {
    id: 'uncategorized', name: 'Uncategorized', category: 'Unknown',
    functions: 0, methods: 0, classes: 0, total: 0,
  });

  for (const sym of symbols) {
    let report = featureMap.get(sym.feature);
    if (!report) {
      report = {
        id: sym.feature, name: sym.featureName, category: 'Unknown',
        functions: 0, methods: 0, classes: 0, total: 0,
      };
      featureMap.set(sym.feature, report);
    }
    if (sym.kind === 'function') report.functions++;
    else if (sym.kind === 'method') report.methods++;
    else if (sym.kind === 'class') report.classes++;
    report.total++;
  }

  // 5. Overlay git churn if --since provided
  if (since) {
    console.error(`Extracting git churn since ${since}...`);
    const churnData = getGitChurn(absRoot, since, config.excludeChurn || []);

    // Aggregate churn by feature
    for (const file of churnData) {
      const { id } = classifySymbol(file.path, config.features);
      const report = featureMap.get(id);
      if (!report) continue;
      report.commits = (report.commits || 0) + file.commits;
      report.churn = (report.churn || 0) + file.churn;
      if (!report.topFiles) report.topFiles = [];
      report.topFiles.push({ path: file.path, commits: file.commits, churn: file.churn });
    }

    // Compute hotspot scores and trim topFiles
    for (const report of featureMap.values()) {
      if (report.churn && report.commits) {
        report.hotspotScore = Math.round(report.churn * Math.sqrt(report.commits));
      }
      if (report.topFiles) {
        report.topFiles.sort((a, b) => b.churn - a.churn);
        report.topFiles = report.topFiles.slice(0, 10);
      }
    }
  }

  // Sort by total symbols (or hotspot score if churn available)
  const sorted = [...featureMap.values()]
    .filter(f => f.total > 0 || (f.churn && f.churn > 0))
    .sort((a, b) => {
      if (since && a.hotspotScore !== undefined && b.hotspotScore !== undefined) {
        return b.hotspotScore - a.hotspotScore;
      }
      return b.total - a.total;
    });

  // Stats
  const totalSymbols = symbols.length;
  const totalFunctions = symbols.filter(s => s.kind === 'function').length;
  const totalMethods = symbols.filter(s => s.kind === 'method').length;
  const totalClasses = symbols.filter(s => s.kind === 'class').length;
  const uncatCount = featureMap.get('uncategorized')?.total || 0;
  const coveragePct = ((1 - uncatCount / totalSymbols) * 100).toFixed(1);

  // JSON output
  if (jsonOut) {
    const output = {
      repo: absRoot,
      extractedAt: new Date().toISOString(),
      since: since || null,
      totals: { symbols: totalSymbols, functions: totalFunctions, methods: totalMethods, classes: totalClasses },
      coverageRate: coveragePct + '%',
      features: sorted,
      symbols: symbols.map(s => ({
        name: s.name, kind: s.kind, file: s.file, line: s.line,
        scope: s.scope, feature: s.feature,
      })),
    };
    fs.writeFileSync(jsonOut, JSON.stringify(output, null, 2));
    console.error(`Written to ${jsonOut} (${(fs.statSync(jsonOut).size / 1024 / 1024).toFixed(1)} MB)`);
  }

  // Text report
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                            CODEBASE CENSUS                                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Repo:         ${absRoot}`);
  console.log(`  Functions:    ${totalFunctions.toLocaleString()}`);
  console.log(`  Methods:      ${totalMethods.toLocaleString()}`);
  console.log(`  Classes:      ${totalClasses.toLocaleString()}`);
  console.log(`  Total:        ${totalSymbols.toLocaleString()}`);
  console.log(`  Categorized:  ${coveragePct}%`);
  if (since) console.log(`  Churn since:  ${since}`);
  console.log('');

  // Group by category
  const categories = new Map<string, FeatureReport[]>();
  for (const r of sorted) {
    if (!categories.has(r.category)) categories.set(r.category, []);
    categories.get(r.category)!.push(r);
  }

  // Sort categories by total symbols
  const catOrder = [...categories.entries()]
    .sort((a, b) => {
      const aTotal = a[1].reduce((s, r) => s + r.total, 0);
      const bTotal = b[1].reduce((s, r) => s + r.total, 0);
      return bTotal - aTotal;
    });

  const hasChurn = !!since;

  for (const [cat, features] of catOrder) {
    const catTotal = features.reduce((s, r) => s + r.total, 0);
    const catChurn = hasChurn ? features.reduce((s, r) => s + (r.churn || 0), 0) : 0;
    const churnStr = hasChurn ? `, ${catChurn.toLocaleString()} churn` : '';

    console.log(`  ┌─ ${cat.toUpperCase()} (${catTotal.toLocaleString()} symbols${churnStr})`);

    const sortedFeats = hasChurn
      ? features.sort((a, b) => (b.hotspotScore || 0) - (a.hotspotScore || 0))
      : features.sort((a, b) => b.total - a.total);

    for (const feat of sortedFeats) {
      const parts = [
        `${String(feat.total).padStart(5)} sym`,
        `${String(feat.functions).padStart(4)}f`,
        `${String(feat.methods).padStart(5)}m`,
        `${String(feat.classes).padStart(4)}c`,
      ];
      if (hasChurn && feat.churn) {
        parts.push(`${feat.churn.toLocaleString().padStart(7)} churn`);
      }
      console.log(`  │  ${feat.name.padEnd(32)} ${parts.join('  ')}`);
    }
    console.log('  │');
  }

  // Top churned files
  if (hasChurn) {
    const allTopFiles: { path: string; commits: number; churn: number; feature: string }[] = [];
    for (const feat of sorted) {
      for (const f of feat.topFiles || []) {
        allTopFiles.push({ ...f, feature: feat.name });
      }
    }
    allTopFiles.sort((a, b) => b.churn - a.churn);

    console.log('  ── TOP 20 HOTTEST FILES ───────────────────────────────────────────────────────────');
    console.log('');
    for (const f of allTopFiles.slice(0, 20)) {
      console.log(`  ${f.churn.toLocaleString().padStart(7)} churn  ${String(f.commits).padStart(3)} commits  [${f.feature.padEnd(24)}]  ${f.path}`);
    }
    console.log('');
  }
}

main();
