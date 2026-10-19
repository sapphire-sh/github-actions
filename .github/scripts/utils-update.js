import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, posix, relative, sep } from 'node:path';

const PACKAGE_NAME = '@sapphire-sh/utils';
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

const runNpm = (directory, argumentsList) => {
	const output = execFileSync('npm', argumentsList, {
		cwd: directory,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit'],
	});
	if (argumentsList[0] !== 'view') process.stderr.write(output);
	return output;
};

const replaceRanges = (text, version) => {
	const tokens = Array.from(
		text.matchAll(/"(?:\\.|[^"\\])*"|[\[\]{}:,]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g),
	);
	const replacements = [];
	let cursor = 0;
	const visit = (path) => {
		const token = tokens[cursor++];
		if (token[0] === '{') {
			while (tokens[cursor][0] !== '}') {
				const key = JSON.parse(tokens[cursor++][0]);
				cursor += 1;
				visit([...path, key]);
				if (tokens[cursor][0] === ',') cursor += 1;
			}
			cursor += 1;
		} else if (token[0] === '[') {
			let index = 0;
			while (tokens[cursor][0] !== ']') {
				visit([...path, index++]);
				if (tokens[cursor][0] === ',') cursor += 1;
			}
			cursor += 1;
		} else if (path.length === 2 && DEPENDENCY_FIELDS.includes(path[0]) && path[1] === PACKAGE_NAME) {
			const range = JSON.parse(token[0]);
			const prefix = range.replace(/[0-9].*$/, '');
			replacements.push({ start: token.index, end: token.index + token[0].length, value: `${prefix}${version}` });
		}
	};
	visit([]);
	for (const { start, end, value } of replacements.toReversed()) {
		text = `${text.slice(0, start)}${JSON.stringify(value)}${text.slice(end)}`;
	}
	return text;
};

const findInstallationDirectory = (directory, manifestDirectory) => {
	let candidate = manifestDirectory;
	while (true) {
		const lockfilePath = join(directory, candidate, 'package-lock.json');
		if (existsSync(lockfilePath)) {
			const lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'));
			const packagePath = relative(candidate, manifestDirectory).split(sep).join('/');
			if (candidate === manifestDirectory || Object.hasOwn(lockfile.packages, packagePath)) return candidate;
		}
		if (candidate === '.') return manifestDirectory;
		candidate = dirname(candidate);
	}
};

const readInstalledVersion = (directory, installationDirectory, manifestDirectory) => {
	const lockfile = JSON.parse(readFileSync(join(directory, installationDirectory, 'package-lock.json'), 'utf8'));
	let packagePath = relative(installationDirectory, manifestDirectory).split(sep).join('/');
	while (true) {
		const key = posix.join(packagePath, 'node_modules', PACKAGE_NAME);
		if (Object.hasOwn(lockfile.packages, key)) return lockfile.packages[key].version;
		if (packagePath === '' || packagePath === '.') {
			throw new Error(`Installed ${PACKAGE_NAME} version is missing from ${installationDirectory}/package-lock.json`);
		}
		packagePath = posix.dirname(packagePath);
	}
};

export const updateUtils = (
	directory,
	{ runNpm: executeNpm = runNpm, rebuildPackages = [], runTests = false } = {},
) => {
	const paths = execFileSync('git', ['ls-files', '-z'], { cwd: directory, encoding: 'utf8' })
		.split('\0')
		.filter((path) => basename(path) === 'package.json')
		.toSorted();
	const manifests = paths
		.map((path) => {
			const text = readFileSync(join(directory, path), 'utf8');
			const manifest = JSON.parse(text);
			const ranges = DEPENDENCY_FIELDS.flatMap((field) =>
				Object.hasOwn(manifest[field] ?? {}, PACKAGE_NAME) ? [manifest[field][PACKAGE_NAME]] : [],
			);
			return { path, text, manifest, ranges };
		})
		.filter(({ ranges }) => ranges.length > 0);
	if (manifests.length === 0) return { changed: false, versions: [] };

	const latest = executeNpm(directory, ['view', PACKAGE_NAME, 'version']).trim();
	const changed = manifests.filter(({ ranges }) => ranges.some((range) => range.replace(/^[^0-9]*/, '') !== latest));
	if (changed.length === 0) return { changed: false, versions: [] };

	const installations = new Map();
	for (const [index, manifest] of changed.entries()) {
		process.stderr.write(`Updating ${index + 1}/${changed.length}: ${manifest.path}\n`);
		const manifestDirectory = dirname(manifest.path);
		const installationDirectory = findInstallationDirectory(directory, manifestDirectory);
		manifest.manifestDirectory = manifestDirectory;
		manifest.installationDirectory = installationDirectory;
		manifest.updatedText = replaceRanges(manifest.text, latest);
		writeFileSync(join(directory, manifest.path), manifest.updatedText);
		if (!installations.has(installationDirectory)) installations.set(installationDirectory, []);
		installations.get(installationDirectory).push(manifest);
	}

	for (const [installationDirectory, consumers] of installations) {
		executeNpm(join(directory, installationDirectory), ['install', '--ignore-scripts']);
		for (const consumer of consumers) writeFileSync(join(directory, consumer.path), consumer.updatedText);
		if (rebuildPackages.length > 0) {
			executeNpm(join(directory, installationDirectory), ['rebuild', ...rebuildPackages]);
		}
	}
	if (installations.has('.')) {
		const rootManifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
		if (Object.hasOwn(rootManifest.scripts ?? {}, 'bootstrap')) executeNpm(directory, ['run', 'bootstrap']);
	}

	const versions = new Set(
		changed.map(({ installationDirectory, manifestDirectory }) =>
			readInstalledVersion(directory, installationDirectory, manifestDirectory),
		),
	);
	const verificationDirectories = new Map();
	for (const [installationDirectory, consumers] of installations) {
		verificationDirectories.set(installationDirectory, installationDirectory);
		for (const { manifestDirectory } of consumers) {
			verificationDirectories.set(manifestDirectory, installationDirectory);
		}
	}
	for (const script of ['build', 'lint', 'prettier', ...(runTests ? ['test'] : [])]) {
		for (const [manifestDirectory, installationDirectory] of verificationDirectories) {
			const manifest = JSON.parse(readFileSync(join(directory, manifestDirectory, 'package.json'), 'utf8'));
			if (!Object.hasOwn(manifest.scripts ?? {}, script)) continue;
			const argumentsList = script === 'test' ? ['test'] : ['run', script];
			if (manifestDirectory !== installationDirectory) {
				argumentsList.push('--workspace', relative(installationDirectory, manifestDirectory));
			}
			executeNpm(join(directory, installationDirectory), argumentsList);
		}
	}
	return { changed: true, versions: [...versions].toSorted() };
};

if (import.meta.main) {
	const [rebuildPackages = '', runTests = 'false'] = process.argv.slice(2);
	const result = updateUtils(process.cwd(), {
		rebuildPackages: rebuildPackages.split(/\s+/).filter((name) => name !== ''),
		runTests: runTests === 'true',
	});
	process.stdout.write(`changed=${result.changed}\nversion=${result.versions.join(', ')}\n`);
}
