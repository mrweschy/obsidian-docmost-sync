// Frontmatter handling, change hashing and link rewriting between
// Docmost file URLs (/api/files/<id>/<name>) and vault paths.

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
// [text](target "title") and ![alt](target); target may be wrapped in <...>.
const MD_LINK = /(!?)\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]+)(\s+"[^"]*")?\s*\)/g;
const WIKI_EMBED = /!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
// [[target]], [[target#heading|alias]] and ![[target]].
const WIKI_LINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const DOCMOST_FILE = /^\/api\/files\/([0-9a-fA-F-]{36})\/([^/?#]+)$/;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const PDF_EXT = /\.pdf$/i;

export interface Note {
	frontmatter: string[];
	body: string;
}

export function parseNote(content: string): Note {
	const match = FRONTMATTER.exec(content);
	if (!match) return { frontmatter: [], body: content };
	return { frontmatter: (match[1] ?? '').split(/\r?\n/), body: content.slice(match[0].length) };
}

export function getFrontmatterValue(lines: string[], key: string): string | undefined {
	for (const line of lines) {
		const match = new RegExp(`^${key}:\\s*(.*)$`).exec(line);
		if (match) return (match[1] ?? '').trim().replace(/^(["'])(.*)\1$/, '$2');
	}
	return undefined;
}

/** Builds a note, setting (or removing, with null) the given top-level keys and keeping all others. */
export function buildNote(frontmatter: string[], updates: Record<string, string | boolean | null>, body: string): string {
	const keys = Object.keys(updates);
	const lines = frontmatter.filter((line) => !keys.some((key) => line.startsWith(`${key}:`)));
	for (const [key, value] of Object.entries(updates)) {
		if (value !== null) lines.push(`${key}: ${typeof value === 'boolean' ? value : JSON.stringify(value)}`);
	}
	return lines.length ? `---\n${lines.join('\n')}\n---\n${body}` : body;
}

export function normalizeBody(body: string): string {
	return body.replace(/\r\n/g, '\n').replace(/\s+$/, '');
}

/** Fast non-cryptographic hash (cyrb53) of the normalized body, used for change detection. */
export function hashBody(body: string): string {
	const text = normalizeBody(body);
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

export interface DocmostFileRef {
	id: string;
	/** Decoded original file name. */
	fileName: string;
	/** Server-relative URL, e.g. /api/files/<id>/<name>. */
	url: string;
}

/** Recognizes Docmost file URLs, relative or absolute on the given server. */
export function parseDocmostFileUrl(target: string, baseUrl: string): DocmostFileRef | null {
	let path = target;
	if (path.startsWith(baseUrl + '/')) path = path.slice(baseUrl.length);
	const match = DOCMOST_FILE.exec(path);
	if (!match) return null;
	return { id: match[1] as string, fileName: safeDecode(match[2] as string), url: path };
}

/**
 * Pull direction: replaces Docmost file URLs with vault paths returned by `toLocal`.
 *
 * Docmost exports file blocks (e.g. its PDF viewer) as links whose text is the URL itself.
 * Those get the file name as text instead, and a PDF on its own line becomes an embed so
 * Obsidian shows a preview.
 */
export async function localizeLinks(
	markdown: string,
	baseUrl: string,
	toLocal: (ref: DocmostFileRef) => Promise<string>,
): Promise<string> {
	const resolved = new Map<string, { ref: DocmostFileRef; local: string }>();
	for (const match of markdown.matchAll(MD_LINK)) {
		const target = unwrapTarget(match[3] as string);
		const ref = parseDocmostFileUrl(target, baseUrl);
		if (ref && !resolved.has(target)) resolved.set(target, { ref, local: await toLocal(ref) });
	}
	return markdown.replace(
		MD_LINK,
		(full, bang: string, text: string, rawTarget: string, title: string | undefined, offset: number, all: string) => {
			const target = unwrapTarget(rawTarget);
			const file = resolved.get(target);
			if (!file) return full;
			const path = encodeLinkPath(file.local);
			if (!bang && safeDecode(unescapeMarkdown(text)) === safeDecode(target)) {
				const name = file.ref.fileName.replace(/[[\]]/g, '');
				const embed = PDF_EXT.test(file.ref.fileName) && isOwnLine(all, offset, full.length);
				return `${embed ? '!' : ''}[${name}](${path}${title ?? ''})`;
			}
			return `${bang}[${text}](${path}${title ?? ''})`;
		},
	);
}

/**
 * Push direction: replaces links to vault files (markdown links and ![[embeds]])
 * with Docmost URLs returned by `toRemote`. Returning null leaves the link unchanged.
 * A PDF embedded on its own, unindented line becomes a Docmost PDF block (sent as HTML,
 * which Docmost's Markdown import accepts), so Docmost shows its PDF viewer. Other embeds
 * of non-image files become links.
 */
export async function remoteizeLinks(
	markdown: string,
	toRemote: (linkTarget: string) => Promise<string | null>,
): Promise<string> {
	const resolved = new Map<string, string | null>();
	const resolve = async (target: string) => {
		if (!resolved.has(target)) resolved.set(target, await toRemote(target));
	};

	for (const match of markdown.matchAll(MD_LINK)) {
		const target = safeDecode(unwrapTarget(match[3] as string));
		if (isLocalTarget(target)) await resolve(target);
	}
	for (const match of markdown.matchAll(WIKI_EMBED)) await resolve((match[1] as string).trim());

	return markdown
		.replace(
			MD_LINK,
			(full, bang: string, text: string, rawTarget: string, title: string | undefined, offset: number, all: string) => {
				const target = safeDecode(unwrapTarget(rawTarget));
				const remote = resolved.get(target);
				if (!remote) return full;
				if (bang && isOwnLine(all, offset, full.length)) {
					const block = pdfBlock(remote);
					if (block) return block;
				}
				// Docmost would turn ![x](file.pdf) into a broken image, as for ![[file.pdf]] use a link.
				const image = bang && IMAGE_EXT.test(target) ? '!' : '';
				return `${image}[${text}](${remote}${title ?? ''})`;
			},
		)
		.replace(WIKI_EMBED, (full, rawTarget: string, alias: string | undefined, offset: number, all: string) => {
			const target = rawTarget.trim();
			const remote = resolved.get(target);
			if (!remote) return full;
			if (isOwnLine(all, offset, full.length)) {
				const block = pdfBlock(remote);
				if (block) return block;
			}
			const label = alias?.trim() && !/^\d+(x\d+)?$/.test(alias.trim()) ? alias.trim() : target.split('/').pop();
			return `${IMAGE_EXT.test(target) ? '!' : ''}[${label}](${remote})`;
		});
}

/** Targets of all links and embeds in `markdown` that point into the vault, as written (decoded). */
export function localLinkTargets(markdown: string): string[] {
	const targets = new Set<string>();
	for (const match of markdown.matchAll(MD_LINK)) {
		const target = safeDecode(unwrapTarget(match[3] as string));
		if (isLocalTarget(target)) targets.add(target);
	}
	for (const match of markdown.matchAll(WIKI_LINK)) targets.add((match[1] as string).trim());
	return [...targets];
}

/** Docmost's PDF block for a Docmost file URL, or null if the file is no PDF. */
function pdfBlock(url: string): string | null {
	const ref = parseDocmostFileUrl(url, '');
	if (!ref || !PDF_EXT.test(ref.fileName)) return null;
	const attr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
	// Blank lines around it make it a separate HTML block in Markdown.
	return `\n<div data-type="pdf" src="${attr(url)}" data-name="${attr(ref.fileName)}" data-attachment-id="${ref.id}"></div>\n`;
}

/**
 * Whether the text at `offset` is the only content of its line and starts at its beginning.
 * Indented or quoted lines belong to a list item or blockquote, where a block would not fit.
 */
function isOwnLine(text: string, offset: number, length: number): boolean {
	const start = text.lastIndexOf('\n', offset - 1) + 1;
	const newline = text.indexOf('\n', offset + length);
	const end = newline === -1 ? text.length : newline;
	return start === offset && text.slice(offset + length, end).trim() === '';
}

/** Removes Markdown backslash escapes, e.g. `a\_b` -> `a_b`. */
function unescapeMarkdown(text: string): string {
	return text.replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, '$1');
}

function isLocalTarget(target: string): boolean {
	return target !== '' && !target.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('/');
}

function unwrapTarget(target: string): string {
	return target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target;
}

function encodeLinkPath(path: string): string {
	return path.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
