import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseConfig } from '../domain/config';
import { buildIndex } from '../domain/load';
import type { EngineData } from '../domain/types';

const root = resolve(__dirname, '../../customers');
const read = (customer: string, f: string) => JSON.parse(readFileSync(resolve(root, customer, f), 'utf8'));

export function loadCustomer(id = 'nordlicht') {
  const cfg = parseConfig(read(id, 'config.json'));
  const e = (n: string) => read(id, `${cfg.dataPath}/${n}.json`);
  const data: EngineData = {
    summary: e('summary'), invoices: e('invoices'), bank: e('bank_transactions'),
    decisions: e('decisions'), partners: e('partners'), accounts: e('accounts'),
  };
  return { cfg, idx: buildIndex(data) };
}
