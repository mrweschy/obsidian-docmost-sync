import { MarkdownView, type Plugin } from 'obsidian';

/** Set on a note's view or hover preview while the note has no properties besides Docmost's own (see styles.css). */
const DOCMOST_PROPERTIES_ONLY_CLASS = 'docmost-sync-docmost-properties-only';
/** Properties the CSS in styles.css hides in notes. */
const DOCMOST_PROPERTIES = ['docmost_id', 'docmost_url'];

function onlyDocmostProperties(keys: string[]): boolean {
	return keys.length > 0 && keys.every((key) => DOCMOST_PROPERTIES.includes(key));
}

/**
 * styles.css hides docmost_id and docmost_url in notes. This marks the views and hover previews
 * of notes that have no other properties, so that the CSS hides their then empty properties box
 * as well. Call once the workspace layout is ready.
 */
export function hideEmptyPropertyBoxes(plugin: Plugin): void {
	const { workspace, metadataCache } = plugin.app;

	const markViews = (): void => {
		workspace.iterateAllLeaves((leaf) => {
			if (!(leaf.view instanceof MarkdownView)) return;
			const file = leaf.view.file;
			const keys = Object.keys((file && metadataCache.getFileCache(file)?.frontmatter) ?? {});
			leaf.view.containerEl.toggleClass(DOCMOST_PROPERTIES_ONLY_CLASS, onlyDocmostProperties(keys));
		});
	};
	plugin.registerEvent(workspace.on('layout-change', markViews));
	plugin.registerEvent(workspace.on('file-open', markViews));
	plugin.registerEvent(metadataCache.on('changed', markViews));
	markViews();

	// Hover previews are no views and show no file path, so they are marked by the properties
	// they show, when they open and whenever their content changes.
	const markPopover = (popover: HTMLElement): void => {
		const properties = popover.find('.metadata-container')?.findAll('.metadata-property') ?? [];
		const keys = properties.map((el) => el.dataset.propertyKey ?? '');
		popover.toggleClass(DOCMOST_PROPERTIES_ONLY_CLASS, onlyDocmostProperties(keys));
	};
	const popoverContent = new MutationObserver((records) => {
		for (const record of records) {
			const popover = record.target.instanceOf(HTMLElement) ? record.target.closest<HTMLElement>('.hover-popover') : null;
			if (popover) markPopover(popover);
		}
	});
	const popovers = new MutationObserver((records) => {
		for (const record of records) {
			record.addedNodes.forEach((node) => {
				if (node.instanceOf(HTMLElement) && node.hasClass('hover-popover')) {
					markPopover(node);
					popoverContent.observe(node, { childList: true, subtree: true });
				}
			});
		}
	});
	const body = workspace.containerEl.doc.body;
	popovers.observe(body, { childList: true });

	plugin.register(() => {
		popovers.disconnect();
		popoverContent.disconnect();
		workspace.iterateAllLeaves((leaf) => leaf.view.containerEl.removeClass(DOCMOST_PROPERTIES_ONLY_CLASS));
		for (const el of body.findAll(`.${DOCMOST_PROPERTIES_ONLY_CLASS}`)) el.removeClass(DOCMOST_PROPERTIES_ONLY_CLASS);
	});
}
