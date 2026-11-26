import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../App';
import { parseConfig, type RoleId } from '../domain/config';
import { AppProvider } from '../ui/state';

const root = resolve(__dirname, '../../customers');

beforeEach(() => {
  localStorage.clear();
  location.hash = '';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    try { return new Response(readFileSync(resolve(root, '.' + url), 'utf8'), { status: 200 }); }
    catch { return new Response('not found', { status: 404 }); }
  }));
  window.scrollTo = vi.fn() as never;
});

function renderAs(role: RoleId, opts: { fail?: string; hash?: string } = {}) {
  if (opts.hash) location.hash = opts.hash;
  const cfg = parseConfig(JSON.parse(readFileSync(resolve(root, 'nordlicht/config.json'), 'utf8')));
  return render(<AppProvider cfg={cfg} initialRole={role} latencyMs={0} fail={opts.fail}><App /></AppProvider>);
}
const go = async (hash: string) => { await act(async () => { location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); }); };

describe('overview', () => {
  it('says what is left before sign-off and where to start', async () => {
    renderAs('finance_lead');
    expect(await screen.findByRole('heading', { name: /116 required decisions and 5 checks before sign-off/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Start: VAT ID for a customer you sold to tax-free/ })).toHaveAttribute('href', '#/decisions/vat_zero_rated');
    expect(screen.getByRole('button', { name: /1\.770 invoices loaded\. Show source/ })).toBeInTheDocument();
  });
  it('ties the failed bank load to its retry', async () => {
    renderAs('finance_lead');
    expect(await screen.findByText(/Retried 24 minutes after it failed/)).toBeInTheDocument();
  });
});

describe('decision workspace', () => {
  it('separates required from optional and opens the first required group', async () => {
    renderAs('finance_lead', { hash: '#/decisions' });
    const queue = await screen.findByRole('navigation', { name: 'Decision groups' });
    expect(within(queue).getByRole('region', { name: 'Needed for sign-off' })).toHaveTextContent('116 of 116 left');
    expect(within(queue).getByRole('region', { name: 'Can stay open' })).toHaveTextContent('52 of 52 left');
    await waitFor(() => expect(location.hash).toBe('#/decisions/vat_zero_rated'));
  });

  it('pre-selects nothing, validates the VAT ID, and keeps a deferral blocking', async () => {
    renderAs('finance_lead', { hash: '#/decisions/vat_zero_rated' });
    const radios = await screen.findAllByRole('radio');
    radios.forEach((r) => expect(r).not.toBeChecked());
    fireEvent.click(screen.getByRole('radio', { name: /Ask the customer/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm answer' }));
    expect(await screen.findByText(/still blocks sign-off/)).toBeInTheDocument();
    expect(screen.getByText('0 of 116 required')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change answer' }));
    fireEvent.click(await screen.findByRole('radio', { name: /Enter the correct VAT id/ }));
    fireEvent.change(screen.getByLabelText('Correct VAT ID'), { target: { value: 'DE123456789' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/starts with FR/);
    fireEvent.change(screen.getByLabelText('Correct VAT ID'), { target: { value: 'fr 40303265045' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm answer' }));
    expect(await screen.findByText('1 of 116 required')).toBeInTheDocument();
    expect(screen.getByText('FR40303265045')).toBeInTheDocument();
  });

  it('books a whole description to one account and undoes it as one action', async () => {
    renderAs('finance_lead', { hash: '#/decisions/classification' });
    const cluster = (await screen.findByRole('heading', { name: '“Beratung Digitalisierung”' })).closest('section')!;
    expect(within(cluster).getByText(/4 different accounts for the same description/)).toBeInTheDocument();
    fireEvent.click(within(cluster).getByRole('radio', { name: /6825 Legal and consulting fees/ }));
    expect(within(cluster).getByText(/31 move from other accounts/)).toBeInTheDocument();
    fireEvent.click(within(cluster).getByRole('button', { name: 'Book 37 invoices to 6825' }));
    expect(await screen.findByText('37 of 116 required')).toBeInTheDocument();
    fireEvent.click(within(cluster).getByRole('button', { name: 'Undo this booking (37)' }));
    expect(await screen.findByText('0 of 116 required')).toBeInTheDocument();
  });

  it('shows what was actually paid next to the rounding suggestion', async () => {
    renderAs('finance_lead', { hash: '#/decisions/rounding' });
    expect(await screen.findByText(/For 20 of 24 invoices, the bank shows the export's gross was paid/)).toBeInTheDocument();
  });

  it('compares the duplicate customers and states that merging moves nothing', async () => {
    renderAs('finance_lead', { hash: '#/decisions/duplicate_partner' });
    expect(await screen.findByText(/K00161 has no invoices and no bank payments, so no amount moves/)).toBeInTheDocument();
    expect(screen.getAllByText('✓ Same').length).toBeGreaterThanOrEqual(4);
  });
});

describe('checks and sign-off', () => {
  it('acknowledging keeps a finding open, and says so', async () => {
    renderAs('finance_lead', { hash: '#/checks/credit_notes_in_open_items' });
    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge as an open item' }));
    const detail = screen.getByRole('article');
    expect(within(detail).getAllByText(/Acknowledged, still open/).length).toBeGreaterThan(0);
    expect(within(detail).getByText(/still open/, { selector: 'strong' })).toBeInTheDocument();
  });

  it('names every blocker and keeps sign-off disabled', async () => {
    renderAs('finance_lead', { hash: '#/sign-off' });
    expect(await screen.findByRole('heading', { name: /Not ready: 116 required decisions and 5 checks left/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign off the migration' })).toBeDisabled();
    expect(screen.getByRole('link', { name: /Expense accounts to confirm: 89 of 89 not settled/ })).toHaveAttribute('href', '#/decisions/classification');
  });
});

describe('who sees what', () => {
  it('masks personal data for the tax advisor and offers no decisions', async () => {
    renderAs('tax_advisor', { hash: '#/records/invoices' });
    expect(screen.queryByRole('link', { name: /Decisions/ })).not.toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('Search invoices'), { target: { value: 'RE-2026-00631' } });
    fireEvent.click(await screen.findByRole('button', { name: 'RE-2026-00631' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Schneider Metall AG' }));
    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByText(/FR52 •••• •••• 5881/)).toBeInTheDocument();
    expect(within(panel).queryByText(/buchhaltung@/)).not.toBeInTheDocument();
  });

  it('gives the managing director one page', async () => {
    renderAs('owner');
    expect(await screen.findByRole('heading', { name: 'The books are in. Sign-off is still open.' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link')).toHaveLength(1);
  });
});

describe('robustness', () => {
  it('says what failed, shows no partial totals, and recovers on retry', async () => {
    renderAs('finance_lead', { fail: 'invoices' });
    expect((await screen.findAllByText(/The invoices could not be loaded/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /invoices loaded/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Try loading invoices again' })[0]);
    await waitFor(() => expect(screen.getByRole('button', { name: /invoices loaded/ })).toBeInTheDocument());
  });
  it('routes with the hash, so Back and refresh keep the place', async () => {
    renderAs('finance_lead');
    await screen.findByRole('heading', { name: /before sign-off/ });
    await go('#/records/bank');
    expect(await screen.findByRole('link', { name: 'Bank' })).toHaveAttribute('aria-current', 'page');
  });
});
