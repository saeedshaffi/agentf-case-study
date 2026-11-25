import { formatMoney, sum, toCents, toDecimalString } from './money';

describe('money', () => {
  it('parses decimal strings exactly', () => {
    expect(toCents('1234.56')).toBe(123456n);
    expect(toCents('-0.01')).toBe(-1n);
    expect(toCents('7')).toBe(700n);
    expect(toCents('0.5')).toBe(50n);
  });
  it('rejects things that are not amounts', () => {
    expect(() => toCents('1,50')).toThrow();
    expect(() => toCents('abc')).toThrow();
  });
  it('sums without floating point drift', () => {
    expect(toDecimalString(sum(Array(10).fill(toCents('0.10'))))).toBe('1.00');
  });
  it('formats in the customer locale with exact cents', () => {
    expect(formatMoney(toCents('24929183.08'), 'EUR', 'de-DE')).toBe('24.929.183,08 €');
    expect(formatMoney(toCents('-560940.33'), 'EUR', 'de-DE')).toBe('−560.940,33 €');
    expect(formatMoney(toCents('228491.60'), 'USD', 'en-US')).toBe('$228,491.60');
  });
});
