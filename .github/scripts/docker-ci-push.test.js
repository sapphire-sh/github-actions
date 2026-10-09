import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { shouldPushImage } from './docker-ci-push.js';

describe('shouldPushImage', () => {
	it('is false on a pull_request event even when push_image is true', () => {
		assert.equal(shouldPushImage('pull_request', true), false);
	});

	it('follows push_image on a push event', () => {
		assert.equal(shouldPushImage('push', true), true);
		assert.equal(shouldPushImage('push', false), false);
	});
});
