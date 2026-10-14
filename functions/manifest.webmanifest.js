// Served dynamically so start_url keeps the family key: a home-screen web app on iOS
// has its own storage, separate from Safari, so the key has to ride in the launch URL.
export function onRequestGet({ request }) {
  const k = new URL(request.url).searchParams.get('k') || '';
  const safe = /^[A-Za-z0-9_-]{24,64}$/.test(k) ? k : '';
  const manifest = {
    name: 'Chores',
    short_name: 'Chores',
    description: 'Today\'s chores, stars and rewards.',
    id: '/',
    start_url: safe ? `/?k=${safe}` : '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0B1433',
    theme_color: '#0B1433',
    icons: [
      { src: '/theme/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/theme/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/theme/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-cache' },
  });
}
