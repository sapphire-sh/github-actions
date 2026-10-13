#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const BODY_BYTE_LIMIT = 65536;
const MIN_FENCE_LENGTH = 3;
const CHANGE_NAMES = { A: 'Added', M: 'Modified', D: 'Deleted', T: 'Type changed' };

const runGit = (directory, args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' });

const splitNul = (output) => output.split('\0').filter((field) => field !== '');

const formatRow = (cells) => `| ${cells.join(' | ')} |`;

const changeName = (status) => {
	if (!Object.hasOwn(CHANGE_NAMES, status)) {
		throw new Error(`unknown change status: ${status}`);
	}
	return CHANGE_NAMES[status];
};

// A fence longer than every backtick run in the diff keeps a diff line made of backticks from
// closing the block early.
const fenceFor = (text) => {
	const longestRun = Math.max(0, ...Array.from(text.matchAll(/`+/g), ([run]) => run.length));
	return '`'.repeat(Math.max(MIN_FENCE_LENGTH, longestRun + 1));
};

export const summarizeWorkingTreeChanges = (directory) => {
	// Marking untracked paths as intent-to-add makes `git diff` show new files with their content,
	// while deletions stay unstaged so the same diff still shows them.
	const untrackedPaths = splitNul(runGit(directory, ['ls-files', '--others', '--exclude-standard', '-z']));
	if (untrackedPaths.length > 0) {
		runGit(directory, ['add', '--intent-to-add', '--', ...untrackedPaths]);
	}

	const statusFields = splitNul(runGit(directory, ['diff', '--no-renames', '--name-status', '-z']));
	const rows = [];
	for (let index = 0; index < statusFields.length; index += 2) {
		rows.push([`\`${statusFields[index + 1]}\``, changeName(statusFields[index])]);
	}
	const header = ['File', 'Change'];
	const table = [header, header.map(() => '---'), ...rows].map((cells) => `${formatRow(cells)}\n`).join('');

	const diff = runGit(directory, ['diff', '--no-renames']);
	const fence = fenceFor(diff);
	const body = `${table}\n<details>\n<summary>Diff</summary>\n\n${fence}diff\n${diff}${fence}\n\n</details>\n`;

	// GitHub rejects a pull request body over 65,536 characters, and the UTF-8 byte count is never
	// smaller than the character count, so a body within the byte limit fits however it is counted.
	return Buffer.byteLength(body, 'utf8') > BODY_BYTE_LIMIT ? table : body;
};

if (import.meta.filename === process.argv[1]) {
	process.stdout.write(summarizeWorkingTreeChanges(process.cwd()));
}
