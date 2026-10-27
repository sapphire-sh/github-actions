#!/usr/bin/env node

import { setTimeout as sleep } from 'node:timers/promises';

const POLL_INTERVAL_MILLISECONDS = 8000;
const TIMEOUT_MILLISECONDS = 128000;

const selectStackContainers = (containers, stack) =>
	containers.filter((container) => container.Labels['com.docker.compose.project'] === stack);

export const deployedRevisionMatches = (containers, stack, revision) => {
	const stackContainers = selectStackContainers(containers, stack);
	return (
		stackContainers.length > 0 &&
		stackContainers.every((container) => container.Labels['org.opencontainers.image.revision'] === revision)
	);
};

const fetchContainers = async (url, apiKey) => {
	const response = await fetch(url, { headers: { 'X-API-Key': apiKey } });
	if (!response.ok) {
		throw new Error(`Portainer answered ${response.status}`);
	}
	return response.json();
};

const describeContainers = (containers, stack) =>
	selectStackContainers(containers, stack)
		.map((container) => `${container.Names.join(',')} ${container.Labels['org.opencontainers.image.revision']}`)
		.join('\n');

if (import.meta.filename === process.argv[1]) {
	const { PORTAINER_URL, PORTAINER_API_KEY, PORTAINER_ENDPOINT_ID, PORTAINER_STACK, REVISION } = process.env;
	const url = `${PORTAINER_URL}/api/endpoints/${PORTAINER_ENDPOINT_ID}/docker/containers/json`;
	const deadline = Date.now() + TIMEOUT_MILLISECONDS;
	let containers = [];
	while (Date.now() < deadline) {
		try {
			containers = await fetchContainers(url, PORTAINER_API_KEY);
			if (deployedRevisionMatches(containers, PORTAINER_STACK, REVISION)) {
				process.exit(0);
			}
		} catch (error) {
			process.stderr.write(`${error.message}\n`);
		}
		await sleep(POLL_INTERVAL_MILLISECONDS);
	}
	process.stderr.write(`${describeContainers(containers, PORTAINER_STACK)}\n`);
	process.exit(1);
}
