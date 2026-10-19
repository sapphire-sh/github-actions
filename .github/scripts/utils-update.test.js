import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { updateUtils } from './utils-update.js';

const PACKAGE_NAME = '@sapphire-sh/utils';
let directory;

const writeFile = (path, text) => {
	mkdirSync(dirname(join(directory, path)), { recursive: true });
	writeFileSync(join(directory, path), text);
};

const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, '\t')}\n`);
const trackFiles = () => execFileSync('git', ['add', '-A'], { cwd: directory });

const recordNpm = () => {
	const calls = [];
	const runNpm = (workingDirectory, argumentsList) => {
		calls.push([relative(directory, workingDirectory) || '.', argumentsList]);
		if (argumentsList[0] === 'view') {
			return '3.0.0\n';
		}
		if (argumentsList[0] === 'install') {
			const lockfilePath = join(workingDirectory, 'package-lock.json');
			const lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'));
			lockfile.packages[`node_modules/${PACKAGE_NAME}`] = { version: '3.0.0' };
			writeFileSync(lockfilePath, `${JSON.stringify(lockfile)}\n`);
		}
		return '';
	};
	return { calls, runNpm };
};

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), 'utils-update-'));
	execFileSync('git', ['init', '--quiet', directory]);
});

afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

describe('updateUtils', () => {
	it('updates dependency values while preserving the rest of each manifest', () => {
		const manifest =
			'{\r\n\t"name": "example",\r\n\t"description": "braces { } and escaped \\"quotes\\"",\r\n\t"dependencies": { "@sapphire-sh/utils": "~2.0.0", "other": "1.0.0" },\r\n\t"devDependencies": { "@sapphire-sh/utils": "^2.0.0" },\r\n\t"metadata": { "@sapphire-sh/utils": "2.0.0" }\r\n}\r\n';
		writeFile('package.json', manifest);
		writeJson('package-lock.json', { packages: { '': {} } });
		trackFiles();
		const { calls, runNpm } = recordNpm();

		assert.deepEqual(updateUtils(directory, { runNpm }), { changed: true, versions: ['3.0.0'] });
		assert.equal(
			readFileSync(join(directory, 'package.json'), 'utf8'),
			manifest.replace('~2.0.0', '~3.0.0').replace('^2.0.0', '^3.0.0'),
		);
		assert.deepEqual(calls, [
			['.', ['view', PACKAGE_NAME, 'version']],
			['.', ['install', '--ignore-scripts']],
		]);
	});

	it('installs independent manifests in their own lockfile directories', () => {
		for (const path of ['package.json', 'apps/web/package.json']) {
			writeJson(path, { dependencies: { [PACKAGE_NAME]: '2.0.0' } });
			writeJson(join(dirname(path), 'package-lock.json'), { packages: { '': {} } });
		}
		trackFiles();
		const { calls, runNpm } = recordNpm();

		assert.deepEqual(updateUtils(directory, { runNpm }), { changed: true, versions: ['3.0.0'] });
		assert.deepEqual(calls, [
			['.', ['view', PACKAGE_NAME, 'version']],
			['apps/web', ['install', '--ignore-scripts']],
			['.', ['install', '--ignore-scripts']],
		]);
		for (const path of ['package.json', 'apps/web/package.json']) {
			assert.deepEqual(JSON.parse(readFileSync(join(directory, path), 'utf8')), {
				dependencies: { [PACKAGE_NAME]: '3.0.0' },
			});
		}
	});

	it('installs a shared workspace lockfile once and checks scripts in stage order', () => {
		const scripts = { bootstrap: 'bootstrap', build: 'build', lint: 'lint', prettier: 'prettier', test: 'test' };
		writeJson('package.json', {
			workspaces: ['packages/*'],
			devDependencies: { [PACKAGE_NAME]: '^2.0.0' },
			scripts,
		});
		writeJson('packages/web/package.json', { name: 'web', dependencies: { [PACKAGE_NAME]: '~2.0.0' }, scripts });
		writeJson('package-lock.json', {
			packages: { '': {}, 'packages/web': {}, 'node_modules/web': { resolved: 'packages/web', link: true } },
		});
		trackFiles();
		const { calls, runNpm } = recordNpm();

		assert.deepEqual(updateUtils(directory, { runNpm, rebuildPackages: ['native-package'], runTests: true }), {
			changed: true,
			versions: ['3.0.0'],
		});
		assert.deepEqual(calls, [
			['.', ['view', PACKAGE_NAME, 'version']],
			['.', ['install', '--ignore-scripts']],
			['.', ['rebuild', 'native-package']],
			['.', ['run', 'bootstrap']],
			['.', ['run', 'build']],
			['.', ['run', 'build', '--workspace', 'packages/web']],
			['.', ['run', 'lint']],
			['.', ['run', 'lint', '--workspace', 'packages/web']],
			['.', ['run', 'prettier']],
			['.', ['run', 'prettier', '--workspace', 'packages/web']],
			['.', ['test']],
			['.', ['test', '--workspace', 'packages/web']],
		]);
	});

	it('keeps independent nested projects separate from an ancestor lockfile', () => {
		writeJson('package.json', { name: 'root' });
		writeJson('package-lock.json', { packages: { '': {} } });
		writeJson('tools/package.json', { devDependencies: { [PACKAGE_NAME]: '^2.0.0' } });
		trackFiles();
		const calls = [];
		const runNpm = (workingDirectory, argumentsList) => {
			calls.push([relative(directory, workingDirectory) || '.', argumentsList]);
			if (argumentsList[0] === 'view') return '3.0.0\n';
			writeFile(
				'tools/package-lock.json',
				JSON.stringify({ packages: { [`node_modules/${PACKAGE_NAME}`]: { version: '3.0.0' } } }),
			);
			return '';
		};

		assert.deepEqual(updateUtils(directory, { runNpm }), { changed: true, versions: ['3.0.0'] });
		assert.deepEqual(calls, [
			['.', ['view', PACKAGE_NAME, 'version']],
			['tools', ['install', '--ignore-scripts']],
		]);
	});

	it('runs bootstrap only when the root is an installation directory', () => {
		writeJson('package.json', { name: 'root', scripts: { bootstrap: 'bootstrap' } });
		writeJson('tools/package.json', { devDependencies: { [PACKAGE_NAME]: '^2.0.0' } });
		writeJson('tools/package-lock.json', { packages: { '': {} } });
		trackFiles();
		const { calls, runNpm } = recordNpm();

		assert.deepEqual(updateUtils(directory, { runNpm }), { changed: true, versions: ['3.0.0'] });
		assert.deepEqual(calls, [
			['.', ['view', PACKAGE_NAME, 'version']],
			['tools', ['install', '--ignore-scripts']],
		]);
	});

	it('finishes after the version lookup when all manifests are current', () => {
		writeJson('package.json', { devDependencies: { [PACKAGE_NAME]: '^3.0.0' } });
		trackFiles();
		const { calls, runNpm } = recordNpm();

		assert.deepEqual(updateUtils(directory, { runNpm }), { changed: false, versions: [] });
		assert.deepEqual(calls, [['.', ['view', PACKAGE_NAME, 'version']]]);
	});

	it('reports the version installed after the registry lookup', () => {
		writeJson('package.json', { devDependencies: { [PACKAGE_NAME]: '^2.0.0' } });
		writeJson('package-lock.json', { packages: { '': {} } });
		trackFiles();
		const { runNpm } = recordNpm();
		const installNewerVersion = (workingDirectory, argumentsList) => {
			const output = runNpm(workingDirectory, argumentsList);
			if (argumentsList[0] === 'install') {
				writeJson('package-lock.json', { packages: { [`node_modules/${PACKAGE_NAME}`]: { version: '3.1.0' } } });
			}
			return output;
		};

		assert.deepEqual(updateUtils(directory, { runNpm: installNewerVersion }), {
			changed: true,
			versions: ['3.1.0'],
		});
	});

	it('prints workflow outputs from a standalone copy of the helper', () => {
		writeJson('package.json', { name: 'example' });
		trackFiles();
		const helperPath = join(directory, 'helper.mjs');
		copyFileSync(new URL('./utils-update.js', import.meta.url), helperPath);

		assert.equal(
			execFileSync(process.execPath, [helperPath, '', 'false'], { cwd: directory, encoding: 'utf8' }),
			'changed=false\nversion=\n',
		);
	});

	it('selects tracked consumers and leaves other dependency records intact', () => {
		const rootManifest = { name: 'root', dependencies: { other: '1.0.0' } };
		writeJson('package.json', rootManifest);
		writeJson('web/package.json', { devDependencies: { [PACKAGE_NAME]: '^2.0.0' }, scripts: { test: 'test' } });
		writeJson('web/package-lock.json', { packages: { '': {} } });
		trackFiles();
		const untrackedManifest = JSON.stringify({ dependencies: { [PACKAGE_NAME]: '^1.0.0' } });
		writeFile('untracked/package.json', untrackedManifest);
		const { calls, runNpm } = recordNpm();

		assert.deepEqual(updateUtils(directory, { runNpm }), { changed: true, versions: ['3.0.0'] });
		assert.deepEqual(JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')), rootManifest);
		assert.equal(readFileSync(join(directory, 'untracked/package.json'), 'utf8'), untrackedManifest);
		assert.deepEqual(calls, [
			['.', ['view', PACKAGE_NAME, 'version']],
			['web', ['install', '--ignore-scripts']],
		]);
	});

	it('finishes without an npm lookup when no tracked manifest consumes utils', () => {
		writeJson('package.json', { name: 'example' });
		trackFiles();
		const { calls, runNpm } = recordNpm();

		assert.deepEqual(updateUtils(directory, { runNpm }), { changed: false, versions: [] });
		assert.deepEqual(calls, []);
	});
});
