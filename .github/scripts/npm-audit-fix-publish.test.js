import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { publishPullRequest } from './npm-audit-fix-publish.js';

const BRANCH = 'chore/npm-audit-fix';
const TITLE = 'chore(deps): apply npm audit fix';
const BODY = '| Package | From | To | Required by |\n';
const ASSIGNEE = 'repository-owner';

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

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'npm-audit-fix-publish-'));
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

		publishPullRequest(directory, { branch: BRANCH, title: TITLE, body: BODY, assignee: ASSIGNEE, runGh });

		assert.equal(originGit('for-each-ref', '--format=%(refname)', 'refs/heads'), '');
		assert.deepEqual(calls, []);
	});

	it('pushes the branch and creates a pull request when none is open', () => {
		writeLockfile('{ "version": "1.0.1" }\n');
		const { calls, runGh } = recordGh([]);

		publishPullRequest(directory, { branch: BRANCH, title: TITLE, body: BODY, assignee: ASSIGNEE, runGh });

		assert.equal(originGit('show', `${BRANCH}:package-lock.json`), '{ "version": "1.0.1" }\n');
		assert.equal(originGit('log', '--format=%s', `${BRANCH}`), `${TITLE}\ninitial\n`);
		assert.deepEqual(calls, [
			['pr', 'list', '--head', BRANCH, '--state', 'open', '--json', 'number'],
			['pr', 'create', '--title', TITLE, '--body', BODY, '--assignee', ASSIGNEE],
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

		publishPullRequest(directory, { branch: BRANCH, title: TITLE, body: BODY, assignee: ASSIGNEE, runGh });

		assert.equal(originGit('show', `${BRANCH}:package-lock.json`), '{ "version": "1.0.2" }\n');
		assert.equal(originGit('log', '--format=%s', `${BRANCH}`), `${TITLE}\ninitial\n`);
		assert.deepEqual(calls, [
			['pr', 'list', '--head', BRANCH, '--state', 'open', '--json', 'number'],
			['pr', 'edit', '7', '--body', BODY, '--add-assignee', ASSIGNEE],
		]);
	});
});
