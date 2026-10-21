import { defineConfig, type Plugin } from 'vite';

// Public origin used for absolute Open Graph URLs. Vercel and Netlify expose
// their production URL during builds; SITE_URL overrides both.
function siteOrigin(): string {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const raw =
    process.env.SITE_URL ||
    process.env.VITE_SITE_URL ||
    (vercel ? `https://${vercel}` : '') ||
    process.env.URL ||
    '';
  return raw.replace(/\/+$/, '');
}

const base = process.env.BASE_PATH || '/';

function socialMeta(): Plugin {
  return {
    name: 'chancla-social-meta',
    transformIndexHtml(html) {
      const site = siteOrigin() + base;
      return html.replaceAll('%SITE_URL%', site);
    },
  };
}

export default defineConfig({
  base,
  plugins: [socialMeta()],
  build: {
    target: 'es2020',
    outDir: 'dist',
    chunkSizeWarningLimit: 900,
    sourcemap: false,
  },
  server: { host: true },
  preview: { host: true },
});
