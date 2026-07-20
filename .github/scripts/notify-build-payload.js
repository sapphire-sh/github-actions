#!/usr/bin/env node

const e = (k) => process.env[k] ?? '';

const success = e('RESULT') === 'success';
const color = success ? 'good' : 'danger';
const emoji = success ? ':white_check_mark:' : ':x:';
const statusText = success ? 'succeeded' : 'failed';

const runStartedAt = e('RUN_STARTED_AT');
const diff = runStartedAt ? Math.floor((Date.now() - new Date(runStartedAt).getTime()) / 1000) : 0;
let duration = 'n/a';
if (runStartedAt) {
	duration = diff >= 60 ? `${Math.floor(diff / 60)} min ${diff % 60} sec` : `${diff} sec`;
}

const sha = e('SHA');
const authorEmail = e('COMMIT_AUTHOR_EMAIL');
const commitAuthor = authorEmail ? `${e('COMMIT_AUTHOR_NAME')} <${authorEmail}>` : e('COMMIT_AUTHOR_NAME');
const commitMessage = (e('COMMIT_MESSAGE') || '').split('\n')[0];

const payload = {
	attachments: [
		{
			color,
			title: `${sha.slice(0, 7)}: ${commitMessage}`,
			title_link: `${e('SERVER_URL')}/${e('REPOSITORY')}/commit/${sha}`,
			text: `${emoji} *\`${e('CONTEXT')}\` ${statusText}* | <${e('SERVER_URL')}/${e('REPOSITORY')}/actions/runs/${e('RUN_ID')}|View run>`,
			mrkdwn_in: ['text'],
			fields: [
				{ title: 'repo', value: e('REPOSITORY'), short: true },
				{ title: 'author', value: commitAuthor, short: true },
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

process.stdout.write(JSON.stringify(payload) + '\n');
