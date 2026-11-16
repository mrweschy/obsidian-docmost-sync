// The rules the Obsidian community directory checks submitted plugins with.
import { defineConfig, globalIgnores } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
	// Build output, build scripts and tests are not plugin code; the directory's scanner skips them too.
	globalIgnores(['node_modules', 'main.js', 'esbuild.config.mjs', 'version-bump.mjs', 'tests']),
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.*'],
				},
			},
		},
	},
]);
