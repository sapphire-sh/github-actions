import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { summarizeLockfileChanges } from './dependency-summary.js';

let directory;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), 'dependency-summary-'));
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

const writeLockfile = (packages, lockfilePath = 'package-lock.json') => {
	writeFileSync(join(directory, lockfilePath), `${JSON.stringify({ lockfileVersion: 3, packages }, null, '\t')}\n`);
};

describe('summarizeLockfileChanges', () => {
	it('lists bumped, added and removed packages in lockfile order and leaves out unchanged and root entries', () => {
		writeLockfile({
			'': { name: 'example', version: '1.0.0' },
			'node_modules/a': { version: '1.0.0' },
			'node_modules/b': { version: '2.0.0' },
			'node_modules/c': { version: '3.0.0' },
			'node_modules/d': { version: '4.0.0' },
		});
		git('add', '-A');
		git('commit', '--quiet', '-m', 'initial');

		writeLockfile({
			'': { name: 'example', version: '1.0.1' },
			'node_modules/a': { version: '1.1.0', dependencies: { e: '^5.0.0' } },
			'node_modules/b': { version: '2.0.0' },
			'node_modules/d': { version: '4.0.0', dependencies: { e: '^5.0.0' } },
			'node_modules/d/node_modules/e': { version: '5.0.0' },
		});

		assert.equal(
			summarizeLockfileChanges(directory),
			[
				'| Package | From | To | Required by |',
				'| --- | --- | --- | --- |',
				'| `a` | 1.0.0 | 1.1.0 |  |',
				'| `c` | 3.0.0 |  |  |',
				'| `e` |  | 5.0.0 | `a`, `d` |',
				'',
			].join('\n'),
		);
	});

	it('adds a Lockfile column for several manifests and finds Required by within the row lockfile', () => {
		mkdirSync(join(directory, 'web'));
		writeLockfile({
			'': { name: 'example', version: '1.0.0' },
			'node_modules/a': { version: '1.0.0' },
			'node_modules/d': { version: '4.0.0', dependencies: { c: '^3.0.0' } },
		});
		writeLockfile(
			{
				'': { name: 'web', version: '1.0.0' },
				'node_modules/b': { version: '2.0.0' },
			},
			'web/package-lock.json',
		);
		git('add', '-A');
		git('commit', '--quiet', '-m', 'initial');

		writeLockfile({
			'': { name: 'example', version: '1.0.0' },
			'node_modules/a': { version: '1.1.0' },
			'node_modules/d': { version: '4.0.0', dependencies: { c: '^3.0.0' } },
		});
		writeLockfile(
			{
				'': { name: 'web', version: '1.0.0' },
				'node_modules/b': { version: '2.1.0', dependencies: { c: '^3.0.0' } },
				'node_modules/c': { version: '3.0.0' },
			},
			'web/package-lock.json',
		);

		assert.equal(
			summarizeLockfileChanges(directory, ['package.json', 'web/package.json']),
			[
				'| Lockfile | Package | From | To | Required by |',
				'| --- | --- | --- | --- | --- |',
				'| package-lock.json | `a` | 1.0.0 | 1.1.0 |  |',
				'| web/package-lock.json | `b` | 2.0.0 | 2.1.0 |  |',
				'| web/package-lock.json | `c` |  | 3.0.0 | `b` |',
				'',
			].join('\n'),
		);
	});
});
