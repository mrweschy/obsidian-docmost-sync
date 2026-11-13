import type { DocmostClient, PageDetails, SidebarPage, Space } from '../api';
import { basename, childFolder, computePaths, dirname, joinPath, noteName, sanitizeName } from './paths';
import {
	buildNote,
	getFrontmatterValue,
	hashBody,
	localizeLinks,
	type Note,
	normalizeBody,
	parseNote,
	remoteizeLinks,
} from './markdown';
import type { PageState, SyncState } from './state';

export const ATTACHMENTS_FOLDER = '_attachments';

/** The vault operations the engine needs (implemented with Obsidian's Vault API in the plugin). */
export interface SyncFs {
	/** All .md files below `folder`, recursively. */
	listMarkdown(folder: string): Promise<string[]>;
	read(path: string): Promise<string>;
	/** Creates or overwrites a file, creating parent folders as needed. */
	write(path: string, content: string): Promise<void>;
	readBinary(path: string): Promise<ArrayBuffer>;
	writeBinary(path: string, data: ArrayBuffer): Promise<void>;
	exists(path: string): Promise<boolean>;
	/** Last modification time of a file in milliseconds since the epoch. */
	modifiedAt(path: string): Promise<number>;
	/** Moves a file, creating parent folders as needed. */
	rename(from: string, to: string): Promise<void>;
	trash(path: string): Promise<void>;
	/** Deletes the folder if it exists and is empty; returns whether it was deleted. */
	removeFolderIfEmpty(folder: string): Promise<boolean>;
	/** Resolves a link target as written in `sourcePath` to an existing vault file. */
	resolveLink(target: string, sourcePath: string): string | null;
}

export interface SyncResult {
	pulled: number;
	pushed: number;
	created: number;
	deleted: number;
	conflicts: string[];
	/** Locally modified notes whose page was deleted in Docmost. */
	kept: string[];
	errors: string[];
}

export interface SyncOptions {
	/**
	 * Notes modified after this time (ms since the epoch) are left alone in this sync,
	 * so an automatic sync never writes into a note that is being edited.
	 */
	skipModifiedAfter?: number;
}

export type Decision = 'none' | 'pull' | 'push' | 'conflict';

export function decide(localChanged: boolean, remoteChanged: boolean): Decision {
	if (localChanged && remoteChanged) return 'conflict';
	if (localChanged) return 'push';
	if (remoteChanged) return 'pull';
	return 'none';
}

interface LocalNote {
	path: string;
	note: Note;
}

type RemoteNode = SidebarPage;

export class SyncEngine {
	private result: SyncResult = emptyResult();
	/** docmost_id -> local note, built once per sync. */
	private byId = new Map<string, LocalNote>();
	/** Local notes without docmost_id (candidates for new Docmost pages). */
	private unlinked: LocalNote[] = [];
	/** local path -> docmost_id, kept current during the sync. */
	private idByPath = new Map<string, string>();
	/** Folders the sync moved or deleted files out of (cleaned up if left empty). */
	private vacated = new Set<string>();
	/** Paths of notes skipped in this sync because they are being edited. */
	private busy = new Set<string>();

	constructor(
		private readonly client: DocmostClient,
		private readonly fs: SyncFs,
		private readonly state: SyncState,
		private readonly rootFolder: string,
		private readonly now: () => Date = () => new Date(),
	) {}

	async sync(spaces: Space[], options: SyncOptions = {}): Promise<SyncResult> {
		this.result = emptyResult();
		await this.indexLocalNotes(options.skipModifiedAfter);
		for (const space of spaces) {
			try {
				await this.syncSpace(space);
			} catch (err) {
				this.result.errors.push(`${space.name}: ${errorText(err)}`);
			}
		}
		return this.result;
	}

	private async indexLocalNotes(skipModifiedAfter?: number): Promise<void> {
		this.byId.clear();
		this.idByPath.clear();
		this.unlinked = [];
		this.busy.clear();
		for (const path of await this.fs.listMarkdown(this.rootFolder)) {
			if (path.split('/').includes(ATTACHMENTS_FOLDER)) continue;
			const note = parseNote(await this.fs.read(path));
			if (getFrontmatterValue(note.frontmatter, 'docmost_conflict') === 'true') continue;
			if (skipModifiedAfter !== undefined && (await this.fs.modifiedAt(path)) > skipModifiedAfter) this.busy.add(path);
			const id = getFrontmatterValue(note.frontmatter, 'docmost_id');
			if (!id) {
				this.unlinked.push({ path, note });
			} else if (!this.byId.has(id) || this.state.pages[id]?.path === path) {
				this.byId.set(id, { path, note });
				this.idByPath.set(path, id);
			}
		}
	}

	private async syncSpace(space: Space): Promise<void> {
		const spaceFolder = joinPath(this.rootFolder, sanitizeName(space.name));
		// The whole tree is loaded before anything is changed, so a failed
		// request can never be mistaken for deleted pages.
		const tree = await this.fetchTree(space.id);
		const remotePaths = computePaths(spaceFolder, tree);

		for (const node of tree) {
			const remotePath = remotePaths.get(node.id) as string;
			try {
				await this.syncPage(space, spaceFolder, node, remotePath);
			} catch (err) {
				this.result.errors.push(`${remotePath}: ${errorText(err)}`);
			}
		}

		await this.handleRemoteDeletions(space, new Set(tree.map((n) => n.id)));

		const newNotes = this.unlinked
			.filter((n) => n.path.startsWith(spaceFolder + '/') && !this.busy.has(n.path))
			.sort((a, b) => a.path.split('/').length - b.path.split('/').length);
		for (const local of newNotes) {
			try {
				await this.createRemotePage(space, spaceFolder, local);
			} catch (err) {
				this.result.errors.push(`${local.path}: ${errorText(err)}`);
			}
		}

		await this.removeVacatedFolders(spaceFolder);
	}

	private async removeVacatedFolders(spaceFolder: string): Promise<void> {
		const deepestFirst = [...this.vacated].sort((a, b) => b.length - a.length);
		this.vacated.clear();
		for (let dir of deepestFirst) {
			while (dir.startsWith(spaceFolder + '/') && (await this.fs.removeFolderIfEmpty(dir))) dir = dirname(dir);
		}
	}

	private async fetchTree(spaceId: string, parentId?: string): Promise<RemoteNode[]> {
		const nodes: RemoteNode[] = [];
		for (const node of await this.client.listChildren(spaceId, parentId)) {
			nodes.push(node);
			if (node.hasChildren) nodes.push(...(await this.fetchTree(spaceId, node.id)));
		}
		return nodes;
	}

	private async syncPage(space: Space, spaceFolder: string, node: RemoteNode, remotePath: string): Promise<void> {
		const st = this.state.pages[node.id];
		const local = this.byId.get(node.id);

		if (local && this.busy.has(local.path)) return; // being edited; a later sync handles it
		if (!local) {
			// New in Docmost, or the local file was deleted: (re)download it.
			await this.pull(space, spaceFolder, node.id, await this.freePath(remotePath, node.id), [], remotePath);
			this.result.pulled++;
			return;
		}
		if (!st) {
			// Linked note without sync state (e.g. data.json was reset): Docmost wins,
			// but a differing local version is kept as a conflict copy.
			await this.pull(space, spaceFolder, node.id, local.path, local.note.frontmatter, remotePath, local.note.body);
			this.result.pulled++;
			return;
		}

		let path = local.path;
		const remoteMoved = remotePath !== st.remotePath;
		const renamedLocally = noteName(path) !== noteName(st.path);

		if (remoteMoved && path !== remotePath) {
			// Moved or renamed in Docmost: follow it (Docmost wins over local moves).
			const target = await this.freePath(remotePath, node.id);
			await this.fs.rename(path, target);
			this.vacated.add(dirname(path));
			this.idByPath.delete(path);
			this.idByPath.set(target, node.id);
			path = target;
		}
		const newTitle = !remoteMoved && renamedLocally ? noteName(path) : undefined;

		const decision = decide(hashBody(local.note.body) !== st.hash, node.updatedAt !== st.remoteUpdatedAt);
		if (decision === 'push') {
			await this.push(space, spaceFolder, node.id, path, local.note, newTitle);
			this.result.pushed++;
		} else {
			if (decision === 'conflict') await this.writeConflictCopy(path, local.note);
			if (decision !== 'none') {
				await this.pull(space, spaceFolder, node.id, path, local.note.frontmatter, remotePath);
				this.result.pulled++;
			}
			if (newTitle !== undefined) {
				const page = await this.client.updatePage(node.id, { title: newTitle });
				this.pageState(node.id).remoteUpdatedAt = page.updatedAt;
				this.result.pushed++;
			}
		}

		const ps = this.pageState(node.id);
		ps.path = path;
		ps.remotePath = newTitle !== undefined ? joinPath(dirname(remotePath), `${sanitizeName(newTitle)}.md`) : remotePath;
	}

	private async handleRemoteDeletions(space: Space, remoteIds: Set<string>): Promise<void> {
		for (const [id, st] of Object.entries(this.state.pages)) {
			if (st.spaceId !== space.id || remoteIds.has(id)) continue;
			const local = this.byId.get(id);
			if (local && this.busy.has(local.path)) continue; // keep the state, decide in a later sync
			if (local && hashBody(local.note.body) === st.hash) {
				await this.fs.trash(local.path);
				this.vacated.add(dirname(local.path));
				this.result.deleted++;
			} else if (local) {
				this.result.kept.push(local.path);
			}
			delete this.state.pages[id];
		}
	}

	private async createRemotePage(space: Space, spaceFolder: string, local: LocalNote): Promise<void> {
		const title = noteName(local.path);
		const parentId = this.findParentId(local.path, spaceFolder);
		const page = await this.client.createPage(space.id, parentId, title, '');

		// Link the note right away so a failure below cannot create a duplicate page next time.
		await this.fs.write(local.path, buildNote(local.note.frontmatter, this.linkKeys(space, page), local.note.body));
		this.idByPath.set(local.path, page.id);
		const parentState = parentId ? this.state.pages[parentId] : undefined;
		const folder = parentState ? childFolder(parentState.remotePath) : spaceFolder;
		this.state.pages[page.id] = {
			spaceId: space.id,
			path: local.path,
			remotePath: joinPath(folder, `${sanitizeName(title)}.md`),
			remoteUpdatedAt: page.updatedAt,
			hash: '', // forces a push of the content if the step below fails
		};

		await this.push(space, spaceFolder, page.id, local.path, local.note);
		this.result.created++;
	}

	/** Parent = nearest folder note ("X.md" next to folder "X/") that is linked to Docmost. */
	private findParentId(path: string, spaceFolder: string): string | null {
		for (let dir = dirname(path); dir.startsWith(spaceFolder + '/'); dir = dirname(dir)) {
			const id = this.idByPath.get(`${dir}.md`);
			if (id) return id;
		}
		return null;
	}

	private async pull(
		space: Space,
		spaceFolder: string,
		pageId: string,
		path: string,
		frontmatter: string[],
		remotePath: string,
		conflictCheckBody?: string,
	): Promise<void> {
		const page = await this.client.getPage(pageId);
		const body = await this.localize(page.content, spaceFolder);
		if (conflictCheckBody !== undefined && normalizeBody(conflictCheckBody) !== normalizeBody(body)) {
			await this.writeConflictCopy(path, { frontmatter, body: conflictCheckBody });
		}
		await this.fs.write(path, buildNote(frontmatter, this.linkKeys(space, page), withNewline(body)));
		this.idByPath.set(path, pageId);
		this.state.pages[pageId] = {
			spaceId: space.id,
			path,
			remotePath,
			remoteUpdatedAt: page.updatedAt,
			hash: hashBody(body),
		};
	}

	private async push(
		space: Space,
		spaceFolder: string,
		pageId: string,
		path: string,
		note: Note,
		title?: string,
	): Promise<void> {
		const markdown = await this.remoteize(note.body, path, pageId);
		const page = await this.client.updatePage(pageId, { title, markdown });
		// Store what Docmost made of the content, so formatting differences do not
		// show up as changes on the next sync.
		const body = await this.localize(page.content, spaceFolder);
		await this.fs.write(path, buildNote(note.frontmatter, this.linkKeys(space, page), withNewline(body)));
		const ps = this.pageState(pageId);
		ps.hash = hashBody(body);
		ps.remoteUpdatedAt = page.updatedAt;
	}

	private async writeConflictCopy(path: string, note: Note): Promise<void> {
		const stamp = this.now().toISOString().slice(0, 16).replace('T', ' ').replace(':', '');
		const target = await this.freePath(joinPath(dirname(path), `${noteName(path)} (conflict ${stamp}).md`));
		const content = buildNote(
			note.frontmatter,
			{ docmost_id: null, docmost_url: null, docmost_conflict: true },
			note.body,
		);
		await this.fs.write(target, content);
		this.result.conflicts.push(target);
	}

	/** Downloads Docmost files referenced in `markdown` and points the links to the vault copies. */
	private localize(markdown: string, spaceFolder: string): Promise<string> {
		return localizeLinks(markdown, this.client.baseUrl, async (ref) => {
			const known = this.state.attachments[ref.id];
			if (known && (await this.fs.exists(known.path))) return known.path;
			const path = joinPath(spaceFolder, ATTACHMENTS_FOLDER, attachmentFileName(ref.id, ref.fileName));
			await this.fs.writeBinary(path, await this.client.downloadFile(ref.url));
			this.state.attachments[ref.id] = { path, url: ref.url };
			return path;
		});
	}

	/** Replaces links to vault files with Docmost URLs, uploading files Docmost does not have yet. */
	private remoteize(body: string, sourcePath: string, pageId: string): Promise<string> {
		return remoteizeLinks(body, async (target) => {
			const vaultPath = this.fs.resolveLink(target, sourcePath);
			if (!vaultPath || vaultPath.endsWith('.md')) return null;
			const known = Object.values(this.state.attachments).find((a) => a.path === vaultPath);
			if (known) return known.url;
			const name = basename(vaultPath);
			const attachment = await this.client.uploadFile(pageId, name, await this.fs.readBinary(vaultPath), mimeType(name));
			const url = `/api/files/${attachment.id}/${encodeURIComponent(attachment.fileName)}`;
			this.state.attachments[attachment.id] = { path: vaultPath, url };
			return url;
		});
	}

	private linkKeys(space: Space, page: PageDetails): Record<string, string> {
		return { docmost_id: page.id, docmost_url: `${this.client.baseUrl}/s/${space.slug}/p/${page.slugId}` };
	}

	private pageState(pageId: string): PageState {
		const ps = this.state.pages[pageId];
		if (!ps) throw new Error(`Missing sync state for page ${pageId}`);
		return ps;
	}

	/** Returns `path`, or a numbered variant if a file not belonging to `pageId` occupies it. */
	private async freePath(path: string, pageId?: string): Promise<string> {
		const stem = path.replace(/\.md$/, '');
		let candidate = path;
		for (let i = 2; await this.isTaken(candidate, pageId); i++) candidate = `${stem} (${i}).md`;
		return candidate;
	}

	private async isTaken(path: string, pageId?: string): Promise<boolean> {
		if (!(await this.fs.exists(path))) return false;
		return pageId === undefined || this.idByPath.get(path) !== pageId;
	}
}

export function attachmentFileName(id: string, fileName: string): string {
	const clean = sanitizeName(fileName);
	const dot = clean.lastIndexOf('.');
	const [stem, ext] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ''];
	return `${stem}-${id.slice(-8)}${ext}`;
}

const MIME_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	bmp: 'image/bmp',
	avif: 'image/avif',
	pdf: 'application/pdf',
	mp4: 'video/mp4',
	webm: 'video/webm',
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	zip: 'application/zip',
	txt: 'text/plain',
};

function mimeType(fileName: string): string {
	const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
	return MIME_TYPES[ext] ?? 'application/octet-stream';
}

function withNewline(body: string): string {
	return body.endsWith('\n') ? body : `${body}\n`;
}

function emptyResult(): SyncResult {
	return { pulled: 0, pushed: 0, created: 0, deleted: 0, conflicts: [], kept: [], errors: [] };
}

function errorText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
