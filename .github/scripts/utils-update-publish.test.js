import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { PERMISSION_GUIDANCE } from './pull-request-permission.js';
import { publishPullRequest } from './utils-update-publish.js';

const BRANCH = 'chore/sapphire-utils-2.7.0';
const TITLE = 'chore(deps): bump @sapphire-sh/utils to 2.7.0';
const BODY = '| Package | From | To | Required by |\n';
const ASSIGNEE = 'repository-owner';

let root;
let origin;
let directory;

const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' });

const originGit = (...args) => execFileSync('git', ['--git-dir', origin, ...args], { encoding: 'utf8' });

const writeLockfile = (content) => {
	writeFileSync(join(directory, 'package-lock.json'), content);
};

const recordGh = (failure) => {
	const calls = [];
	const error =
		failure === undefined
			? undefined
			: Object.assign(new Error(`Command failed: gh pr create\n${failure}`), { status: 1, stderr: failure });
	const runGh = (args) => {
		calls.push(args);
		if (error !== undefined) {
			throw error;
		}
		return '';
	};
	return { calls, error, runGh };
};

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'utils-update-publish-'));
	origin = join(root, 'origin.git');
	directory = join(root, 'work');
	execFileSync('git', ['init', '--quiet', '--bare', origin]);
	execFileSync('git', ['init', '--quiet', directory]);
	git('config', 'user.name', 'test');
	git('config', 'user.email', 'test@example.com');
	git('config', 'commit.gpgsign', 'false');
	git('remote', 'add', 'origin', origin);
	writeLockfile('{ "version": "1.0.0" }\n');
	git('add', '-A');
	git('commit', '--quiet', '-m', 'initial');
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('publishPullRequest', () => {
	it('does nothing when the working tree has no changes', () => {
		const { calls, runGh } = recordGh();

		publishPullRequest(directory, { branch: BRANCH, title: TITLE, body: BODY, assignee: ASSIGNEE, runGh });

		assert.equal(originGit('for-each-ref', '--format=%(refname)', 'refs/heads'), '');
		assert.deepEqual(calls, []);
	});

	it('pushes the branch and creates a pull request', () => {
		writeLockfile('{ "version": "1.0.1" }\n');
		const { calls, runGh } = recordGh();

		publishPullRequest(directory, { branch: BRANCH, title: TITLE, body: BODY, assignee: ASSIGNEE, runGh });

		assert.equal(originGit('show', `${BRANCH}:package-lock.json`), '{ "version": "1.0.1" }\n');
		assert.equal(originGit('log', '--format=%s', `${BRANCH}`), `${TITLE}\ninitial\n`);
		assert.deepEqual(calls, [['pr', 'create', '--title', TITLE, '--body', BODY, '--assignee', ASSIGNEE]]);
	});

	it('prints the settings guidance, deletes the pushed branch and fails when GitHub Actions may not create pull requests', (t) => {
		writeLockfile('{ "version": "1.0.1" }\n');
		const { calls, error, runGh } = recordGh(
			'pull request create failed: GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)\n',
		);
		const consoleError = t.mock.method(console, 'error', () => {});

		assert.throws(
			() => publishPullRequest(directory, { branch: BRANCH, title: TITLE, body: BODY, assignee: ASSIGNEE, runGh }),
			(thrown) => thrown === error,
		);

		assert.deepEqual(
			consoleError.mock.calls.map((call) => call.arguments),
			[[PERMISSION_GUIDANCE]],
		);
		assert.equal(originGit('for-each-ref', '--format=%(refname)', 'refs/heads'), '');
		assert.deepEqual(calls, [['pr', 'create', '--title', TITLE, '--body', BODY, '--assignee', ASSIGNEE]]);
	});

	it('fails with the original error and no guidance and keeps the pushed branch when pull request creation fails otherwise', (t) => {
		writeLockfile('{ "version": "1.0.1" }\n');
		const { calls, error, runGh } = recordGh('HTTP 502: Bad Gateway\n');
		const consoleError = t.mock.method(console, 'error', () => {});

		assert.throws(
			() => publishPullRequest(directory, { branch: BRANCH, title: TITLE, body: BODY, assignee: ASSIGNEE, runGh }),
			(thrown) => thrown === error,
		);

		assert.deepEqual(consoleError.mock.calls, []);
		assert.equal(originGit('for-each-ref', '--format=%(refname)', 'refs/heads'), `refs/heads/${BRANCH}\n`);
		assert.deepEqual(calls, [['pr', 'create', '--title', TITLE, '--body', BODY, '--assignee', ASSIGNEE]]);
	});
});
