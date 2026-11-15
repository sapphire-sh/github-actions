#!/usr/bin/env node

const REBASE_COMMAND = '/rebase';

const WRITE_ACCESS_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

const WORKFLOW_BY_BRANCH = new Map([
	['chore/sapphire-utils', 'node-utils-update.yml'],
	['chore/sapphire-ui', 'node-ui-update.yml'],
	['chore/shared-config-update', 'node-shared-config-update.yml'],
	['chore/npm-audit-fix', 'node-audit-fix.yml'],
]);

export const resolveRebaseWorkflow = ({ body, authorAssociation, branch }) => {
	if (body.trim() !== REBASE_COMMAND || !WRITE_ACCESS_ASSOCIATIONS.has(authorAssociation)) {
		return null;
	}
	return WORKFLOW_BY_BRANCH.get(branch) ?? null;
};

if (import.meta.filename === process.argv[1]) {
	const workflow = resolveRebaseWorkflow({
		body: process.env.BODY,
		authorAssociation: process.env.AUTHOR_ASSOCIATION,
		branch: process.env.BRANCH,
	});
	if (workflow !== null) {
		process.stdout.write(`workflow=${workflow}\n`);
	}
}
