import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { slackToMd } from './notify-mattermost-proxy.js';

describe('slackToMd', () => {
	it('converts a Slack link into a Markdown link', () => {
		assert.equal(slackToMd('see <https://example.com/run|run 12> now'), 'see [run 12](https://example.com/run) now');
	});

	it('leaves a link whose label carries an opening angle bracket as it is', () => {
		assert.equal(slackToMd('<https://example.com|a <b> c>'), '<https://example.com|a <b> c>');
	});

	it('returns an empty string for a missing text', () => {
		assert.equal(slackToMd(undefined), '');
	});
});
