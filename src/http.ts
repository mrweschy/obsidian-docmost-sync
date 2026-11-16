import { Platform, requestUrl } from 'obsidian';
import type { HttpFn } from './api';
import { type NodeHttp, nodeRequest } from './node-http';

/** HTTP transport for the plugin, based on Obsidian's requestUrl (not subject to CORS). */
export const obsidianHttp: HttpFn = async (req) => {
	// Docmost returns the session token only as a Set-Cookie header. requestUrl
	// does not reliably expose that header, so on desktop the login request goes
	// through Node's http module instead. Node's modules only exist in the desktop app.
	if (Platform.isDesktopApp && req.url.endsWith('/api/auth/login')) {
		const lib = (/^https:/i.test(req.url) ? require('https') : require('http')) as NodeHttp;
		return nodeRequest(lib, req);
	}

	const res = await requestUrl({
		url: req.url,
		method: req.method,
		headers: req.headers,
		body: req.body,
		throw: false,
	});
	return { status: res.status, headers: res.headers, arrayBuffer: res.arrayBuffer };
};
