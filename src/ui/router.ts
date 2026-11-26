import { useEffect, useState } from 'react';
import type { PageId } from '../domain/config';

// Hash routes: work with Back/Forward, survive refresh, can be shared, and need no server rewrites.
//   #/overview  #/decisions/<group>/<decision?>  #/checks/<finding?>  #/records/<tab>  #/sign-off  #/log  #/summary

export const PAGE_PATH: Record<PageId, string> = {
  arrival: 'overview', decisions: 'decisions', checks: 'checks', books: 'records',
  handover: 'sign-off', decisionLog: 'log', overview: 'summary',
};
const PATH_PAGE = Object.fromEntries(Object.entries(PAGE_PATH).map(([k, v]) => [v, k])) as Record<string, PageId>;

export interface Route { page: PageId | null; params: string[] }

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
  return { page: PATH_PAGE[parts[0] ?? ''] ?? null, params: parts.slice(1) };
}

export function href(page: PageId, ...params: (string | undefined)[]): string {
  const rest = params.filter((p): p is string => !!p).map(encodeURIComponent);
  return `#/${[PAGE_PATH[page], ...rest].join('/')}`;
}

export function navigate(page: PageId, ...params: (string | undefined)[]) {
  const h = href(page, ...params);
  if (location.hash !== h) location.hash = h;
}

export function useRoute(): Route {
  const [r, setR] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setR(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}
