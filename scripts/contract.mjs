import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// Shared package convention; extension.json is the only installed-file ownership contract.
function safe(value) {
  assert.equal(typeof value, 'string');
  assert(value && !value.includes('\\') && !path.posix.isAbsolute(value));
  assert(value.split('/').every(part => /^[a-zA-Z0-9_.()-]+$/.test(part) && part !== '.' && part !== '..'), `Unsafe path: ${value}`);
  return value;
}
export function payloadFiles(root, directory = 'payload') {
  const files = [];
  assert(!fs.lstatSync(path.join(root, directory)).isSymbolicLink(), `Symlink: ${directory}`);
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const source = safe(`${directory}/${entry.name}`);
    assert(!entry.isSymbolicLink(), `Symlink: ${source}`);
    if (entry.isDirectory()) files.push(...payloadFiles(root, source));
    else { assert(entry.isFile(), `Not a regular file: ${source}`); files.push(source); }
  }
  return files.sort();
}
export function fileContract(id, source) {
  safe(source);
  const mappings = {
    'payload/app/': `src/app/(project)/(extensions)/(sc_extensions)/(${id})/`,
    'payload/supabase/shared/': `supabase/functions/_shared/extensions/sc_ext-${id}/`,
    'payload/supabase/functions/': 'supabase/functions/',
    'payload/supabase/migrations/': 'supabase/migrations/',
    'payload/supabase/schemas/': `supabase/schemas/extensions/${id}/`,
    'payload/docs/': `docs/extensions/${id}/`,
    'payload/agents/': `docs/agents/extensions/supacharger-ext-${id}/`,
  };
  const prefix = Object.keys(mappings).find(prefix => source.startsWith(prefix));
  assert(prefix, `Unsupported payload path: ${source}`);
  if (prefix === 'payload/supabase/functions/') {
    const parts = source.slice(prefix.length).split('/');
    assert(parts.length > 1 && new RegExp(`^(?:sc_(?:[a-z][a-z0-9_]{0,5}_)?)?ext-${id}(?:-[a-z0-9-]+)?$`).test(parts[0]), `Invalid worker: ${source}`);
  }
  if (prefix === 'payload/agents/') assert(source.endsWith('.md'), 'Agent guides must be Markdown');
  let kind;
  if (source === `payload/app/supacharger-ext-${id}.config.ts`) kind = 'config';
  if (prefix === 'payload/supabase/migrations/') {
    assert(new RegExp(`^payload/supabase/migrations/[0-9]{14}_ext_${id.replaceAll('-', '_')}_[a-z0-9_]+\\.sql$`).test(source), `Invalid migration: ${source}`);
    kind = 'migration';
  }
  if (prefix === 'payload/supabase/schemas/') { assert(source.endsWith('.sql'), 'Schema payloads must be SQL'); kind = 'schema'; }
  return { source, target: mappings[prefix] + source.slice(prefix.length), ...(kind ? { kind } : {}) };
}
export function createManifest(root, pkg, extra = {}) {
  const id = pkg.name.replace(/^supacharger-ext-/, '');
  return { schemaVersion: 3, id, name: pkg.name, version: pkg.version, coreOwnershipVersion: 2,
    dependencies: [], core_services: [], ...extra, files: payloadFiles(root).map(source => fileContract(id, source)) };
}
export function verifyContract(root, manifest, pkg) {
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.coreOwnershipVersion, 2);
  assert.match(manifest.id, /^[a-z][a-z0-9-]*$/);
  assert.equal(manifest.name, `supacharger-ext-${manifest.id}`);
  assert.equal(manifest.name, pkg.name);
  assert.equal(manifest.version, pkg.version);
  assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  for (const field of ['dependencies', 'core_services']) {
    assert(Array.isArray(manifest[field]), `Missing ${field}`);
    assert.equal(new Set(manifest[field]).size, manifest[field].length, `Duplicate ${field}`);
    for (const value of manifest[field]) assert.match(value, field === 'dependencies' ? /^supacharger-ext-[a-z][a-z0-9-]*$/ : /^[a-z][a-z0-9_]*$/);
  }
  assert(!manifest.dependencies.includes(manifest.name), 'Self dependency');
  if (manifest.preparedNamespace !== undefined) assert(typeof manifest.preparedNamespace === 'string' && (manifest.preparedNamespace === '' || /^[a-z][a-z0-9_]{0,5}$/.test(manifest.preparedNamespace)), 'Invalid namespace');
  assert(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 1000);
  const targets = new Set(); const migrations = new Set();
  for (const file of manifest.files) {
    assert.deepEqual(file, fileContract(manifest.id, file.source), `Incorrect ownership or mapping: ${file.source}`);
    const target = safe(file.target).toLowerCase();
    assert(!targets.has(target), `Duplicate target: ${file.target}`); targets.add(target);
    if (file.kind === 'migration') {
      const timestamp = path.basename(file.source).slice(0, 14);
      assert(!migrations.has(timestamp), 'Migration timestamp collision'); migrations.add(timestamp);
    }
  }
  assert.deepEqual(manifest.files.map(file => file.source).sort(), payloadFiles(root), 'Manifest must cover the payload exactly');
  for (const required of ['payload/app/index.ts', `payload/app/supacharger-ext-${manifest.id}.config.ts`, 'payload/docs/INSTALL.md', 'payload/agents/AGENTS.md']) {
    assert(manifest.files.some(file => file.source === required), `Required file missing: ${required}`);
  }
  return manifest;
}
