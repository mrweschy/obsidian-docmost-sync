// Maps the Docmost page tree to vault paths.
// Layout: a page is "<Title>.md"; its children live in the sibling folder "<Title>/".

export interface TreeNode {
	id: string;
	title: string | null;
	parentPageId: string | null;
}

/** Turns a page or space title into a safe file/folder name. */
export function sanitizeName(title: string | null | undefined): string {
	const cleaned = (title ?? '')
		// Characters that are invalid in file names or break Obsidian links.
		.replace(/[\\/:*?"<>|#^[\]]/g, ' ')
		// eslint-disable-next-line no-control-regex -- control characters are what this removes
		.replace(/[\u0000-\u001f]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '')
		.slice(0, 120)
		.trim();
	return cleaned || 'Untitled';
}

/**
 * Computes the vault path of every page. `nodes` must be in tree order
 * (parents before children, siblings sorted by position).
 */
export function computePaths(spaceFolder: string, nodes: TreeNode[]): Map<string, string> {
	const paths = new Map<string, string>();
	const usedNames = new Map<string, Set<string>>(); // folder -> lower-cased names in use

	for (const node of nodes) {
		const parentPath = node.parentPageId ? paths.get(node.parentPageId) : undefined;
		const folder = parentPath ? childFolder(parentPath) : spaceFolder;
		const used = usedNames.get(folder) ?? new Set<string>();
		usedNames.set(folder, used);

		const base = sanitizeName(node.title);
		let name = base;
		for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} (${i})`;
		used.add(name.toLowerCase());

		paths.set(node.id, joinPath(folder, `${name}.md`));
	}
	return paths;
}

/** Folder that holds the children of the page stored at `pagePath`. */
export function childFolder(pagePath: string): string {
	return pagePath.replace(/\.md$/, '');
}

export function joinPath(...parts: string[]): string {
	return parts
		.filter((p) => p !== '')
		.join('/')
		.replace(/\/+/g, '/');
}

export function dirname(path: string): string {
	const i = path.lastIndexOf('/');
	return i === -1 ? '' : path.slice(0, i);
}

export function basename(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

/** File name without the ".md" extension. */
export function noteName(path: string): string {
	return basename(path).replace(/\.md$/, '');
}
