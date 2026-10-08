import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { discardWorkflowChanges } from './utils-update-workflows.js';

let directory;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), 'utils-update-workflows-'));
	git('init', '--quiet');
});

afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

const git = (...args) =>
	execFileSync(
		'git',
		['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
		{ cwd: directory, encoding: 'utf8' },
	);

const writeFile = (path, content) => {
	writeFileSync(join(directory, path), content);
};

const commitAll = () => {
	git('add', '-A');
	git('commit', '--quiet', '-m', 'initial');
};

describe('discardWorkflowChanges', () => {
	it('reverts tracked workflow edits and removes new workflow files while keeping other changes', () => {
		mkdirSync(join(directory, '.github/workflows'), { recursive: true });
		writeFile('.github/workflows/ci.yml', 'name: CI\n');
		writeFile('package.json', '{}\n');
		commitAll();

		writeFile('.github/workflows/ci.yml', 'name: Changed\n');
		writeFile('.github/workflows/npm-audit-fix.yml', 'name: npm audit fix\n');
		writeFile('package.json', '{ "name": "example" }\n');

		discardWorkflowChanges(directory);

		assert.equal(git('status', '--porcelain'), ' M package.json\n');
	});

	it('keeps other changes in a repository without a .github/workflows directory', () => {
		writeFile('package.json', '{}\n');
		commitAll();

		writeFile('package.json', '{ "name": "example" }\n');

		discardWorkflowChanges(directory);

		assert.equal(git('status', '--porcelain'), ' M package.json\n');
	});
});
