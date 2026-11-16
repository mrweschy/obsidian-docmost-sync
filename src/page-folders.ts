import { debounce, Keymap, type Menu, type TAbstractFile, TFile, TFolder } from 'obsidian';
import { t } from './i18n';
import type DocmostSyncPlugin from './main';
import { ATTACHMENTS_FOLDER } from './sync/engine';

/** Hides a page note in the file explorer (see styles.css). */
const PAGE_NOTE_CLASS = 'docmost-sync-page-note';
/** Highlights the folder of the open page in the file explorer. */
const ACTIVE_PAGE_CLASS = 'docmost-sync-active-page';

/**
 * A Docmost page with subpages is stored as "Page.md" next to the folder "Page/".
 * This shows such a pair as a single item in the file explorer: the note is hidden,
 * clicking the folder name opens it and the arrow shows the subpages. Renaming or
 * moving one of the two also renames or moves the other.
 */
export class PageFolders {
	/** Paths of the page notes that are hidden in the file explorer. */
	private pageNotes = new Set<string>();
	/** Folder path of the open page, which is highlighted instead of its hidden note. */
	private activePage: string | null = null;
	private readonly refresh = debounce(() => this.render(), 100, true);
	/** Marks file explorer items as soon as the explorer adds them, e.g. when a folder is expanded. */
	private readonly observer = new MutationObserver((records) => {
		for (const record of records) {
			record.addedNodes.forEach((node) => {
				if (node.instanceOf(HTMLElement)) this.mark(node);
			});
		}
	});

	constructor(private readonly plugin: DocmostSyncPlugin) {}

	/** Call once the workspace layout is ready. */
	load(): void {
		const { vault, workspace } = this.plugin.app;
		this.plugin.register(() => {
			this.refresh.cancel();
			this.observer.disconnect();
			for (const root of this.explorerRoots()) {
				for (const el of root.findAll(`.${PAGE_NOTE_CLASS}, .${ACTIVE_PAGE_CLASS}`)) el.removeClass(PAGE_NOTE_CLASS, ACTIVE_PAGE_CLASS);
			}
		});

		this.plugin.registerEvent(vault.on('create', () => this.refresh()));
		this.plugin.registerEvent(vault.on('delete', () => this.refresh()));
		this.plugin.registerEvent(
			vault.on('rename', (file, oldPath) => {
				this.keepTogether(file, oldPath);
				this.refresh();
			}),
		);
		this.plugin.registerEvent(workspace.on('file-open', () => this.refresh()));
		// A file explorer may be opened later or replace its content when it loads.
		this.plugin.registerEvent(workspace.on('layout-change', () => this.markExplorers()));
		this.plugin.registerEvent(workspace.on('file-menu', (menu, file) => this.addMenuItems(menu, file)));
		this.plugin.registerDomEvent(document, 'click', (evt) => this.onClick(evt), { capture: true });
		this.render();
	}

	/** Re-applies the view, e.g. after the settings changed. */
	render(): void {
		const { vault, workspace } = this.plugin.app;
		this.pageNotes = new Set();
		this.activePage = null;
		if (this.plugin.settings.combinePageFolders) {
			for (const folder of vault.getAllFolders()) {
				const note = this.pageNote(folder.path);
				if (note) this.pageNotes.add(note.path);
			}
			const active = workspace.getActiveFile()?.path;
			if (active && this.pageNotes.has(active)) this.activePage = active.replace(/\.md$/, '');
		}
		this.markExplorers();
	}

	private markExplorers(): void {
		for (const root of this.explorerRoots()) {
			this.observer.observe(root, { childList: true, subtree: true });
			this.mark(root);
		}
	}

	private explorerRoots(): HTMLElement[] {
		return this.plugin.app.workspace.getLeavesOfType('file-explorer').map((leaf) => leaf.view.containerEl);
	}

	/** Hides the page notes and highlights the open page among the explorer items in `root`. */
	private mark(root: HTMLElement): void {
		for (const title of root.findAllSelf('.nav-file-title[data-path]')) {
			title.closest('.nav-file')?.toggleClass(PAGE_NOTE_CLASS, this.pageNotes.has(title.dataset.path ?? ''));
		}
		for (const title of root.findAllSelf('.nav-folder-title[data-path]')) {
			title.toggleClass(ACTIVE_PAGE_CLASS, title.dataset.path === this.activePage);
		}
	}

	/** The note of the page whose subpages are in `folderPath`, or null if it is no such folder. */
	private pageNote(folderPath: string): TFile | null {
		if (folderPath.split('/').pop() === ATTACHMENTS_FOLDER) return null;
		if (this.plugin.spaceFolderOf(folderPath) === null) return null;
		return this.plugin.app.vault.getFileByPath(`${folderPath}.md`);
	}

	private isPage(file: TAbstractFile): file is TFile {
		return (
			file instanceof TFile &&
			file.extension === 'md' &&
			this.plugin.spaceFolderOf(file.path) !== null &&
			!file.path.split('/').includes(ATTACHMENTS_FOLDER)
		);
	}

	/** Clicking the name of a page folder opens the page; the arrow still shows or hides the subpages. */
	private onClick(evt: MouseEvent): void {
		if (!this.plugin.settings.combinePageFolders || evt.button !== 0) return;
		const target = evt.target as HTMLElement | null;
		if (!target?.closest || target.closest('.collapse-icon')) return;
		const path = target.closest<HTMLElement>('.nav-folder-title')?.dataset.path;
		const note = path ? this.pageNote(path) : null;
		if (!note) return;
		evt.preventDefault();
		evt.stopPropagation();
		void this.plugin.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(note);
	}

	private addMenuItems(menu: Menu, file: TAbstractFile): void {
		// The space folder itself: new top-level page.
		if (file instanceof TFolder && this.plugin.spaceFolderOf(`${file.path}/`) === file.path) {
			menu.addItem((item) =>
				item
					.setTitle(t.newPage)
					.setIcon('file-plus')
					.onClick(() => void this.createPage(file.path)),
			);
			return;
		}
		const page = file instanceof TFolder ? this.pageNote(file.path) : this.isPage(file) ? file : null;
		if (!page) return;
		menu.addItem((item) =>
			item
				.setTitle(t.newSubpage)
				.setIcon('file-plus')
				.onClick(() => void this.createPage(page.path.replace(/\.md$/, ''))),
		);
	}

	/** Creates an untitled note in `folder` and opens it with the title selected for renaming. */
	private async createPage(folder: string): Promise<void> {
		const { vault, workspace } = this.plugin.app;
		if (!vault.getFolderByPath(folder)) await vault.createFolder(folder);
		let path = `${folder}/${t.untitled}.md`;
		for (let i = 1; await this.plugin.isTaken(path); i++) path = `${folder}/${t.untitled} ${i}.md`;
		const file = await vault.create(path, '');
		await workspace.getLeaf(false).openFile(file, { active: true, eState: { rename: 'all' } });
	}

	/** Renames or moves the page note together with its subpage folder and vice versa. */
	private keepTogether(file: TAbstractFile, oldPath: string): void {
		// The sync moves notes and their subpages itself.
		if (this.plugin.isSyncing() || this.plugin.spaceFolderOf(file.path) === null) return;
		const { vault, fileManager } = this.plugin.app;
		if (file instanceof TFolder) {
			const note = vault.getFileByPath(`${oldPath}.md`);
			const target = `${file.path}.md`;
			if (note && !vault.getAbstractFileByPath(target)) void fileManager.renameFile(note, target);
		} else if (this.isPage(file) && oldPath.endsWith('.md')) {
			const folder = vault.getFolderByPath(oldPath.slice(0, -3));
			const target = file.path.slice(0, -3);
			if (folder && !target.startsWith(`${folder.path}/`) && !vault.getAbstractFileByPath(target)) {
				void fileManager.renameFile(folder, target);
			}
		}
	}
}
