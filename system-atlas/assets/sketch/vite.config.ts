// Local editor for <outDir>/atlas.excalidraw, served beside atlas.html.
//   cd <atlas home>/sketch && pnpm install --frozen-lockfile && pnpm start   → http://127.0.0.1:5178  (pnpm dev only to work on the editor)
// Loopback only and no auth: anyone who can reach the port can read and overwrite the sketch.
import { createReadStream, existsSync, readFileSync, statSync, watch } from 'node:fs';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { META } from '../data.mjs';
import { describe, itemElements, readJson, readSketch, sketchPaths, writeAtomic } from '../sketch.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const atlasHome = join(here, '..');
const dataPath = join(atlasHome, 'data.mjs');
const { outDir, scene: scenePath, base: basePath } = sketchPaths(atlasHome, META);
const fontsDir = join(here, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts');
const PORT = Number(process.env.ATLAS_SKETCH_PORT || 5178);
const MAX_BODY = 50 * 1024 * 1024;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };

const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

// What `fold.mjs` would report for the saved sketch, without writing a proposal.
// data.mjs is re-imported by mtime so edits show up without restarting the server.
async function foldPreview() {
  const scene = readJson(scenePath), base = readJson(basePath);
  if (!scene || !base) return { stale: false, items: [], error: 'no sketch yet: run build.mjs first' };
  const data = await import(`${pathToFileURL(dataPath).href}?v=${statSync(dataPath).mtimeMs}`);
  const { items, stale } = readSketch(data, scene, base);
  return { stale, items: items.map((it: { n: number }) => ({ n: it.n, text: describe(it), elements: itemElements(it) })) };
}

function atlasFiles(): Plugin {
  const clients = new Set<ServerResponse>();
  let lastWritten: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Compare host only: behind `tailscale serve` the page is https while the proxied request is http.
  const sameOrigin = (req: IncomingMessage) => {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  };
  const sendFile = (res: ServerResponse, path: string) => {
    if (!existsSync(path) || !statSync(path).isFile()) return void res.writeHead(404).end('not found');
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(path).pipe(res);
  };

  const broadcast = (event: string, data = '') => {
    for (const res of clients) res.write(`event: ${event}\ndata: ${data}\n\n`);
  };

  function serve(server: ViteDevServer | PreviewServer) {
    // A data edit or rebuild changes what the sketch folds into.
    let foldTimer: ReturnType<typeof setTimeout> | undefined;
    watch(atlasHome, (_, file) => {
      if (file !== 'data.mjs' && file !== 'sketch-base.json') return;
      clearTimeout(foldTimer);
      foldTimer = setTimeout(() => broadcast('fold'), 120);
    });
    // Tell open editors when the build (or anything else) rewrites the scene.
    watch(outDir, (_, file) => {
      if (file !== 'atlas.excalidraw') return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!existsSync(scenePath)) return;
        const hash = sha(readFileSync(scenePath));
        if (hash === lastWritten) return;
        lastWritten = hash;
        broadcast('scene', hash);
      }, 120);
    });

    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/scene' && req.method === 'GET') {
        if (!existsSync(scenePath)) return void res.writeHead(404).end(`no ${scenePath}: run build.mjs first`);
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        return void res.end(readFileSync(scenePath));
      }
      if (url.pathname === '/scene' && req.method === 'PUT') {
        if (!sameOrigin(req)) return void res.writeHead(403).end('cross-origin write refused');
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_BODY) req.destroy();
          else chunks.push(c);
        });
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            return void res.writeHead(400).end('invalid JSON');
          }
          const scene = parsed as { type?: unknown; elements?: unknown } | null;
          if (scene?.type !== 'excalidraw' || !Array.isArray(scene.elements)) return void res.writeHead(400).end('not an excalidraw scene');
          lastWritten = sha(body);
          writeAtomic(scenePath, body);
          res.writeHead(204).end();
          broadcast('fold');
        });
        return;
      }
      if (url.pathname === '/fold' && req.method === 'GET') {
        foldPreview().then(
          (out) => res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(out)),
          (e: unknown) => res.writeHead(500).end(e instanceof Error ? e.message : String(e)),
        );
        return;
      }
      if (url.pathname === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(': connected\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (url.pathname === '/atlas.html') return sendFile(res, join(outDir, 'atlas.html'));
      if (url.pathname.startsWith('/fonts/')) {
        const path = normalize(join(fontsDir, decodeURIComponent(url.pathname.slice('/fonts/'.length))));
        if (!path.startsWith(fontsDir + sep)) return void res.writeHead(403).end();
        return sendFile(res, path);
      }
      next();
    });
  }

  return { name: 'atlas-files', configureServer: serve, configurePreviewServer: serve };
}

// Loopback bind; `.ts.net` lets a `tailscale serve` proxy through Vite's Host check.
const server = { host: '127.0.0.1', port: PORT, strictPort: true, allowedHosts: ['.ts.net'] };
export default defineConfig({
  plugins: [react(), atlasFiles()],
  define: { 'process.env.IS_PREACT': JSON.stringify('false') },
  server,
  preview: server,
});
