import { describe, expect, it, vi } from 'vitest';
import type { DocmostClient, SidebarPage } from '../src/api';
import { attachmentFileName, decide, SyncEngine } from '../src/sync/engine';
import { hashBody } from '../src/sync/markdown';
import { emptyState, type SyncState } from '../src/sync/state';
import { MemoryFs } from './memory-fs';

describe('decide', () => {
	it('covers all four cases', () => {
		expect(decide(false, false)).toBe('none');
		expect(decide(true, false)).toBe('push');
		expect(decide(false, true)).toBe('pull');
		expect(decide(true, true)).toBe('conflict');
	});
});

describe('attachmentFileName', () => {
	it('keeps the name and adds a short id suffix', () => {
		expect(attachmentFileName('01a1d06d-9ad7-728d-a728-6bd2ebe9889f', 'my:photo.png')).toBe('my photo-ebe9889f.png');
		expect(attachmentFileName('01a1d06d-9ad7-728d-a728-6bd2ebe9889f', 'README')).toBe('README-ebe9889f');
	});
});

describe('SyncEngine with notes that are being edited', () => {
	const space = { id: 's1', name: 'Space', slug: 'space' };
	const path = 'Docmost/Space/Page.md';
	const node: SidebarPage = {
		id: 'p1',
		slugId: 'abc',
		title: 'Page',
		parentPageId: null,
		position: 'a0',
		updatedAt: 't1',
		hasChildren: false,
	};

	function setup(remoteNodes: SidebarPage[]) {
		const fs = new MemoryFs();
		const state = emptyState();
		const client = {
			baseUrl: 'https://docs.example.com',
			listChildren: vi.fn(async () => remoteNodes),
			updatePage: vi.fn(async (pageId: string, update: { markdown?: string }) => ({
				id: pageId,
				slugId: 'abc',
				title: 'Page',
				spaceId: 's1',
				parentPageId: null,
				updatedAt: 't2',
				content: update.markdown ?? '',
			})),
			createPage: vi.fn(),
		};
		const engine = new SyncEngine(client as unknown as DocmostClient, fs, state, 'Docmost');
		return { fs, state, client, engine };
	}

	/** A linked note whose last synced body was "Old"; `body` is its current content. */
	function linkedNote(fs: MemoryFs, state: SyncState, body: string) {
		fs.files.set(path, `---\ndocmost_id: "p1"\n---\n${body}`);
		fs.mtimes.set(path, 1000);
		state.pages.p1 = { spaceId: 's1', path, remotePath: path, remoteUpdatedAt: 't1', hash: hashBody('Old\n') };
	}

	it('pushes a recently edited note only once it is no longer being edited', async () => {
		const { fs, state, client, engine } = setup([node]);
		linkedNote(fs, state, 'New\n');

		expect(await engine.sync([space], { skipModifiedAfter: 500 })).toMatchObject({ pushed: 0, errors: [] });
		expect(client.updatePage).not.toHaveBeenCalled();

		expect(await engine.sync([space], { skipModifiedAfter: 2000 })).toMatchObject({ pushed: 1, errors: [] });
		expect(client.updatePage).toHaveBeenCalledOnce();
	});

	it('does not create a page for a new note that is being edited', async () => {
		const { fs, client, engine } = setup([]);
		fs.files.set('Docmost/Space/Draft.md', 'Draft\n');
		fs.mtimes.set('Docmost/Space/Draft.md', 1000);

		expect(await engine.sync([space], { skipModifiedAfter: 500 })).toMatchObject({ created: 0, errors: [] });
		expect(client.createPage).not.toHaveBeenCalled();
	});

	it('does not trash a note that is being edited when its page was deleted in Docmost', async () => {
		const { fs, state, engine } = setup([]);
		linkedNote(fs, state, 'Old\n');

		expect(await engine.sync([space], { skipModifiedAfter: 500 })).toMatchObject({ deleted: 0, kept: [] });
		expect(fs.files.has(path)).toBe(true);
		expect(state.pages.p1).toBeDefined();

		expect(await engine.sync([space])).toMatchObject({ deleted: 1 });
		expect(fs.trashed).toEqual([path]);
	});
});

describe('SyncEngine removes attachments of deleted pages', () => {
	const space = { id: 's1', name: 'Space', slug: 'space' };
	const path = 'Docmost/Space/Page.md';
	const image = 'Docmost/Space/_attachments/pic-1234abcd.png';
	const body = `![pic](Docmost/Space/_attachments/pic-1234abcd.png)\n`;

	/** The page of `path` was deleted in Docmost; its note still links to `image`. */
	function setup(noteBody = body) {
		const fs = new MemoryFs();
		const state = emptyState();
		fs.files.set(path, `---\ndocmost_id: "p1"\n---\n${noteBody}`);
		fs.files.set(image, new ArrayBuffer(1));
		state.pages.p1 = { spaceId: 's1', path, remotePath: path, remoteUpdatedAt: 't1', hash: hashBody(body) };
		state.attachments.a1 = { path: image, url: '/api/files/a1/pic.png' };
		const client = { baseUrl: 'https://docs.example.com', listChildren: vi.fn(async () => []) };
		const engine = new SyncEngine(client as unknown as DocmostClient, fs, state, 'Docmost');
		return { fs, state, engine };
	}

	it('trashes an attachment no other note links to', async () => {
		const { fs, state, engine } = setup();
		expect(await engine.sync([space])).toMatchObject({ deleted: 1, errors: [] });
		expect(fs.trashed).toEqual([path, image]);
		expect(state.attachments).toEqual({});
	});

	it('keeps an attachment that another note links to, also outside the space folders', async () => {
		const { fs, state, engine } = setup();
		fs.files.set('Journal/Today.md', 'See ![[pic-1234abcd.png]]\n');
		expect(await engine.sync([space])).toMatchObject({ deleted: 1, errors: [] });
		expect(fs.trashed).toEqual([path]);
		expect(state.attachments.a1).toBeDefined();
	});

	it('never trashes files the sync does not track', async () => {
		const { fs, state, engine } = setup();
		delete state.attachments.a1;
		await engine.sync([space]);
		expect(fs.trashed).toEqual([path]);
		expect(fs.files.has(image)).toBe(true);
	});

	it('keeps the attachments of a locally modified note that is kept', async () => {
		const { fs, engine } = setup(`${body}\nLocal edit\n`);
		expect(await engine.sync([space])).toMatchObject({ deleted: 0, kept: [path] });
		expect(fs.trashed).toEqual([]);
		expect(fs.files.has(image)).toBe(true);
	});
});
