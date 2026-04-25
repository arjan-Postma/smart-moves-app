/**
 * Post-build patch for Expo web export.
 * Adds PWA / Apple home-screen meta tags to dist/index.html,
 * copies the app icon, and writes a web manifest.
 *
 * Run automatically via package.json "postbuild" script.
 */

const fs   = require('fs');
const path = require('path');

const DIST   = path.join(__dirname, 'dist');
const ASSETS = path.join(__dirname, 'assets');

// ── 1. Copy icon files into dist/ ──────────────────────────────────────────
fs.copyFileSync(
  path.join(ASSETS, 'apple-touch-icon.png'),
  path.join(DIST,   'apple-touch-icon.png')
);
fs.copyFileSync(
  path.join(ASSETS, 'icon.png'),
  path.join(DIST,   'icon.png')
);
console.log('[patch-html] copied icon files to dist/');

// ── 2. Write PWA manifest ──────────────────────────────────────────────────
const manifest = {
  name:             'Futures Academy Trends',
  short_name:       'TrendDeck',
  description:      'Swipeable trend cards from Futures Academy',
  start_url:        '/',
  display:          'standalone',
  background_color: '#E93440',
  theme_color:      '#E93440',
  icons: [
    { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    { src: '/icon.png',             sizes: '1024x1024', type: 'image/png' },
  ],
};
fs.writeFileSync(
  path.join(DIST, 'manifest.json'),
  JSON.stringify(manifest, null, 2)
);
console.log('[patch-html] wrote dist/manifest.json');

// ── 3. Inject meta tags into dist/index.html ──────────────────────────────
const htmlPath = path.join(DIST, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

const injection = `
  <!-- PWA / iPhone home screen -->
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="TrendDeck" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="theme-color" content="#E93440" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/manifest.json" />`;

// Insert just before </head>
if (!html.includes('apple-mobile-web-app-capable')) {
  html = html.replace('</head>', injection + '\n</head>');
  fs.writeFileSync(htmlPath, html);
  console.log('[patch-html] injected PWA meta tags into dist/index.html');
} else {
  console.log('[patch-html] meta tags already present, skipping');
}

// ── 4. Copy pre-translated card content into dist/ ────────────────────────
const TRANSLATIONS = path.join(__dirname, 'translations');
const DIST_TRANSLATIONS = path.join(DIST, 'translations');
if (fs.existsSync(TRANSLATIONS)) {
  if (!fs.existsSync(DIST_TRANSLATIONS)) fs.mkdirSync(DIST_TRANSLATIONS);
  for (const file of fs.readdirSync(TRANSLATIONS)) {
    fs.copyFileSync(path.join(TRANSLATIONS, file), path.join(DIST_TRANSLATIONS, file));
  }
  console.log('[patch-html] copied translations/ to dist/translations/');
}
