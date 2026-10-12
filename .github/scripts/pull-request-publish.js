#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { git, hasChanges } from './git-helpers.js';
import { createPullRequest } from './pull-request-permission.js';

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
		createPullRequest(runGh, ['--title', title, '--body', body, '--assignee', assignee]);
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
