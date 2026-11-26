#!/usr/bin/env node

import { readFileSync } from 'node:fs';

export const buildDesktopVersion = (version, runNumber) => {
	const match = /^(\d+)\.(\d+)\.\d+$/.exec(version);
	if (match === null) {
		throw new Error(`tauri.conf.json version is not major.minor.patch: ${version}`);
	}
	return `${match[1]}.${match[2]}.${runNumber}`;
};

if (import.meta.filename === process.argv[1]) {
	const config = JSON.parse(readFileSync(process.env.TAURI_CONFIG, 'utf8'));
	process.stdout.write(`version=${buildDesktopVersion(config.version, process.env.RUN_NUMBER)}\n`);
}
