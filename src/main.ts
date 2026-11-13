import { normalizePath, Notice, Plugin } from 'obsidian';
import { type AuthConfig, DocmostClient } from './api';
import { obsidianHttp } from './http';
import { ObsidianFs } from './obsidian-fs';
import { DEFAULT_SETTINGS, type DocmostSettings, DocmostSettingTab, SECRET_API_KEY, SECRET_PASSWORD } from './settings';
import { SyncEngine, type SyncResult } from './sync/engine';
import { emptyState, type SyncState } from './sync/state';

interface PluginData {
	settings: DocmostSettings;
	state: SyncState;
}

export default class DocmostSyncPlugin extends Plugin {
	settings: DocmostSettings = { ...DEFAULT_SETTINGS };
	state: SyncState = emptyState();
	private client: DocmostClient | null = null;
	private syncing = false;

	async onload(): Promise<void> {
		const data = ((await this.loadData()) ?? {}) as Partial<PluginData>;
		this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
		this.state = { ...emptyState(), ...data.state };

		this.addSettingTab(new DocmostSettingTab(this.app, this));
		this.addRibbonIcon('refresh-cw', 'Sync with Docmost', () => void this.runSync());
		this.addCommand({ id: 'sync-now', name: 'Sync now', callback: () => void this.runSync() });
	}

	async saveSettings(): Promise<void> {
		this.resetClient();
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

	private async runSync(): Promise<void> {
		if (this.syncing) {
			new Notice('Docmost: a sync is already running.');
			return;
		}
		const spaces = this.settings.spaces.filter((s) => s.enabled);
		if (spaces.length === 0) {
			new Notice('Docmost: no spaces selected. Choose spaces in the plugin settings.');
			return;
		}

		this.syncing = true;
		const progress = new Notice('Docmost: syncing…', 0);
		try {
			const engine = new SyncEngine(
				this.getClient(),
				new ObsidianFs(this.app),
				this.state,
				normalizePath(this.settings.rootFolder),
			);
			const result = await engine.sync(spaces);
			if (result.errors.length) console.error('Docmost sync errors:', result.errors);
			const needsAttention = result.errors.length > 0 || result.conflicts.length > 0 || result.kept.length > 0;
			new Notice(summarize(result), needsAttention ? 15000 : 5000);
		} catch (err) {
			new Notice(`Docmost sync failed: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			// The engine updates the state as it goes, so save it even after a failure.
			await this.savePluginData();
			progress.hide();
			this.syncing = false;
		}
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
