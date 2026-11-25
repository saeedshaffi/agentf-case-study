#!/usr/bin/env node
// Usage: npm run new-customer -- <id> "<Company name>" ["<industry>"]
// Creates customers/<id>/ with a config copied from the template and an empty engine-output folder.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [id, company, industry = ''] = process.argv.slice(2);
if (!id || !company || !/^[a-z0-9-]+$/.test(id)) {
  console.error('Usage: npm run new-customer -- <id: lowercase-with-dashes> "<Company name>" ["<industry>"]');
  process.exit(1);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'customers');
const dir = resolve(root, id);
if (existsSync(dir)) { console.error(`customers/${id} already exists.`); process.exit(1); }
mkdirSync(resolve(dir, 'engine-output'), { recursive: true });
const tpl = readFileSync(resolve(root, '_template', 'config.json'), 'utf8')
  .replaceAll('__ID__', id).replaceAll('__COMPANY__', company)
  .replaceAll('__SHORT__', company.split(' ')[0]).replaceAll('__INDUSTRY__', industry);
writeFileSync(resolve(dir, 'config.json'), tpl);
console.log(`Created customers/${id}/
  1. Put the engine's API responses in customers/${id}/engine-output/ (summary.json, invoices.json, ...)
  2. Edit customers/${id}/config.json: words, people, roles, decision groups
  3. npm test            validates the config and runs every check against the new data
  4. npm start -- ?customer=${id}   or open http://localhost:5173/?customer=${id}`);
