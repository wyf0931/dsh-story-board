/**
 * dsh-story-board — local directory browsing.
 *
 * The product form links a product to its code: a repository address and a
 * local project root. The path is picked from a small in-panel browser instead
 * of a browser file input, because a Web file input never reveals an absolute
 * path. This module is the Host half of that browser: expand `~`, validate the
 * directory, and return one level plus its ancestry. It deliberately returns
 * names and paths only — listing a project root is not reading the project.
 */

import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, parse, resolve, sep } from 'node:path';

import { BadInput, textOf } from './store.js';

/** Maximum entries one level returns before it says it truncated. */
export const DIRECTORY_LIMIT = 500;

/** Expand `~` against the home directory and return an absolute path. */
export function expandLocalPath(value, home = homedir()) {
	const clean = textOf(value, 1000);
	if (clean === '' || clean === '~') return resolve(home);
	if (clean.startsWith('~/') === true || clean.startsWith('~\\') === true) return resolve(home, clean.slice(2));
	return resolve(clean);
}

/** Ancestry from the filesystem root down to the directory. */
export function crumbsOf(absolute) {
	const root = parse(absolute).root;
	const segments = absolute.slice(root.length).split(sep).filter((segment) => segment !== '');
	const crumbs = [{ name: root, path: root }];
	let current = root;
	for (const segment of segments) {
		current = join(current, segment);
		crumbs.push({ name: segment, path: current });
	}
	return crumbs;
}

/** List the direct child directories of one level, plus its breadcrumb. */
export async function listDirectory(value, { home = homedir(), limit = DIRECTORY_LIMIT } = {}) {
	const absolute = expandLocalPath(value, home);
	let info;
	try {
		info = await stat(absolute);
	} catch (error) {
		if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
			throw new BadInput(`目录不存在：${absolute}`, 'directory_not_found');
		}
		throw new BadInput(`无法读取目录：${absolute}`, 'directory_unreadable');
	}
	if (info.isDirectory() !== true) throw new BadInput(`不是文件夹：${absolute}`, 'not_a_directory');

	let dirents;
	try {
		dirents = await readdir(absolute, { withFileTypes: true });
	} catch (error) {
		throw new BadInput(`无法读取目录：${absolute}`, 'directory_unreadable');
	}

	const children = [];
	for (const dirent of dirents) {
		let isDirectory = dirent.isDirectory();
		if (isDirectory !== true && dirent.isSymbolicLink() === true) {
			isDirectory = await stat(join(absolute, dirent.name)).then((entry) => entry.isDirectory()).catch(() => false);
		}
		if (isDirectory !== true) continue;
		children.push({
			name: dirent.name,
			path: join(absolute, dirent.name),
			hidden: dirent.name.startsWith('.')
		});
	}
	children.sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }));

	const cap = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : DIRECTORY_LIMIT;
	return {
		path: absolute,
		home: resolve(home),
		crumbs: crumbsOf(absolute),
		entries: children.slice(0, cap),
		truncated: children.length > cap
	};
}
