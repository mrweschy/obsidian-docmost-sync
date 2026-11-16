# Development

```sh
npm install
npm run dev     # rebuild on change
npm run build   # type-check and production build
npm test        # unit tests
npm run lint    # the ESLint rules Obsidian's community directory reviews plugins with
```

UI strings live in `src/i18n.ts`. To add a language, add an object for it there and register it in `LANGUAGES`; the type check reports any missing string.

## Local Docmost test server

`dev/docker-compose.yml` starts Docmost with PostgreSQL and Redis at http://localhost:3456 (data is kept in Docker volumes):

```sh
docker compose -f dev/docker-compose.yml up -d
# Open http://localhost:3456 once and create a workspace and an account.
docker compose -f dev/docker-compose.yml down      # stop, keep data
docker compose -f dev/docker-compose.yml down -v   # stop and delete data
```

The compose file contains fixed development secrets. Use it for local testing only.

## End-to-end tests

End-to-end tests run against a real Docmost server and are skipped unless configured:

```sh
DOCMOST_E2E_URL=http://localhost:3456 DOCMOST_E2E_EMAIL=you@example.com DOCMOST_E2E_PASSWORD=secret npm test
```

The tests create and delete their own space. Docmost allows 10 logins per minute, so wait a moment between repeated runs.

## Testing in Obsidian

Copy `main.js`, `manifest.json` and `styles.css` into `<test vault>/.obsidian/plugins/docmost-sync/` after each build and reload the plugin (toggle it off and on). With Obsidian's command line interface enabled (*Settings > General > Advanced*), this can be scripted:

```sh
obsidian plugin:reload id=docmost-sync
obsidian command id=docmost-sync:sync-now
```

## Releasing

1. `npm version patch` (or `minor`, `major`) sets the new version in `package.json`, `manifest.json` and `versions.json`, commits it and creates a tag without a `v` prefix, as Obsidian requires.
2. `git push --follow-tags` starts the release workflow (`.github/workflows/release.yml`). It lints, tests and builds the plugin and creates a draft release with `main.js`, `manifest.json` and `styles.css` and build attestations.
3. Publish the draft release on GitHub. Obsidian's community directory reviews every new release automatically.
