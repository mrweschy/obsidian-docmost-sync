import { type App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { t } from './i18n';
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
	hideAttachments: boolean;
	combinePageFolders: boolean;
	spaces: SpaceSetting[];
	syncOnStartup: boolean;
	/** Minutes between automatic syncs; 0 turns them off. */
	syncInterval: number;
	syncAfterEdit: boolean;
}

export const DEFAULT_SETTINGS: DocmostSettings = {
	baseUrl: '',
	authMode: 'password',
	email: '',
	rootFolder: 'Docmost',
	hideAttachments: true,
	combinePageFolders: true,
	spaces: [],
	syncOnStartup: true,
	syncInterval: 5,
	syncAfterEdit: true,
};

/** How long "sync after editing" waits after the last change. */
export const SYNC_AFTER_EDIT_SECONDS = 30;
const SYNC_INTERVALS = [0, 1, 5, 10, 15, 30, 60];

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
			.setName(t.urlName)
			.setDesc(t.urlDesc)
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
			.setName(t.authName)
			.setDesc(t.authDesc)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('password', t.authPassword)
					.addOption('apiKey', t.authApiKey)
					.setValue(settings.authMode)
					.onChange(async (value) => {
						settings.authMode = value as DocmostSettings['authMode'];
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (settings.authMode === 'apiKey') {
			this.addSecret(t.authApiKey, t.apiKeyDesc, SECRET_API_KEY);
		} else {
			new Setting(containerEl).setName(t.emailName).addText((text) =>
				text.setValue(settings.email).onChange(async (value) => {
					settings.email = value.trim();
					await this.plugin.saveSettings();
				}),
			);
			this.addSecret(t.passwordName, t.passwordDesc, SECRET_PASSWORD);
		}

		new Setting(containerEl)
			.setName(t.folderName)
			.setDesc(t.folderDesc)
			.addText((text) =>
				text.setValue(settings.rootFolder).onChange(async (value) => {
					settings.rootFolder = value.trim().replace(/^\/+|\/+$/g, '') || DEFAULT_SETTINGS.rootFolder;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName(t.combineName)
			.setDesc(t.combineDesc)
			.addToggle((toggle) =>
				toggle.setValue(settings.combinePageFolders).onChange(async (value) => {
					settings.combinePageFolders = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName(t.hideName)
			.setDesc(t.hideDesc)
			.addToggle((toggle) =>
				toggle.setValue(settings.hideAttachments).onChange(async (value) => {
					settings.hideAttachments = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName(t.testName).addButton((button) =>
			button.setButtonText(t.testButton).onClick(async () => {
				try {
					const name = await this.plugin.getClient().getCurrentUserName();
					new Notice(t.connected(name));
				} catch (err) {
					new Notice(t.connectionFailed(err instanceof Error ? err.message : String(err)));
				}
			}),
		);

		new Setting(containerEl)
			.setName(t.spacesName)
			.setDesc(t.spacesDesc)
			.setHeading()
			.addButton((button) =>
				button.setButtonText(t.loadSpaces).onClick(async () => {
					try {
						await this.loadSpaces();
						this.display();
					} catch (err) {
						new Notice(t.loadSpacesFailed(err instanceof Error ? err.message : String(err)));
					}
				}),
			);

		if (settings.spaces.length === 0) {
			containerEl.createEl('p', { text: t.noSpacesLoaded, cls: 'setting-item-description' });
		}
		for (const space of settings.spaces) {
			new Setting(containerEl).setName(space.name).addToggle((toggle) =>
				toggle.setValue(space.enabled).onChange(async (value) => {
					space.enabled = value;
					await this.plugin.saveSettings();
				}),
			);
		}

		new Setting(containerEl)
			.setName(t.autoName)
			.setDesc(t.autoDesc)
			.setHeading();

		new Setting(containerEl)
			.setName(t.startupName)
			.setDesc(t.startupDesc)
			.addToggle((toggle) =>
				toggle.setValue(settings.syncOnStartup).onChange(async (value) => {
					settings.syncOnStartup = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName(t.intervalName)
			.setDesc(t.intervalDesc)
			.addDropdown((dropdown) => {
				for (const minutes of SYNC_INTERVALS) dropdown.addOption(String(minutes), t.intervalOption(minutes));
				dropdown.setValue(String(settings.syncInterval)).onChange(async (value) => {
					settings.syncInterval = Number(value);
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(t.afterEditName)
			.setDesc(t.afterEditDesc(SYNC_AFTER_EDIT_SECONDS))
			.addToggle((toggle) =>
				toggle.setValue(settings.syncAfterEdit).onChange(async (value) => {
					settings.syncAfterEdit = value;
					await this.plugin.saveSettings();
				}),
			);
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
