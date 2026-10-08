#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const LOCKFILE_NAME = 'package-lock.json';
const NODE_MODULES_SEGMENT = 'node_modules/';
const ROOT_KEY = '';

const packageName = (key) => key.slice(key.lastIndexOf(NODE_MODULES_SEGMENT) + NODE_MODULES_SEGMENT.length);

const formatRow = (cells) => `| ${cells.join(' | ')} |`;

// Keeps the order of the working tree lockfile and places each removed key right after the key
// that preceded it in the committed lockfile, so the rows follow the order npm wrote.
const mergeKeys = (beforeKeys, afterKeys) => {
	const afterSet = new Set(afterKeys);
	const keys = [...afterKeys];
	let insertAt = 0;
	for (const key of beforeKeys) {
		if (afterSet.has(key)) {
			insertAt = keys.indexOf(key) + 1;
			continue;
		}
		keys.splice(insertAt, 0, key);
		insertAt += 1;
	}
	return keys;
};

const lockfileRows = (directory, lockfilePath) => {
	const before = JSON.parse(
		execFileSync('git', ['show', `HEAD:${lockfilePath}`], { cwd: directory, encoding: 'utf8' }),
	).packages;
	const after = JSON.parse(readFileSync(join(directory, lockfilePath), 'utf8')).packages;

	const requiredBy = (name) =>
		Object.entries(after)
			.filter(([key, entry]) => key !== ROOT_KEY && Object.hasOwn(entry.dependencies ?? {}, name))
			.map(([key]) => `\`${packageName(key)}\``)
			.join(', ');

	return mergeKeys(Object.keys(before), Object.keys(after))
		.filter((key) => key !== ROOT_KEY && before[key]?.version !== after[key]?.version)
		.map((key) => {
			const name = packageName(key);
			const from = before[key]?.version ?? '';
			const to = after[key]?.version ?? '';
			return [`\`${name}\``, from, to, Object.hasOwn(before, key) ? '' : requiredBy(name)];
		});
};

export const summarizeLockfileChanges = (directory, manifestPaths = ['package.json']) => {
	const lockfilePaths = manifestPaths.map((manifestPath) => join(dirname(manifestPath), LOCKFILE_NAME));
	const showLockfile = lockfilePaths.length > 1;
	const header = [...(showLockfile ? ['Lockfile'] : []), 'Package', 'From', 'To', 'Required by'];
	const rows = lockfilePaths.flatMap((lockfilePath) =>
		lockfileRows(directory, lockfilePath).map((cells) => (showLockfile ? [lockfilePath, ...cells] : cells)),
	);

	return [header, header.map(() => '---'), ...rows].map((cells) => `${formatRow(cells)}\n`).join('');
};

if (import.meta.filename === process.argv[1]) {
	const manifestPaths = process.argv.slice(2);
	process.stdout.write(summarizeLockfileChanges(process.cwd(), manifestPaths.length > 0 ? manifestPaths : undefined));
}
