#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOWS_PATH = '.github/workflows';

export const discardWorkflowChanges = (directory) => {
	if (!existsSync(join(directory, WORKFLOWS_PATH))) {
		return;
	}
	execFileSync('git', ['checkout', '--', WORKFLOWS_PATH], { cwd: directory, stdio: 'inherit' });
	execFileSync('git', ['clean', '-fd', '--', WORKFLOWS_PATH], { cwd: directory, stdio: 'inherit' });
};

if (import.meta.filename === process.argv[1]) {
	discardWorkflowChanges(process.cwd());
}
