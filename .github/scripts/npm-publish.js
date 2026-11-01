import { spawnSync } from 'node:child_process';

const PUBLISH_ARGUMENTS = ['publish', '--access', 'public', '--tag', 'latest'];
const RETRY_ERROR_CODE = 'TLOG_CREATE_ENTRY_ERROR';

const runNpm = (argumentsList) => {
	const result = spawnSync('npm', argumentsList, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	process.stdout.write(result.stdout);
	process.stderr.write(result.stderr);
	return { status: result.status ?? 1, output: `${result.stdout}${result.stderr}` };
};

export const publishToNpm = ({ runNpm: executeNpm = runNpm } = {}) => {
	const { status, output } = executeNpm(PUBLISH_ARGUMENTS);
	if (status === 0 || !output.includes(RETRY_ERROR_CODE)) return status;
	process.stderr.write(`Retrying npm publish once after ${RETRY_ERROR_CODE}\n`);
	return executeNpm(PUBLISH_ARGUMENTS).status;
};

if (import.meta.main) {
	process.exitCode = publishToNpm();
}
