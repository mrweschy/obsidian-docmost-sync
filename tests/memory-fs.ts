import type { SyncFs } from '../src/sync/engine';
import { basename, dirname, joinPath } from '../src/sync/paths';

/** In-memory SyncFs for tests; folders are implicit. */
export class MemoryFs implements SyncFs {
	readonly files = new Map<string, string | ArrayBuffer>();
	readonly trashed: string[] = [];

	async listMarkdown(folder: string): Promise<string[]> {
		return [...this.files.keys()].filter((p) => p.startsWith(`${folder}/`) && p.endsWith('.md')).sort();
	}
	async read(path: string): Promise<string> {
		const value = this.files.get(path);
		if (typeof value !== 'string') throw new Error(`Not a text file: ${path}`);
		return value;
	}
	async write(path: string, content: string): Promise<void> {
		this.files.set(path, content);
	}
	async readBinary(path: string): Promise<ArrayBuffer> {
		const value = this.files.get(path);
		if (!(value instanceof ArrayBuffer)) throw new Error(`Not a binary file: ${path}`);
		return value;
	}
	async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
		this.files.set(path, data);
	}
	async exists(path: string): Promise<boolean> {
		return this.files.has(path) || [...this.files.keys()].some((p) => p.startsWith(`${path}/`));
	}
	async rename(from: string, to: string): Promise<void> {
		const value = this.files.get(from);
		if (value === undefined) throw new Error(`File not found: ${from}`);
		this.files.delete(from);
		this.files.set(to, value);
	}
	async trash(path: string): Promise<void> {
		this.files.delete(path);
		this.trashed.push(path);
	}
	readonly removedFolders: string[] = [];
	async removeFolderIfEmpty(folder: string): Promise<boolean> {
		if (await this.exists(folder)) return false;
		this.removedFolders.push(folder);
		return true;
	}
	resolveLink(target: string, sourcePath: string): string | null {
		const relative = joinPath(dirname(sourcePath), target);
		if (this.files.has(target)) return target;
		if (this.files.has(relative)) return relative;
		return [...this.files.keys()].find((p) => basename(p) === basename(target)) ?? null;
	}
	text(path: string): string {
		const value = this.files.get(path);
		if (typeof value !== 'string') throw new Error(`Missing text file: ${path}`);
		return value;
	}
}
