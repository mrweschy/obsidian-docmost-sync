import type { HttpRequest, HttpResponse } from './api';

/** Performs a request with Node's http/https modules (desktop only). */
export function nodeRequest(req: HttpRequest): Promise<HttpResponse> {
	// Loaded lazily: Node modules only exist in the desktop app.
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const lib: typeof import('http') = req.url.startsWith('https:') ? require('https') : require('http');
	return new Promise((resolve, reject) => {
		const request = lib.request(req.url, { method: req.method, headers: req.headers }, (res) => {
			const chunks: Buffer[] = [];
			res.on('data', (chunk: Buffer) => chunks.push(chunk));
			res.on('end', () => {
				const buf = Buffer.concat(chunks);
				resolve({
					status: res.statusCode ?? 0,
					headers: res.headers as Record<string, string | string[]>,
					arrayBuffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
				});
			});
			res.on('error', reject);
		});
		request.on('error', reject);
		if (req.body !== undefined) request.write(typeof req.body === 'string' ? req.body : Buffer.from(req.body));
		request.end();
	});
}
