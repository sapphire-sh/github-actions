import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { deployedRevisionMatches } from './deploy-revision-check.js';

const container = (name, stack, revision) => ({
	Names: [`/${name}`],
	Labels: { 'com.docker.compose.project': stack, 'org.opencontainers.image.revision': revision },
});

describe('deployedRevisionMatches', () => {
	it('is true when every container of the stack carries the revision', () => {
		const containers = [
			container('my-app-web-1', 'my-app', 'new-revision'),
			container('my-app-worker-1', 'my-app', 'new-revision'),
		];
		assert.equal(deployedRevisionMatches(containers, 'my-app', 'new-revision'), true);
	});

	it('is false when one container of the stack carries another revision', () => {
		const containers = [
			container('my-app-web-1', 'my-app', 'new-revision'),
			container('my-app-worker-1', 'my-app', 'old-revision'),
		];
		assert.equal(deployedRevisionMatches(containers, 'my-app', 'new-revision'), false);
	});

	it('is false when no container belongs to the stack', () => {
		const containers = [container('other-app-web-1', 'other-app', 'new-revision')];
		assert.equal(deployedRevisionMatches(containers, 'my-app', 'new-revision'), false);
	});

	it('ignores containers of other stacks', () => {
		const containers = [
			container('my-app-web-1', 'my-app', 'new-revision'),
			container('other-app-web-1', 'other-app', 'old-revision'),
		];
		assert.equal(deployedRevisionMatches(containers, 'my-app', 'new-revision'), true);
	});
});
