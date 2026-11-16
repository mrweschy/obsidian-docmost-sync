import { describe, expect, it } from 'vitest';
import {
	buildNote,
	getFrontmatterValue,
	hashBody,
	localizeLinks,
	localLinkTargets,
	parseDocmostFileUrl,
	parseNote,
	remoteizeLinks,
} from '../src/sync/markdown';

const ID = '01a1d06d-9ad7-728d-a728-6bd2ebe9889f';

describe('frontmatter', () => {
	it('round-trips our keys and keeps user keys', () => {
		const note = buildNote(['tags: [a, b]'], { docmost_id: 'abc', docmost_url: 'https://x/s/g/p/1' }, 'Body\n');
		expect(note).toBe('---\ntags: [a, b]\ndocmost_id: "abc"\ndocmost_url: "https://x/s/g/p/1"\n---\nBody\n');
		const parsed = parseNote(note);
		expect(parsed.body).toBe('Body\n');
		expect(getFrontmatterValue(parsed.frontmatter, 'docmost_id')).toBe('abc');
		expect(getFrontmatterValue(parsed.frontmatter, 'tags')).toBe('[a, b]');
	});
	it('replaces existing keys and removes keys set to null', () => {
		const note = buildNote(['docmost_id: "old"', 'docmost_url: "u"'], { docmost_id: null, docmost_url: null, docmost_conflict: true }, 'x');
		expect(note).toBe('---\ndocmost_conflict: true\n---\nx');
	});
	it('omits the block when nothing is left', () => {
		expect(buildNote([], {}, 'x')).toBe('x');
		expect(parseNote('no frontmatter')).toEqual({ frontmatter: [], body: 'no frontmatter' });
	});
});

describe('hashBody', () => {
	it('ignores trailing whitespace and line endings', () => {
		expect(hashBody('a\r\nb\n\n')).toBe(hashBody('a\nb'));
		expect(hashBody('a')).not.toBe(hashBody('b'));
	});
});

describe('parseDocmostFileUrl', () => {
	it('accepts relative and absolute URLs of the same server', () => {
		expect(parseDocmostFileUrl(`/api/files/${ID}/my%20file.png`, 'https://d.example')).toEqual({
			id: ID,
			fileName: 'my file.png',
			url: `/api/files/${ID}/my%20file.png`,
		});
		expect(parseDocmostFileUrl(`https://d.example/api/files/${ID}/a.png`, 'https://d.example')?.url).toBe(`/api/files/${ID}/a.png`);
		expect(parseDocmostFileUrl(`https://other.example/api/files/${ID}/a.png`, 'https://d.example')).toBeNull();
		expect(parseDocmostFileUrl('https://example.com/x.png', 'https://d.example')).toBeNull();
	});
});

describe('localizeLinks', () => {
	it('rewrites Docmost file links to encoded vault paths', async () => {
		const md = `![img](/api/files/${ID}/a.png)\n[doc](/api/files/${ID}/a.png "t")\n[web](https://example.com)`;
		const out = await localizeLinks(md, 'https://d.example', async () => 'Docmost/My Space/_attachments/a (1).png');
		expect(out).toBe(
			'![img](Docmost/My%20Space/_attachments/a%20%281%29.png)\n' +
				'[doc](Docmost/My%20Space/_attachments/a%20%281%29.png "t")\n' +
				'[web](https://example.com)',
		);
	});

	it('names file blocks after the file and embeds PDFs', async () => {
		const md = `PDF:\n\n[/api/files/${ID}/Kindsköpfe.pdf](/api/files/${ID}/Kindsköpfe.pdf)\n\n[/api/files/${ID}/a b.zip](/api/files/${ID}/a%20b.zip)\n\n[read this](/api/files/${ID}/b.pdf)\n\nSee [/api/files/${ID}/c.pdf](/api/files/${ID}/c.pdf) inline\n\n[/api/files/${ID}/my\\_file.pdf](/api/files/${ID}/my_file.pdf)`;
		const out = await localizeLinks(md, 'https://d.example', async (ref) => `Docmost/S/_attachments/${ref.fileName}`);
		expect(out).toBe(
			'PDF:\n\n![Kindsköpfe.pdf](Docmost/S/_attachments/Kindsköpfe.pdf)\n\n' +
				'[a b.zip](Docmost/S/_attachments/a%20b.zip)\n\n' +
				'[read this](Docmost/S/_attachments/b.pdf)\n\n' +
				'See [c.pdf](Docmost/S/_attachments/c.pdf) inline\n\n' +
				'![my_file.pdf](Docmost/S/_attachments/my_file.pdf)',
		);
	});
});

describe('remoteizeLinks', () => {
	it('maps vault links and embeds to Docmost URLs and keeps everything else', async () => {
		const md = [
			'![a](Docmost/My%20Space/_attachments/a.png)',
			'![[photo.jpg|300]]',
			'![[doc.pdf]]',
			'[[Some note]]',
			'[web](https://example.com)',
			'[anchor](#x)',
			'![missing](nope.png)',
		].join('\n');
		const map: Record<string, string> = {
			'Docmost/My Space/_attachments/a.png': '/api/files/1/a.png',
			'photo.jpg': '/api/files/2/photo.jpg',
			'doc.pdf': '/api/files/3/doc.pdf',
		};
		const out = await remoteizeLinks(md, async (target) => map[target] ?? null);
		expect(out.split('\n')).toEqual([
			'![a](/api/files/1/a.png)',
			'![photo.jpg](/api/files/2/photo.jpg)',
			'[doc.pdf](/api/files/3/doc.pdf)',
			'[[Some note]]',
			'[web](https://example.com)',
			'[anchor](#x)',
			'![missing](nope.png)',
		]);
	});

	it('turns PDFs embedded on their own line into Docmost PDF blocks', async () => {
		const url = `/api/files/${ID}/Kindsk%C3%B6pfe.pdf`;
		const md = ['Before', '![Kindsköpfe.pdf](Docmost/S/_attachments/Kindsk%C3%B6pfe.pdf)', '![[Kindsköpfe.pdf]]', 'See ![[Kindsköpfe.pdf]] inline', 'See ![r](Kindsköpfe.pdf) inline', '- item', '  ![[Kindsköpfe.pdf]]', '> ![[Kindsköpfe.pdf]]', '[link](Kindsköpfe.pdf)'].join('\n');
		const out = await remoteizeLinks(md, async () => url);
		const block = `\n<div data-type="pdf" src="${url}" data-name="Kindsköpfe.pdf" data-attachment-id="${ID}"></div>\n`;
		expect(out.split('\n')).toEqual(['Before', ...block.split('\n'), ...block.split('\n'), `See [Kindsköpfe.pdf](${url}) inline`, `See [r](${url}) inline`, '- item', `  [Kindsköpfe.pdf](${url})`, `> [Kindsköpfe.pdf](${url})`, `[link](${url})`]);
	});
});

describe('localLinkTargets', () => {
	it('lists vault targets of links, embeds and wiki links, decoded', () => {
		const body = [
			'![a](Docmost/S/_attachments/my%20pic.png) [doc](<files/a b.pdf> "t")',
			'![[diagram.png|200]] [[Other note#Heading|alias]] [[my pic.png]]',
			'[web](https://example.com/x.png) [anchor](#top) ![abs](/api/files/x/y.png)',
		].join('\n');
		expect(localLinkTargets(body)).toEqual([
			'Docmost/S/_attachments/my pic.png',
			'files/a b.pdf',
			'diagram.png',
			'Other note',
			'my pic.png',
		]);
	});
});
