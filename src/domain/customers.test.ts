import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runChecks } from './checks';
import { parseConfig } from './config';
import { groupDecisions } from './decisions';
import { buildIndex } from './load';
import { computeMetrics } from './metrics';

// Every customer folder must have a valid config. If its engine output is present,
// every question must land in a group and every check must run.
const root = resolve(__dirname, '../../customers');
const customers = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name);

describe.each(customers)('customer %s', (id) => {
  const cfg = parseConfig(JSON.parse(readFileSync(resolve(root, id, 'config.json'), 'utf8')));
  const dir = resolve(root, id, cfg.dataPath);
  const has = existsSync(resolve(dir, 'summary.json'));

  it('has a valid config', () => { expect(cfg.id).toBe(id); });

  it.runIf(has)('places every question in a group and runs every check', () => {
    const r = (f: string) => JSON.parse(readFileSync(resolve(dir, `${f}.json`), 'utf8'));
    const idx = buildIndex({ summary: r('summary'), invoices: r('invoices'), bank: r('bank_transactions'), decisions: r('decisions'), partners: r('partners'), accounts: r('accounts') });
    const groups = groupDecisions(idx, cfg);
    expect(groups.reduce((n, g) => n + g.decisions.length, 0)).toBe(idx.decisions.length);
    expect(() => runChecks(idx, cfg)).not.toThrow();
    expect(Object.keys(computeMetrics(idx)).length).toBeGreaterThan(0);
  });
});
