import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createManifest, verifyContract } from './contract.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const manifest = createManifest(root, pkg);
verifyContract(root, manifest, pkg);
console.log(`Verified ${manifest.name}: ${manifest.files.length} payload ownership entries`);
