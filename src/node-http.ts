import type { HttpRequest, HttpResponse } from './api';

/** Node's http or https module. */
export type NodeHttp = Pick<typeof import('http'), 'request'>;

/** Performs a request with Node's http or https module (desktop only). */
export function nodeRequest(lib: NodeHttp, req: HttpRequest): Promise<HttpResponse> {
	return new Promise((resolve, reject) => {
		const request = lib.request(req.url, { method: req.method, headers: req.headers }, (res) => {
			const chunks: Buffer[] = [];
			res.on('data', (chunk: Buffer) => chunks.push(chunk));
			res.on('end', () => {
				const buf = Buffer.concat(chunks);
				resolve({
					status: res.statusCode ?? 0,
					headers: res.headers as Record<string, string | string[]>,
					arrayBuffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
				});
			});
			res.on('error', reject);
		});
		request.on('error', reject);
		if (req.body !== undefined) request.write(typeof req.body === 'string' ? req.body : Buffer.from(req.body));
		request.end();
	});
}
