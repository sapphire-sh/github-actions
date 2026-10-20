import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { PERMISSION_GUIDANCE } from './pull-request-permission.js';
import { publishPullRequest } from './pull-request-publish.js';

const BRANCH = 'chore/npm-audit-fix';
const TITLE = 'chore(deps): apply npm audit fix';
const BODY = '| Package | From | To | Required by |\n';
const ASSIGNEES = ['first-assignee', 'second-assignee'];
const OWNER = 'repository-owner';

let root;
let origin;
let directory;
let baseBranch;

const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' });

const originGit = (...args) => execFileSync('git', ['--git-dir', origin, ...args], { encoding: 'utf8' });

const writeLockfile = (content) => {
	writeFileSync(join(directory, 'package-lock.json'), content);
};

const commitAll = (message) => {
	git('add', '-A');
	git('commit', '--quiet', '-m', message);
};

const recordGh = (openPullRequests) => {
	const calls = [];
	const runGh = (args) => {
		calls.push(args);
		return args[1] === 'list' ? JSON.stringify(openPullRequests) : '';
	};
	return { calls, runGh };
};

const failGhCreate = (stderr) => {
	const calls = [];
	const error = Object.assign(new Error(`Command failed: gh pr create\n${stderr}`), { status: 1, stderr });
	const runGh = (args) => {
		calls.push(args);
		if (args[1] === 'create') {
			throw error;
		}
		return args[1] === 'list' ? '[]' : '';
	};
	return { calls, error, runGh };
};

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'pull-request-publish-'));
	origin = join(root, 'origin.git');
	directory = join(root, 'work');
	execFileSync('git', ['init', '--quiet', '--bare', origin]);
	execFileSync('git', ['init', '--quiet', directory]);
	git('config', 'user.name', 'test');
	git('config', 'user.email', 'test@example.com');
	git('config', 'commit.gpgsign', 'false');
	git('remote', 'add', 'origin', origin);
	writeLockfile('{ "version": "1.0.0" }\n');
	commitAll('initial');
	baseBranch = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('publishPullRequest', () => {
	it('does nothing when the working tree has no changes', () => {
		const { calls, runGh } = recordGh([]);

		publishPullRequest(directory, {
			branch: BRANCH,
			title: TITLE,
			body: BODY,
			assignees: ASSIGNEES,
			owner: OWNER,
			runGh,
		});

		assert.equal(originGit('for-each-ref', '--format=%(refname)', 'refs/heads'), '');
		assert.deepEqual(calls, []);
	});

	it('pushes the branch and creates a pull request when none is open', () => {
		writeLockfile('{ "version": "1.0.1" }\n');
		const { calls, runGh } = recordGh([]);

		publishPullRequest(directory, {
			branch: BRANCH,
			title: TITLE,
			body: BODY,
			assignees: ASSIGNEES,
			owner: OWNER,
			runGh,
		});

		assert.equal(originGit('show', `${BRANCH}:package-lock.json`), '{ "version": "1.0.1" }\n');
		assert.equal(originGit('log', '--format=%s', `${BRANCH}`), `${TITLE}\ninitial\n`);
		assert.deepEqual(calls, [
			['pr', 'list', '--head', BRANCH, '--state', 'open', '--json', 'number'],
			['pr', 'create', '--title', TITLE, '--body', BODY, '--assignee', 'first-assignee,second-assignee'],
		]);
	});

	it('force-pushes over the remote branch and edits the open pull request body', () => {
		git('switch', '--quiet', '-c', BRANCH);
		writeLockfile('{ "version": "1.0.1" }\n');
		commitAll('earlier fix');
		git('push', '--quiet', 'origin', BRANCH);
		git('switch', '--quiet', baseBranch);
		writeLockfile('{ "version": "1.0.2" }\n');
		const { calls, runGh } = recordGh([{ number: 7 }]);

		publishPullRequest(directory, {
			branch: BRANCH,
			title: TITLE,
			body: BODY,
			assignees: ASSIGNEES,
			owner: OWNER,
			runGh,
		});

		assert.equal(originGit('show', `${BRANCH}:package-lock.json`), '{ "version": "1.0.2" }\n');
		assert.equal(originGit('log', '--format=%s', `${BRANCH}`), `${TITLE}\ninitial\n`);
		assert.deepEqual(calls, [
			['pr', 'list', '--head', BRANCH, '--state', 'open', '--json', 'number'],
			['pr', 'edit', '7', '--body', BODY, '--add-assignee', 'first-assignee,second-assignee'],
		]);
	});

	it('assigns the repository owner to a new pull request when no assignee is listed', () => {
		writeLockfile('{ "version": "1.0.1" }\n');
		const { calls, runGh } = recordGh([]);

		publishPullRequest(directory, { branch: BRANCH, title: TITLE, body: BODY, assignees: [], owner: OWNER, runGh });

		assert.deepEqual(calls, [
			['pr', 'list', '--head', BRANCH, '--state', 'open', '--json', 'number'],
			['pr', 'create', '--title', TITLE, '--body', BODY, '--assignee', OWNER],
		]);
	});

	it('assigns the repository owner to the open pull request when no assignee is listed', () => {
		writeLockfile('{ "version": "1.0.1" }\n');
		const { calls, runGh } = recordGh([{ number: 7 }]);

		publishPullRequest(directory, { branch: BRANCH, title: TITLE, body: BODY, assignees: [], owner: OWNER, runGh });

		assert.deepEqual(calls, [
			['pr', 'list', '--head', BRANCH, '--state', 'open', '--json', 'number'],
			['pr', 'edit', '7', '--body', BODY, '--add-assignee', OWNER],
		]);
	});

	it('prints the settings guidance and fails when GitHub Actions may not create pull requests', (t) => {
		writeLockfile('{ "version": "1.0.1" }\n');
		const { calls, error, runGh } = failGhCreate(
			'pull request create failed: GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)\n',
		);
		const consoleError = t.mock.method(console, 'error', () => {});

		assert.throws(
			() =>
				publishPullRequest(directory, {
					branch: BRANCH,
					title: TITLE,
					body: BODY,
					assignees: ASSIGNEES,
					owner: OWNER,
					runGh,
				}),
			(thrown) => thrown === error,
		);

		assert.deepEqual(
			consoleError.mock.calls.map((call) => call.arguments),
			[[PERMISSION_GUIDANCE]],
		);
		assert.equal(originGit('for-each-ref', '--format=%(refname)', 'refs/heads'), `refs/heads/${BRANCH}\n`);
		assert.deepEqual(calls, [
			['pr', 'list', '--head', BRANCH, '--state', 'open', '--json', 'number'],
			['pr', 'create', '--title', TITLE, '--body', BODY, '--assignee', 'first-assignee,second-assignee'],
		]);
	});

	it('fails with the original error and no guidance when pull request creation fails otherwise', (t) => {
		writeLockfile('{ "version": "1.0.1" }\n');
		const { calls, error, runGh } = failGhCreate('HTTP 502: Bad Gateway\n');
		const consoleError = t.mock.method(console, 'error', () => {});

		assert.throws(
			() =>
				publishPullRequest(directory, {
					branch: BRANCH,
					title: TITLE,
					body: BODY,
					assignees: ASSIGNEES,
					owner: OWNER,
					runGh,
				}),
			(thrown) => thrown === error,
		);

		assert.deepEqual(consoleError.mock.calls, []);
		assert.deepEqual(calls, [
			['pr', 'list', '--head', BRANCH, '--state', 'open', '--json', 'number'],
			['pr', 'create', '--title', TITLE, '--body', BODY, '--assignee', 'first-assignee,second-assignee'],
		]);
	});
});
