#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const PACKAGE_NAME = '@sapphire-sh/utils';

export const readCurrentVersions = (manifestPaths) =>
	manifestPaths.map((manifestPath) => {
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
		const range = manifest.dependencies?.[PACKAGE_NAME] ?? manifest.devDependencies?.[PACKAGE_NAME] ?? '';
		const version = range.replace(/^[^0-9]*/, '');
		if (version === '') {
			throw new Error(`${PACKAGE_NAME} is not a dependency of ${manifestPath}`);
		}
		return { manifestPath, version };
	});

export const isOutdated = (currentVersions, latest) => currentVersions.some(({ version }) => version !== latest);

export const bumpManifests = (manifestPaths, version) => {
	for (const manifestPath of manifestPaths) {
		const text = readFileSync(manifestPath, 'utf8');
		const manifest = JSON.parse(text);
		for (const field of ['dependencies', 'devDependencies']) {
			const range = manifest[field]?.[PACKAGE_NAME];
			if (range === undefined) {
				continue;
			}
			manifest[field][PACKAGE_NAME] = range.replace(/^([^0-9]*).*$/, '$1') + version;
		}
		// Rewriting with the indentation the file already uses keeps a tab-indented manifest
		// passing the prettier check that runs later in the update job.
		const indent = text.match(/^[ \t]+/m)?.[0] ?? 2;
		writeFileSync(manifestPath, JSON.stringify(manifest, null, indent) + '\n');
	}
};

export const readInstalledVersion = ([manifestPath]) =>
	JSON.parse(readFileSync(join(dirname(manifestPath), 'package-lock.json'), 'utf8')).packages[
		`node_modules/${PACKAGE_NAME}`
	].version;

if (import.meta.filename === process.argv[1]) {
	const [command, version, ...manifestPaths] = process.argv.slice(2);
	if (command === 'check') {
		const currentVersions = readCurrentVersions(manifestPaths);
		for (const { manifestPath, version: current } of currentVersions) {
			console.error(
				current === version
					? `${manifestPath} is already up to date (${current})`
					: `${manifestPath} has an update available (${current} -> ${version})`,
			);
		}
		process.stdout.write(`outdated=${isOutdated(currentVersions, version)}\n`);
	} else if (command === 'bump') {
		bumpManifests(manifestPaths, version);
	} else if (command === 'installed') {
		const [, ...manifestPaths] = process.argv.slice(2);
		process.stdout.write(`version=${readInstalledVersion(manifestPaths)}\n`);
	} else {
		throw new Error(`unknown command: ${command}`);
	}
}
