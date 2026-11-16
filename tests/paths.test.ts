import { describe, expect, it } from 'vitest';
import { computePaths, sanitizeName } from '../src/sync/paths';

describe('sanitizeName', () => {
	it('replaces characters that are invalid in file names or links', () => {
		expect(sanitizeName('Child: A/B?')).toBe('Child A B');
		expect(sanitizeName('a#b^c[d]e|f')).toBe('a b c d e f');
	});
	it('falls back to Untitled', () => {
		expect(sanitizeName(null)).toBe('Untitled');
		expect(sanitizeName(' ... ')).toBe('Untitled');
	});
	it('removes trailing dots and spaces, which Windows does not allow', () => {
		expect(sanitizeName('Version 1.0.')).toBe('Version 1.0');
		expect(sanitizeName('Wait... ')).toBe('Wait');
		expect(sanitizeName('. Notes')).toBe('Notes');
		expect(sanitizeName('... hello')).toBe('hello');
	});
	it('avoids device names Windows reserves', () => {
		expect(sanitizeName('CON')).toBe('CON_');
		expect(sanitizeName('nul.txt')).toBe('nul_.txt');
		expect(sanitizeName('Com1')).toBe('Com1_');
		expect(sanitizeName('LPT9.')).toBe('LPT9_');
		expect(sanitizeName('Console')).toBe('Console');
		expect(sanitizeName('aux files')).toBe('aux files');
		expect(sanitizeName('COM10')).toBe('COM10');
		expect(sanitizeName('nul .png')).toBe('nul_ .png');
		expect(sanitizeName('CONOUT$')).toBe('CONOUT$_');
		expect(sanitizeName('CON.')).toBe('CON_');
		expect(sanitizeName(`con.${'x'.repeat(200)}`)).toHaveLength(120);
	});
	it('keeps umlauts and spaces', () => {
		expect(sanitizeName('Über  uns')).toBe('Über uns');
	});
});

describe('computePaths', () => {
	it('nests children in a folder named after the parent', () => {
		const paths = computePaths('Docmost/General', [
			{ id: '1', title: 'Parent', parentPageId: null },
			{ id: '2', title: 'Child', parentPageId: '1' },
			{ id: '3', title: 'Grandchild', parentPageId: '2' },
		]);
		expect(paths.get('1')).toBe('Docmost/General/Parent.md');
		expect(paths.get('2')).toBe('Docmost/General/Parent/Child.md');
		expect(paths.get('3')).toBe('Docmost/General/Parent/Child/Grandchild.md');
	});
	it('numbers duplicate sibling titles (case-insensitive)', () => {
		const paths = computePaths('S', [
			{ id: '1', title: 'Notes', parentPageId: null },
			{ id: '2', title: 'notes', parentPageId: null },
			{ id: '3', title: null, parentPageId: null },
			{ id: '4', title: '', parentPageId: null },
		]);
		expect([...paths.values()]).toEqual(['S/Notes.md', 'S/notes (2).md', 'S/Untitled.md', 'S/Untitled (2).md']);
	});
});
