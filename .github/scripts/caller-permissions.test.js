import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { findPermissionExcesses, findRepositoryPermissionExcesses } from './caller-permissions.js';

describe('findPermissionExcesses', () => {
	const template = { permissions: {}, jobs: { build: { permissions: { contents: 'read', 'id-token': 'write' } } } };

	it('passes when every template job permission is within the caller job permissions', () => {
		assert.deepEqual(
			findPermissionExcesses('caller', { permissions: { contents: 'read', 'id-token': 'write' } }, template),
			[],
		);
	});

	it('fails when a template job requests a scope the caller does not grant', () => {
		assert.deepEqual(findPermissionExcesses('caller', { permissions: { contents: 'read' } }, template), [
			'caller -> build: id-token write exceeds none',
		]);
	});

	it('fails when a template job requests write where the caller grants read', () => {
		assert.deepEqual(
			findPermissionExcesses('caller', { permissions: { contents: 'read', 'id-token': 'read' } }, template),
			['caller -> build: id-token write exceeds read'],
		);
	});

	it('fails when a caller job declares no permissions', () => {
		assert.deepEqual(findPermissionExcesses('caller', {}, template), ['caller: caller job declares no permissions']);
	});
});

describe('findRepositoryPermissionExcesses', () => {
	it('every reusable workflow in this repository stays within the permissions its callers grant', () => {
		assert.deepEqual(findRepositoryPermissionExcesses(path.join(import.meta.dirname, '../..')), []);
	});
});
