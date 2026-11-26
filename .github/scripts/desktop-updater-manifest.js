#!/usr/bin/env node

import { readFileSync } from 'node:fs';

export const buildUpdaterManifest = (version, pubDate, url, signature) => ({
	version,
	pub_date: pubDate,
	platforms: {
		'darwin-aarch64': { url, signature },
	},
});

if (import.meta.filename === process.argv[1]) {
	const manifest = buildUpdaterManifest(
		process.env.APP_VERSION,
		new Date().toISOString(),
		process.env.ASSET_URL,
		readFileSync(process.env.SIGNATURE_FILE, 'utf8'),
	);
	process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}
