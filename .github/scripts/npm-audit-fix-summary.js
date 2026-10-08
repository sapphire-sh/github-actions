#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCKFILE_PATH = 'package-lock.json';
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

export const summarizeLockfileChanges = (directory) => {
	const before = JSON.parse(
		execFileSync('git', ['show', `HEAD:${LOCKFILE_PATH}`], { cwd: directory, encoding: 'utf8' }),
	).packages;
	const after = JSON.parse(readFileSync(join(directory, LOCKFILE_PATH), 'utf8')).packages;

	const requiredBy = (name) =>
		Object.entries(after)
			.filter(([key, entry]) => key !== ROOT_KEY && Object.hasOwn(entry.dependencies ?? {}, name))
			.map(([key]) => `\`${packageName(key)}\``)
			.join(', ');

	const rows = mergeKeys(Object.keys(before), Object.keys(after))
		.filter((key) => key !== ROOT_KEY && before[key]?.version !== after[key]?.version)
		.map((key) => {
			const name = packageName(key);
			const from = before[key]?.version ?? '';
			const to = after[key]?.version ?? '';
			return formatRow([`\`${name}\``, from, to, Object.hasOwn(before, key) ? '' : requiredBy(name)]);
		});

	return [formatRow(['Package', 'From', 'To', 'Required by']), formatRow(['---', '---', '---', '---']), ...rows]
		.map((row) => `${row}\n`)
		.join('');
};

if (import.meta.filename === process.argv[1]) {
	process.stdout.write(summarizeLockfileChanges(process.cwd()));
}
