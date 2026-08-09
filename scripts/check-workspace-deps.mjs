#!/usr/bin/env node
/**
 * Asserts that every `@project-signal/*` package an app imports is declared in its
 * package.json `dependencies`.
 *
 * WHY THIS EXISTS. The API gained an import of `@project-signal/llm` without declaring it. Yarn
 * hoists workspace packages into the root `node_modules`, so the import resolved perfectly:
 * lint passed, typecheck passed, the unit suite passed, and the Docker image built. It failed
 * only in the RUNNER stage, where `yarn workspaces focus <app> --production` installs exactly
 * the declared dependencies and nothing else — so the container crashed on boot with
 * ERR_MODULE_NOT_FOUND, ECS's circuit breaker rolled the deployment back, and the service
 * silently kept serving the previous image while reporting the new task definition.
 *
 * That is a nasty failure: every local signal is green, the deploy reports success, and the
 * symptom is a feature that is simply "not there" in an environment you cannot easily inspect.
 * A missing manifest entry is trivial to fix and nearly impossible to spot after the fact, so it
 * gets a check rather than a note in a document.
 *
 * Import-only-in-tests is fine and is not flagged: `test/` is excluded, because a dev dependency
 * is the correct home for something the shipped code never loads.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APPS = ['api', 'ingestion', 'sentiment-worker', 'report-worker', 'web'];
const IMPORT_RE = /from\s+['"](@project-signal\/[a-z-]+)['"]|import\(['"](@project-signal\/[a-z-]+)['"]\)/g;

/** Every source file under a directory, excluding build output. */
function sourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue;
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts)$/.test(entry)) out.push(full);
    }
  };
  try {
    walk(dir);
  } catch {
    /* An app without a src/ directory has nothing to check. */
  }
  return out;
}

let failed = false;

for (const app of APPS) {
  const manifestPath = join('apps', app, 'package.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    continue;
  }

  const declared = new Set(Object.keys(manifest.dependencies ?? {}));
  const imported = new Set();

  for (const file of sourceFiles(join('apps', app, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(IMPORT_RE)) {
      imported.add(match[1] ?? match[2]);
    }
  }

  const missing = [...imported].filter((pkg) => !declared.has(pkg)).sort();
  if (missing.length > 0) {
    failed = true;
    console.error(`\n  ${manifestPath} is missing declared dependencies:`);
    for (const pkg of missing) console.error(`    - ${pkg}`);
    console.error(
      '    These resolve locally through Yarn hoisting but are OMITTED by\n' +
        `    \`yarn workspaces focus ${manifest.name} --production\` in the Docker runner stage,\n` +
        '    so the container will crash on boot with ERR_MODULE_NOT_FOUND.',
    );
  } else {
    console.log(`  ${manifest.name}: ${imported.size} workspace import(s), all declared`);
  }
}

if (failed) {
  console.error('\n  Add the packages above to the app’s "dependencies" and re-run.\n');
  process.exit(1);
}
console.log('\n  All workspace imports are declared.');
