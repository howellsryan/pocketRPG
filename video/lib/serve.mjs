/**
 * Minimal static server for the built single-file bundle. The pipeline never
 * touches the network: it serves `index.html` + `game-<hash>.js` + `public/`
 * straight off disk so a render works offline and costs nothing.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.ico': 'image/x-icon',
}

export function serveStatic(root, port = 0) {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0])
    if (rel === '/') rel = '/index.html'
    const file = path.join(root, rel)
    // Never serve outside the build root.
    if (!file.startsWith(path.resolve(root))) { res.writeHead(403); return res.end() }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: bound } = server.address()
      resolve({ server, port: bound, url: `http://127.0.0.1:${bound}`, close: () => server.close() })
    })
  })
}
