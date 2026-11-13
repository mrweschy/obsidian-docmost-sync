# Docmost Sync for Obsidian

Two-way sync between [Docmost](https://docmost.com) spaces and a folder in your Obsidian vault, including images and attachments.

- Pulls the page tree of the selected spaces as Markdown notes (one subfolder per space).
- Pushes local edits, renamed notes (as new page titles) and new notes (as new pages) back to Docmost.
- Downloads images and attachments into the vault and uploads new local images.
- Detects conflicts and never silently overwrites your local changes.

## Requirements

- Obsidian 1.11.4 or newer. Tested with Obsidian 1.15.1 on macOS.
- A recent Docmost version: the plugin uses the Markdown content API that Docmost added in early 2026. Tested with Docmost v0.97.0.
- Either
  - an **API key** (Docmost Enterprise; create it under *Settings > API keys*), or
  - **email and password** of a Docmost account (works with the Community edition). Accounts with MFA or enforced SSO cannot log in this way.

## Installation

The plugin is not in the community plugin directory. Install it manually:

1. `npm install && npm run build`
2. Copy `main.js` and `manifest.json` to `<your vault>/.obsidian/plugins/docmost-sync/`.
3. In Obsidian, open *Settings > Community plugins* and enable **Docmost Sync**.

## Setup

1. Open *Settings > Docmost Sync*.
2. Enter your Docmost URL, e.g. `https://docs.example.com`.
3. Choose the authentication method and enter your credentials. They are stored in Obsidian's secret storage, not in the plugin's `data.json`.
4. Optionally change the vault folder (default: `Docmost`). This is a folder *inside* your vault, so a vault named `Notes` gets `Notes/Docmost/…`.
5. Click **Test**, then **Load spaces** and enable the spaces you want to sync.

## Usage

Sync is started manually: click the **Sync with Docmost** icon in the ribbon, or open the command palette (`Cmd/Ctrl+P`) and run **Docmost Sync: Sync now**. If you do not see the icon, the ribbon is probably hidden (*Settings > Appearance > Show ribbon*); the command always works.

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

Each synced note carries `docmost_id` and `docmost_url` in its frontmatter. Your own frontmatter properties are kept and are not sent to Docmost.

### What happens on sync

| Situation | Result |
| --- | --- |
| Page changed in Docmost | Note is updated. |
| Note changed in Obsidian | Page is updated in Docmost. The note is then rewritten with Docmost's version of the Markdown so both sides stay identical. |
| Changed on both sides | Docmost's version goes into the note. Your version is saved next to it as `<name> (conflict <date>).md`; this copy is never uploaded. |
| Note renamed in Obsidian | Page title is updated in Docmost. |
| Page renamed or moved in Docmost | Note (and its children) is moved accordingly. |
| New note inside a space folder | New page is created. Its parent is the note whose folder it is in (`Parent page.md` for `Parent page/…`), otherwise the space root. |
| Page deleted in Docmost | Note is moved to the trash if unchanged, otherwise kept. |
| Note deleted in Obsidian | Nothing is deleted in Docmost; the note is downloaded again on the next sync. |

### Limitations

- **Pushing replaces the page content with the Markdown version.** Docmost-specific content that has no Markdown equivalent (e.g. diagrams, embeds, mentions, colors) can be simplified or lost when you edit such a page in Obsidian. Pages you only read in Obsidian are not affected.
- Obsidian-specific syntax is not understood by Docmost: `[[wikilinks]]`, callouts (`> [!note]`) and similar are escaped and come back as plain text. Image embeds (`![[image.png]]`) are converted to regular image links and uploaded.
- Moving or deleting notes in Obsidian is not transferred to Docmost.
- Links between Docmost pages keep pointing to the Docmost web app.
- There is no automatic sync interval; sync is started manually.

## Development

```sh
npm install
npm run dev     # rebuild on change
npm run build   # type-check and production build
npm test        # unit tests
```

### Local Docmost test server

`dev/docker-compose.yml` starts Docmost with PostgreSQL and Redis at http://localhost:3456 (data is kept in Docker volumes):

```sh
docker compose -f dev/docker-compose.yml up -d
# Open http://localhost:3456 once and create a workspace and an account.
docker compose -f dev/docker-compose.yml down      # stop, keep data
docker compose -f dev/docker-compose.yml down -v   # stop and delete data
```

The compose file contains fixed development secrets. Use it for local testing only.

### End-to-end tests

End-to-end tests run against a real Docmost server and are skipped unless configured:

```sh
DOCMOST_E2E_URL=http://localhost:3456 DOCMOST_E2E_EMAIL=you@example.com DOCMOST_E2E_PASSWORD=secret npm test
```

The tests create and delete their own space. Docmost allows 10 logins per minute, so wait a moment between repeated runs.

### Testing in Obsidian

Copy `main.js` and `manifest.json` into `<test vault>/.obsidian/plugins/docmost-sync/` after each build and reload the plugin (toggle it off and on). With Obsidian's command line interface enabled (*Settings > General > Advanced*), this can be scripted:

```sh
obsidian plugin:reload id=docmost-sync
obsidian command id=docmost-sync:sync-now
```
