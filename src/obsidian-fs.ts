import { type App, TFile } from 'obsidian';
import type { SyncFs } from './sync/engine';
import { dirname } from './sync/paths';

/** SyncFs backed by Obsidian's Vault API. */
export class ObsidianFs implements SyncFs {
	constructor(private readonly app: App) {}

	async listMarkdown(folder: string): Promise<string[]> {
		const prefix = `${folder}/`;
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path.startsWith(prefix))
			.map((f) => f.path);
	}

	read(path: string): Promise<string> {
		return this.app.vault.read(this.file(path));
	}

	async write(path: string, content: string): Promise<void> {
		const existing = this.app.vault.getFileByPath(path);
		if (existing) return this.app.vault.modify(existing, content);
		await this.ensureFolder(dirname(path));
		await this.app.vault.create(path, content);
	}

	readBinary(path: string): Promise<ArrayBuffer> {
		return this.app.vault.readBinary(this.file(path));
	}

	async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
		const existing = this.app.vault.getFileByPath(path);
		if (existing) return this.app.vault.modifyBinary(existing, data);
		await this.ensureFolder(dirname(path));
		await this.app.vault.createBinary(path, data);
	}

	async exists(path: string): Promise<boolean> {
		return this.app.vault.getAbstractFileByPath(path) !== null;
	}

	async modifiedAt(path: string): Promise<number> {
		return this.file(path).stat.mtime;
	}

	async rename(from: string, to: string): Promise<void> {
		await this.ensureFolder(dirname(to));
		// FileManager.renameFile also updates links pointing to the note.
		await this.app.fileManager.renameFile(this.file(from), to);
	}

	trash(path: string): Promise<void> {
		// Respects the user's "deleted files" setting (system trash or .trash).
		return this.app.fileManager.trashFile(this.file(path));
	}

	async removeFolderIfEmpty(path: string): Promise<boolean> {
		const folder = this.app.vault.getFolderByPath(path);
		if (!folder || folder.children.length > 0) return false;
		await this.app.vault.delete(folder);
		return true;
	}

	resolveLink(target: string, sourcePath: string): string | null {
		return this.app.metadataCache.getFirstLinkpathDest(target, sourcePath)?.path ?? null;
	}

	private async ensureFolder(path: string): Promise<void> {
		if (!path || this.app.vault.getAbstractFileByPath(path)) return;
		await this.ensureFolder(dirname(path));
		await this.app.vault.createFolder(path);
	}

	private file(path: string): TFile {
		const file = this.app.vault.getFileByPath(path);
		if (!file) throw new Error(`File not found: ${path}`);
		return file;
	}
}
