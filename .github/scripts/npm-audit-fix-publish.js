#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (directory, ...args) => execFileSync('git', args, { cwd: directory, stdio: 'inherit' });

const hasChanges = (directory) => {
	try {
		execFileSync('git', ['diff', '--quiet'], { cwd: directory });
		return false;
	} catch (error) {
		if (error.status === 1) {
			return true;
		}
		throw error;
	}
};

export const publishPullRequest = (directory, { branch, title, body, assignee, runGh }) => {
	if (!hasChanges(directory)) {
		console.log('no changes to commit');
		return;
	}
	git(directory, 'switch', '-C', branch);
	git(directory, 'add', '-A');
	git(directory, 'commit', '-m', title);
	git(directory, 'push', '--force', '-u', 'origin', branch);

	const openPullRequests = JSON.parse(runGh(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number']));
	if (openPullRequests.length === 0) {
		runGh(['pr', 'create', '--title', title, '--body', body, '--assignee', assignee]);
		return;
	}
	const [{ number }] = openPullRequests;
	runGh(['pr', 'edit', String(number), '--body', body, '--add-assignee', assignee]);
};

if (import.meta.filename === process.argv[1]) {
	const [branch, title, assignee] = process.argv.slice(2);
	publishPullRequest(process.cwd(), {
		branch,
		title,
		body: readFileSync(0, 'utf8'),
		assignee,
		runGh: (args) => execFileSync('gh', args, { encoding: 'utf8' }),
	});
}
