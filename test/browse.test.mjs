import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { crumbsOf, expandLocalPath, listDirectory } from '../browse.js';

test('expandLocalPath resolves home shortcuts', () => {
	const home = '/Users/tester';
	assert.equal(expandLocalPath('', home), home);
	assert.equal(expandLocalPath('~', home), home);
	assert.equal(expandLocalPath('~/code/app', home), '/Users/tester/code/app');
	assert.equal(expandLocalPath('/var/tmp', home), '/var/tmp');
});

test('crumbsOf walks from the filesystem root to the directory', () => {
	const crumbs = crumbsOf('/Users/tester/code/app');
	assert.equal(crumbs[0].name, '/');
	assert.equal(crumbs[crumbs.length - 1].path, '/Users/tester/code/app');
	assert.deepEqual(crumbs.map((crumb) => crumb.name), ['/', 'Users', 'tester', 'code', 'app']);
});

test('listDirectory returns child folders, hidden flags, and truncation', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'dsh-browse-'));
	try {
		await mkdir(join(dir, 'alpha'));
		await mkdir(join(dir, 'beta'));
		await mkdir(join(dir, '.hidden'));
		await writeFile(join(dir, 'readme.txt'), 'not a directory');
		const listing = await listDirectory(dir, { home: dir });
		assert.equal(listing.path, dir);
		assert.equal(listing.home, dir);
		assert.equal(listing.crumbs[listing.crumbs.length - 1].path, dir);
		assert.equal(listing.entries.some((entry) => entry.name === 'readme.txt'), false);
		assert.equal(listing.entries.find((entry) => entry.name === '.hidden').hidden, true);
		assert.equal(listing.entries.find((entry) => entry.name === 'alpha').hidden, false);
		assert.equal(listing.truncated, false);

		const capped = await listDirectory(dir, { home: dir, limit: 2 });
		assert.equal(capped.entries.length, 2);
		assert.equal(capped.truncated, true);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test('listDirectory reports a missing or non-directory target', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'dsh-browse-'));
	try {
		await writeFile(join(dir, 'file.txt'), 'x');
		await assert.rejects(() => listDirectory(join(dir, 'missing')), (error) => error.code === 'directory_not_found');
		await assert.rejects(() => listDirectory(join(dir, 'file.txt')), (error) => error.code === 'not_a_directory');
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
