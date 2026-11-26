import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'CPUGrab — Campus Food Reservation',
    short_name: 'CPUGrab',
    description: 'Reserve campus food, pick up, and skip the line.',
    start_url: '/student/home',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0B2257',
    orientation: 'portrait-primary',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
