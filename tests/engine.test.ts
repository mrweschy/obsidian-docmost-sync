import { describe, expect, it } from 'vitest';
import { attachmentFileName, decide } from '../src/sync/engine';

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
