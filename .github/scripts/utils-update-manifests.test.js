import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { bumpManifests, isOutdated, readCurrentVersions, readInstalledVersion } from './utils-update-manifests.js';

let directory;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), 'utils-update-manifests-'));
});

afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

const writeManifest = (name, manifest) => {
	const manifestPath = join(directory, name);
	writeFileSync(manifestPath, typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
	return manifestPath;
};

describe('readCurrentVersions', () => {
	it('fails for a manifest that does not depend on @sapphire-sh/utils', () => {
		const root = writeManifest('root.json', { devDependencies: { '@sapphire-sh/utils': '^2.6.0' } });
		const nested = writeManifest('nested.json', { dependencies: { prettier: '^3.6.2' } });
		assert.throws(() => readCurrentVersions([root, nested]), {
			message: `@sapphire-sh/utils is not a dependency of ${nested}`,
		});
	});
});

describe('isOutdated', () => {
	it('is true when only one of several manifests is behind the latest version', () => {
		const root = writeManifest('root.json', { devDependencies: { '@sapphire-sh/utils': '^2.6.0' } });
		const nested = writeManifest('nested.json', { dependencies: { '@sapphire-sh/utils': '^2.5.0' } });
		const currentVersions = readCurrentVersions([root, nested]);
		assert.deepEqual(currentVersions, [
			{ manifestPath: root, version: '2.6.0' },
			{ manifestPath: nested, version: '2.5.0' },
		]);
		assert.equal(isOutdated(currentVersions, '2.6.0'), true);
	});

	it('is false when every manifest matches the latest version', () => {
		const root = writeManifest('root.json', { devDependencies: { '@sapphire-sh/utils': '^2.6.0' } });
		const nested = writeManifest('nested.json', { dependencies: { '@sapphire-sh/utils': '~2.6.0' } });
		assert.equal(isOutdated(readCurrentVersions([root, nested]), '2.6.0'), false);
	});
});

describe('bumpManifests', () => {
	it('keeps the range prefix and the tab indentation', () => {
		const manifestPath = writeManifest(
			'package.json',
			'{\n\t"name": "example",\n\t"devDependencies": {\n\t\t"@sapphire-sh/utils": "^2.5.0"\n\t}\n}\n',
		);
		bumpManifests([manifestPath], '2.6.0');
		assert.equal(
			readFileSync(manifestPath, 'utf8'),
			'{\n\t"name": "example",\n\t"devDependencies": {\n\t\t"@sapphire-sh/utils": "^2.6.0"\n\t}\n}\n',
		);
	});
});

describe('readInstalledVersion', () => {
	it('reads the installed version from the lockfile beside the first manifest', () => {
		mkdirSync(join(directory, 'web'));
		writeManifest('package-lock.json', { packages: { 'node_modules/@sapphire-sh/utils': { version: '2.8.0' } } });
		writeManifest('web/package-lock.json', { packages: { 'node_modules/@sapphire-sh/utils': { version: '2.9.0' } } });
		assert.equal(
			readInstalledVersion([join(directory, 'web', 'package.json'), join(directory, 'package.json')]),
			'2.9.0',
		);
	});
});
