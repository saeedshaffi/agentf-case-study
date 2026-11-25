// Money is handled as integer cents in BigInt. Never as floating point.
// The engine sends decimal strings ("1234.56"); we parse them exactly.

export type Cents = bigint;

export function toCents(amount: string | null | undefined): Cents {
  if (amount == null || amount === '') return 0n;
  const s = amount.trim();
  const neg = s.startsWith('-');
  const body = neg || s.startsWith('+') ? s.slice(1) : s;
  if (!/^\d+(\.\d{1,2})?$/.test(body)) throw new Error(`Not a money amount: "${amount}"`);
  const [whole, frac = ''] = body.split('.');
  const cents = BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
  return neg ? -cents : cents;
}

export function sum(values: Iterable<Cents>): Cents {
  let t = 0n;
  for (const v of values) t += v;
  return t;
}

export function abs(c: Cents): Cents { return c < 0n ? -c : c; }

/** Decimal string with dot, e.g. "-1234.50". Used for comparisons and tests. */
export function toDecimalString(c: Cents): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  const whole = a / 100n;
  const frac = (a % 100n).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

const formatters = new Map<string, Intl.NumberFormat>();

/** Locale-aware formatting without going through a float for the fraction. */
export function formatMoney(c: Cents, currency: string, locale: string, opts: { signed?: boolean } = {}): string {
  const key = `${locale}|${currency}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    formatters.set(key, f);
  }
  // Format the whole part through Intl (grouping, symbol position) using a placeholder fraction,
  // then splice in the exact cents. Safe for amounts well beyond Number.MAX_SAFE_INTEGER / 100.
  const neg = c < 0n;
  const a = neg ? -c : c;
  const whole = a / 100n;
  const frac = (a % 100n).toString().padStart(2, '0');
  const parts = f.formatToParts(Number(whole));
  let out = '';
  for (const p of parts) {
    if (p.type === 'fraction') out += frac;
    else if (p.type === 'minusSign') continue;
    else out += p.value;
  }
  const sign = neg ? '−' : opts.signed && c > 0n ? '+' : '';
  return sign + out.replace(/^\s+/, '');
}

export function formatCount(n: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(n);
}
