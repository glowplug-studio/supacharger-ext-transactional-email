import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createManifest, verifyContract, fileContract } from '../scripts/contract.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const manifest = fs.existsSync(path.join(root, 'extension.json'))
  ? JSON.parse(fs.readFileSync(path.join(root, 'extension.json'), 'utf8')) : createManifest(root, pkg);

test('contract covers the real package payload', () => verifyContract(root, manifest, pkg));
test('consumer config cannot become managed implementation', () => {
  const changed = structuredClone(manifest); delete changed.files.find(file => file.kind === 'config').kind;
  assert.throws(() => verifyContract(root, changed, pkg), /ownership/);
});
test('arbitrary destinations and path traversal are rejected', () => {
  const changed = structuredClone(manifest); changed.files[0].target = 'src/supacharger/config.ts';
  assert.throws(() => verifyContract(root, changed, pkg), /ownership/);
  assert.throws(() => fileContract(manifest.id, 'payload/app/../../secret'), /Unsafe/);
});
test('duplicates and omitted files are rejected', () => {
  const duplicate = structuredClone(manifest); duplicate.files.push(duplicate.files[0]);
  assert.throws(() => verifyContract(root, duplicate, pkg), /Duplicate/);
  const missing = structuredClone(manifest); missing.files.pop();
  assert.throws(() => verifyContract(root, missing, pkg), /cover/);
});
test('package and contract version must agree', () => {
  assert.throws(() => verifyContract(root, { ...manifest, version: '99.0.0' }, pkg));
});
test('generated worker and migration receive concrete ownership mappings', () => {
  const worker = fileContract(manifest.id, `payload/supabase/functions/sc_wake_ext-${manifest.id}/index.ts`);
  assert.equal(worker.target, `supabase/functions/sc_wake_ext-${manifest.id}/index.ts`);
  const migration = fileContract(manifest.id, `payload/supabase/migrations/20261030000000_ext_${manifest.id.replaceAll('-', '_')}_setup.sql`);
  assert.equal(migration.kind, 'migration');
  assert.equal(fileContract(manifest.id, 'payload/supabase/schemas/sc_example/schema.sql').kind, 'schema');
});
test('symlink payloads are rejected without reading the destination', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-contract-'));
  try {
    fs.mkdirSync(path.join(fixture, 'payload'));
    fs.symlinkSync(path.join(root, 'package.json'), path.join(fixture, 'payload', 'outside.json'));
    assert.throws(() => createManifest(fixture, pkg), /Symlink/);
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});
