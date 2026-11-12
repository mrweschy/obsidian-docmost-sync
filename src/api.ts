// Minimal client for the Docmost REST API (all endpoints are POST under /api,
// responses are wrapped as { data, success, status }).

export interface HttpRequest {
	url: string;
	method: 'GET' | 'POST';
	headers: Record<string, string>;
	body?: string | ArrayBuffer;
}

export interface HttpResponse {
	status: number;
	headers: Record<string, string | string[]>;
	arrayBuffer: ArrayBuffer;
}

/** Transport abstraction: Obsidian's requestUrl in the plugin, fetch in tests. */
export type HttpFn = (req: HttpRequest) => Promise<HttpResponse>;

export type AuthConfig =
	| { mode: 'apiKey'; apiKey: string }
	| { mode: 'password'; email: string; password: string };

export interface Space {
	id: string;
	name: string;
	slug: string;
}

export interface SidebarPage {
	id: string;
	slugId: string;
	title: string | null;
	parentPageId: string | null;
	position: string;
	updatedAt: string;
	hasChildren: boolean;
}

export interface PageDetails {
	id: string;
	slugId: string;
	title: string | null;
	spaceId: string;
	parentPageId: string | null;
	updatedAt: string;
	/** Markdown, because every request asks for format "markdown". */
	content: string;
}

export interface Attachment {
	id: string;
	fileName: string;
}

export class DocmostError extends Error {
	constructor(message: string, readonly status?: number) {
		super(message);
		this.name = 'DocmostError';
	}
}

interface CursorPage<T> {
	items: T[];
	meta: { hasNextPage: boolean; nextCursor: string | null };
}

const PAGE_LIMIT = 100;

export class DocmostClient {
	readonly baseUrl: string;
	private token: string | null = null;

	constructor(
		baseUrl: string,
		private readonly auth: AuthConfig,
		private readonly http: HttpFn,
	) {
		this.baseUrl = baseUrl.trim().replace(/\/+$/, '');
		if (auth.mode === 'apiKey') this.token = auth.apiKey;
	}

	/** Returns the display name of the authenticated user (used to test the connection). */
	async getCurrentUserName(): Promise<string> {
		const data = await this.post<{ user: { name: string; email: string } }>('users/me', {});
		return data.user.name || data.user.email;
	}

	async listSpaces(): Promise<Space[]> {
		return this.paginate<Space>('spaces', {});
	}

	/** Direct children of a page, or the root pages of a space if pageId is omitted. */
	async listChildren(spaceId: string, pageId?: string): Promise<SidebarPage[]> {
		return this.paginate<SidebarPage>('pages/sidebar-pages', pageId ? { spaceId, pageId } : { spaceId });
	}

	async getPage(pageId: string): Promise<PageDetails> {
		const page = await this.post<PageDetails>('pages/info', { pageId, format: 'markdown' });
		return normalizePage(page);
	}

	async updatePage(pageId: string, update: { title?: string; markdown?: string }): Promise<PageDetails> {
		const body: Record<string, unknown> = { pageId };
		if (update.title !== undefined) body.title = update.title;
		if (update.markdown !== undefined) {
			body.content = update.markdown;
			body.operation = 'replace';
		}
		// Always ask for markdown so the response carries the normalized content.
		body.format = 'markdown';
		const page = await this.post<PageDetails>('pages/update', body);
		return normalizePage(page);
	}

	async createPage(spaceId: string, parentPageId: string | null, title: string, markdown: string): Promise<PageDetails> {
		const body: Record<string, unknown> = { spaceId, title };
		if (parentPageId) body.parentPageId = parentPageId;
		if (markdown) Object.assign(body, { content: markdown, format: 'markdown' });
		const page = await this.post<PageDetails>('pages/create', body);
		// The create response does not necessarily contain markdown content.
		return normalizePage({ ...page, content: typeof page.content === 'string' ? page.content : markdown });
	}

	/** Downloads a file by its Docmost URL (absolute or relative like /api/files/...). */
	async downloadFile(url: string): Promise<ArrayBuffer> {
		const absolute = url.startsWith('/') ? this.baseUrl + url : url;
		const res = await this.send(() => ({ url: absolute, method: 'GET', headers: this.authHeaders() }));
		return res.arrayBuffer;
	}

	async uploadFile(pageId: string, fileName: string, data: ArrayBuffer, mimeType: string): Promise<Attachment> {
		const { body, contentType } = buildMultipart({ pageId }, { name: 'file', fileName, mimeType, data });
		const res = await this.send(() => ({
			url: `${this.baseUrl}/api/files/upload`,
			method: 'POST',
			headers: { ...this.authHeaders(), 'Content-Type': contentType },
			body,
		}));
		// This endpoint returns the attachment without the usual { data } wrapper.
		const json = safeJson(responseText(res)) as (Attachment & { data?: Attachment }) | null;
		const attachment = json?.data ?? json;
		if (!attachment?.id) throw new DocmostError('Unexpected upload response from Docmost.', res.status);
		return attachment;
	}

	async post<T>(path: string, body: object): Promise<T> {
		const res = await this.send(() => ({
			url: `${this.baseUrl}/api/${path}`,
			method: 'POST',
			headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		}));
		return unwrap<T>(res);
	}

	private async paginate<T>(path: string, body: object): Promise<T[]> {
		const all: T[] = [];
		let cursor: string | null = null;
		do {
			const page: CursorPage<T> = await this.post<CursorPage<T>>(path, {
				...body,
				limit: PAGE_LIMIT,
				...(cursor ? { cursor } : {}),
			});
			all.push(...page.items);
			cursor = page.meta.hasNextPage ? page.meta.nextCursor : null;
		} while (cursor);
		return all;
	}

	/** Sends a request, logging in first (password mode) and once more on 401. */
	private async send(build: () => HttpRequest): Promise<HttpResponse> {
		if (!this.token) await this.login();
		let res = await this.http(build());
		if (res.status === 401 && this.auth.mode === 'password') {
			await this.login();
			res = await this.http(build());
		}
		if (res.status >= 400) throw new DocmostError(errorMessage(res), res.status);
		return res;
	}

	private async login(): Promise<void> {
		if (this.auth.mode !== 'password') throw new DocmostError('No API key configured.');
		const res = await this.http({
			url: `${this.baseUrl}/api/auth/login`,
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email: this.auth.email, password: this.auth.password }),
		});
		if (res.status >= 400) throw new DocmostError(`Login failed: ${errorMessage(res)}`, res.status);

		const token = extractAuthToken(res.headers);
		if (!token) {
			const data = safeJson(responseText(res)) as { data?: { userHasMfa?: boolean; requiresMfaSetup?: boolean } } | null;
			if (data?.data?.userHasMfa || data?.data?.requiresMfaSetup) {
				throw new DocmostError('MFA is not supported for password login. Please use an API key.');
			}
			throw new DocmostError('Login succeeded but Docmost returned no auth token. Please use an API key instead.');
		}
		this.token = token;
	}

	private authHeaders(): Record<string, string> {
		return this.token ? { Authorization: `Bearer ${this.token}` } : {};
	}
}

/** Reads the authToken cookie from (possibly joined) Set-Cookie headers. */
export function extractAuthToken(headers: Record<string, string | string[]>): string | null {
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() !== 'set-cookie') continue;
		const joined = Array.isArray(value) ? value.join('\n') : value;
		const match = /(?:^|[\s,;])authToken=([^;,\s]+)/.exec(joined);
		if (match?.[1]) return decodeURIComponent(match[1]);
	}
	return null;
}

export function buildMultipart(
	fields: Record<string, string>,
	file: { name: string; fileName: string; mimeType: string; data: ArrayBuffer },
): { body: ArrayBuffer; contentType: string } {
	const boundary = `----DocmostSync${Math.random().toString(16).slice(2)}`;
	const encoder = new TextEncoder();
	const parts: Uint8Array[] = [];
	// Fields must come before the file: Docmost only sees fields parsed ahead of it.
	for (const [name, value] of Object.entries(fields)) {
		parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
	}
	const safeName = file.fileName.replace(/["\r\n]/g, '_');
	parts.push(
		encoder.encode(
			`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${safeName}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`,
		),
	);
	parts.push(new Uint8Array(file.data));
	parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));

	const total = parts.reduce((sum, p) => sum + p.byteLength, 0);
	const body = new Uint8Array(total);
	let offset = 0;
	for (const p of parts) {
		body.set(p, offset);
		offset += p.byteLength;
	}
	return { body: body.buffer, contentType: `multipart/form-data; boundary=${boundary}` };
}

function normalizePage(page: PageDetails): PageDetails {
	return { ...page, content: typeof page.content === 'string' ? page.content : '' };
}

function responseText(res: HttpResponse): string {
	return new TextDecoder().decode(res.arrayBuffer);
}

function unwrap<T>(res: HttpResponse): T {
	// Endpoints without a result return just { success, status }.
	const json = safeJson(responseText(res)) as { data?: T; success?: boolean } | null;
	if (!json || !('data' in json || json.success === true)) {
		throw new DocmostError('Unexpected response from Docmost.', res.status);
	}
	return json.data as T;
}

function errorMessage(res: HttpResponse): string {
	const json = safeJson(responseText(res)) as { message?: string | string[] } | null;
	const message = Array.isArray(json?.message) ? json?.message.join(', ') : json?.message;
	return message ? `${message} (HTTP ${res.status})` : `HTTP ${res.status}`;
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}
