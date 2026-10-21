#!/usr/bin/env node

export const fetchRunStartedAt = async ({ apiUrl, repository, runId, token, fetch }) => {
	try {
		const response = await fetch(`${apiUrl}/repos/${repository}/actions/runs/${runId}`, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github+json',
			},
		});
		if (!response.ok) {
			return '';
		}
		const run = await response.json();
		return run.run_started_at ?? '';
	} catch {
		return '';
	}
};

export const buildPayload = (env) => {
	const e = (k) => env[k] ?? '';

	let color = 'danger';
	let emoji = ':x:';
	let statusText = 'failed';
	if (e('RESULT') === 'success') {
		color = 'good';
		emoji = ':white_check_mark:';
		statusText = 'succeeded';
	} else if (e('RESULT') === 'cancelled') {
		color = '#808080';
		emoji = ':no_entry_sign:';
		statusText = 'cancelled';
	}

	const runStartedAt = e('RUN_STARTED_AT');
	const diff = runStartedAt ? Math.floor((Date.now() - new Date(runStartedAt).getTime()) / 1000) : 0;
	let duration = 'n/a';
	if (runStartedAt) {
		duration = diff >= 60 ? `${Math.floor(diff / 60)} min ${diff % 60} sec` : `${diff} sec`;
	}

	const sha = e('SHA');
	const prNumber = e('PR_NUMBER');
	let title;
	let titleLink;
	let author;
	if (prNumber) {
		title = `#${prNumber}: ${e('PR_TITLE')}`;
		titleLink = e('PR_URL');
		author = e('PR_AUTHOR');
	} else {
		const authorEmail = e('COMMIT_AUTHOR_EMAIL');
		author = authorEmail ? `${e('COMMIT_AUTHOR_NAME')} <${authorEmail}>` : e('COMMIT_AUTHOR_NAME');
		title = `${sha.slice(0, 7)}: ${(e('COMMIT_MESSAGE') || '').split('\n')[0]}`;
		titleLink = `${e('SERVER_URL')}/${e('REPOSITORY')}/commit/${sha}`;
	}

	return {
		attachments: [
			{
				color,
				title,
				title_link: titleLink,
				text: `${emoji} *\`${e('CONTEXT')}\` ${statusText}* | <${e('SERVER_URL')}/${e('REPOSITORY')}/actions/runs/${e('RUN_ID')}|View run>`,
				mrkdwn_in: ['text'],
				fields: [
					{ title: 'repo', value: e('REPOSITORY'), short: true },
					{ title: 'author', value: author, short: true },
					{ title: 'job', value: e('JOB'), short: true },
					{ title: 'took', value: duration, short: true },
					{ title: 'eventName', value: e('EVENT_NAME'), short: true },
					{ title: 'ref', value: e('REF'), short: true },
					{ title: 'workflow', value: e('WORKFLOW'), short: true },
					{ title: 'pullRequest', value: e('PR_NUMBER') || 'n/a', short: true },
				],
				footer: `${e('REPOSITORY')} @ ${e('REF_NAME')}`,
			},
		],
	};
};

if (import.meta.filename === process.argv[1]) {
	const runStartedAt = await fetchRunStartedAt({
		apiUrl: process.env.API_URL,
		repository: process.env.REPOSITORY,
		runId: process.env.RUN_ID,
		token: process.env.GITHUB_TOKEN,
		fetch,
	});
	process.stdout.write(JSON.stringify(buildPayload({ ...process.env, RUN_STARTED_AT: runStartedAt })) + '\n');
}
