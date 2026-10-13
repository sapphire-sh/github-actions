import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildPayload } from './notify-build-payload.js';

const authorOf = (attachment) => attachment.fields.find((field) => field.title === 'author').value;

describe('buildPayload', () => {
	it('titles a pull_request run with the pull request number and title and names the pull request author', () => {
		const [attachment] = buildPayload({
			PR_NUMBER: '12',
			PR_TITLE: 'Bump example from 1.0.0 to 1.1.0',
			PR_AUTHOR: 'dependabot[bot]',
			PR_URL: 'https://github.com/owner/repo/pull/12',
		}).attachments;
		assert.equal(attachment.title, '#12: Bump example from 1.0.0 to 1.1.0');
		assert.equal(attachment.title_link, 'https://github.com/owner/repo/pull/12');
		assert.equal(authorOf(attachment), 'dependabot[bot]');
	});

	it('titles a push run with the short commit SHA and the first message line and names the commit author', () => {
		const [attachment] = buildPayload({
			SERVER_URL: 'https://github.com',
			REPOSITORY: 'owner/repo',
			SHA: '0123456789abcdef',
			COMMIT_MESSAGE: 'First line\nSecond line',
			COMMIT_AUTHOR_NAME: 'Example',
			COMMIT_AUTHOR_EMAIL: 'example@example.com',
		}).attachments;
		assert.equal(attachment.title, '0123456: First line');
		assert.equal(attachment.title_link, 'https://github.com/owner/repo/commit/0123456789abcdef');
		assert.equal(authorOf(attachment), 'Example <example@example.com>');
	});
});
