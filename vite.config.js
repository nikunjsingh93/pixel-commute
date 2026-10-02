import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only endpoint: POST a dataURL to /__snap?name=foo -> shots/foo.png
function snapPlugin() {
  return {
    name: 'snap',
    configureServer(server) {
      server.middlewares.use('/__snap', (req, res) => {
        const url = new URL(req.url, 'http://x');
        const name = (url.searchParams.get('name') || 'shot').replace(/[^\w-]/g, '');
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const b64 = body.replace(/^data:image\/png;base64,/, '');
          const dir = path.resolve('shots');
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from(b64, 'base64'));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [snapPlugin()],
});
