import { type App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type DocmostSyncPlugin from './main';

export interface SpaceSetting {
	id: string;
	name: string;
	slug: string;
	enabled: boolean;
}

export interface DocmostSettings {
	baseUrl: string;
	authMode: 'apiKey' | 'password';
	email: string;
	rootFolder: string;
	spaces: SpaceSetting[];
}

export const DEFAULT_SETTINGS: DocmostSettings = {
	baseUrl: '',
	authMode: 'password',
	email: '',
	rootFolder: 'Docmost',
	spaces: [],
};

// Credentials live in Obsidian's secret storage, not in data.json.
export const SECRET_API_KEY = 'docmost-sync-api-key';
export const SECRET_PASSWORD = 'docmost-sync-password';

export class DocmostSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: DocmostSyncPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const settings = this.plugin.settings;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Docmost URL')
			.setDesc('Address of your Docmost instance, e.g. https://docs.example.com')
			.addText((text) =>
				text
					.setPlaceholder('https://docs.example.com')
					.setValue(settings.baseUrl)
					.onChange(async (value) => {
						settings.baseUrl = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Authentication')
			.setDesc('API keys require a Docmost Enterprise license. Community editions use email and password.')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('password', 'Email and password')
					.addOption('apiKey', 'API key')
					.setValue(settings.authMode)
					.onChange(async (value) => {
						settings.authMode = value as DocmostSettings['authMode'];
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (settings.authMode === 'apiKey') {
			this.addSecret('API key', 'Create one in Docmost under Settings > API keys.', SECRET_API_KEY);
		} else {
			new Setting(containerEl).setName('Email').addText((text) =>
				text.setValue(settings.email).onChange(async (value) => {
					settings.email = value.trim();
					await this.plugin.saveSettings();
				}),
			);
			this.addSecret('Password', 'Accounts with MFA or enforced SSO cannot log in this way; use an API key instead.', SECRET_PASSWORD);
		}

		new Setting(containerEl)
			.setName('Vault folder')
			.setDesc('Docmost spaces are synced into subfolders of this folder.')
			.addText((text) =>
				text.setValue(settings.rootFolder).onChange(async (value) => {
					settings.rootFolder = value.trim().replace(/^\/+|\/+$/g, '') || DEFAULT_SETTINGS.rootFolder;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName('Test connection').addButton((button) =>
			button.setButtonText('Test').onClick(async () => {
				try {
					const name = await this.plugin.getClient().getCurrentUserName();
					new Notice(`Connected to Docmost as ${name}.`);
				} catch (err) {
					new Notice(`Connection failed: ${err instanceof Error ? err.message : String(err)}`);
				}
			}),
		);

		new Setting(containerEl)
			.setName('Spaces')
			.setDesc('Choose which spaces to sync.')
			.setHeading()
			.addButton((button) =>
				button.setButtonText('Load spaces').onClick(async () => {
					try {
						await this.loadSpaces();
						this.display();
					} catch (err) {
						new Notice(`Could not load spaces: ${err instanceof Error ? err.message : String(err)}`);
					}
				}),
			);

		if (settings.spaces.length === 0) {
			containerEl.createEl('p', { text: 'No spaces loaded yet.', cls: 'setting-item-description' });
		}
		for (const space of settings.spaces) {
			new Setting(containerEl).setName(space.name).addToggle((toggle) =>
				toggle.setValue(space.enabled).onChange(async (value) => {
					space.enabled = value;
					await this.plugin.saveSettings();
				}),
			);
		}
	}

	private addSecret(name: string, desc: string, secretId: string): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((text) => {
				text.inputEl.type = 'password';
				text.setValue(this.app.secretStorage.getSecret(secretId) ?? '').onChange((value) => {
					this.app.secretStorage.setSecret(secretId, value);
					this.plugin.resetClient();
				});
			});
	}

	private async loadSpaces(): Promise<void> {
		const remote = await this.plugin.getClient().listSpaces();
		const enabled = new Set(this.plugin.settings.spaces.filter((s) => s.enabled).map((s) => s.id));
		this.plugin.settings.spaces = remote.map((s) => ({ id: s.id, name: s.name, slug: s.slug, enabled: enabled.has(s.id) }));
		await this.plugin.saveSettings();
	}
}
