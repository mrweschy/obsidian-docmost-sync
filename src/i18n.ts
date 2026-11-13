import { getLanguage } from 'obsidian';

// UI strings of the plugin. English is the source and the fallback; every other language
// must provide all keys (enforced by the `Strings` type). Terms follow Docmost's own
// translations (e.g. "Bereich"/"Espace" for space).

interface SyncCounts {
	pulled: number;
	pushed: number;
	created: number;
	deleted: number;
}

const en = {
	ribbonSync: 'Sync with Docmost',
	commandSync: 'Sync now',
	newSubpage: 'New subpage',
	untitled: 'Untitled',

	missingUrl: 'Please enter your Docmost URL in the plugin settings.',
	missingApiKey: 'Please enter an API key in the plugin settings.',
	missingPassword: 'Please enter email and password in the plugin settings.',

	syncRunning: 'Docmost: a sync is already running.',
	noSpacesSelected: 'Docmost: no spaces selected. Choose spaces in the plugin settings.',
	syncing: 'Docmost: syncing…',
	syncFailed: (message: string) => `Docmost sync failed: ${message}`,
	statusSynced: (time: string) => `Docmost: synced ${time}`,
	statusErrors: (n: number) => `Docmost: ${n} sync ${n === 1 ? 'error' : 'errors'}`,
	statusFailed: 'Docmost: sync failed',
	summary: (r: SyncCounts) => `Docmost: ${r.pulled} pulled, ${r.pushed} pushed, ${r.created} created, ${r.deleted} removed.`,
	summaryConflicts: (n: number) =>
		`${n} ${n === 1 ? 'conflict' : 'conflicts'}, local versions saved as "(conflict …)" notes.`,
	summaryKept: (n: number) => `${n} locally modified ${n === 1 ? 'note' : 'notes'} kept although deleted in Docmost.`,
	summaryErrors: (n: number, first: string, more: boolean) =>
		`${n} ${n === 1 ? 'error' : 'errors'}: ${first}${more ? ' (see console)' : ''}`,

	urlName: 'Docmost URL',
	urlDesc: 'Address of your Docmost instance, e.g. https://docs.example.com',
	authName: 'Authentication',
	authDesc: 'API keys require a Docmost Enterprise license. Community editions use email and password.',
	authPassword: 'Email and password',
	authApiKey: 'API key',
	apiKeyDesc: 'Create one in Docmost under Settings > API keys.',
	emailName: 'Email',
	passwordName: 'Password',
	passwordDesc: 'Accounts with MFA or enforced SSO cannot log in this way; use an API key instead.',
	folderName: 'Vault folder',
	folderDesc: 'Docmost spaces are synced into subfolders of this folder.',
	combineName: 'Show pages with subpages as one item',
	combineDesc:
		'In the file explorer, a page with subpages appears as a single folder: click its name to open the page and the arrow to show its subpages.',
	hideName: 'Hide attachment folders',
	hideDesc: 'Hide the _attachments folders in the file explorer. Images and files are still shown in your notes.',
	testName: 'Test connection',
	testButton: 'Test',
	connected: (name: string) => `Connected to Docmost as ${name}.`,
	connectionFailed: (message: string) => `Connection failed: ${message}`,
	spacesName: 'Spaces',
	spacesDesc: 'Choose which spaces to sync.',
	loadSpaces: 'Load spaces',
	loadSpacesFailed: (message: string) => `Could not load spaces: ${message}`,
	noSpacesLoaded: 'No spaces loaded yet.',
	autoName: 'Automatic sync',
	autoDesc: 'Automatic syncs skip notes you are still editing and run quietly; a notice appears only for conflicts.',
	startupName: 'Sync on startup',
	startupDesc: 'Sync when Obsidian starts.',
	intervalName: 'Sync interval',
	intervalDesc: 'Regularly fetch changes made in Docmost.',
	intervalOption: (minutes: number) =>
		minutes === 0 ? 'Off' : minutes === 1 ? 'Every minute' : `Every ${minutes} minutes`,
	afterEditName: 'Sync after editing',
	afterEditDesc: (seconds: number) =>
		`Sync ${seconds} seconds after you stop editing a note in a synced space folder.`,
};

export type Strings = typeof en;

const de: Strings = {
	ribbonSync: 'Mit Docmost synchronisieren',
	commandSync: 'Jetzt synchronisieren',
	newSubpage: 'Neue Unterseite',
	untitled: 'Unbenannt',

	missingUrl: 'Bitte trage in den Plugin-Einstellungen die Adresse deines Docmost ein.',
	missingApiKey: 'Bitte trage in den Plugin-Einstellungen einen API-Schlüssel ein.',
	missingPassword: 'Bitte trage in den Plugin-Einstellungen E-Mail und Passwort ein.',

	syncRunning: 'Docmost: Es läuft bereits eine Synchronisierung.',
	noSpacesSelected: 'Docmost: Keine Bereiche ausgewählt. Wähle sie in den Plugin-Einstellungen aus.',
	syncing: 'Docmost: Synchronisiere…',
	syncFailed: (message) => `Docmost-Synchronisierung fehlgeschlagen: ${message}`,
	statusSynced: (time) => `Docmost: synchronisiert ${time}`,
	statusErrors: (n) => `Docmost: ${n} Sync-Fehler`,
	statusFailed: 'Docmost: Synchronisierung fehlgeschlagen',
	summary: (r) => `Docmost: ${r.pulled} geholt, ${r.pushed} hochgeladen, ${r.created} erstellt, ${r.deleted} entfernt.`,
	summaryConflicts: (n) =>
		`${n} ${n === 1 ? 'Konflikt' : 'Konflikte'}, deine lokalen Versionen sind als „(conflict …)“-Notizen gespeichert.`,
	summaryKept: (n) =>
		`${n} lokal ${n === 1 ? 'geänderte Notiz' : 'geänderte Notizen'} behalten, obwohl in Docmost gelöscht.`,
	summaryErrors: (n, first, more) => `${n} Fehler: ${first}${more ? ' (siehe Konsole)' : ''}`,

	urlName: 'Docmost-Adresse',
	urlDesc: 'Adresse deiner Docmost-Instanz, z. B. https://docs.example.com',
	authName: 'Anmeldung',
	authDesc: 'API-Schlüssel erfordern eine Docmost-Enterprise-Lizenz. Die Community-Edition nutzt E-Mail und Passwort.',
	authPassword: 'E-Mail und Passwort',
	authApiKey: 'API-Schlüssel',
	apiKeyDesc: 'Erstelle ihn in Docmost unter Einstellungen > API-Schlüssel.',
	emailName: 'E-Mail',
	passwordName: 'Passwort',
	passwordDesc:
		'Konten mit Zwei-Faktor-Authentifizierung oder erzwungenem SSO können sich so nicht anmelden; nutze stattdessen einen API-Schlüssel.',
	folderName: 'Ordner im Vault',
	folderDesc: 'Docmost-Bereiche werden in Unterordner dieses Ordners synchronisiert.',
	combineName: 'Seiten mit Unterseiten als einen Eintrag anzeigen',
	combineDesc:
		'Im Datei-Explorer erscheint eine Seite mit Unterseiten als ein einziger Ordner: Ein Klick auf den Namen öffnet die Seite, der Pfeil zeigt die Unterseiten.',
	hideName: 'Anhang-Ordner ausblenden',
	hideDesc: 'Blendet die _attachments-Ordner im Datei-Explorer aus. Bilder und Dateien werden in deinen Notizen weiterhin angezeigt.',
	testName: 'Verbindung testen',
	testButton: 'Testen',
	connected: (name) => `Mit Docmost verbunden als ${name}.`,
	connectionFailed: (message) => `Verbindung fehlgeschlagen: ${message}`,
	spacesName: 'Bereiche',
	spacesDesc: 'Wähle aus, welche Bereiche synchronisiert werden.',
	loadSpaces: 'Bereiche laden',
	loadSpacesFailed: (message) => `Bereiche konnten nicht geladen werden: ${message}`,
	noSpacesLoaded: 'Noch keine Bereiche geladen.',
	autoName: 'Automatische Synchronisierung',
	autoDesc:
		'Automatische Synchronisierungen überspringen Notizen, die du gerade bearbeitest, und laufen im Hintergrund; eine Meldung erscheint nur bei Konflikten.',
	startupName: 'Beim Start synchronisieren',
	startupDesc: 'Synchronisiert, wenn Obsidian startet.',
	intervalName: 'Synchronisierungsintervall',
	intervalDesc: 'Holt regelmäßig Änderungen aus Docmost.',
	intervalOption: (minutes) => (minutes === 0 ? 'Aus' : minutes === 1 ? 'Jede Minute' : `Alle ${minutes} Minuten`),
	afterEditName: 'Nach dem Bearbeiten synchronisieren',
	afterEditDesc: (seconds) =>
		`Synchronisiert ${seconds} Sekunden, nachdem du eine Notiz in einem synchronisierten Bereichsordner zuletzt bearbeitet hast.`,
};

/** French plural ending: 0 and 1 are singular. */
const s = (n: number) => (n > 1 ? 's' : '');

const fr: Strings = {
	ribbonSync: 'Synchroniser avec Docmost',
	commandSync: 'Synchroniser maintenant',
	newSubpage: 'Nouvelle sous-page',
	untitled: 'Sans titre',

	missingUrl: 'Veuillez saisir l’adresse de votre Docmost dans les paramètres du plugin.',
	missingApiKey: 'Veuillez saisir une clé API dans les paramètres du plugin.',
	missingPassword: 'Veuillez saisir l’e-mail et le mot de passe dans les paramètres du plugin.',

	syncRunning: 'Docmost : une synchronisation est déjà en cours.',
	noSpacesSelected: 'Docmost : aucun espace sélectionné. Choisissez des espaces dans les paramètres du plugin.',
	syncing: 'Docmost : synchronisation…',
	syncFailed: (message) => `Échec de la synchronisation Docmost : ${message}`,
	statusSynced: (time) => `Docmost : synchronisé à ${time}`,
	statusErrors: (n) => `Docmost : ${n} erreur${s(n)} de synchronisation`,
	statusFailed: 'Docmost : échec de la synchronisation',
	summary: (r) =>
		`Docmost : ${r.pulled} récupérée${s(r.pulled)}, ${r.pushed} envoyée${s(r.pushed)}, ` +
		`${r.created} créée${s(r.created)}, ${r.deleted} supprimée${s(r.deleted)}.`,
	summaryConflicts: (n) =>
		`${n} conflit${s(n)}, vos versions locales sont enregistrées dans des notes « (conflict …) ».`,
	summaryKept: (n) =>
		`${n} note${s(n)} modifiée${s(n)} localement conservée${s(n)} bien que supprimée${s(n)} dans Docmost.`,
	summaryErrors: (n, first, more) => `${n} erreur${s(n)} : ${first}${more ? ' (voir la console)' : ''}`,

	urlName: 'Adresse de Docmost',
	urlDesc: 'Adresse de votre instance Docmost, p. ex. https://docs.example.com',
	authName: 'Authentification',
	authDesc: 'Les clés API nécessitent une licence Docmost Enterprise. L’édition Community utilise l’e-mail et le mot de passe.',
	authPassword: 'E-mail et mot de passe',
	authApiKey: 'Clé API',
	apiKeyDesc: 'Créez-en une dans Docmost sous Paramètres > Clés API.',
	emailName: 'E-mail',
	passwordName: 'Mot de passe',
	passwordDesc:
		'Les comptes avec authentification à deux facteurs ou SSO obligatoire ne peuvent pas se connecter ainsi ; utilisez plutôt une clé API.',
	folderName: 'Dossier du coffre',
	folderDesc: 'Les espaces Docmost sont synchronisés dans des sous-dossiers de ce dossier.',
	combineName: 'Afficher les pages avec sous-pages comme un seul élément',
	combineDesc:
		'Dans l’explorateur de fichiers, une page avec des sous-pages apparaît comme un seul dossier : cliquez sur son nom pour ouvrir la page et sur la flèche pour afficher ses sous-pages.',
	hideName: 'Masquer les dossiers de pièces jointes',
	hideDesc:
		'Masque les dossiers _attachments dans l’explorateur de fichiers. Les images et fichiers restent affichés dans vos notes.',
	testName: 'Tester la connexion',
	testButton: 'Tester',
	connected: (name) => `Connecté à Docmost en tant que ${name}.`,
	connectionFailed: (message) => `Échec de la connexion : ${message}`,
	spacesName: 'Espaces',
	spacesDesc: 'Choisissez les espaces à synchroniser.',
	loadSpaces: 'Charger les espaces',
	loadSpacesFailed: (message) => `Impossible de charger les espaces : ${message}`,
	noSpacesLoaded: 'Aucun espace chargé pour l’instant.',
	autoName: 'Synchronisation automatique',
	autoDesc:
		'Les synchronisations automatiques ignorent les notes en cours de modification et s’exécutent discrètement ; un avis n’apparaît qu’en cas de conflit.',
	startupName: 'Synchroniser au démarrage',
	startupDesc: 'Synchronise au démarrage d’Obsidian.',
	intervalName: 'Intervalle de synchronisation',
	intervalDesc: 'Récupère régulièrement les modifications faites dans Docmost.',
	intervalOption: (minutes) =>
		minutes === 0 ? 'Désactivé' : minutes === 1 ? 'Chaque minute' : `Toutes les ${minutes} minutes`,
	afterEditName: 'Synchroniser après modification',
	afterEditDesc: (seconds) =>
		`Synchronise ${seconds} secondes après la dernière modification d’une note dans un dossier d’espace synchronisé.`,
};

const LANGUAGES: Record<string, Strings> = { en, de, fr };

/**
 * Strings in Obsidian's display language ("de", "fr", "pt-BR", …), falling back to English.
 * Obsidian only changes its language after a restart, so it is read once.
 */
export const t: Strings = LANGUAGES[getLanguage().split('-')[0] ?? 'en'] ?? en;
