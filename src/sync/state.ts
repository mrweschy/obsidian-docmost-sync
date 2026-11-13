// Persistent sync bookkeeping, stored in the plugin's data.json.

export interface PageState {
	spaceId: string;
	/** Local path at the last sync. */
	path: string;
	/** Path derived from the Docmost tree at the last sync (detects remote moves/renames). */
	remotePath: string;
	remoteUpdatedAt: string;
	/** Hash of the note body at the last sync (detects local edits). */
	hash: string;
}

export interface AttachmentState {
	path: string;
	/** Server-relative URL, e.g. /api/files/<id>/<name>. */
	url: string;
}

export interface SyncState {
	pages: Record<string, PageState>;
	/** Keyed by Docmost attachment id. */
	attachments: Record<string, AttachmentState>;
}

export function emptyState(): SyncState {
	return { pages: {}, attachments: {} };
}
