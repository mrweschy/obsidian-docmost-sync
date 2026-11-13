import { debounce, normalizePath, Notice, Plugin, type TAbstractFile, TFile } from 'obsidian';
import { type AuthConfig, DocmostClient } from './api';
import { obsidianHttp } from './http';
import { ObsidianFs } from './obsidian-fs';
import {
	DEFAULT_SETTINGS,
	type DocmostSettings,
	DocmostSettingTab,
	SECRET_API_KEY,
	SECRET_PASSWORD,
	SYNC_AFTER_EDIT_SECONDS,
} from './settings';
import { SyncEngine, type SyncResult } from './sync/engine';
import { joinPath, sanitizeName } from './sync/paths';
import { emptyState, type SyncState } from './sync/state';

/** Automatic syncs leave notes alone that were modified this recently, because they are being edited. */
const ACTIVE_EDIT_WINDOW_MS = 15_000;

interface PluginData {
	settings: DocmostSettings;
	state: SyncState;
}

export default class DocmostSyncPlugin extends Plugin {
	settings: DocmostSettings = { ...DEFAULT_SETTINGS };
	state: SyncState = emptyState();
	private client: DocmostClient | null = null;
	private syncing = false;
	/** An automatic sync was requested while another sync was running. */
	private syncAgain = false;
	private intervalId: number | null = null;
	private statusEl: HTMLElement | null = null;
	private readonly syncAfterEdit = debounce(() => void this.runSync(true), SYNC_AFTER_EDIT_SECONDS * 1000, true);

	async onload(): Promise<void> {
		const data = ((await this.loadData()) ?? {}) as Partial<PluginData>;
		this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
		this.state = { ...emptyState(), ...data.state };

		this.addSettingTab(new DocmostSettingTab(this.app, this));
		this.addRibbonIcon('refresh-cw', 'Sync with Docmost', () => void this.runSync());
		this.addCommand({ id: 'sync-now', name: 'Sync now', callback: () => void this.runSync() });
		this.statusEl = this.addStatusBarItem();
		this.scheduleIntervalSync();

		// Vault events also fire for every existing file while Obsidian starts up,
		// so only listen once the layout is ready.
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(this.app.vault.on('modify', (file) => this.onLocalChange(file)));
			this.registerEvent(this.app.vault.on('create', (file) => this.onLocalChange(file)));
			this.registerEvent(this.app.vault.on('rename', (file) => this.onLocalChange(file)));
			if (this.settings.syncOnStartup) void this.runSync(true);
		});
	}

	onunload(): void {
		this.syncAfterEdit.cancel();
	}

	async saveSettings(): Promise<void> {
		this.resetClient();
		this.scheduleIntervalSync();
		await this.savePluginData();
	}

	/** Returns a client for the current settings; it is reused so the login token stays cached. */
	getClient(): DocmostClient {
		if (this.client) return this.client;
		const { baseUrl, authMode, email } = this.settings;
		if (!baseUrl) throw new Error('Please enter your Docmost URL in the plugin settings.');

		let auth: AuthConfig;
		if (authMode === 'apiKey') {
			const apiKey = this.app.secretStorage.getSecret(SECRET_API_KEY);
			if (!apiKey) throw new Error('Please enter an API key in the plugin settings.');
			auth = { mode: 'apiKey', apiKey };
		} else {
			const password = this.app.secretStorage.getSecret(SECRET_PASSWORD);
			if (!email || !password) throw new Error('Please enter email and password in the plugin settings.');
			auth = { mode: 'password', email, password };
		}
		this.client = new DocmostClient(baseUrl, auth, obsidianHttp);
		return this.client;
	}

	resetClient(): void {
		this.client = null;
	}

	private scheduleIntervalSync(): void {
		if (this.intervalId !== null) window.clearInterval(this.intervalId);
		this.intervalId = null;
		const minutes = this.settings.syncInterval;
		if (minutes > 0) {
			this.intervalId = this.registerInterval(window.setInterval(() => void this.runSync(true), minutes * 60_000));
		}
	}

	private onLocalChange(file: TAbstractFile): void {
		if (!this.settings.syncAfterEdit || !(file instanceof TFile) || file.extension !== 'md') return;
		const root = normalizePath(this.settings.rootFolder);
		const inSyncedSpace = this.settings.spaces.some(
			(s) => s.enabled && file.path.startsWith(`${joinPath(root, sanitizeName(s.name))}/`),
		);
		if (inSyncedSpace) this.syncAfterEdit();
	}

	/**
	 * Runs a sync. Automatic syncs show no notices except for conflicts; their
	 * progress and errors appear in the status bar.
	 */
	private async runSync(auto = false): Promise<void> {
		if (this.syncing) {
			if (auto) this.syncAgain = true;
			else new Notice('Docmost: a sync is already running.');
			return;
		}
		const spaces = this.settings.spaces.filter((s) => s.enabled);
		if (spaces.length === 0) {
			if (!auto) new Notice('Docmost: no spaces selected. Choose spaces in the plugin settings.');
			return;
		}

		this.syncing = true;
		const progress = auto ? null : new Notice('Docmost: syncing…', 0);
		this.setStatus('Docmost: syncing…');
		try {
			const engine = new SyncEngine(
				this.getClient(),
				new ObsidianFs(this.app),
				this.state,
				normalizePath(this.settings.rootFolder),
			);
			const options = auto ? { skipModifiedAfter: Date.now() - ACTIVE_EDIT_WINDOW_MS } : {};
			const result = await engine.sync(spaces, options);
			if (result.errors.length) console.error('Docmost sync errors:', result.errors);
			const needsAction = result.conflicts.length > 0 || result.kept.length > 0;
			if (!auto || needsAction) {
				new Notice(summarize(result), needsAction || result.errors.length > 0 ? 15000 : 5000);
			}
			if (result.errors.length) this.setStatus(`Docmost: ${result.errors.length} sync error(s)`, result.errors[0]);
			else this.setStatus(`Docmost: synced ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error('Docmost sync failed:', err);
			if (!auto) new Notice(`Docmost sync failed: ${message}`);
			this.setStatus('Docmost: sync failed', message);
		} finally {
			// The engine updates the state as it goes, so save it even after a failure.
			await this.savePluginData();
			progress?.hide();
			this.syncing = false;
			if (this.syncAgain) {
				this.syncAgain = false;
				void this.runSync(true);
			}
		}
	}

	/** Shows the sync status in the status bar; `detail` appears as tooltip. */
	private setStatus(text: string, detail?: string): void {
		if (!this.statusEl) return;
		this.statusEl.setText(text);
		if (detail) this.statusEl.setAttribute('aria-label', detail);
		else this.statusEl.removeAttribute('aria-label');
	}

	private async savePluginData(): Promise<void> {
		const data: PluginData = { settings: this.settings, state: this.state };
		await this.saveData(data);
	}
}

function summarize(r: SyncResult): string {
	const lines = [`Docmost: ${r.pulled} pulled, ${r.pushed} pushed, ${r.created} created, ${r.deleted} removed.`];
	if (r.conflicts.length) lines.push(`${r.conflicts.length} conflict(s), local versions saved as "(conflict …)" notes.`);
	if (r.kept.length) lines.push(`${r.kept.length} locally modified note(s) kept although deleted in Docmost.`);
	if (r.errors.length) lines.push(`${r.errors.length} error(s): ${r.errors[0]}${r.errors.length > 1 ? ' (see console)' : ''}`);
	return lines.join('\n');
}
