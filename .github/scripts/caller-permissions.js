import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const PERMISSION_LEVELS = { none: 0, read: 1, write: 2 };

const readWorkflow = (filePath) => parse(readFileSync(filePath, 'utf8'));

const listWorkflowFiles = (directory) =>
	readdirSync(directory)
		.filter((name) => name.endsWith('.yml'))
		.map((name) => path.join(directory, name));

export const findPermissionExcesses = (callerName, callerJob, template) => {
	if (callerJob.permissions === undefined) {
		return [`${callerName}: caller job declares no permissions`];
	}
	const excesses = [];
	for (const [jobName, job] of Object.entries(template.jobs)) {
		const requested = job.permissions ?? template.permissions ?? {};
		for (const [scope, level] of Object.entries(requested)) {
			const granted = callerJob.permissions[scope] ?? 'none';
			if (PERMISSION_LEVELS[level] > PERMISSION_LEVELS[granted]) {
				excesses.push(`${callerName} -> ${jobName}: ${scope} ${level} exceeds ${granted}`);
			}
		}
	}
	return excesses;
};

export const findRepositoryPermissionExcesses = (repositoryDirectory) => {
	const templateDirectory = path.join(repositoryDirectory, '.github/workflows');
	const callerFiles = [
		...listWorkflowFiles(path.join(repositoryDirectory, 'node_modules/@sapphire-sh/utils/templates/.github/workflows')),
		...listWorkflowFiles(templateDirectory),
	];
	const excesses = [];
	for (const callerFile of callerFiles) {
		for (const [jobName, job] of Object.entries(readWorkflow(callerFile).jobs)) {
			const match = /\.github\/workflows\/([^/@]+\.yml)/.exec(job.uses ?? '');
			if (match !== null) {
				const template = readWorkflow(path.join(templateDirectory, match[1]));
				excesses.push(...findPermissionExcesses(`${path.basename(callerFile)} ${jobName}`, job, template));
			}
		}
	}
	return excesses;
};
