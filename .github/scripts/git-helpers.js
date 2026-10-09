import { execFileSync } from 'node:child_process';

export const git = (directory, ...args) => execFileSync('git', args, { cwd: directory, stdio: 'inherit' });

export const hasChanges = (directory) => {
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
