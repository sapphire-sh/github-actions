import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildDesktopVersion } from './desktop-build-version.js';

describe('buildDesktopVersion', () => {
	it('keeps major and minor and puts the run number in the patch place', () => {
		assert.equal(buildDesktopVersion('1.4.0', '37'), '1.4.37');
	});

	it('throws when the version is a path rather than major.minor.patch', () => {
		assert.throws(
			() => buildDesktopVersion('../package.json', '37'),
			new Error('tauri.conf.json version is not major.minor.patch: ../package.json'),
		);
	});
});
