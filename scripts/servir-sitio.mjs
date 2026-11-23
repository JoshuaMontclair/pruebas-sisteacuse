// Sirve el sitio compilado (sut/sitio) como lo hace Cloudflare Pages en
// producción: /planes → planes.html, y las rutas que no se prerenderizan
// (/registro, /gracias) caen en 200.html, el arranque de la SPA.
//
//   node scripts/servir-sitio.mjs [puerto]

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../sut/sitio/', import.meta.url));
const PUERTO = Number(process.argv[2] ?? 4173);

const TIPOS = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2',
	'.txt': 'text/plain; charset=utf-8',
	'.xml': 'application/xml',
	'.webmanifest': 'application/manifest+json'
};

async function archivo(ruta) {
	try {
		return (await stat(ruta)).isFile() ? ruta : null;
	} catch {
		return null;
	}
}

createServer(async (req, res) => {
	const { pathname } = new URL(req.url ?? '/', 'http://localhost');
	const pedido = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
	const base = join(RAIZ, pedido);
	const encontrado =
		(await archivo(base)) ??
		(await archivo(`${base.replace(/\/$/, '')}.html`)) ??
		(await archivo(join(base, 'index.html'))) ??
		join(RAIZ, '200.html');
	res.writeHead(200, { 'content-type': TIPOS[extname(encontrado)] ?? 'application/octet-stream' });
	res.end(await readFile(encontrado));
}).listen(PUERTO, () => console.log(`sitio en http://localhost:${PUERTO}`));
