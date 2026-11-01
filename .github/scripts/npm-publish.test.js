import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { publishToNpm } from './npm-publish.js';

const PUBLISH_ARGUMENTS = ['publish', '--access', 'public', '--tag', 'latest'];
const TLOG_ERROR_OUTPUT =
	'npm error code TLOG_CREATE_ENTRY_ERROR\nnpm error error creating tlog entry - (409) an equivalent entry already exists in the transparency log\n';

const recordNpm = (results) => {
	const calls = [];
	const runNpm = (argumentsList) => {
		calls.push(argumentsList);
		return results[calls.length - 1];
	};
	return { calls, runNpm };
};

describe('publishToNpm', () => {
	it('publishes once when the first attempt succeeds', () => {
		const { calls, runNpm } = recordNpm([{ status: 0, output: '+ example@1.0.0\n' }]);

		assert.equal(publishToNpm({ runNpm }), 0);
		assert.deepEqual(calls, [PUBLISH_ARGUMENTS]);
	});

	it('publishes again once when the first attempt prints TLOG_CREATE_ENTRY_ERROR', () => {
		const { calls, runNpm } = recordNpm([
			{ status: 1, output: TLOG_ERROR_OUTPUT },
			{ status: 0, output: '+ example@1.0.0\n' },
		]);

		assert.equal(publishToNpm({ runNpm }), 0);
		assert.deepEqual(calls, [PUBLISH_ARGUMENTS, PUBLISH_ARGUMENTS]);
	});

	it('returns the second status when the publish after TLOG_CREATE_ENTRY_ERROR fails too', () => {
		const { calls, runNpm } = recordNpm([
			{ status: 1, output: TLOG_ERROR_OUTPUT },
			{ status: 1, output: TLOG_ERROR_OUTPUT },
		]);

		assert.equal(publishToNpm({ runNpm }), 1);
		assert.deepEqual(calls, [PUBLISH_ARGUMENTS, PUBLISH_ARGUMENTS]);
	});

	it('returns the failing status without another publish when the error is not TLOG_CREATE_ENTRY_ERROR', () => {
		const { calls, runNpm } = recordNpm([{ status: 1, output: 'npm error code E403\n' }]);

		assert.equal(publishToNpm({ runNpm }), 1);
		assert.deepEqual(calls, [PUBLISH_ARGUMENTS]);
	});
});
