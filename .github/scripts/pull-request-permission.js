const PERMISSION_ERROR = 'GitHub Actions is not permitted to create or approve pull requests';

export const PERMISSION_GUIDANCE =
	'GitHub Actions is not allowed to create pull requests in this repository. Enable "Allow GitHub Actions to create and approve pull requests" under "Workflow permissions" in the repository\'s Actions settings, then re-run this workflow.';

export const createPullRequest = (runGh, args, onPermissionDenied = () => {}) => {
	try {
		runGh(['pr', 'create', ...args]);
	} catch (error) {
		if (error.stderr?.includes(PERMISSION_ERROR)) {
			console.error(PERMISSION_GUIDANCE);
			onPermissionDenied();
		}
		throw error;
	}
};
