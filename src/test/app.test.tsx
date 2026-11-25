import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../App';
import { parseConfig, type RoleId } from '../domain/config';
import { AppProvider } from '../ui/state';

const root = resolve(__dirname, '../../customers');

// Serve customers/<id>/... exactly like the dev server does.
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    try {
      const body = readFileSync(resolve(root, '.' + url), 'utf8');
      return new Response(body, { status: 200 });
    } catch {
      return new Response('not found', { status: 404 });
    }
  }));
  window.scrollTo = vi.fn() as never;
});

function renderAs(role: RoleId, opts: { fail?: string } = {}) {
  const cfg = parseConfig(JSON.parse(readFileSync(resolve(root, 'nordlicht/config.json'), 'utf8')));
  return render(<AppProvider cfg={cfg} initialRole={role} latencyMs={0} fail={opts.fail}><App /></AppProvider>);
}

describe('finance lead journey', () => {
  it('arrives, sees the failed load explained and every count', async () => {
    renderAs('finance_lead');
    expect(await screen.findByText(/Timed out after 600 s/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Invoices loaded: show where this comes from/ })).toHaveTextContent('1.770');
    expect(screen.getByText(/adds up/)).toBeInTheDocument();
  });

  it('opens any number down to its source row', async () => {
    renderAs('finance_lead');
    fireEvent.click(await screen.findByRole('button', { name: /Total debits/ }));
    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByText(/matches the engine's figure/)).toBeInTheDocument();
  });

  it('answers a whole group at once and can undo it', async () => {
    renderAs('finance_lead');
    fireEvent.click(await screen.findByRole('button', { name: 'Start with the questions' }));
    fireEvent.click(await screen.findByText('One-cent rounding differences'));
    fireEvent.click(await screen.findByRole('button', { name: 'Accept all 24 suggestions' }));
    expect(await screen.findByText(/Accepted the suggestion for 24 questions/)).toBeInTheDocument();
    expect(screen.getByText('24 / 168')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('0 / 168')).toBeInTheDocument();
  });

  it('will not sign off while questions that change the books are open', async () => {
    renderAs('finance_lead');
    fireEvent.click(await screen.findByRole('button', { name: /Hand-over/ }));
    expect(await screen.findByRole('button', { name: 'Sign off the migration' })).toBeDisabled();
  });
});

describe('who sees what', () => {
  it('masks personal data for the tax advisor and offers no decisions', async () => {
    renderAs('tax_advisor');
    expect(screen.queryByRole('button', { name: /Your decisions/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('tab', { name: 'Invoices' }));
    fireEvent.change(await screen.findByLabelText('Search invoices'), { target: { value: 'RE-2026-00631' } });
    fireEvent.click(await screen.findByRole('button', { name: 'RE-2026-00631' }));
    fireEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Schneider Metall AG' }));
    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByText(/FR52 •••• •••• 5881/)).toBeInTheDocument();
    expect(within(panel).queryByText(/buchhaltung@/)).not.toBeInTheDocument();
  });

  it('gives the managing director one overview page with totals only', async () => {
    renderAs('owner');
    expect(await screen.findByText(/Did the move to Agent F work/)).toBeInTheDocument();
    expect(await screen.findByText(/Customers owe you \(net of credit notes\)/)).toBeInTheDocument();
    expect(screen.getAllByRole('navigation')[0].querySelectorAll('button')).toHaveLength(1);
  });
});

describe('when data is missing', () => {
  it('says what failed, shows no partial totals, and recovers on retry', async () => {
    renderAs('finance_lead', { fail: 'invoices' });
    expect(await screen.findByText(/Part of your data did not load/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Invoices loaded/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry invoices' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Invoices loaded/ })).toBeInTheDocument());
  });
});
