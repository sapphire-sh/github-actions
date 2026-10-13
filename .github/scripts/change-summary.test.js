import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { summarizeWorkingTreeChanges } from './change-summary.js';
import { hasChanges } from './git-helpers.js';

let directory;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), 'change-summary-'));
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

const write = (path, content) => {
	writeFileSync(join(directory, path), content);
};

const commitAll = (message) => {
	git('add', '-A');
	git('commit', '--quiet', '-m', message);
};

const blobId = (content) =>
	execFileSync('git', ['hash-object', '--stdin'], { cwd: directory, encoding: 'utf8', input: content }).slice(0, 7);

describe('summarizeWorkingTreeChanges', () => {
	it('lists modified, added and deleted files and appends the whole diff in a collapsed block', () => {
		write('kept.txt', 'first\n');
		write('removed.txt', 'gone\n');
		commitAll('initial');

		write('kept.txt', 'second\n');
		rmSync(join(directory, 'removed.txt'));
		write('added.txt', 'new line\n');

		assert.equal(
			summarizeWorkingTreeChanges(directory),
			[
				'| File | Change |',
				'| --- | --- |',
				'| `added.txt` | Added |',
				'| `kept.txt` | Modified |',
				'| `removed.txt` | Deleted |',
				'',
				'<details>',
				'<summary>Diff</summary>',
				'',
				'```diff',
				'diff --git a/added.txt b/added.txt',
				'new file mode 100644',
				`index 0000000..${blobId('new line\n')}`,
				'--- /dev/null',
				'+++ b/added.txt',
				'@@ -0,0 +1 @@',
				'+new line',
				'diff --git a/kept.txt b/kept.txt',
				`index ${blobId('first\n')}..${blobId('second\n')} 100644`,
				'--- a/kept.txt',
				'+++ b/kept.txt',
				'@@ -1 +1 @@',
				'-first',
				'+second',
				'diff --git a/removed.txt b/removed.txt',
				'deleted file mode 100644',
				`index ${blobId('gone\n')}..0000000`,
				'--- a/removed.txt',
				'+++ /dev/null',
				'@@ -1 +0,0 @@',
				'-gone',
				'```',
				'',
				'</details>',
				'',
			].join('\n'),
		);
	});

	it('leaves the diff out when the body with it would exceed 65,536 bytes', () => {
		write('kept.txt', 'first\n');
		commitAll('initial');

		write('large.txt', 'a\n'.repeat(40000));

		assert.equal(
			summarizeWorkingTreeChanges(directory),
			['| File | Change |', '| --- | --- |', '| `large.txt` | Added |', ''].join('\n'),
		);
	});

	it('fences the diff with one more backtick than its longest backtick run', () => {
		write('notes.md', 'x\n');
		commitAll('initial');

		write('notes.md', '```\n');

		assert.equal(
			summarizeWorkingTreeChanges(directory),
			[
				'| File | Change |',
				'| --- | --- |',
				'| `notes.md` | Modified |',
				'',
				'<details>',
				'<summary>Diff</summary>',
				'',
				'````diff',
				'diff --git a/notes.md b/notes.md',
				`index ${blobId('x\n')}..${blobId('```\n')} 100644`,
				'--- a/notes.md',
				'+++ b/notes.md',
				'@@ -1 +1 @@',
				'-x',
				'+```',
				'````',
				'',
				'</details>',
				'',
			].join('\n'),
		);
	});

	it('makes hasChanges detect a working tree whose only change is a new file', () => {
		write('kept.txt', 'first\n');
		commitAll('initial');

		write('added.txt', 'new line\n');
		summarizeWorkingTreeChanges(directory);

		assert.equal(hasChanges(directory), true);
	});

	it('throws on a change status outside A, M, D and T', () => {
		write('shared.txt', 'base\n');
		commitAll('initial');
		git('switch', '--quiet', '-c', 'other');
		write('shared.txt', 'other\n');
		commitAll('other');
		git('switch', '--quiet', '-');
		write('shared.txt', 'main\n');
		commitAll('main');
		assert.throws(() => git('merge', '--quiet', 'other'));

		assert.throws(() => summarizeWorkingTreeChanges(directory), { message: 'unknown change status: U' });
	});
});
