import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
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

// Which build is running, for the diagnostics report and the settings footer:
// the commit (Vercel provides it; locally, git), plus the Vercel environment.
function buildId(): string {
  let sha = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7);
  if (!sha) { try { sha = execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { sha = 'unknown'; } }
  const env = process.env.VERCEL_ENV || 'local';
  return `${sha} (${env})`;
}

// Experiment builds (graphics, close combat) are offline-only: no online play
// and no network connections except to the site itself, so they can never
// reach the production game server, even if the deployment inherits its
// address. Their protocol may not match production's either.
const EXPERIMENT_BRANCHES = ['codex/graphics', 'codex/close-combat'];
const offlineOnly =
  process.env.GRAPHICS_EXPERIMENT === '1' || EXPERIMENT_BRANCHES.some((b) => (process.env.VERCEL_GIT_COMMIT_REF || '').startsWith(b));

function offlineCsp(): Plugin {
  return {
    name: 'chancla-offline-csp',
    transformIndexHtml(html) {
      if (!offlineOnly || html.includes('Content-Security-Policy')) return html;
      return html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="connect-src 'self'">`);
    },
  };
}

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
  // True only for Vercel preview deployments: enables tester conveniences
  // (?unlock=all) that never exist in production builds.
  define: { __BUILD_ID__: JSON.stringify(buildId()), __PREVIEW_BUILD__: JSON.stringify(process.env.VERCEL_ENV === 'preview' || process.env.PREVIEW_BUILD === '1'), __OFFLINE_ONLY__: JSON.stringify(offlineOnly) },
  plugins: [socialMeta(), offlineCsp()],
  build: {
    target: 'es2020',
    outDir: 'dist',
    chunkSizeWarningLimit: 900,
    sourcemap: false,
    rollupOptions: {
      // index.html is the online shooter; classic.html keeps the original
      // single-player arcade game.
      input: {
        main: resolve(__dirname, 'index.html'),
        classic: resolve(__dirname, 'classic.html'),
        courtyard: resolve(__dirname, 'courtyard.html'),
      },
    },
  },
  server: { host: true },
  preview: { host: true },
});
