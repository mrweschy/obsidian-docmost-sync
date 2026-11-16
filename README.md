# Docmost Sync for Obsidian

Two-way sync between [Docmost](https://docmost.com) spaces and a folder in your Obsidian vault, including images and attachments.

- Pulls the page tree of the selected spaces as Markdown notes (one subfolder per space).
- Pushes local edits, renamed notes (as new page titles) and new notes (as new pages) back to Docmost.
- Downloads images and attachments into the vault and uploads new local images and files.
- Detects conflicts and never silently overwrites your local changes.
- Syncs automatically on startup, at a regular interval and shortly after you edit a note, or manually on demand.

## Requirements

- Obsidian 1.11.4 or newer. Tested with Obsidian 1.15.1 on macOS, Linux and Windows. The plugin is meant to run on mobile too, but this has not been tested yet, in particular logging in with email and password.
- A recent Docmost version: the plugin uses the Markdown content API that Docmost added in early 2026. Tested with Docmost v0.97.0.
- Either
  - an **API key** (Docmost Enterprise; create it under *Settings > API keys*), or
  - **email and password** of a Docmost account (works with the Community edition). Accounts with MFA or enforced SSO cannot log in this way.

## Network use, accounts and data

- **Network:** The plugin connects only to the Docmost server whose URL you enter. It logs in there and downloads and uploads pages, images and attachments. It sends nothing to any other service and collects no telemetry.
- **Account:** You need an account on a Docmost server. The plugin is free. Logging in with an API key requires a paid Docmost Enterprise license; email and password work with the free Community edition.
- **Files:** The plugin reads and changes only the notes and attachments in the vault folder you set for it, and its own settings. When it renames or moves a note, Obsidian updates links to it in other notes, as with any rename, if *Automatically update internal links* is on. Notes it removes go to the trash you chose under *Settings > Files and links*; folders it empties are deleted. Your credentials are kept in Obsidian's secret storage.

## Installation

In Obsidian, open *Settings > Community plugins*, select **Browse**, search for **Docmost Sync**, then select **Install** and **Enable**.

To install a version by hand, download `main.js`, `manifest.json` and `styles.css` from the [releases](https://github.com/mrweschy/obsidian-docmost-sync/releases), copy them to `<your vault>/.obsidian/plugins/docmost-sync/` and enable **Docmost Sync** under *Settings > Community plugins*.

## Setup

1. Open *Settings > Docmost Sync*.
2. Enter your Docmost URL, e.g. `https://docs.example.com`.
3. Choose the authentication method and enter your credentials. They are stored in Obsidian's secret storage, not in the plugin's `data.json`.
4. Optionally change the vault folder (default: `Docmost`). This is a folder *inside* your vault, so a vault named `Notes` gets `Notes/Docmost/…`.
5. Click **Test**, then **Load spaces** and enable the spaces you want to sync.

The plugin uses Obsidian's display language (*Settings > General > Language*). English, German and French are available; other languages fall back to English. Error messages about the connection to Docmost and the file names the sync creates (conflict copies, pages without a title) stay in English.

## Usage

### Automatic sync

By default the plugin syncs on its own. Each trigger can be changed under *Settings > Docmost Sync > Automatic sync*:

| Trigger | Default | What it is for |
| --- | --- | --- |
| Sync on startup | on | Fetches everything that changed while Obsidian was closed. |
| Sync interval | every 5 minutes | Fetches changes made in Docmost (Docmost cannot notify the plugin, so it has to ask). |
| Sync after editing | on | Uploads your changes 30 seconds after you stop editing a note in a space folder. |

Automatic syncs never touch a note you edited in the last 15 seconds; it is synced once you pause. They run quietly: the status bar shows `Docmost: synced 14:05` or the number of errors (hover for details), and a notice appears only for conflicts.

### Manual sync

Click the **Sync with Docmost** icon in the ribbon, or open the command palette (`Cmd/Ctrl+P`) and run **Docmost Sync: Sync now**. If you do not see the icon, the ribbon is probably hidden (*Settings > Appearance > Show ribbon*); the command always works.

A notice shows what was pulled, pushed, created and removed. Errors are listed in the notice and logged to the developer console (`Cmd/Ctrl+Shift+I`).

### Which notes are synced

Only Markdown notes inside `<vault folder>/<space name>/` (e.g. `Docmost/General/`) take part in the sync. Notes anywhere else in the vault are never read, uploaded or changed. To turn an existing note into a Docmost page, move it into a space folder and sync. The `_attachments` folders and conflict copies are not uploaded as pages.

### Layout

```
Docmost/
  General/                      ← one folder per space
    Parent page.md
    Parent page/                ← children of "Parent page"
      Child page.md
    _attachments/               ← images and files of this space
      diagram-1a2b3c4d.png
```

Each synced note carries `docmost_id` and `docmost_url` in its frontmatter. Your own frontmatter properties are kept and are not sent to Docmost. `docmost_id` and `docmost_url` are hidden in the note; you can still see them in source mode and in the *File properties* view.

File and folder names follow the page titles. Characters that are not allowed in file names (such as `:` or `?`) become spaces, trailing dots are dropped and names Windows reserves get an underscore (`CON` becomes `CON_`). This happens on every platform, so a vault you share between devices has the same paths everywhere. The page title in Docmost stays unchanged.

Images and files you paste or drop into a note inside a space folder are stored in that space's `_attachments` folder; notes elsewhere keep Obsidian's attachment setting (*Settings > Files and links*). You can move or rename attachment files in Obsidian; the plugin keeps track of them, so they are not uploaded or downloaded again. The `_attachments` folders are hidden in the file explorer unless you turn off *Hide attachment folders* in the plugin settings.

### Subpages

In the file explorer, a page with subpages appears as a single folder, like in Docmost: click its name to open the page, click the arrow to show its subpages. To add a subpage, right-click a page and choose **New subpage**; a page without subpages gets its folder this way. To add a top-level page, right-click the space folder and choose **New page**. Renaming or moving the folder also renames or moves the page and vice versa. To see the page notes and folders separately, turn off *Show pages with subpages as one item* in the plugin settings.

### What happens on sync

| Situation | Result |
| --- | --- |
| Page changed in Docmost | Note is updated. |
| Note changed in Obsidian | Page is updated in Docmost. The note is then rewritten with Docmost's version of the Markdown so both sides stay identical. |
| Changed on both sides | Docmost's version goes into the note. Your version is saved next to it as `<name> (conflict <date>).md`; this copy is never uploaded. |
| Note renamed in Obsidian | Page title is updated in Docmost. |
| Page renamed or moved in Docmost | Note (and its children) is moved accordingly. |
| New note inside a space folder | New page is created. Its parent is the note whose folder it is in (`Parent page.md` for `Parent page/…`), otherwise the space root. |
| Page deleted in Docmost | Note is moved to the trash if unchanged, otherwise kept. Its images and files go to the trash as well, unless a note or canvas still links to them. |
| Note deleted in Obsidian | Nothing is deleted in Docmost; the note is downloaded again on the next sync. |

### Limitations

- **Pushing replaces the page content with the Markdown version.** Docmost-specific content that has no Markdown equivalent (e.g. diagrams, embeds, mentions, colors) can be simplified or lost when you edit such a page in Obsidian. Pages you only read in Obsidian are not affected.
- Obsidian-specific syntax is not understood by Docmost: `[[wikilinks]]`, callouts (`> [!note]`) and similar are escaped and come back as plain text. Image embeds (`![[image.png]]`) are converted to regular image links and uploaded. A PDF embed (`![[file.pdf]]` or `![](file.pdf)`) on its own line becomes a Docmost PDF viewer; inside a paragraph it becomes a link.
- Moving or deleting notes in Obsidian is not transferred to Docmost.
- Links between Docmost pages keep pointing to the Docmost web app.
- Changes made in Docmost arrive with the next interval sync, not instantly.
