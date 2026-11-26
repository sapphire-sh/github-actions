import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildUpdaterManifest } from './desktop-updater-manifest.js';

describe('buildUpdaterManifest', () => {
	it('puts the asset url and the signature under darwin-aarch64', () => {
		assert.deepEqual(
			buildUpdaterManifest(
				'1.4.37',
				'2026-11-27T01:30:00.000Z',
				'https://api.github.com/repos/example/app/releases/assets/1024',
				'c2lnbmF0dXJl',
			),
			{
				version: '1.4.37',
				pub_date: '2026-11-27T01:30:00.000Z',
				platforms: {
					'darwin-aarch64': {
						url: 'https://api.github.com/repos/example/app/releases/assets/1024',
						signature: 'c2lnbmF0dXJl',
					},
				},
			},
		);
	});
});
