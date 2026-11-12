import { describe, expect, it } from 'vitest';
import { buildMultipart, DocmostClient, extractAuthToken, type HttpRequest } from '../src/api';

describe('DocmostClient with an API key', () => {
	it('sends the key as bearer token without logging in and unwraps data', async () => {
		const requests: HttpRequest[] = [];
		const json = JSON.stringify({ data: { user: { name: 'Kevin', email: 'k@example.com' } }, success: true });
		const client = new DocmostClient('https://docs.example.com/', { mode: 'apiKey', apiKey: 'key123' }, async (req) => {
			requests.push(req);
			return { status: 200, headers: {}, arrayBuffer: new TextEncoder().encode(json).buffer };
		});
		expect(await client.getCurrentUserName()).toBe('Kevin');
		expect(requests).toHaveLength(1);
		expect(requests[0]?.url).toBe('https://docs.example.com/api/users/me');
		expect(requests[0]?.headers.Authorization).toBe('Bearer key123');
	});

	it('surfaces the server error message', async () => {
		const json = JSON.stringify({ message: 'Unauthorized', statusCode: 401 });
		const client = new DocmostClient('https://d', { mode: 'apiKey', apiKey: 'bad' }, async () => ({
			status: 401,
			headers: {},
			arrayBuffer: new TextEncoder().encode(json).buffer,
		}));
		await expect(client.listSpaces()).rejects.toThrow('Unauthorized (HTTP 401)');
	});
});

describe('extractAuthToken', () => {
	it('finds the token among several cookies', () => {
		const header = 'mfaToken=; Max-Age=0; Path=/, authToken=eyJ.abc.def; Path=/; HttpOnly; SameSite=Lax';
		expect(extractAuthToken({ 'Set-Cookie': header })).toBe('eyJ.abc.def');
		expect(extractAuthToken({ 'set-cookie': ['mfaToken=; Path=/', 'authToken=tok; Path=/'] })).toBe('tok');
		expect(extractAuthToken({ 'content-type': 'application/json' })).toBeNull();
	});
});

describe('buildMultipart', () => {
	it('puts fields before the file', () => {
		const { body, contentType } = buildMultipart(
			{ pageId: 'p1' },
			{ name: 'file', fileName: 'a.png', mimeType: 'image/png', data: new TextEncoder().encode('DATA').buffer },
		);
		const boundary = contentType.split('boundary=')[1];
		const text = new TextDecoder().decode(body);
		expect(text).toBe(
			`--${boundary}\r\nContent-Disposition: form-data; name="pageId"\r\n\r\np1\r\n` +
				`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\nDATA\r\n` +
				`--${boundary}--\r\n`,
		);
	});
});
