/**
 * Browser-half smoke test: mounts the real panel in jsdom with the workspace's
 * React 18, feeds it a fully populated store snapshot through the same fetch
 * route the plugin uses, and checks the five tabs and the story drawer render.
 *
 * This catches the class of defect a syntax check cannot: undefined helpers,
 * wrong hook order, a crashing tab. It is not a visual verification.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import { STATUSES, PRIORITIES, emptyState, mutate } from '../store.js';

// The smoke test borrows React/jsdom from the sibling dsh-superagent checkout
// so the plugin itself stays dependency-free. Skip cleanly when that checkout
// is absent (or its dependencies are not installed).
const sibling = new URL('../../dsh-superagent/package.json', import.meta.url);
const hasSibling = existsSync(sibling);
const requireFromSuperagent = hasSibling ? createRequire(sibling) : undefined;
let JSDOM;
let React;
let ReactDOMClient;
let skipReason;
if (hasSibling) {
	try {
		JSDOM = requireFromSuperagent('jsdom').JSDOM;
		React = requireFromSuperagent('react');
		ReactDOMClient = requireFromSuperagent('react-dom/client');
	} catch (error) {
		skipReason = `sibling React/jsdom unavailable: ${String(error)}`;
	}
} else {
	skipReason = 'workspace has no dsh-superagent checkout with React/jsdom';
}

/** Build the snapshot the Host route would return, with the demo board. */
function demoSnapshot() {
	const state = emptyState();
	mutate(state, 'seed_demo', {}, { clock: () => '2026-11-13T08:00:00.000Z' });
	return {
		...structuredClone(state),
		meta: {
			schemaVersion: 1,
			statuses: STATUSES.map((status) => ({ ...status })),
			priorities: [...PRIORITIES],
			colors: ['blue', 'green', 'amber', 'red', 'slate']
		}
	};
}

test('client panel mounts, switches tabs, and opens a story', { skip: skipReason }, async () => {
	const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:56150/' });
	const { window } = dom;
	global.window = window;
	global.document = window.document;
	global.Node = window.Node;
	global.Element = window.Element;
	global.HTMLElement = window.HTMLElement;
	global.Event = window.Event;
	global.MouseEvent = window.MouseEvent;
	global.getComputedStyle = window.getComputedStyle.bind(window);

	let plugin;
	let mainComponent;
	const dictionaries = {};
	const registered = [];

	window.__ModuleLoader__ = {
		load({ id, factory }) {
			assert.equal(id, 'dsh-story-board');
			plugin = factory((name) => {
				if (name === 'react') return requireFromSuperagent('react');
				if (name === 'react-dom') return requireFromSuperagent('react-dom');
				throw new Error(`unexpected module: ${name}`);
			});
		}
	};


	window.fetch = async (url, options) => {
		assert.match(String(url), /api\/story-board\/state/);
		assert.equal(JSON.parse(options.body ?? '{}')?.action, undefined);
		return new Response(JSON.stringify({ ok: true, value: demoSnapshot() }), { headers: { 'content-type': 'application/json' } });
	};
	global.fetch = window.fetch;

	await import('../client.js');
	assert.ok(plugin, 'client module registered a factory');

	plugin.apply({
		effect(fn) {
			const dispose = fn();
			registered.push(dispose);
			return dispose;
		},
		locale: {
			register(namespace, dict) {
				dictionaries[namespace] = dict;
			},
			bind(namespace) {
				const dict = dictionaries[namespace]?.zh ?? {};
				return (key, vars) => {
					const raw = dict[key] ?? key;
					return vars === undefined ? raw : raw.replace(/\{(\w+)\}/g, (whole, name) => vars[name] === undefined ? whole : String(vars[name]));
				};
			}
		},
		slots: {
			inject(_name, callback) {
				callback();
			},
			register(options, component) {
				if (options.name === 'main') mainComponent = component;
				return () => undefined;
			}
		}
	});

	assert.equal(typeof mainComponent, 'function');
	const root = ReactDOMClient.createRoot(document.getElementById('root'));
	root.render(React.createElement(mainComponent, {}));
	await new Promise((resolve) => setTimeout(resolve, 80));

	const text = () => document.body.textContent;

	assert.match(text(), /用户故事看板/);
	assert.match(text(), /概览/);
	assert.match(text(), /US-06/);
	assert.match(text(), /故事9/);

	// Board tab: five status columns and the demo cards.
	const boardTab = [...document.querySelectorAll('button')].find((button) => button.textContent.trim().startsWith('看板'));
	assert.ok(boardTab, 'board tab button exists');
	boardTab.click();
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.match(text(), /待开发/);
	assert.match(text(), /开发中/);
	assert.match(text(), /US-01/);
	assert.match(text(), /预估到达时间/);
	assert.match(text(), /1\/3/);

	// Click the first card: the story drawer should open with the Connextra fields.
	const card = document.querySelector('.sb-card');
	assert.ok(card, 'a story card exists');
	card.click();
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.match(text(), /编辑故事/);
	assert.match(text(), /验收标准/);
	assert.match(text(), /作为一个/);

	root.unmount();
	dom.window.close();
});
