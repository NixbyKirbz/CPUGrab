export type Portal = 'student' | 'seller';

export const portalCookie = 'cpugrab-last-portal';
export const portalCookieOptions = {
  path: '/',
  sameSite: 'lax' as const,
  maxAge: 60 * 60 * 24 * 365,
};

export const loginHref = (portal: Portal) =>
  portal === 'seller' ? '/login?role=seller' : '/login';
export const portalSessionCookie = (portal: Portal) =>
  portal === 'seller' ? { name: 'cpugrab-stall-auth' } : undefined;

export function portalForPath(path: string, requested?: string | null): Portal {
  if (path === '/seller' || path.startsWith('/seller/') || path === '/register/stall')
    return 'seller';
  return ['/login', '/register', '/forgot-password', '/reset-password', '/auth/callback'].includes(
    path,
  ) && requested === 'seller'
    ? 'seller'
    : 'student';
}

export const portalHome = (portal: Portal, role: string | undefined) =>
  role === 'admin'
    ? '/admin'
    : portal === 'seller'
      ? role === 'seller'
        ? '/seller/dashboard'
        : '/register/stall'
      : '/student/home';

export const identifierPattern = /^[a-z0-9][a-z0-9 ._/-]{2,39}$/i;
