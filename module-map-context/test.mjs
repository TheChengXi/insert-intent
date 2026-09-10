// Runtime verification for the installed `module-map-context` plugin (imported by
// absolute path so deps resolve from the web profile node_modules).
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const PLUGIN_URL = pathToFileURL('C:/Users/王晨曦/.dsh/profiles/web/node_modules/module-map-context/index.js').href;
const { apply, name } = await import(PLUGIN_URL);

let failures = 0;
function check(label, cond) {
  if (cond) console.log(`  [PASS] ${label}`);
  else { console.log(`  [FAIL] ${label}`); failures += 1; }
}

// --- fake fs backed by an in-memory file map ---
function makeFs(files) {
  const tok = (p) => ({ key: `t:${p}`, p });
  return {
    async resolve(p, _opts) { return tok(path.resolve(p)); },
    async stat(target) { const f = files.get(path.normalize(target.p)); return f ? { type: f.type, version: 1 } : undefined; },
    async listDir(target) {
      const f = files.get(path.normalize(target.p));
      if (!f || f.type !== 'dir') throw Object.assign(new Error('FS_NOT_FOUND'), { code: 'FS_NOT_FOUND' });
      return f.children.map((cname) => {
        const p = path.join(target.p, cname);
        return { name: cname, type: files.get(p).type, target: tok(p) };
      });
    },
    async readText(target) { return files.get(path.normalize(target.p)).text; }
  };
}
function dir(map, abs) {
  const p = path.normalize(abs);
  if (!map.has(p)) map.set(p, { type: 'dir', children: [] });
}
function file(map, abs, text) {
  dir(map, path.dirname(abs)); // ensure parent exists, never clobber existing siblings
  const ch = map.get(path.normalize(path.dirname(abs)));
  const bn = path.basename(abs);
  if (!ch.children.includes(bn)) ch.children.push(bn);
  map.set(path.normalize(abs), { type: 'file', text });
}
const addChild = (map, dirAbs, name) => {
  const d = map.get(dirAbs);
  if (d && d.type === 'dir' && !d.children.includes(name)) d.children.push(name);
};

// workspace A: has .git + .intentflow/_packages/{a,b}.yml
const A = 'D:/testws/A';
const filesA = new Map();
dir(filesA, A);
file(filesA, path.join(A, '.git', 'x'), '');
dir(filesA, path.join(A, '.intentflow'));
dir(filesA, path.join(A, '.intentflow', '_packages'));
addChild(filesA, path.join(A, '.intentflow', '_packages'), 'a.yml');
addChild(filesA, path.join(A, '.intentflow', '_packages'), 'b.yml');
file(filesA, path.join(A, '.intentflow', '_packages', 'a.yml'), 'packageName: a\nsummary: module A\n');
file(filesA, path.join(A, '.intentflow', '_packages', 'b.yml'), 'packageName: b\nsummary: module B\n');
dir(filesA, path.join(A, 'sub'));

const A_TEXT = 'packageName: a\nsummary: module A\n' + '\n' + 'packageName: b\nsummary: module B\n';

// workspace B: no _packages, no .git
const B = 'D:/testws/B';
const filesB = new Map();
dir(filesB, B);

function makeCtx(fs) {
  const handlers = [];
  const ctx = {
    get(k) { return k === 'fs' ? fs : undefined; },
    on(evt, handler, opts) { if (evt === 'agent/pre-step') handlers.push({ handler, opts }); }
  };
  return { ctx, handler: () => handlers[0].handler };
}

const userMsg = { role: 'user', content: [{ type: 'text', text: 'hello' }] };
const decision = { kind: 'enter', messages: [userMsg] };
const next = async () => decision;
const sig = () => new AbortController().signal;

console.log('== exports ==');
check(`name === 'module-map-context'`, name === 'module-map-context');

console.log('== first step injects, snapshot appended at end ==');
{
  const { ctx, handler } = makeCtx(makeFs(filesA));
  apply(ctx, {});
  const session = { header: { cwd: path.join(A, 'sub') } }; // deeper cwd -> project root found via .git
  const res = await handler()({ agent: { session }, step: 1, signal: sig() }, next);
  check('decision is enter', res.kind === 'enter');
  check('snapshot appended at end', res.messages.length === 2 && res.messages[0] === userMsg && res.messages[1] !== userMsg);
  const s = res.messages[1];
  check('snapshot is plugin-sourced', s.role === 'user' && s.source.kind === 'plugin' && s.source.plugin === 'module-map-context' && s.source.form === 'snapshot');
  check('text is sorted verbatim concat (a then b)', s.content[0].text === A_TEXT);
}

console.log('== same session later step: no reinjection ==');
{
  const { ctx, handler } = makeCtx(makeFs(filesA));
  apply(ctx, {});
  const session = { header: { cwd: A } };
  await handler()({ agent: { session }, step: 1, signal: sig() }, next);
  const res2 = await handler()({ agent: { session }, step: 2, signal: sig() }, next);
  check('step 2 decision unchanged (no inject)', res2.kind === 'enter' && res2.messages.length === 1 && res2.messages[0] === userMsg);
}

console.log('== new session: injects again ==');
{
  const { ctx, handler } = makeCtx(makeFs(filesA));
  apply(ctx, {});
  const s1 = { header: { cwd: A } };
  const s2 = { header: { cwd: A } };
  await handler()({ agent: { session: s1 }, step: 1, signal: sig() }, next);
  const res = await handler()({ agent: { session: s2 }, step: 1, signal: sig() }, next);
  check('fresh session first step injects', res.messages.length === 2 && res.messages[1].source?.form === 'snapshot');
}

console.log('== missing _packages: graceful no-op ==');
{
  const { ctx, handler } = makeCtx(makeFs(filesB));
  apply(ctx, {});
  const session = { header: { cwd: B } };
  const res = await handler()({ agent: { session }, step: 1, signal: sig() }, next);
  check('decision unchanged when _packages absent', res.messages.length === 1 && res.messages[0] === userMsg);
}

console.log('== rejected decision: no injection, not decided ==');
{
  const { ctx, handler } = makeCtx(makeFs(filesA));
  apply(ctx, {});
  const session = { header: { cwd: A } };
  const res = await handler()({ agent: { session }, step: 1, signal: sig() }, async () => ({ kind: 'reject' }));
  check('reject passes through', res.kind === 'reject');
}

console.log('== yml appears mid-session: never injects (AGENTS.md semantics) ==');
{
  const C = 'D:/testws/C';
  const filesC = new Map();
  dir(filesC, C);
  const fs = makeFs(filesC); // reads live from filesC, so later additions become visible
  const { ctx, handler } = makeCtx(fs);
  apply(ctx, {});
  const session = { header: { cwd: C } };
  // session start: no yml -> decide + skip
  const r1 = await handler()({ agent: { session }, step: 1, signal: sig() }, next);
  check('no yml at start -> no inject', r1.messages.length === 1 && r1.messages[0] === userMsg);
  // yml appears later (e.g. after a report)
  dir(filesC, path.join(C, '.intentflow'));
  dir(filesC, path.join(C, '.intentflow', '_packages'));
  file(filesC, path.join(C, '.intentflow', '_packages', 'x.yml'), 'packageName: x\n');
  // a later turn's first step must NOT inject
  const r2 = await handler()({ agent: { session }, step: 1, signal: sig() }, next);
  check('later step after yml appears -> still no inject', r2.messages.length === 1 && r2.messages[0] === userMsg);
}

// --- minimal sessionProjections registry driven over a durable event list ---
function makeProjections() {
  const defs = new Map();
  const states = new Map();
  const events = [];
  return {
    register(def) {
      defs.set(def.key, def);
      if (!states.has(def.key)) states.set(def.key, def.init()); // same key+version re-register shares the cell, keep state
    },
    feed(event) { events.push(event); for (const [k, d] of defs) states.set(k, d.apply(states.get(k), event)); },
    stateOf(_session, key) { return states.get(key); }
  };
}
function makeCtxWithProjections(fs, projections) {
  const handlers = [];
  const ctx = {
    get(k) { return k === 'fs' ? fs : k === 'sessionProjections' ? projections : undefined; },
    on(evt, handler, opts) { if (evt === 'agent/pre-step') handlers.push({ handler, opts }); }
  };
  return { ctx, handler: () => handlers[0].handler };
}

console.log('== durable dedup across host restart (session projection) ==');
{
  const durable = makeProjections(); // the durable store that survives restart
  const { ctx, handler } = makeCtxWithProjections(makeFs(filesA), durable);
  apply(ctx, {});
  const session = { header: { cwd: A } };
  const r1 = await handler()({ agent: { session }, step: 1, signal: sig() }, next);
  check('first process injects snapshot', r1.messages.length === 2 && r1.messages[1].source?.form === 'snapshot');
  // the injected snapshot is committed as a durable user/message event -> projection folds it
  durable.feed({ type: 'user/message', data: { source: { kind: 'plugin', plugin: 'module-map-context', form: 'snapshot' }, content: [{ type: 'text', text: A_TEXT }] } });
  check('projection marked injected after commit', durable.stateOf(session, 'moduleMapContext') === true);
  // restart: fresh process, same durable store -> must NOT re-inject
  const { ctx: ctx2, handler: handler2 } = makeCtxWithProjections(makeFs(filesA), durable);
  apply(ctx2, {});
  const r2 = await handler2()({ agent: { session }, step: 1, signal: sig() }, next);
  check('restarted process does NOT re-inject (durable)', r2.messages.length === 1 && r2.messages[0] === userMsg);
}

console.log('== skip not persisted across restart (official degrade) ==');
{
  const durableB = makeProjections();
  {
    const p1 = makeCtxWithProjections(makeFs(filesB), durableB);
    apply(p1.ctx, {});
    const r = await p1.handler()({ agent: { session: { header: { cwd: B } } }, step: 1, signal: sig() }, next);
    check('skip: no _packages does not inject', r.messages.length === 1 && r.messages[0] === userMsg);
  }
  check('skip: projection not marked (not durable)', durableB.stateOf({}, 'moduleMapContext') !== true);
  {
    // restart: same durable store, now workspace with _packages present -> re-probes and injects (official degrade)
    const p2 = makeCtxWithProjections(makeFs(filesA), durableB);
    apply(p2.ctx, {});
    const r = await p2.handler()({ agent: { session: { header: { cwd: A } } }, step: 1, signal: sig() }, next);
    check('restart with _packages present -> injects once (degrade)', r.messages.length === 2 && r.messages[1].source?.form === 'snapshot');
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
