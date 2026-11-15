import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveRebaseWorkflow } from './pull-request-rebase.js';

describe('resolveRebaseWorkflow', () => {
	it('returns the caller paired with the branch for a /rebase comment from a collaborator', () => {
		assert.equal(
			resolveRebaseWorkflow({ body: '/rebase', authorAssociation: 'COLLABORATOR', branch: 'chore/sapphire-ui' }),
			'node-ui-update.yml',
		);
	});

	it('returns null for a comment other than /rebase', () => {
		assert.equal(
			resolveRebaseWorkflow({ body: 'please /rebase', authorAssociation: 'OWNER', branch: 'chore/sapphire-utils' }),
			null,
		);
	});

	it('returns null for a commenter without write access', () => {
		assert.equal(
			resolveRebaseWorkflow({ body: '/rebase', authorAssociation: 'CONTRIBUTOR', branch: 'chore/sapphire-utils' }),
			null,
		);
	});

	it('returns null for a branch outside the table', () => {
		assert.equal(
			resolveRebaseWorkflow({ body: '/rebase', authorAssociation: 'OWNER', branch: 'feature/example' }),
			null,
		);
	});
});
