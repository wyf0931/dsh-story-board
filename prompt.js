/**
 * dsh-story-board — reverse-engineering prompt composer.
 *
 * The "import product from an existing project" flow picks a local checkout and
 * needs a prompt that makes the agent explore that checkout and land derived
 * user stories on the board. This module owns that prompt so the Host route and
 * the unit tests share one authoritative text; it depends on nothing.
 *
 * The prompt deliberately separates "read the code" from "derive value" from
 * "call the tool": models that skip straight to inventing stories produce
 * plausible-but-wrong cards, so the exploration step is mandatory and read-only.
 */

/** A short, uppercase product key derived from a folder name (`dsh-story-board` → `DSHSTORYBOARD`). */
export function deriveProductKey(pathLike) {
	const base = String(pathLike ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
	const upper = base.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
	return upper.slice(0, 16);
}

/** A human product name derived from a folder name (`dsh-story-board` → `dsh-story-board`). */
export function deriveProductName(pathLike) {
	const base = String(pathLike ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
	return base.slice(0, 80);
}

/**
 * Build the reverse-engineering prompt for one local project.
 *
 * @param {object} config
 * @param {string} config.path         Absolute local project root (required).
 * @param {string} [config.productName]
 * @param {string} [config.productKey]
 * @param {string} [config.repoUrl]    Optional repository link to record on the product.
 * @param {string} [config.focus]      Optional free-text emphasis from the user.
 * @param {number} [config.maxStories] Target story count (default 10).
 * @param {'zh'|'en'} [config.language]
 * @returns {string} The full prompt text.
 */
export function composeProjectImportPrompt(config) {
	const projectPath = String(config?.path ?? '').trim();
	if (projectPath === '') throw new Error('composeProjectImportPrompt: path is required');
	const language = config?.language === 'en' ? 'en' : 'zh';
	const maxStories = Number.isFinite(Number(config?.maxStories)) && Number(config?.maxStories) > 0
		? Math.min(40, Math.trunc(Number(config?.maxStories)))
		: 10;
	const name = String(config?.productName ?? '').trim() || deriveProductName(projectPath);
	const key = String(config?.productKey ?? '').trim() || deriveProductKey(projectPath);
	const repoUrl = String(config?.repoUrl ?? '').trim();
	const focus = String(config?.focus ?? '').trim();

	const lines = language === 'zh'
		? zhPrompt({ projectPath, name, key, repoUrl, focus, maxStories })
		: enPrompt({ projectPath, name, key, repoUrl, focus, maxStories });
	return lines.join('\n');
}

/** Chinese prompt body. */
function zhPrompt({ projectPath, name, key, repoUrl, focus, maxStories }) {
	const head = [
		'你是一名资深产品经理兼敏捷教练。下面是一个**已经存在的本地项目**，请你反向推导出它的用户故事（User Story），并直接落到「用户故事看板」上。',
		'',
		'项目本地路径：' + projectPath,
		repoUrl === '' ? null : '代码仓库：' + repoUrl,
		'产品名：' + name + '（Key：' + key + '）',
		focus === '' ? null : '用户重点关注：' + focus,
		'目标故事数量：约 ' + String(maxStories) + ' 条（可按实际功能密度上下浮动约 20%）。',
		''
	];
	const body = [
		'## 第一步：先读懂项目（不要凭空编）',
		'用读文件 / 列目录 / 搜索等工具**实地探查**这个目录，至少覆盖：',
		'- 根目录清单，README 与文档；',
		'- 工程清单（package.json / pyproject.toml / go.mod / pom.xml / Cargo.toml 等）：从名字、脚本、依赖推断技术栈；',
		'- 入口与配置（main / index、路由、config、.env.example）；',
		'- 对外能力（HTTP 路由 / RPC / CLI 命令 / 事件 / 定时任务）；',
		'- 数据模型（schema / model / migration / 实体）；',
		'- 前端页面与组件（如果存在）。',
		'**只读，不要修改任何文件。**',
		'',
		'## 第二步：归纳产品与角色',
		'- 用 2-3 句话概括：这个产品为谁解决什么问题；',
		'- 列出主要用户角色（例如 终端用户 / 管理员 / 运营 / 集成方）。',
		'',
		'## 第三步：推导用户故事',
		'从「用户价值」出发（而不是从技术模块出发），把核心能力写成用户故事：',
		'- 每条用 Connextra 三段式：作为一个<角色> / 我想要<能力> / 以便于<价值>；',
		'- 每条配 2-4 条**可观测、可测试**的验收标准（优先 Given / When / Then）；',
		'- 标注 priority（P0-P3）、epic（功能域）、tags、合理的 estimate（故事点 1-8）；',
		'- 遵循 INVEST：独立、有价值、可估算、够小、可测试；',
		'- **不要写纯技术故事**（例如“接入 Redis”“重构某模块”）；把它们转成用户可感知的价值，或并入某条故事的验收标准；',
		'- 覆盖主干 happy path 与关键的异常 / 边界场景，但不要为每个细枝末节都建卡。',
		'',
		'## 第四步：落板（必须调用工具，不要只在对话里打印）',
		'调用一次 story_board_import，参数：',
		'- productName: "' + name + '"',
		'- productKey: "' + key + '"',
		repoUrl === '' ? null : '- repoUrl: "' + repoUrl + '"',
		'- localPath: "' + projectPath + '"',
		'- description: <你在第二步归纳的产品一句话定位>',
		'- projectName: "产品现状梳理"',
		'- stories: [ { title, asA, iWant, soThat, acceptanceCriteria: [...], priority, estimate, epic, tags }, ... ]',
		'',
		'## 第五步：汇报',
		'用 3 行以内告诉我：建了哪个产品 / 项目、多少条故事、有没有 WIP 提示。完成后提示我打开侧边栏「用户故事看板」查看。'
	];
	return [...head, ...body].filter((line) => line !== null);
}

/** English prompt body. */
function enPrompt({ projectPath, name, key, repoUrl, focus, maxStories }) {
	const head = [
		'You are a senior product manager and agile coach. Below is an **existing local project**. Reverse-engineer its user stories and land them directly on the user-story board.',
		'',
		'Local project path: ' + projectPath,
		repoUrl === '' ? null : 'Repository: ' + repoUrl,
		'Product name: ' + name + ' (key: ' + key + ')',
		focus === '' ? null : 'User focus: ' + focus,
		'Target story count: about ' + String(maxStories) + ' (flex roughly 20% by real feature density).',
		''
	];
	const body = [
		'## Step 1 — Understand the project first (do not invent)',
		'Use the file-read / list-directory / search tools to **actually explore** this directory, covering at least:',
		'- Root listing, README and docs;',
		'- Build manifests (package.json / pyproject.toml / go.mod / pom.xml / Cargo.toml …): infer the stack from the name, scripts and dependencies;',
		'- Entry points and configuration (main / index, routes, config, .env.example);',
		'- Outward capabilities (HTTP routes / RPC / CLI commands / events / scheduled jobs);',
		'- Data model (schema / model / migrations / entities);',
		'- Frontend pages and components, if any.',
		'**Read only — do not modify any file.**',
		'',
		'## Step 2 — Summarize the product and its roles',
		'- In 2-3 sentences: who is this for and what problem does it solve;',
		'- List the primary user roles (e.g. end user / admin / operator / integrator).',
		'',
		'## Step 3 — Derive the user stories',
		'Start from **user value** (not from technical modules) and express core capabilities as stories:',
		'- Use the Connextra form for each: As a <role> / I want <capability> / so that <value>;',
		'- Add 2-4 **observable, testable** acceptance criteria each (prefer Given / When / Then);',
		'- Set priority (P0-P3), epic (feature area), tags, and a sensible estimate (1-8 points);',
		'- Follow INVEST: independent, valuable, estimable, small, testable;',
		'- **No purely technical stories** (e.g. "add Redis", "refactor module"); translate them into user-perceivable value or fold them into a story’s acceptance criteria;',
		'- Cover the main happy path and the key error / edge cases, but do not create a card for every trivial detail.',
		'',
		'## Step 4 — Land them (you must call the tool, not just print)',
		'Call story_board_import once with:',
		'- productName: "' + name + '"',
		'- productKey: "' + key + '"',
		repoUrl === '' ? null : '- repoUrl: "' + repoUrl + '"',
		'- localPath: "' + projectPath + '"',
		'- description: <your one-line positioning from step 2>',
		'- projectName: "Current-state import"',
		'- stories: [ { title, asA, iWant, soThat, acceptanceCriteria: [...], priority, estimate, epic, tags }, ... ]',
		'',
		'## Step 5 — Report back',
		'In 3 lines or fewer tell me: which product / project you created, how many stories, and any WIP warning. Then tell me to open the "User Story Board" panel in the sidebar.'
	];
	return [...head, ...body].filter((line) => line !== null);
}