import { Platform, requestUrl } from 'obsidian';
import type { HttpFn } from './api';
import { nodeRequest } from './node-http';

/** HTTP transport for the plugin, based on Obsidian's requestUrl (not subject to CORS). */
export const obsidianHttp: HttpFn = async (req) => {
	// Docmost returns the session token only as a Set-Cookie header. requestUrl
	// does not reliably expose that header, so on desktop the login request goes
	// through Node's http module instead.
	if (Platform.isDesktopApp && req.url.endsWith('/api/auth/login')) return nodeRequest(req);

	const res = await requestUrl({
		url: req.url,
		method: req.method,
		headers: req.headers,
		body: req.body,
		throw: false,
	});
	return { status: res.status, headers: res.headers, arrayBuffer: res.arrayBuffer };
};
