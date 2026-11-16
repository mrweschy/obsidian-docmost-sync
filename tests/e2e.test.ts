// End-to-end test against a real Docmost server. Skipped unless configured:
//   DOCMOST_E2E_URL=http://localhost:3456 DOCMOST_E2E_EMAIL=... DOCMOST_E2E_PASSWORD=... npm test
// It creates (and finally deletes) its own space.
import http from 'node:http';
import https from 'node:https';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocmostClient, type HttpFn, type Space } from '../src/api';
import { nodeRequest } from '../src/node-http';
import { SyncEngine } from '../src/sync/engine';
import { getFrontmatterValue, parseNote } from '../src/sync/markdown';
import { emptyState } from '../src/sync/state';
import { MemoryFs } from './memory-fs';

const url = process.env.DOCMOST_E2E_URL;
const email = process.env.DOCMOST_E2E_EMAIL ?? '';
const password = process.env.DOCMOST_E2E_PASSWORD ?? '';

/** The Node transport the plugin uses for the login on desktop. */
const nodeHttp: HttpFn = (req) => nodeRequest(req.url.startsWith('https:') ? https : http, req);

const fetchHttp: HttpFn = async (req) => {
	const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
	const headers: Record<string, string | string[]> = {};
	res.headers.forEach((value, key) => (headers[key] = value));
	headers['set-cookie'] = res.headers.getSetCookie();
	return { status: res.status, headers, arrayBuffer: await res.arrayBuffer() };
};

// 1x1 PNG
const PNG = Uint8Array.from(
	atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
	(c) => c.charCodeAt(0),
).buffer;

describe.skipIf(!url)('Docmost login', () => {
	it('logs in through the Node transport used on desktop', async () => {
		const nodeClient = new DocmostClient(url ?? '', { mode: 'password', email, password }, nodeHttp);
		expect(await nodeClient.getCurrentUserName()).toBeTruthy();
	});

	it('reports wrong credentials', async () => {
		const bad = new DocmostClient(url ?? '', { mode: 'password', email, password: 'wrong-password' }, nodeHttp);
		await expect(bad.listSpaces()).rejects.toThrow(/Login failed/);
	});
});

describe.skipIf(!url)('sync against a real Docmost server', () => {
	const client = new DocmostClient(url ?? '', { mode: 'password', email, password }, fetchHttp);
	const fs = new MemoryFs();
	const state = emptyState();
	const engine = new SyncEngine(client, fs, state, 'Docmost', () => new Date('2026-11-12T10:30:00Z'));
	const runId = Date.now().toString(36);
	let space: Space;
	let parentId: string;
	let childId: string;
	let folder: string;

	const sync = () => engine.sync([space]);
	const body = (path: string) => parseNote(fs.text(path)).body;
	const editBody = (path: string, edit: (body: string) => string) => {
		const note = parseNote(fs.text(path));
		fs.files.set(path, fs.text(path).replace(note.body, edit(note.body)));
	};

	beforeAll(async () => {
		space = await client.post<Space>('spaces/create', { name: `E2E ${runId}`, slug: `e2e${runId}` });
		folder = `Docmost/E2E ${runId}`;
		const parent = await client.createPage(space.id, null, 'Parent', 'Parent text');
		parentId = parent.id;
		const attachment = await client.uploadFile(parentId, 'pixel.png', PNG, 'image/png');
		await client.updatePage(parentId, { markdown: `Parent text\n\n![pixel](/api/files/${attachment.id}/pixel.png)` });
		childId = (await client.createPage(space.id, parentId, 'Child: A/B', 'Child text')).id;
	});

	afterAll(async () => {
		if (space) await client.post('spaces/delete', { spaceId: space.id });
	});

	it('pulls the tree, frontmatter and images', async () => {
		const result = await sync();
		expect(result.errors).toEqual([]);
		expect(result.pulled).toBe(2);

		const parentNote = parseNote(fs.text(`${folder}/Parent.md`));
		expect(getFrontmatterValue(parentNote.frontmatter, 'docmost_id')).toBe(parentId);
		expect(getFrontmatterValue(parentNote.frontmatter, 'docmost_url')).toContain(`/s/${space.slug}/p/`);
		const image = [...fs.files.keys()].find((p) => p.startsWith(`${folder}/_attachments/pixel-`));
		expect(image).toBeDefined();
		expect(new Uint8Array(await fs.readBinary(image as string))).toEqual(new Uint8Array(PNG));
		expect(parentNote.body).toContain(`](${(image as string).replace(/ /g, '%20')})`);

		expect(body(`${folder}/Parent/Child A B.md`)).toContain('Child text');
	});

	it('is stable when nothing changed', async () => {
		const result = await sync();
		expect(result).toMatchObject({ pulled: 0, pushed: 0, created: 0, deleted: 0, errors: [] });
	});

	it('pushes local edits (keeping images intact)', async () => {
		editBody(`${folder}/Parent.md`, (b) => b.replace('Parent text', 'Parent text edited locally'));
		const result = await sync();
		expect(result.errors).toEqual([]);
		expect(result.pushed).toBe(1);
		const remote = await client.getPage(parentId);
		expect(remote.content).toContain('Parent text edited locally');
		expect(remote.content).toMatch(/!\[pixel\]\(\/api\/files\/[0-9a-f-]{36}\/pixel\.png\)/);
		expect(await sync()).toMatchObject({ pulled: 0, pushed: 0 });
	});

	it('pulls remote edits', async () => {
		await client.updatePage(childId, { markdown: 'Child text edited remotely' });
		const result = await sync();
		expect(result).toMatchObject({ pulled: 1, pushed: 0, errors: [] });
		expect(body(`${folder}/Parent/Child A B.md`)).toContain('Child text edited remotely');
	});

	it('keeps a conflict copy when both sides changed', async () => {
		await client.updatePage(childId, { markdown: 'Remote wins' });
		editBody(`${folder}/Parent/Child A B.md`, () => 'Local loses\n');
		const result = await sync();
		expect(result.errors).toEqual([]);
		expect(result.conflicts).toEqual([`${folder}/Parent/Child A B (conflict 2026-11-12 1030).md`]);
		expect(body(`${folder}/Parent/Child A B.md`)).toContain('Remote wins');
		const copy = parseNote(fs.text(result.conflicts[0] as string));
		expect(copy.body).toBe('Local loses\n');
		expect(getFrontmatterValue(copy.frontmatter, 'docmost_id')).toBeUndefined();
		expect(await sync()).toMatchObject({ pulled: 0, pushed: 0, created: 0, conflicts: [] });
	});

	it('creates Docmost pages for new local notes, uploading embedded images', async () => {
		fs.files.set('pic.png', PNG);
		fs.files.set(`${folder}/Parent/New note.md`, 'Hello from Obsidian\n\n![[pic.png]]\n');
		const result = await sync();
		expect(result.errors).toEqual([]);
		expect(result.created).toBe(1);

		const id = getFrontmatterValue(parseNote(fs.text(`${folder}/Parent/New note.md`)).frontmatter, 'docmost_id');
		const remote = await client.getPage(id as string);
		expect(remote.title).toBe('New note');
		expect(remote.parentPageId).toBe(parentId);
		expect(remote.content).toContain('Hello from Obsidian');
		expect(remote.content).toMatch(/\/api\/files\/[0-9a-f-]{36}\/pic\.png/);
		expect(await sync()).toMatchObject({ pulled: 0, pushed: 0, created: 0 });
	});

	it('pushes a local rename as the new title', async () => {
		await fs.rename(`${folder}/Parent/Child A B.md`, `${folder}/Parent/Child renamed.md`);
		const result = await sync();
		expect(result.errors).toEqual([]);
		expect((await client.getPage(childId)).title).toBe('Child renamed');
		expect(await fs.exists(`${folder}/Parent/Child renamed.md`)).toBe(true);
		expect(await sync()).toMatchObject({ pulled: 0, pushed: 0 });
	});

	it('follows a rename in Docmost, moving the children too', async () => {
		// Resolve the earlier conflict so the old folder can become empty.
		fs.files.delete(`${folder}/Parent/Child A B (conflict 2026-11-12 1030).md`);
		await client.updatePage(parentId, { title: 'Parent 2' });
		const result = await sync();
		expect(result.errors).toEqual([]);
		expect(await fs.exists(`${folder}/Parent 2.md`)).toBe(true);
		expect(await fs.exists(`${folder}/Parent 2/Child renamed.md`)).toBe(true);
		expect(await fs.exists(`${folder}/Parent 2/New note.md`)).toBe(true);
		expect(await fs.exists(`${folder}/Parent.md`)).toBe(false);
		expect(fs.removedFolders).toContain(`${folder}/Parent`);
		expect(await sync()).toMatchObject({ pulled: 0, pushed: 0 });
	});

	it('removes unchanged notes whose page was deleted in Docmost', async () => {
		await client.post('pages/delete', { pageId: childId });
		const result = await sync();
		expect(result).toMatchObject({ deleted: 1, errors: [] });
		expect(fs.trashed).toEqual([`${folder}/Parent 2/Child renamed.md`]);
		expect(await sync()).toMatchObject({ pulled: 0, pushed: 0, deleted: 0, created: 0 });
	});

	it('keeps Docmost PDF blocks as PDF embeds in both directions', async () => {
		const page = await client.createPage(space.id, null, 'PDF page', 'placeholder');
		const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF\n').buffer as ArrayBuffer;
		const file = await client.uploadFile(page.id, 'doc.pdf', pdf, 'application/pdf');
		const url = `/api/files/${file.id}/doc.pdf`;
		await client.updatePage(page.id, {
			markdown: `PDF:\n\n<div data-type="pdf" src="${url}" data-name="doc.pdf" data-attachment-id="${file.id}"></div>\n\nEnd`,
		});

		expect(await sync()).toMatchObject({ pulled: 1, errors: [] });
		const path = `${folder}/PDF page.md`;
		expect(body(path)).toMatch(/^PDF:\n\n!\[doc\.pdf\]\(Docmost\/E2E%20\w+\/_attachments\/doc-\w{8}\.pdf\)\n\nEnd\n$/);

		editBody(path, (b) => b.replace('End', 'End, edited locally'));
		expect(await sync()).toMatchObject({ pushed: 1, errors: [] });
		const html = await client.post<{ content: string }>('pages/info', { pageId: page.id, format: 'html' });
		expect(html.content).toContain('data-type="pdf"');
		expect(html.content).toContain(`data-attachment-id="${file.id}"`);
		expect(html.content).toContain('End, edited locally');
		expect(await sync()).toMatchObject({ pulled: 0, pushed: 0, errors: [] });
	});
});
