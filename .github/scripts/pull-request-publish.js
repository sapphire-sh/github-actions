#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { git, hasChanges } from './git-helpers.js';
import { createPullRequest } from './pull-request-permission.js';

export const publishPullRequest = (directory, { branch, title, body, assignees, owner, runGh }) => {
	if (!hasChanges(directory)) {
		console.log('no changes to commit');
		return;
	}
	git(directory, 'switch', '-C', branch);
	git(directory, 'add', '-A');
	git(directory, 'commit', '-m', title);
	git(directory, 'push', '--force', '-u', 'origin', branch);

	const assignee = assignees.length === 0 ? owner : assignees.join(',');
	const openPullRequests = JSON.parse(runGh(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number']));
	if (openPullRequests.length === 0) {
		createPullRequest(runGh, ['--title', title, '--body', body, '--assignee', assignee]);
		return;
	}
	const [{ number }] = openPullRequests;
	runGh(['pr', 'edit', String(number), '--body', body, '--add-assignee', assignee]);
};

if (import.meta.filename === process.argv[1]) {
	const [branch, title, assignee, owner] = process.argv.slice(2);
	publishPullRequest(process.cwd(), {
		branch,
		title,
		body: readFileSync(0, 'utf8'),
		assignees: assignee.split(/\s+/).filter((name) => name !== ''),
		owner,
		runGh: (args) => execFileSync('gh', args, { encoding: 'utf8' }),
	});
}
