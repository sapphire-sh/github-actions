import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildPayload, fetchRunStartedAt } from './notify-build-payload.js';

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

describe('fetchRunStartedAt', () => {
	const options = { apiUrl: 'https://api.github.com', repository: 'owner/repo', runId: '123', token: 'token' };

	it('requests the workflow run with the token and returns its run_started_at', async () => {
		const requests = [];
		const fetch = async (url, init) => {
			requests.push({ url, init });
			return { ok: true, json: async () => ({ run_started_at: '2026-01-01T00:00:00Z' }) };
		};
		assert.equal(await fetchRunStartedAt({ ...options, fetch }), '2026-01-01T00:00:00Z');
		assert.deepEqual(requests, [
			{
				url: 'https://api.github.com/repos/owner/repo/actions/runs/123',
				init: { headers: { Authorization: 'Bearer token', Accept: 'application/vnd.github+json' } },
			},
		]);
	});

	it('returns an empty string when the response is not ok', async () => {
		const fetch = async () => ({ ok: false });
		assert.equal(await fetchRunStartedAt({ ...options, fetch }), '');
	});

	it('returns an empty string when the request rejects', async () => {
		const fetch = async () => {
			throw new Error('network error');
		};
		assert.equal(await fetchRunStartedAt({ ...options, fetch }), '');
	});
});
