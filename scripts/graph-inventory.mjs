/** Inventory of maintained project text inputs for Graphify verification. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const roots = ['src', 'tests', 'scripts', 'docs', '.github', '.stitch', 'public'];
const textExtension = /\.(?:tsx?|mts|cts|jsx?|mjs|cjs|ps1|json|ya?ml|md|html|css|rules|webmanifest)$/i;
const excluded = /(?:^|\/)(?:node_modules|dist|build|coverage|graphify-out|\.ua|\.git|playwright-report|test-results|\.firebase|\.demo-runtime)(?:\/|$)|(?:^|\/)(?:package-lock\.json|stats\.html|\.env[^/]*$|\.codex-(?:deploy-audit|tmp-deploy)-[^/]*$)|\.(?:bak|backup)$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const slash = value => value.replaceAll('\\', '/');

export function inventory(root) {
  const paths = [];
  function walk(dir) {
    if (!existsSync(join(root, dir))) return;
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = slash(join(dir, entry.name));
      if (excluded.test(path) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && textExtension.test(path)) paths.push(path);
    }
  }
  roots.forEach(walk);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && !excluded.test(entry.name) && entry.name !== 'AGENTS.md' &&
        (textExtension.test(entry.name) || ['.firebaserc', '.gitattributes'].includes(entry.name))) paths.push(entry.name);
  }
  return Object.fromEntries([...new Set(paths)].sort().map(path => [path, hash(readFileSync(join(root, path)))]));
}
