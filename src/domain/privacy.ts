// Who sees what. The role config decides; these helpers only mask.

export function maskIban(iban: string): string {
  if (!iban) return '—';
  const s = iban.replace(/\s+/g, '');
  return `${s.slice(0, 4)} •••• •••• ${s.slice(-4)}`;
}

export function maskEmail(email: string): string {
  if (!email) return '—';
  const [user, domain = ''] = email.split('@');
  return `${user.slice(0, 1)}•••@${domain.replace(/^[^.]+/, (d) => d.slice(0, 1) + '•••')}`;
}

export function maskName(name: string): string {
  if (!name) return '—';
  return name.split(/\s+/).map((w) => w.slice(0, 1) + '.').join(' ');
}
