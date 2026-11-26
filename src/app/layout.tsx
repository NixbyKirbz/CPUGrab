import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/providers';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'CPUGrab — Your campus. Your cravings.', template: '%s | CPUGrab' },
  description:
    'Reserve campus food, choose your pickup time, and skip the line at Central Philippine University.',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'CPUGrab' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0B2257',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
