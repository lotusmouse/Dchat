import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)

const option = (name, fallback) => {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const host = option('--host', '0.0.0.0')
const port = Number(option('--port', process.env.PORT || '8090'))
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}
const publicFiles = new Set(['index.html', 'manifest.webmanifest', 'LICENSE'])
const publicDirectories = new Set(['enhance', 'icons', 'static'])

const server = createServer((request, response) => {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname)
  } catch {
    response.writeHead(400).end('Bad request')
    return
  }
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const firstSegment = relative.split('/')[0]
  if (!publicFiles.has(relative) && !publicDirectories.has(firstSegment)) {
    response.writeHead(404).end('Not found')
    return
  }
  const filename = path.resolve(root, relative)
  if (!filename.startsWith(root) || !existsSync(filename) || !statSync(filename).isFile()) {
    response.writeHead(404).end('Not found')
    return
  }
  response.writeHead(200, {
    'cache-control': 'no-cache',
    'content-type': types[path.extname(filename)] || 'application/octet-stream',
  })
  if (request.method === 'HEAD') response.end()
  else createReadStream(filename).pipe(response)
})

server.listen(port, host, () => {
  console.log(`DChat is available at http://localhost:${port}`)
})
