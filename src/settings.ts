import { type App, Notice, PluginSettingTab, requireApiVersion, Setting, type SettingDefinitionItem } from 'obsidian';
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

/**
 * A row of the settings tab. Obsidian 1.13 and later render the rows from
 * getSettingDefinitions() and find them in the settings search; older versions
 * render them through display().
 */
interface Row {
	name: string;
	desc?: string;
	/** Checked on every render. */
	visible?: () => boolean;
	searchable?: boolean;
	render: (setting: Setting) => void;
}

/** A row named `name` whose controls `build` adds. */
function row(name: string, desc: string | undefined, build: (setting: Setting) => unknown, options: Partial<Row> = {}): Row {
	return {
		...options,
		name,
		desc,
		render: (setting) => {
			setting.setName(name);
			if (desc) setting.setDesc(desc);
			build(setting);
		},
	};
}

export class DocmostSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: DocmostSyncPlugin,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return this.rows();
	}

	/** Obsidian versions before 1.13 do not call getSettingDefinitions() and render the tab here. */
	display(): void {
		this.renderRows();
	}

	/** Renders the tab again after a change that shows, hides or adds rows. */
	private rerender(): void {
		if (requireApiVersion('1.13.0')) this.update();
		else this.renderRows();
	}

	private renderRows(): void {
		this.containerEl.empty();
		for (const r of this.rows()) {
			if (r.visible?.() ?? true) r.render(new Setting(this.containerEl));
		}
	}

	private rows(): Row[] {
		const settings = this.plugin.settings;
		const apiKey = (): boolean => settings.authMode === 'apiKey';
		return [
			row(t.urlName, t.urlDesc, (s) =>
				s.addText((text) =>
					text
						.setPlaceholder('https://docs.example.com')
						.setValue(settings.baseUrl)
						.onChange(async (value) => {
							settings.baseUrl = value.trim();
							await this.plugin.saveSettings();
						}),
				),
			),
			row(t.authName, t.authDesc, (s) =>
				s.addDropdown((dropdown) =>
					dropdown
						.addOption('password', t.authPassword)
						.addOption('apiKey', t.authApiKey)
						.setValue(settings.authMode)
						.onChange(async (value) => {
							settings.authMode = value as DocmostSettings['authMode'];
							await this.plugin.saveSettings();
							this.rerender();
						}),
				),
			),
			this.secretRow(t.authApiKey, t.apiKeyDesc, SECRET_API_KEY, apiKey),
			row(
				t.emailName,
				undefined,
				(s) =>
					s.addText((text) =>
						text.setValue(settings.email).onChange(async (value) => {
							settings.email = value.trim();
							await this.plugin.saveSettings();
						}),
					),
				{ visible: () => !apiKey() },
			),
			this.secretRow(t.passwordName, t.passwordDesc, SECRET_PASSWORD, () => !apiKey()),
			row(t.folderName, t.folderDesc, (s) =>
				s.addText((text) =>
					text.setValue(settings.rootFolder).onChange(async (value) => {
						settings.rootFolder = value.trim().replace(/^\/+|\/+$/g, '') || DEFAULT_SETTINGS.rootFolder;
						await this.plugin.saveSettings();
					}),
				),
			),
			row(t.combineName, t.combineDesc, (s) =>
				s.addToggle((toggle) =>
					toggle.setValue(settings.combinePageFolders).onChange(async (value) => {
						settings.combinePageFolders = value;
						await this.plugin.saveSettings();
					}),
				),
			),
			row(t.hideName, t.hideDesc, (s) =>
				s.addToggle((toggle) =>
					toggle.setValue(settings.hideAttachments).onChange(async (value) => {
						settings.hideAttachments = value;
						await this.plugin.saveSettings();
					}),
				),
			),
			row(t.testName, undefined, (s) =>
				s.addButton((button) =>
					button.setButtonText(t.testButton).onClick(async () => {
						try {
							const name = await this.plugin.getClient().getCurrentUserName();
							new Notice(t.connected(name));
						} catch (err) {
							new Notice(t.connectionFailed(err instanceof Error ? err.message : String(err)));
						}
					}),
				),
			),

			row(t.spacesName, t.spacesDesc, (s) =>
				s.setHeading().addButton((button) =>
					button.setButtonText(t.loadSpaces).onClick(async () => {
						try {
							await this.loadSpaces();
							this.rerender();
						} catch (err) {
							new Notice(t.loadSpacesFailed(err instanceof Error ? err.message : String(err)));
						}
					}),
				),
			),
			row('', t.noSpacesLoaded, () => {}, { visible: () => settings.spaces.length === 0, searchable: false }),
			...settings.spaces.map((space) =>
				row(space.name, undefined, (s) =>
					s.addToggle((toggle) =>
						toggle.setValue(space.enabled).onChange(async (value) => {
							space.enabled = value;
							await this.plugin.saveSettings();
						}),
					),
				),
			),

			row(t.autoName, t.autoDesc, (s) => s.setHeading()),
			row(t.startupName, t.startupDesc, (s) =>
				s.addToggle((toggle) =>
					toggle.setValue(settings.syncOnStartup).onChange(async (value) => {
						settings.syncOnStartup = value;
						await this.plugin.saveSettings();
					}),
				),
			),
			row(t.intervalName, t.intervalDesc, (s) =>
				s.addDropdown((dropdown) => {
					for (const minutes of SYNC_INTERVALS) dropdown.addOption(String(minutes), t.intervalOption(minutes));
					dropdown.setValue(String(settings.syncInterval)).onChange(async (value) => {
						settings.syncInterval = Number(value);
						await this.plugin.saveSettings();
					});
				}),
			),
			row(t.afterEditName, t.afterEditDesc(SYNC_AFTER_EDIT_SECONDS), (s) =>
				s.addToggle((toggle) =>
					toggle.setValue(settings.syncAfterEdit).onChange(async (value) => {
						settings.syncAfterEdit = value;
						await this.plugin.saveSettings();
					}),
				),
			),
		];
	}

	private secretRow(name: string, desc: string, secretId: string, visible: () => boolean): Row {
		return row(
			name,
			desc,
			(s) =>
				s.addText((text) => {
					text.inputEl.type = 'password';
					text.setValue(this.app.secretStorage.getSecret(secretId) ?? '').onChange((value) => {
						this.app.secretStorage.setSecret(secretId, value);
						this.plugin.resetClient();
					});
				}),
			{ visible },
		);
	}

	private async loadSpaces(): Promise<void> {
		const remote = await this.plugin.getClient().listSpaces();
		const enabled = new Set(this.plugin.settings.spaces.filter((s) => s.enabled).map((s) => s.id));
		this.plugin.settings.spaces = remote.map((s) => ({ id: s.id, name: s.name, slug: s.slug, enabled: enabled.has(s.id) }));
		await this.plugin.saveSettings();
	}
}
