(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('walkthrough-data').textContent);
  const $ = id => document.getElementById(id);
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text = value => value === null ? 'null' : typeof value === 'string' ? value || '“”' : JSON.stringify(value);
  const clip = (value, max = 80) => { const t = text(value); return t.length > max ? `${t.slice(0, max)}…` : t; };
  const isObject = v => v !== null && typeof v === 'object';
  const isRecord = v => isObject(v) && !Array.isArray(v);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  // Missing components yield undefined so a previous snapshot can be compared without it having the path.
  const ptr = (value, path) => path === '' ? value : path.slice(1).split('/').reduce((v, k) => v == null ? undefined : v[k.replace(/~1/g, '/').replace(/~0/g, '~')], value);
  // Entities match by id/name/label; anything else only by exact value, never by position, so a shift is not a change.
  const key = v => isRecord(v) ? v.id ?? v.name ?? v.label : undefined;
  const identity = v => key(v) != null ? `key:${key(v)}` : JSON.stringify(v);
  // On a board a bare id and the record carrying that id are the same entity moving between collections.
  const boardKey = v => key(v) != null ? `key:${key(v)}` : isObject(v) ? JSON.stringify(v) : `key:${v}`;
  const describe = v => key(v) != null ? String(key(v)) : clip(v, 40);
  const labels = {observed:'Executed checkpoint', mocked:'Executed with mock', replayed:'Recorded-response replay', inferred:'Inferred • not executed'};
  const badge = kind => labels[kind];
  const prefersDark = matchMedia('(prefers-color-scheme: dark)');
  const narrow = matchMedia('(max-width: 1100px)');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  // Per-viewer conveniences only; the page works identically when storage is unavailable.
  const store = (() => {
    const ns = `code-walkthrough:${data.title}`;
    return {
      get(name, fallback) { try { const v = localStorage.getItem(`${ns}:${name}`); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
      set(name, value) { try { localStorage.setItem(`${ns}:${name}`, JSON.stringify(value)); } catch { /* storage blocked */ } },
    };
  })();

  let view = 'overview', scenarioIndex = 0, stepIndex = 0, sourceIndex = 0, timer = null, shownState, returnQuestion = null;
  const visited = new Set(store.get('visited', []));
  const scenario = () => data.scenarios[scenarioIndex];
  const step = () => scenario().steps[stepIndex];
  const previousState = () => stepIndex ? scenario().steps[stepIndex - 1].state : undefined;
  const allSteps = data.scenarios.flatMap(s => s.steps.map(e => `${s.id}/${e.id}`));
  const chapterMeta = Object.fromEntries((data.chapters || []).map(c => [c.title, c]));

  function segments(steps) {
    const list = [];
    steps.forEach((s, i) => { if (list.at(-1)?.chapter === s.chapter) list.at(-1).items.push(i); else list.push({chapter: s.chapter, items: [i]}); });
    return list;
  }

  // Prose: `code` spans become code, and the first mention of each concept becomes a definition button.
  const concepts = data.concepts || [];
  const quote = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const termRe = concepts.length ? new RegExp(concepts.map(c => esc(c.term)).sort((a, b) => b.length - a.length)
    .map(t => `${/^\w/.test(t) ? '\\b' : ''}${quote(t)}${/\w$/.test(t) ? '\\b' : ''}`).join('|'), 'gi') : null;
  function rich(value, terms = true) {
    const used = new Set(), parts = String(value).split('`');
    if (parts.length % 2 === 0) parts.splice(-2, 2, `${parts.at(-2)}\`${parts.at(-1)}`);
    return parts.map((part, i) => {
      if (i % 2) return `<code>${esc(part)}</code>`;
      const html = esc(part);
      return terms && termRe ? html.replace(termRe, m => {
        const index = concepts.findIndex(c => esc(c.term).toLowerCase() === m.toLowerCase());
        if (index < 0 || used.has(index)) return m;
        used.add(index);
        return `<button type="button" class="term" data-term="${index}">${m}</button>`;
      }) : html;
    }).join('');
  }

  function tree(value, label = 'Value', depth = 0) {
    if (isObject(value)) {
      const entries = Object.entries(value);
      if (!entries.length) return `<div class="tree-leaf"><span class="tree-key">${esc(label)}</span>${Array.isArray(value) ? '[]' : '{}'}</div>`;
      return `<details ${depth < 1 ? 'open' : ''}><summary>${esc(label)} <span class="muted">(${plural(entries.length, Array.isArray(value) ? 'item' : 'field')})</span></summary><div class="tree-body">${entries.map(([k, v]) => tree(v, k, depth + 1)).join('')}</div></details>`;
    }
    return `<div class="tree-leaf"><span class="tree-key">${esc(label)}</span>${esc(text(value))}</div>`;
  }

  function partition(items, render, limit, noun) {
    const first = render(items.slice(0, limit), 0);
    return items.length <= limit ? first : `${first}<details class="more"><summary>Show remaining ${items.length - limit} ${noun} (${items.length} total)</summary>${render(items.slice(limit), limit)}</details>`;
  }

  // Pair each current item with its predecessor by identity.
  function match(before, after) {
    if (!Array.isArray(before)) return {known: false, matched: [], gone: []};
    const pool = new Map();
    before.forEach(v => { const k = identity(v); pool.set(k, [...(pool.get(k) || []), v]); });
    const matched = after.map(v => pool.get(identity(v))?.shift());
    return {known: true, matched, gone: [...pool.values()].flat()};
  }

  const pill = (kind, label) => `<span class="pill pill-${kind}">${label}</span>`;
  const gone = (m, noun) => m.gone.length ? `<p class="gone-note">Left ${noun} since the previous step: ${m.gone.map(v => `<s>${esc(describe(v))}</s>`).join('')}</p>` : '';
  function delta(before, after) {
    if (before === undefined || same(before, after)) return '';
    if (typeof before !== 'number' || typeof after !== 'number') return '<span class="delta-chip">changed</span>';
    const d = Number((after - before).toPrecision(12));
    return `<span class="delta-chip">${d > 0 ? '+' : '−'}${Math.abs(d)}</span>`;
  }

  function board(view, value, old) {
    const prior = isRecord(old) ? view.groups.map(g => ptr(old, g.path)) : null;
    const where = new Map(), previous = new Map();
    prior?.forEach((items, gi) => Array.isArray(items) && items.forEach(v => { where.set(boardKey(v), view.groups[gi].title); previous.set(boardKey(v), v); }));
    const groups = view.groups.map(g => ({title: g.title, items: ptr(value, g.path)}));
    const now = new Set(groups.flatMap(g => g.items.map(boardKey)));
    const fields = (v, before) => isRecord(v) ? `<span class="token-fields">${Object.entries(v).filter(([k]) => v[k] !== key(v)).map(([k, x]) =>
      `<span class="${isRecord(before) && !same(before[k], x) ? 'is-changed' : ''}">${esc(k)} <b>${esc(clip(x, 24))}</b></span>`).join('')}</span>` : '';
    return `<div class="board" style="--cols:${groups.length}">${groups.map((g, gi) => {
      const tokens = g.items.map(v => {
        const k = boardKey(v), from = where.get(k), before = previous.get(k);
        const status = !prior ? '' : from === undefined ? 'new' : from !== g.title ? 'moved' : !same(before, v) ? 'changed' : '';
        const label = key(v) ?? (isObject(v) ? 'Item' : clip(v, 30));
        return `<div class="token ${status ? `is-${status}` : ''}"><span class="token-label">${esc(label)}</span>${status === 'moved' ? `<span class="token-from">from ${esc(from)}</span>` : status === 'new' ? pill('new', 'new') : ''}${fields(v, from === g.title ? before : undefined)}</div>`;
      });
      const ghosts = Array.isArray(prior?.[gi]) ? prior[gi].filter(v => !now.has(boardKey(v))).map(v => `<div class="token is-gone"><span class="token-label"><s>${esc(describe(v))}</s></span><span class="token-from">left</span></div>`) : [];
      return `<div class="board-col"><div class="board-col-head"><span>${esc(g.title)}</span><span class="count">${g.items.length}</span></div><div class="board-items">${tokens.join('')}${ghosts.join('')}${tokens.length || ghosts.length ? '' : '<p class="board-empty">empty</p>'}</div></div>`;
    }).join('')}</div>`;
  }

  function visual(view, state, prior) {
    const value = ptr(state, view.path), old = prior === undefined ? undefined : ptr(prior, view.path);
    const changed = prior !== undefined && !same(old, value);
    let content = '';
    if (view.type === 'text') content = `<div class="value-text ${changed ? 'is-changed' : ''}">${esc(text(value))}</div>`;
    if (view.type === 'tree') content = `<div class="tree">${tree(value, view.title)}</div>`;
    if (view.type === 'board') content = board(view, value, old);
    if (view.type === 'metrics') content = `<div class="metrics">${Object.entries(value).map(([label, v]) => {
      const d = isRecord(old) ? delta(old[label], v) : '';
      return `<div class="metric ${d ? 'is-changed' : ''}"><span class="metric-label">${esc(label)}</span><span class="metric-value">${esc(text(v))}</span>${d}</div>`;
    }).join('')}</div>`;
    if (view.type === 'bars') {
      const scale = Math.max(...Object.values(value).map(Math.abs), 0) || 1;
      content = `<div class="bars" role="list">${Object.entries(value).map(([label, v]) => {
        const was = isRecord(old) && typeof old[label] === 'number' ? old[label] : 0, d = isRecord(old) ? delta(old[label], v) : '';
        return `<div class="bar-row ${d ? 'is-changed' : ''}" role="listitem" title="${esc(label)}: ${esc(text(v))}"><span class="bar-label">${esc(label)}</span><span class="bar-track" aria-hidden="true"><span class="bar-fill ${v < 0 ? 'negative' : ''}" style="width:${Math.abs(was) / scale * 100}%" data-width="${Math.abs(v) / scale * 100}"></span></span><span class="bar-value">${esc(text(v))}${d}</span></div>`;
      }).join('')}</div>`;
    }
    if (view.type === 'queue') {
      const m = match(old, value);
      const ghosts = m.gone.map(item => `<div class="queue-item is-gone"><span class="queue-index">left</span>${esc(describe(item))}</div>`);
      const items = value.map((item, i) => `<div class="queue-item ${m.known && m.matched[i] === undefined ? 'is-new' : ''}"><span class="queue-index">#${i + 1}${m.known && m.matched[i] === undefined ? pill('new', 'new') : ''}</span>${isObject(item) ? tree(item, String(item.id ?? item.name ?? 'Item')) : esc(text(item))}</div>`);
      const lane = list => `<div class="queue">${list.join('<span class="queue-arrow" aria-hidden="true">→</span>')}</div>`;
      content = value.length ? lane([...ghosts, ...items]) : `<p class="empty">Queue is empty at this step.</p>${ghosts.length ? lane(ghosts) : ''}`;
    }
    if (view.type === 'records') {
      const m = match(old, value);
      content = partition(value, (rows, offset) => `<div class="records">${rows.map((row, j) => {
        const before = m.matched[offset + j], added = m.known && before === undefined;
        const fields = Object.entries(row).map(([k, v]) => `<dt>${esc(k)}</dt><dd class="${before && !same(before[k], v) ? 'is-changed' : ''}">${isObject(v) ? `<div class="tree">${tree(v, k, 1)}</div>` : esc(text(v))}</dd>`).join('');
        const edited = before && !same(before, row), name = String(row.id ?? row.name ?? row.label ?? 'Record');
        return `<article class="record ${added ? 'is-new' : edited ? 'is-edited' : ''}"><div class="record-header"><span class="avatar" aria-hidden="true">${esc(name.slice(0, 1).toUpperCase())}</span><span>${esc(name)}</span>${added ? pill('new', 'new') : edited ? pill('changed', 'updated') : ''}</div><dl>${fields}</dl></article>`;
      }).join('')}</div>`, 12, 'records') + gone(m, 'this list');
    }
    if (view.type === 'table') {
      const m = match(old, value);
      content = partition(value, (rows, offset) => `<div class="table-scroll"><table><thead><tr>${view.columns.map(c => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((row, j) => {
        const before = m.matched[offset + j];
        return `<tr class="${m.known && before === undefined ? 'is-new' : ''}">${view.columns.map(c => `<td class="${before && !same(before[c], row[c]) ? 'is-changed' : ''}">${esc(text(row[c]))}</td>`).join('')}</tr>`;
      }).join('')}</tbody></table></div>`, 50, 'rows') + gone(m, 'this table');
    }
    if ((['records', 'table'].includes(view.type) && !value.length) || (['metrics', 'bars'].includes(view.type) && !Object.keys(value).length)) {
      content = '<p class="empty">No items at this step.</p>' + (Array.isArray(value) ? gone(match(old, value), 'this list') : '');
    }
    const count = Array.isArray(value) ? `<span class="count">${value.length}</span>` : '';
    return `<section class="visual" data-visual="${esc(view.type)}"><header class="visual-head"><h3>${esc(view.title)}${count}</h3>${changed ? '<span class="changed-dot" title="Changed since the previous step">changed</span>' : ''}</header>${content}${view.caption ? `<p class="visual-caption">${rich(view.caption)}</p>` : ''}</section>`;
  }

  function differences(before, after, path = '') {
    if (same(before, after)) return [];
    if (isObject(before) && isObject(after) && Array.isArray(before) === Array.isArray(after)) {
      return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(k => differences(before[k], after[k], `${path}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`));
    }
    return [{path: path || '/', before, after}];
  }

  function renderChanges() {
    if (stepIndex === 0) {
      $('change-count').textContent = 'start';
      $('changes').innerHTML = '<p class="muted">Starting snapshot. Later steps list every selected value that changed.</p>';
      return;
    }
    const changes = differences(previousState(), step().state);
    const render = rows => rows.map(c => `<div class="change"><span class="change-path">${esc(c.path)}</span><span class="change-before">${c.before === undefined ? 'Absent' : esc(text(c.before))}</span><span class="change-arrow" aria-label="becomes">→</span><span class="change-after">${c.after === undefined ? 'Removed' : esc(text(c.after))}</span></div>`).join('');
    $('change-count').textContent = String(changes.length);
    $('changes').innerHTML = changes.length ? partition(changes, render, 8, 'changes') : '<p class="muted">Selected values are unchanged. This step explains control flow.</p>';
  }

  const notesOf = s => (s.lineNotes || []).map((n, i) => ({...n, i, file: n.file ?? s.sources[0].path}));

  function renderSource() {
    const s = step(), source = s.sources[sourceIndex];
    const inline = (s.watch || []).filter(w => w.line && (w.file ?? s.sources[0].path) === source.path);
    const notes = notesOf(s).filter(n => n.file === source.path);
    $('file-tabs').innerHTML = s.sources.map((src, i) => {
      const count = notesOf(s).filter(n => n.file === src.path).length;
      return `<button role="tab" aria-selected="${i === sourceIndex}" data-source="${i}" title="${esc(src.path)}">${esc(src.label || src.path.split('/').at(-1))}${count ? `<span class="tab-notes">${count}</span>` : ''}</button>`;
    }).join('');
    $('source-location').textContent = `${source.path}:${source.start}–${source.end}`;
    $('language').textContent = source.language === 'Text only' ? 'Plain text' : source.language;
    $('code').innerHTML = `<div class="code-lines has-focus">${source.lines.map(line => {
      const focus = source.focus.includes(line.number);
      const markers = notes.filter(n => n.line === line.number).map(n => `<button type="button" class="note-marker" data-note="${n.i}" aria-label="Line note ${n.i + 1}">${n.i + 1}</button>`).join('');
      const values = inline.filter(w => w.line === line.number).map(w => `<span class="inline-value"><b>${esc(w.label)}</b>${esc(clip(ptr(s.state, w.path)))}</span>`).join('');
      return `<div class="code-line ${focus ? 'focus' : ''}" data-line="${line.number}" ${focus ? 'aria-current="true"' : ''}><span class="line-number">${line.number}</span><span class="note-gutter">${markers}</span><span class="line-code">${line.html || ' '}${values}</span></div>`;
    }).join('')}</div>`;
    const focused = $('code').querySelector('.focus');
    if (focused) $('code').scrollTop = Math.max(0, focused.offsetTop - $('code').querySelector('.code-lines').offsetTop - 70);
    $('evidence').className = `evidence ev ev-${s.evidence.kind}`;
    $('evidence-summary').innerHTML = `<span class="ev-dot"></span>${badge(s.evidence.kind)} <span class="muted">· how these values were obtained</span>`;
    $('evidence-body').innerHTML = `<p>${esc(s.evidence.detail)}</p><p>Source SHA-256: <code>${esc(source.sha256)}</code></p>${s.evidence.record ? `<p>Checkpoint: <code>${esc(s.evidence.record.path)} · ${esc(s.evidence.record.id)}</code></p>` : '<p>These values are a narrated simulation derived from source inspection.</p>'}<p>Highlighting marks the source discussed by this snapshot; it does not assert that every displayed line executed.</p>`;
  }

  function renderWatch() {
    const s = step(), prior = previousState();
    $('watch').innerHTML = (s.watch || []).length ? `<div class="watch-title">Values in focus</div><div class="watch-grid">${s.watch.map(w => {
      const now = ptr(s.state, w.path), was = prior === undefined ? undefined : ptr(prior, w.path), changed = prior !== undefined && !same(was, now);
      return `<div class="watch-row ${changed ? 'changed' : ''}"><span class="w-name">${esc(w.label)}</span><span class="w-val">${esc(text(now))}</span>${changed ? `<span class="w-was">was ${was === undefined ? 'absent' : esc(clip(was, 30))}</span>` : ''}</div>`;
    }).join('')}</div>` : '';
    $('watch').hidden = !s.watch?.length;
  }

  function renderStack() {
    const frames = step().callStack || [];
    $('stack').hidden = !frames.length;
    $('stack').innerHTML = frames.map((f, i) => `<span class="frame ${i === frames.length - 1 ? 'top' : ''}">${esc(f)}</span>`).join('<span class="frame-sep" aria-hidden="true">›</span>');
  }

  function renderTimeline() {
    const steps = scenario().steps;
    $('timeline').innerHTML = segments(steps).map(seg => `<div class="chapter-seg ${seg.items.includes(stepIndex) ? 'current' : ''}" style="--n:${seg.items.length}"><span class="chapter-name" title="${esc(seg.chapter)}">${esc(seg.chapter)}</span><div class="ticks">${seg.items.map(i => {
      const kind = steps[i].evidence.kind;
      return `<button class="tick ev ev-${kind} ${i < stepIndex ? 'done' : i === stepIndex ? 'current' : ''}" data-step="${i}" tabindex="-1" title="${i + 1}. ${esc(steps[i].title)} · ${badge(kind)}" aria-label="Step ${i + 1}: ${esc(steps[i].title)}"></button>`;
    }).join('')}</div></div>`).join('');
  }

  function renderOutline() {
    const steps = scenario().steps, sid = scenario().id;
    const segs = segments(steps), order = [...new Set(steps.map(s => s.chapter))];
    $('outline-tree').innerHTML = `<ol class="ol-chapters">${segs.map(seg => {
      const seen = seg.items.filter(i => visited.has(`${sid}/${steps[i].id}`)).length, current = seg.items.includes(stepIndex);
      const meta = chapterMeta[seg.chapter];
      return `<li class="ol-chapter ${current ? 'current' : ''} ${seen === seg.items.length ? 'complete' : ''}"><div class="ol-chapter-head" ${meta ? `title="${esc(meta.summary)}"` : ''}><span class="ol-num">${seen === seg.items.length ? '✓' : order.indexOf(seg.chapter) + 1}</span><span class="ol-chapter-title">${esc(seg.chapter)}</span><span class="ol-chapter-count">${seen}/${seg.items.length}</span></div><ol class="ol-steps">${seg.items.map(i => {
        const s = steps[i], state = i === stepIndex ? 'current' : visited.has(`${sid}/${s.id}`) ? 'visited' : '';
        return `<li><button type="button" class="ol-step ${state}" data-step="${i}" ${i === stepIndex ? 'aria-current="step"' : ''}><span class="ol-dot ev ev-${s.evidence.kind}" title="${badge(s.evidence.kind)}"></span><span class="ol-step-n">${i + 1}</span><span class="ol-step-title">${esc(s.title)}</span>${s.iteration ? `<span class="ol-tag">#${s.iteration}</span>` : ''}${s.attempt ? `<span class="ol-tag">try ${s.attempt}</span>` : ''}</button></li>`;
      }).join('')}</ol></li>`;
    }).join('')}</ol>`;
    const seen = steps.filter(s => visited.has(`${sid}/${s.id}`)).length;
    $('outline-progress-text').textContent = `${seen} of ${plural(steps.length, 'step')} explored`;
    $('outline-meter').style.width = `${seen / steps.length * 100}%`;
    const quizCount = data.quiz?.questions.length || 0;
    $('outline-quiz').hidden = !quizCount;
    $('outline-quiz').innerHTML = `<span class="oq-icon" aria-hidden="true">✓</span><span><b>Check your understanding</b><small>${plural(quizCount, 'question')}${quizBest() != null ? ` · best ${quizBest()}%` : ''}</small></span><span aria-hidden="true">→</span>`;
    $('outline-tree').querySelector('[aria-current="step"]')?.scrollIntoView({block: 'nearest'});
  }

  function renderLanes() {
    const steps = scenario().steps, lanes = [...new Set(steps.map(s => s.lane))];
    $('lane-details').hidden = lanes.length < 2;
    if (lanes.length < 2) return;
    const gutter = 14, dx = 28, dy = 36, top = 18, at = Object.fromEntries(steps.map((s, i) => [s.id, i]));
    const pos = i => [gutter + i * dx, top + lanes.indexOf(steps[i].lane) * dy];
    const width = gutter + steps.length * dx, height = top + lanes.length * dy;
    const tracks = lanes.map((lane, r) => `<line class="lane-track" x1="0" x2="${width}" y1="${top + r * dy}" y2="${top + r * dy}"/>`).join('');
    const links = steps.flatMap((s, i) => s.causes.map(c => { const [x1, y1] = pos(at[c]), [x2, y2] = pos(i), mx = (x1 + x2) / 2; return `<path class="lane-link ${i === stepIndex ? 'active' : ''}" d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}"/>`; })).join('');
    const dots = steps.map((s, i) => { const [x, y] = pos(i); return `<g class="lane-dot ev ev-${s.evidence.kind} ${i < stepIndex ? 'done' : i === stepIndex ? 'current' : ''}" data-step="${i}"><title>${i + 1}. ${esc(s.title)}${s.attempt ? ` · attempt ${s.attempt}` : ''}${s.iteration ? ` · iteration ${s.iteration}` : ''} · ${esc(badge(s.evidence.kind))}</title><circle cx="${x}" cy="${y}" r="7"/><text x="${x}" y="${y + 19}" text-anchor="middle">${i + 1}</text></g>`; }).join('');
    $('lane-chart').innerHTML = `<div class="lane-names" aria-hidden="true">${lanes.map(l => `<span title="${esc(l)}">${esc(l)}</span>`).join('')}</div><div class="lane-scroll"><svg width="${width + 10}" height="${height}" role="img" aria-label="Swimlane chart of ${steps.length} steps across ${lanes.length} lanes">${tracks}${links}${dots}</svg></div>`;
    const chart = $('lane-chart').querySelector('.lane-scroll');
    chart.scrollLeft = pos(stepIndex)[0] - chart.clientWidth / 2;
  }

  const targetStep = id => { const steps = scenario().steps, next = steps.findIndex((s, i) => i > stepIndex && s.node === id); return next >= 0 ? next : steps.findIndex(s => s.node === id); };

  // A compact "you are here" path: graph nodes in the order this scenario first reaches them.
  function renderFlow() {
    const steps = scenario().steps, current = step(), nodes = Object.fromEntries(data.graph.nodes.map(n => [n.id, n]));
    const order = [...new Set(steps.map(s => s.node))];
    const chips = order.map(id => {
      const total = steps.filter(s => s.node === id).length, soFar = steps.slice(0, stepIndex + 1).filter(s => s.node === id).length;
      const state = id === current.node ? 'current' : soFar ? 'done' : 'todo';
      return `<button type="button" class="flow-node ${state}" data-step="${targetStep(id)}" title="${esc(nodes[id].description)}"><span class="flow-dot" aria-hidden="true"></span>${esc(nodes[id].label)}${total > 1 ? `<span class="flow-count">${soFar}/${total}</span>` : ''}</button>`;
    });
    $('flow').innerHTML = `<div class="flow-track">${chips.join('<span class="flow-arrow" aria-hidden="true">→</span>')}</div><p class="flow-note"><b>${esc(nodes[current.node].label)}</b> · ${esc(nodes[current.node].description)} <button type="button" class="link" data-view="overview" data-anchor="map">Full map</button></p>`;
  }

  function graphSvg() {
    const nodes = data.graph.nodes, edges = data.graph.edges, steps = scenario().steps, current = step();
    const map = Object.fromEntries(nodes.map(n => [n.id, n]));
    const visits = {}, totals = {}, walked = new Set();
    steps.forEach((s, i) => { totals[s.node] = (totals[s.node] || 0) + 1; if (i <= stepIndex) visits[s.node] = (visits[s.node] || 0) + 1; if (i && i <= stepIndex) walked.add(`${steps[i - 1].node}>${s.node}`); });
    const latest = stepIndex ? `${steps[stepIndex - 1].node}>${current.node}` : '';
    const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
    const x0 = Math.min(...xs) - 20, y0 = Math.min(...ys) - 20, w = Math.max(...xs) - x0 + 225, h = Math.max(...ys) - y0 + 90;
    const paths = edges.map(e => {
      const a = map[e.from], b = map[e.to], k = `${e.from}>${e.to}`, self = e.from === e.to;
      let d, lx, ly;
      // A two-way pair is drawn as two parallel curves so neither hides the other or its label.
      const o = edges.some(r => r.from === e.to && r.to === e.from) && !self ? (e.from < e.to ? -9 : 9) : 0;
      if (self) [d, lx, ly] = [`M ${a.x + 155} ${a.y + 15} C ${a.x + 195} ${a.y - 30},${a.x + 195} ${a.y + 75},${a.x + 155} ${a.y + 38}`, a.x + 200, a.y + 26];
      else if (Math.abs(a.y - b.y) < 50) {
        // Same row: connect facing sides so the curve does not cross either box.
        const ax = b.x >= a.x ? a.x + 160 : a.x, bx = b.x >= a.x ? b.x : b.x + 160, ay = a.y + 25 + o, by = b.y + 25 + o, mx = (ax + bx) / 2;
        [d, lx, ly] = [`M ${ax} ${ay} C ${mx} ${ay},${mx} ${by},${bx} ${by}`, mx, (ay + by) / 2 + (o > 0 ? 15 : -7)];
      } else {
        const down = b.y > a.y, ax = a.x + 80 + o * 2, ay = down ? a.y + 50 : a.y, bx = b.x + 80 + o * 2, by = down ? b.y : b.y + 50, my = (ay + by) / 2;
        [d, lx, ly] = [`M ${ax} ${ay} C ${ax} ${my},${bx} ${my},${bx} ${by}`, (ax + bx) / 2 + o * 4, my - 5];
      }
      return `<path class="graph-edge ${k === latest ? 'latest' : walked.has(k) ? 'walked' : ''}" d="${d}" marker-end="url(#graph-arrow)"><title>${esc(e.label)}</title></path><text class="graph-label" x="${lx}" y="${ly}" text-anchor="${self ? 'start' : 'middle'}">${esc(e.label)}</text>`;
    }).join('');
    const boxes = nodes.map(n => {
      const jump = targetStep(n.id), active = n.id === current.node;
      const classes = ['graph-node', active && 'active', visits[n.id] && 'visited', !totals[n.id] && 'unused'].filter(Boolean).join(' ');
      const note = totals[n.id] ? `${visits[n.id] || 0} of ${plural(totals[n.id], 'visit')}` : 'not in this scenario';
      return `<g class="${classes}" transform="translate(${n.x},${n.y})" ${jump >= 0 ? `data-step="${jump}"` : ''}><title>${esc(n.label)}: ${esc(n.description)} (${note})</title><rect width="160" height="50" rx="10"/><text x="80" y="23" text-anchor="middle">${esc(n.label)}</text><text class="visits" x="80" y="39" text-anchor="middle">${note}</text></g>`;
    }).join('');
    return `<svg width="${w}" height="${h}" viewBox="${x0} ${y0} ${w} ${h}" role="img" aria-label="Codebase flow; the current step is at ${esc(map[current.node].label)}"><defs><marker id="graph-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path class="graph-arrow" d="M0,0 L0,6 L6,3 z"/></marker></defs>${paths}${boxes}</svg>`;
  }

  function scenarioProgress(s) { return s.steps.filter(e => visited.has(`${s.id}/${e.id}`)).length; }

  function renderOverview() {
    const analysis = data.analysis, build = data.build, total = analysis.coverage.length;
    const stepsCount = allSteps.length, chapterCount = new Set(data.scenarios.flatMap(s => s.steps.map(e => e.chapter))).size;
    const nodes = Object.fromEntries(data.graph.nodes.map(n => [n.id, n]));
    const stat = (n, label) => `<div class="ov-stat"><span class="ov-stat-value">${n}</span><span class="ov-stat-label">${label}</span></div>`;
    const bar = ['read', 'skimmed', 'unread', 'excluded'].map(k => build.coverageCounts[k] ? `<span class="cov-${k}" style="width:${build.coverageCounts[k] / total * 100}%" title="${build.coverageCounts[k]} ${k}"></span>` : '').join('');
    const resume = visited.size && view === 'overview' ? scenario().steps[stepIndex] : null;
    const cards = data.scenarios.map((s, i) => {
      const seen = scenarioProgress(s), nodesUsed = [...new Set(s.steps.map(e => e.node))].map(id => nodes[id].label);
      return `<article class="scenario-card ${i === scenarioIndex ? 'selected' : ''}"><div class="sc-top"><span class="sc-num">${String.fromCharCode(65 + i)}</span><h4>${esc(s.title)}</h4></div><p>${rich(s.summary)}</p><p class="sc-path">${nodesUsed.map(esc).join(' → ')}</p><p class="sc-outcome"><b>Outcome</b> ${rich(s.outcome)}</p><div class="sc-foot"><span class="meter" title="${seen} of ${s.steps.length} steps explored"><span style="width:${seen / s.steps.length * 100}%"></span></span><span class="muted">${seen}/${s.steps.length}</span><button type="button" data-start-scenario="${i}" class="${seen ? 'secondary' : ''}">${seen === s.steps.length ? 'Replay' : seen ? 'Continue' : 'Start'} →</button></div></article>`;
    }).join('');
    const chapterList = [...new Set(data.scenarios.flatMap(s => s.steps.map(e => e.chapter)))];
    const learning = chapterList.map((c, i) => {
      const meta = chapterMeta[c], si = data.scenarios.findIndex(s => s.steps.some(e => e.chapter === c));
      const first = data.scenarios[si].steps.findIndex(e => e.chapter === c);
      return `<li><button type="button" class="lp-item" data-start-scenario="${si}" data-start-step="${first}"><span class="lp-num">${i + 1}</span><span class="lp-body"><b>${esc(c)}</b>${meta ? `<span>${rich(meta.summary, false)}</span>${meta.goals ? `<span class="lp-goals">${meta.goals.map(g => `<span>${rich(g, false)}</span>`).join('')}</span>` : ''}` : ''}</span></button></li>`;
    }).join('');
    $('view-overview').innerHTML = `<div class="ov-wrap">
      <section class="ov-hero">
        <p class="eyebrow">${esc(data.repoLabel)}</p>
        <h2>${esc(data.title)}</h2>
        <p class="lead">${rich(data.summary)}</p>
        <p class="scope"><b>Scope</b> ${rich(data.scope)}</p>
        <div class="ov-stats">${stat(data.scenarios.length, 'scenarios')}${stat(stepsCount, 'steps')}${stat(chapterCount, 'chapters')}${stat(build.sourceCount, 'source files')}${data.quiz ? stat(data.quiz.questions.length, 'quiz questions') : ''}</div>
        <div class="ov-cta"><button type="button" data-start-scenario="${scenarioIndex}" data-start-step="${resume ? stepIndex : 0}">${resume ? `Resume: step ${stepIndex + 1} of “${esc(scenario().title)}”` : 'Start the walkthrough'} →</button>${data.quiz ? '<button type="button" class="secondary" data-view="quiz">Go to the quiz</button>' : ''}</div>
      </section>
      <section class="ov-how" aria-label="How to read this page">
        <div><span class="how-num">1</span><b>Overview</b><p>Scenarios, the codebase map and what the analysis covers.</p></div>
        <div><span class="how-num">2</span><b>Walkthrough</b><p>Real source on the left; the values it produced on the right, one step at a time.</p></div>
        <div><span class="how-num">3</span><b>Quiz</b><p>Multiple choice, fill-in-the-blank and ordering questions, each linked back to its step.</p></div>
      </section>
      <section class="ov-section"><h3 class="section-title">Scenarios</h3><div class="scenario-grid">${cards}</div></section>
      <section class="ov-section" id="ov-map"><h3 class="section-title">Codebase map</h3><p class="muted">Highlighted for “${esc(scenario().title)}” up to step ${stepIndex + 1}. Select a box to open its next step. The path follows walkthrough order and does not prove that every edge executed.</p><div class="graph-scroll">${graphSvg()}</div><details class="fold"><summary>Nodes &amp; relationships as text</summary><ul>${data.graph.nodes.map(n => `<li><b>${esc(n.label)}:</b> ${esc(n.description)}</li>`).join('')}${data.graph.edges.map(e => `<li>${esc(nodes[e.from].label)} → ${esc(nodes[e.to].label)}: ${esc(e.label)}</li>`).join('')}</ul></details></section>
      <section class="ov-section"><h3 class="section-title">Learning path</h3><ol class="learning-path">${learning}</ol></section>
      <div class="ov-columns">
        <section class="ov-section"><h3 class="section-title">Entry points</h3><ul class="plain">${analysis.entrypoints.map(v => `<li><code>${esc(v)}</code></li>`).join('')}</ul><h3 class="section-title">What the code establishes</h3><ul class="checks">${analysis.findings.map(v => `<li>${rich(v)}</li>`).join('')}</ul></section>
        ${concepts.length ? `<section class="ov-section"><h3 class="section-title">Key concepts</h3><dl class="glossary">${concepts.map(c => `<dt>${esc(c.term)}</dt><dd>${rich(c.definition, false)}</dd>`).join('')}</dl></section>` : ''}
      </div>
      <section class="ov-section"><h3 class="section-title">Coverage &amp; limits</h3><p>${analysis.inventoryCount} paths inventoried; ${total} coverage entries recorded. Directory entries can summarize a subsystem; an inventory is not proof of reading.</p><div class="coverage-bar" aria-hidden="true">${bar}</div><div class="coverage-counts">${Object.entries(build.coverageCounts).map(([k, v]) => `<span class="cov-key cov-key-${esc(k)}"><b>${v}</b> ${esc(k)}</span>`).join('')}</div><details class="fold"><summary>Coverage ledger (${total})</summary><div class="table-scroll"><table><thead><tr><th>Path</th><th>Review</th><th>Reason</th></tr></thead><tbody>${analysis.coverage.map(c => `<tr><td><code>${esc(c.path)}</code></td><td>${esc(c.status)}</td><td>${esc(c.reason)}</td></tr>`).join('')}</tbody></table></div></details>${analysis.limitations.length ? `<h4>Limitations</h4><ul class="limits">${analysis.limitations.map(v => `<li>${rich(v)}</li>`).join('')}</ul>` : ''}<div class="legend">${Object.entries(labels).map(([k, v]) => `<span class="badge ev ev-${k}">${v}</span>`).join('')}</div></section>
      <p class="build-info muted">Built ${esc(build.created)} · commit ${esc(build.commit)} · working tree ${esc(build.workingTree)} · ${build.sourceCount} source files checked · ${build.checkpointFiles} checkpoint files loaded. Values and code are frozen into this offline page.</p>
    </div>`;
  }

  function renderStory() {
    const s = step(), steps = scenario().steps, count = steps.length, prior = previousState(), kind = s.evidence.kind;
    const chapters = [...new Set(steps.map(e => e.chapter))], chapterNo = chapters.indexOf(s.chapter) + 1;
    const lanes = new Set(steps.map(e => e.lane)).size;
    $('crumbs').innerHTML = `<button type="button" class="crumb" data-view="overview">${esc(scenario().title)}</button><span class="crumb-sep">›</span><span class="crumb">Chapter ${chapterNo} of ${chapters.length}: ${esc(s.chapter)}</span><span class="crumb-sep">›</span><span class="crumb current">Step ${stepIndex + 1} of ${count}</span>`;
    $('tags').innerHTML = `<span class="badge ev ev-${kind}">${badge(kind)}</span>${lanes > 1 ? `<span class="badge">${esc(s.lane)}</span>` : ''}${s.iteration ? `<span class="tag">iteration ${s.iteration}</span>` : ''}${s.attempt ? `<span class="tag">attempt ${s.attempt}</span>` : ''}`;
    const meta = chapterMeta[s.chapter], opens = stepIndex === 0 || steps[stepIndex - 1].chapter !== s.chapter;
    $('chapter-intro').innerHTML = meta && opens ? `<section class="chapter-intro"><p class="eyebrow">Chapter ${chapterNo} · ${esc(s.chapter)}</p><p>${rich(meta.summary)}</p>${meta.goals ? `<ul>${meta.goals.map(g => `<li>${rich(g)}</li>`).join('')}</ul>` : ''}</section>` : '';
    $('step-title').textContent = s.title;
    $('explanation').innerHTML = rich(s.explanation);
    const result = ptr(s.state, s.decision?.resultPath ?? '');
    $('decision').innerHTML = s.decision ? `<section class="decision"><div class="decision-question"><span class="diamond" aria-hidden="true"><span>?</span></span><div><span class="eyebrow">Branch</span><p>${rich(s.decision.condition)}</p></div><b class="decision-result ${result ? 'true' : 'false'}">${result ? 'True' : 'False'}</b></div><div class="decision-paths"><div class="path taken"><span class="path-label">✓ Taken</span><span>${rich(s.decision.taken)}</span></div><div class="path not-taken"><span class="path-label">✕ Not taken in this run</span><span>${rich(s.decision.notTaken)}</span></div></div></section>` : '';
    const notes = notesOf(s);
    $('line-notes').hidden = !notes.length;
    $('line-notes').innerHTML = notes.length ? `<h3 class="section-title">Line by line</h3><ol class="note-list">${notes.map(n => `<li data-note="${n.i}"><button type="button" class="note-num" data-note="${n.i}" aria-label="Show line ${n.line} in the code">${n.i + 1}</button><span class="note-line">${s.sources.length > 1 ? `${esc(n.file.split('/').at(-1))}:` : 'line '}${n.line}</span><span class="note-text">${rich(n.text)}</span></li>`).join('')}</ol>` : '';
    $('visuals').innerHTML = `<h3 class="section-title">State at this step</h3>${s.visuals.map(v => visual(v, s.state, prior)).join('')}`;
    const glyph = {why: '?', concept: '◆', gotcha: '!', performance: '↯', 'edge-case': '◇', design: '✎'};
    const kindLabel = {why: 'Why', concept: 'Concept', gotcha: 'Gotcha', performance: 'Performance', 'edge-case': 'Edge case', design: 'Design'};
    $('insights').hidden = !s.insights?.length;
    $('insights').innerHTML = s.insights?.length ? `<h3 class="section-title">Under the hood</h3><div class="insight-grid">${s.insights.map(n => `<article class="insight k-${n.kind}"><span class="insight-kind"><span class="insight-glyph" aria-hidden="true">${glyph[n.kind]}</span>${kindLabel[n.kind]}</span>${n.title ? `<h4>${rich(n.title, false)}</h4>` : ''}<p>${rich(n.text)}</p></article>`).join('')}</div>` : '';
    const last = stepIndex === count - 1, nextScenario = data.scenarios[scenarioIndex + 1];
    $('outcome').hidden = !last;
    $('outcome').innerHTML = last ? `<p class="eyebrow">Scenario complete</p><h3>${esc(scenario().title)}</h3><p>${rich(scenario().outcome)}</p><div class="outcome-actions">${nextScenario ? `<button type="button" data-start-scenario="${scenarioIndex + 1}" class="${data.quiz ? 'secondary' : ''}">Next scenario: ${esc(nextScenario.title)} →</button>` : ''}${data.quiz ? '<button type="button" data-view="quiz">Test your understanding →</button>' : ''}</div>` : '';
    $('causes').innerHTML = s.causes.length ? `<p class="causes"><span class="muted">Depends on</span>${s.causes.map(id => { const i = steps.findIndex(e => e.id === id); return `<button type="button" class="chip" data-step="${i}">${i + 1}. ${esc(steps[i].title)}</button>`; }).join('')}</p>` : '';
    const input = scenario().input;
    $('input-summary').innerHTML = `Synthetic input <span class="count">${Array.isArray(input) ? plural(input.length, 'item') : 'value'}</span>`;
  }

  function animate() {
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll('.bar-fill[data-width]').forEach(bar => { bar.style.width = `${bar.dataset.width}%`; })));
  }

  function render() {
    const s = step(), count = scenario().steps.length;
    visited.add(`${scenario().id}/${s.id}`);
    store.set('visited', [...visited]);
    $('phase').textContent = {before: 'Before execution', after: 'After execution', return: 'Function returned', inferred: 'Inferred state'}[s.phase];
    $('position').textContent = `Step ${stepIndex + 1} of ${count}`;
    $('scrubber').max = String(count - 1); $('scrubber').value = String(stepIndex); $('scrubber').setAttribute('aria-valuetext', `${stepIndex + 1} of ${count}: ${s.title}`);
    $('previous').disabled = stepIndex === 0; $('next').disabled = stepIndex === count - 1;
    $('announcement').textContent = `Step ${stepIndex + 1}: ${s.title}. ${badge(s.evidence.kind)}.`;
    renderStory(); renderSource(); renderStack(); renderWatch(); renderChanges(); renderLanes(); renderTimeline(); renderFlow(); renderOutline(); renderProgress();
    if (shownState !== `${scenarioIndex}/${stepIndex}`) $('story').scrollTop = 0;
    shownState = `${scenarioIndex}/${stepIndex}`;
    animate();
    updateHash();
  }

  function inputView(input) {
    const rows = Array.isArray(input) && input.length && input.every(isRecord);
    if (!rows) return `<div class="tree">${tree(input, 'Input')}</div>`;
    const columns = [...new Set(input.flatMap(Object.keys))];
    return `<div class="table-scroll"><table><thead><tr>${columns.map(c => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${input.map(row => `<tr>${columns.map(c => `<td>${c in row ? isObject(row[c]) ? `<div class="tree">${tree(row[c], c, 1)}</div>` : esc(text(row[c])) : '<span class="muted">absent</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function renderProgress() {
    const done = allSteps.filter(id => visited.has(id)).length, pct = Math.round(done / allSteps.length * 100);
    $('progress').style.setProperty('--p', pct);
    $('progress').innerHTML = `<span>${pct}%</span>`;
    $('progress').setAttribute('aria-label', `${done} of ${allSteps.length} steps explored`);
    $('progress').title = `${done} of ${allSteps.length} steps explored across all scenarios`;
  }

  // ---- Theme, outline, views, navigation ----
  const isDark = () => (document.documentElement.dataset.theme || (prefersDark.matches ? 'dark' : 'light')) === 'dark';
  function syncTheme() { $('theme').textContent = isDark() ? '☀' : '☾'; $('theme').setAttribute('aria-label', `Switch to ${isDark() ? 'light' : 'dark'} theme`); $('theme').title = `Switch to ${isDark() ? 'light' : 'dark'} theme (T)`; }
  function toggleTheme() { document.documentElement.dataset.theme = isDark() ? 'light' : 'dark'; syncTheme(); }

  const outlineOpen = () => narrow.matches ? document.body.classList.contains('outline-open') : !document.body.classList.contains('outline-collapsed');
  function setOutline(open) {
    if (narrow.matches) { document.body.classList.toggle('outline-open', open); $('outline-scrim').hidden = !open; }
    else document.body.classList.toggle('outline-collapsed', !open);
    $('toggle-outline').setAttribute('aria-expanded', String(open));
  }
  narrow.addEventListener('change', () => { document.body.classList.remove('outline-open'); $('outline-scrim').hidden = true; $('toggle-outline').setAttribute('aria-expanded', String(outlineOpen())); });

  function updateHash() {
    const hash = view === 'walk' ? `#walk/${scenario().id}/${step().id}` : `#${view}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }

  function setView(next) {
    view = next;
    ['overview', 'walk', 'quiz'].forEach(v => { $(`view-${v}`).hidden = v !== next; $(`tab-${v}`).setAttribute('aria-selected', String(v === next)); $(`tab-${v}`).tabIndex = v === next ? 0 : -1; });
    document.body.dataset.section = next;
    renderProgress();
    if (next !== 'walk') { stop(); if (narrow.matches) setOutline(false); }
    if (next === 'quiz') returnQuestion = null;
    $('return-quiz').hidden = next !== 'walk' || returnQuestion === null;
    if (next === 'overview') renderOverview();
    if (next === 'walk') render();
    if (next === 'quiz') renderQuiz();
    if (next !== 'walk') { $(`view-${next}`).scrollTop = 0; window.scrollTo(0, 0); }
    updateHash();
  }

  function stop() { clearInterval(timer); timer = null; $('play').textContent = '▶ Play'; $('play').setAttribute('aria-label', 'Play walkthrough'); }
  function go(index) { stepIndex = Math.max(0, Math.min(index, scenario().steps.length - 1)); sourceIndex = 0; render(); if (stepIndex === scenario().steps.length - 1) stop(); }
  function choose(index, position = 0, show = true) {
    stop(); scenarioIndex = index; stepIndex = position; sourceIndex = 0;
    $('scenario').value = String(index); $('scenario-summary').innerHTML = rich(scenario().summary);
    $('input').innerHTML = inputView(scenario().input);
    $('input-box').open = position === 0;
    if (show) { if (view === 'walk') render(); else setView('walk'); }
  }

  // ---- Quiz ----
  const quiz = data.quiz;
  const Q = {started: false, done: false, ids: [], index: 0, responses: {}, results: {}, round: 0};
  const levelInfo = {recall: 'Remember what the code does', trace: 'Predict the values the run produced', reason: 'Explain why the code behaves this way', apply: 'Transfer the logic to a new input'};
  const typeLabel = {mcq: 'Multiple choice', fill: 'Fill in the blank', 'code-fill': 'Complete the code', order: 'Put in order'};
  const question = id => quiz.questions.find(q => q.id === id);
  const multi = q => Array.isArray(q.answer);
  function quizBest() { return store.get('quiz-best', null); }

  function shuffled(n, seed) {
    // Deterministic per round, never already in the correct order.
    const order = [...Array(n).keys()];
    let x = seed * 9301 + 49297;
    for (let i = n - 1; i > 0; i--) { x = (x * 9301 + 49297) % 233280; const j = Math.floor(x / 233280 * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    if (order.every((v, i) => v === i)) order.push(order.shift());
    return order;
  }

  function startQuiz(ids) {
    Q.round += 1;
    Object.assign(Q, {started: true, done: false, ids, index: 0, responses: {}, results: {}});
    ids.forEach((id, k) => { const q = question(id); if (q.type === 'order') Q.responses[id] = shuffled(q.items.length, Q.round * 31 + k); });
    renderQuiz();
  }

  const normalize = (value, code, caseSensitive) => {
    let t = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (code) t = t.replace(/\s+/g, '');
    else t = t.replace(/^(["'`])(.*)\1$/, '$2');
    return caseSensitive ? t : t.toLowerCase();
  };
  function blankCorrect(blank, given, code) {
    if (!String(given ?? '').trim()) return false;
    return blank.answers.some(answer => {
      const a = normalize(answer, code, blank.caseSensitive), b = normalize(given, code, blank.caseSensitive);
      return a === b || (!code && a !== '' && b !== '' && Number.isFinite(Number(a)) && Number(a) === Number(b));
    });
  }
  function grade(q, response) {
    if (q.type === 'mcq') return {correct: same([].concat(q.answer).sort(), [...(response || [])].sort())};
    if (q.type === 'order') { const positions = response.map((item, i) => item === i); return {correct: positions.every(Boolean), positions}; }
    const blanks = q.blanks.map((b, i) => blankCorrect(b, response?.[i], q.type === 'code-fill'));
    return {correct: blanks.every(Boolean), blanks};
  }
  const answered = (q, r) => q.type === 'order' || (q.type === 'mcq' ? r?.length > 0 : q.blanks.some((b, i) => String(r?.[i] ?? '').trim()));

  function snippet(source, q, locked) {
    return `<div class="q-code"><div class="q-code-head"><code>${esc(source.path)}:${source.start}–${source.end}</code></div><div class="code-lines">${source.lines.map(line => {
      const body = line.segments ? line.segments.map(seg => seg.html !== undefined ? seg.html : (() => {
        const b = q.blanks[seg.blank], value = Q.responses[q.id]?.[seg.blank] ?? '', result = Q.results[q.id];
        const width = Math.max(4, ...b.answers.map(a => a.length)) + 2;
        return `<input class="code-blank ${result ? result.blanks[seg.blank] ? 'right' : 'wrong' : ''}" data-blank="${seg.blank}" style="width:${width}ch" value="${esc(value)}" aria-label="Blank ${seg.blank + 1} on line ${line.number}" autocomplete="off" spellcheck="false" ${locked ? 'disabled' : ''}>`;
      })()).join('') : line.html || ' ';
      const focus = source.focus?.includes(line.number);
      return `<div class="code-line ${focus ? 'focus' : ''}"><span class="line-number">${line.number}</span><span class="line-code">${body}</span></div>`;
    }).join('')}</div></div>`;
  }

  function promptHtml(q, locked) {
    if (q.type !== 'fill') return `<h2 class="q-prompt">${rich(q.prompt, false)}</h2>`;
    const parts = q.prompt.split(/_{3,}/), result = Q.results[q.id];
    return `<h2 class="q-prompt">${parts.map((part, i) => {
      if (i === parts.length - 1) return rich(part, false);
      const value = Q.responses[q.id]?.[i] ?? '', width = Math.max(6, ...q.blanks[i].answers.map(a => a.length)) + 2;
      return `${rich(part, false)}<input class="blank ${result ? result.blanks[i] ? 'right' : 'wrong' : ''}" data-blank="${i}" style="width:${width}ch" value="${esc(value)}" aria-label="Blank ${i + 1}" autocomplete="off" spellcheck="false" ${locked ? 'disabled' : ''}>`;
    }).join('')}</h2>`;
  }

  function answerHtml(q, locked) {
    const result = Q.results[q.id], response = Q.responses[q.id];
    if (q.type === 'mcq') {
      const want = [].concat(q.answer);
      return `<div class="choices" role="${multi(q) ? 'group' : 'radiogroup'}" aria-label="Choices">${multi(q) ? '<p class="muted">Select all that apply.</p>' : ''}${q.choices.map((c, i) => {
        const picked = response?.includes(i), state = result ? want.includes(i) ? picked ? 'right' : 'missed' : picked ? 'wrong' : '' : '';
        return `<label class="choice ${picked ? 'picked' : ''} ${state}"><input type="${multi(q) ? 'checkbox' : 'radio'}" name="q-${esc(q.id)}" value="${i}" ${picked ? 'checked' : ''} ${locked ? 'disabled' : ''}><span class="choice-key">${String.fromCharCode(65 + i)}</span><span class="choice-text">${rich(c, false)}</span>${state === 'right' ? '<span class="choice-mark">✓</span>' : state === 'wrong' ? '<span class="choice-mark">✕</span>' : state === 'missed' ? '<span class="choice-mark">correct</span>' : ''}</label>`;
      }).join('')}</div>`;
    }
    if (q.type === 'order') {
      return `<p class="muted">Drag items, or use the arrow buttons, until they read top to bottom in order.</p><ol class="order-list">${response.map((item, pos) => {
        const state = result ? result.positions[pos] ? 'right' : 'wrong' : '';
        return `<li class="order-item ${state}" data-pos="${pos}" ${locked ? '' : 'draggable="true"'}><span class="grip" aria-hidden="true">⋮⋮</span><span class="order-pos">${pos + 1}</span><span class="order-text">${rich(q.items[item], false)}</span>${locked ? '' : `<span class="order-btns"><button type="button" class="icon-btn small" data-move="-1" aria-label="Move up" ${pos === 0 ? 'disabled' : ''}>↑</button><button type="button" class="icon-btn small" data-move="1" aria-label="Move down" ${pos === response.length - 1 ? 'disabled' : ''}>↓</button></span>`}</li>`;
      }).join('')}</ol>`;
    }
    if (q.type === 'code-fill') return snippet(q.source, q, locked);
    return '';
  }

  function feedbackHtml(q) {
    const result = Q.results[q.id];
    if (!result) return '';
    let reveal = '';
    if (!result.correct) {
      if (q.type === 'mcq') reveal = `<p><b>Correct answer${multi(q) ? 's' : ''}:</b> ${[].concat(q.answer).map(i => `${String.fromCharCode(65 + i)}. ${rich(q.choices[i], false)}`).join('; ')}</p>`;
      if (q.type === 'fill' || q.type === 'code-fill') reveal = `<ul class="reveal">${q.blanks.map((b, i) => `<li><b>Blank ${i + 1}:</b> <code>${esc(b.answers[0])}</code>${b.answers.length > 1 ? ` <span class="muted">(also accepted: ${b.answers.slice(1).map(a => `<code>${esc(a)}</code>`).join(', ')})</span>` : ''}</li>`).join('')}</ul>`;
      if (q.type === 'order') reveal = `<p><b>Correct order:</b></p><ol class="reveal">${q.items.map(t => `<li>${rich(t, false)}</li>`).join('')}</ol>`;
    }
    const verified = (q.blanks || []).filter(b => b.verified).map(b => `<code>${esc(b.verified)}</code>`);
    const refs = q.refs.map(r => {
      const si = data.scenarios.findIndex(s => s.id === r.scenario), i = data.scenarios[si].steps.findIndex(e => e.id === r.step);
      return `<button type="button" class="chip" data-review="${si}:${i}">${esc(data.scenarios[si].title)} · step ${i + 1}: ${esc(data.scenarios[si].steps[i].title)}</button>`;
    }).join('');
    return `<div class="feedback ${result.correct ? 'ok' : 'bad'}" role="status"><div class="fb-head"><span class="fb-icon" aria-hidden="true">${result.correct ? '✓' : '✕'}</span><b>${result.correct ? 'Correct' : 'Not quite'}</b></div>${reveal}<p>${rich(q.explanation, false)}</p>${verified.length ? `<p class="muted">Answer read from the captured checkpoint ${verified.join(', ')}.</p>` : ''}<div class="fb-refs"><span class="muted">Review in the walkthrough</span>${refs}</div></div>`;
  }

  function renderQuiz() {
    const root = $('view-quiz');
    renderBadge();
    if (!quiz) { root.innerHTML = '<div class="quiz-wrap"><section class="card quiz-intro"><h2>No quiz for this walkthrough</h2><p>The author did not include questions. Use the walkthrough to explore the run.</p></section></div>'; return; }
    if (!Q.started) {
      const types = Object.entries(quiz.questions.reduce((m, q) => ({...m, [q.type]: (m[q.type] || 0) + 1}), {}));
      const levels = Object.keys(levelInfo).filter(l => quiz.questions.some(q => q.level === l));
      const best = quizBest();
      root.innerHTML = `<div class="quiz-wrap"><section class="card quiz-intro"><p class="eyebrow">Final check</p><h2>${esc(quiz.title || 'Check your understanding')}</h2><p class="lead">${rich(quiz.intro || 'Answer each question, check it, and follow the links back to the steps that explain it.', false)}</p>
        <div class="quiz-facts"><span class="fact"><b>${quiz.questions.length}</b> questions</span>${types.map(([t, n]) => `<span class="fact"><b>${n}</b> ${typeLabel[t].toLowerCase()}</span>`).join('')}<span class="fact"><b>${Math.round((quiz.passScore ?? 0.7) * 100)}%</b> to pass</span>${best != null ? `<span class="fact best"><b>${best}%</b> your best</span>` : ''}</div>
        <div class="levels">${levels.map(l => `<div class="level-card"><span class="level level-${l}">${l}</span><p>${levelInfo[l]}</p><span class="muted">${quiz.questions.filter(q => q.level === l).length} questions</span></div>`).join('')}</div>
        <div class="quiz-actions"><button type="button" id="quiz-start">Start the quiz →</button><button type="button" class="secondary" data-view="walk">Back to the walkthrough</button></div></section></div>`;
      return;
    }
    if (Q.done) { renderResults(root); return; }
    const q = question(Q.ids[Q.index]), result = Q.results[q.id], locked = Boolean(result);
    const dots = Q.ids.map((id, i) => `<span class="qdot ${Q.results[id] ? Q.results[id].correct ? 'right' : 'wrong' : ''} ${i === Q.index ? 'current' : ''}" title="Question ${i + 1}"></span>`).join('');
    const correct = Object.values(Q.results).filter(r => r.correct).length;
    const hints = (q.blanks || []).map((b, i) => b.hint ? `<li><b>Blank ${i + 1}:</b> ${rich(b.hint, false)}</li>` : '').join('');
    const last = Q.index === Q.ids.length - 1;
    root.innerHTML = `<div class="quiz-wrap"><div class="quiz-top"><span>Question <b>${Q.index + 1}</b> of ${Q.ids.length}</span><div class="qdots" aria-hidden="true">${dots}</div><span>${correct} correct so far</span></div>
      <article class="card question" data-qid="${esc(q.id)}"><div class="q-meta"><span class="level level-${q.level}" title="${levelInfo[q.level]}">${q.level}</span><span class="q-type">${typeLabel[q.type]}</span>${q.chapter ? `<span class="q-chapter">${esc(q.chapter)}</span>` : ''}</div>
      ${promptHtml(q, locked)}${q.source && q.type !== 'code-fill' ? snippet(q.source, q, true) : ''}${answerHtml(q, locked)}
      ${hints && !locked ? `<details class="hints"><summary>Need a hint?</summary><ul>${hints}</ul></details>` : ''}
      <div class="quiz-actions">${locked ? `<button type="button" id="quiz-next">${last ? 'See your results' : 'Next question'} →</button>` : `<button type="button" id="quiz-check" ${answered(q, Q.responses[q.id]) ? '' : 'disabled'}>Check answer</button><button type="button" class="secondary" id="quiz-skip">Skip</button>`}</div>
      ${feedbackHtml(q)}</article></div>`;
    root.querySelector('.feedback')?.scrollIntoView({block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth'});
    if (!locked) root.querySelector('input:not([disabled])')?.focus({preventScroll: true});
  }

  function renderResults(root) {
    const results = Q.ids.map(id => ({q: question(id), r: Q.results[id]}));
    const correct = results.filter(x => x.r?.correct).length, pct = Math.round(correct / results.length * 100);
    const pass = pct >= Math.round((quiz.passScore ?? 0.7) * 100);
    const levels = Object.keys(levelInfo).map(l => { const items = results.filter(x => x.q.level === l); return items.length ? {l, n: items.length, ok: items.filter(x => x.r?.correct).length} : null; }).filter(Boolean);
    const missed = results.filter(x => !x.r?.correct);
    const ref = q => { const r = q.refs[0], si = data.scenarios.findIndex(s => s.id === r.scenario), i = data.scenarios[si].steps.findIndex(e => e.id === r.step); return `<button type="button" class="chip" data-review="${si}:${i}">Review step ${i + 1}</button>`; };
    root.innerHTML = `<div class="quiz-wrap"><section class="card results"><div class="results-head"><div class="score-ring ${pass ? 'pass' : ''}" style="--p:${pct}" role="img" aria-label="Score ${pct} percent"><span>${pct}%</span></div><div><p class="eyebrow">${pass ? 'Passed' : 'Keep going'}</p><h2>${correct} of ${results.length} correct</h2><p>${pass ? 'You can trace the values and explain the reasons behind them.' : 'Revisit the steps linked below, then retry the questions you missed.'}</p></div></div>
      <h3 class="section-title">By level</h3><div class="level-breakdown">${levels.map(x => `<div class="lb-row"><span class="level level-${x.l}">${x.l}</span><span class="meter"><span style="width:${x.ok / x.n * 100}%"></span></span><span class="lb-score">${x.ok}/${x.n}</span></div>`).join('')}</div>
      ${missed.length ? `<h3 class="section-title">Worth another look</h3><ul class="missed-list">${missed.map(x => `<li><span class="level level-${x.q.level}">${x.q.level}</span><span class="missed-q">${rich(x.q.prompt.replace(/_{3,}/g, '____'), false)}</span>${ref(x.q)}</li>`).join('')}</ul>` : ''}
      <div class="quiz-actions">${missed.length ? `<button type="button" id="quiz-retry-missed">Retry ${plural(missed.length, 'missed question')}</button>` : ''}<button type="button" class="secondary" id="quiz-retry">Retake the whole quiz</button><button type="button" class="secondary" data-view="walk">Back to the walkthrough</button></div></section></div>`;
    if (pass && !reduceMotion.matches) celebrate(root.querySelector('.score-ring'));
  }

  function celebrate(anchor) {
    const burst = document.createElement('div');
    burst.className = 'burst';
    burst.innerHTML = Array.from({length: 18}, (_, i) => `<span style="--a:${i * 20}deg;--d:${50 + (i % 3) * 18}px"></span>`).join('');
    anchor.appendChild(burst);
    setTimeout(() => burst.remove(), 1300);
  }

  function renderBadge() {
    const best = quizBest();
    $('quiz-badge').textContent = quiz ? best != null ? `${best}%` : String(quiz.questions.length) : '';
    $('quiz-badge').hidden = !quiz;
  }

  function finishQuestion() {
    if (Q.index < Q.ids.length - 1) { Q.index += 1; renderQuiz(); return; }
    Q.done = true;
    if (Q.ids.length === quiz.questions.length) {
      const pct = Math.round(Q.ids.filter(id => Q.results[id]?.correct).length / Q.ids.length * 100);
      if (pct > (quizBest() ?? -1)) store.set('quiz-best', pct);
    }
    renderQuiz();
  }

  function moveOrder(from, to) {
    const id = Q.ids[Q.index], list = Q.responses[id];
    if (to < 0 || to >= list.length || from === to) return;
    list.splice(to, 0, list.splice(from, 1)[0]);
    renderQuiz();
    $('view-quiz').querySelectorAll('.order-item')[to]?.querySelector(`[data-move="${from < to ? 1 : -1}"]:not([disabled])`)?.focus();
  }

  const quizRoot = $('view-quiz');
  quizRoot.addEventListener('input', e => {
    if (!Q.started || Q.done) return;
    const q = question(Q.ids[Q.index]), target = e.target;
    if (target.dataset.blank !== undefined) { (Q.responses[q.id] ||= [])[Number(target.dataset.blank)] = target.value; }
    if (target.name === `q-${q.id}`) {
      Q.responses[q.id] = [...quizRoot.querySelectorAll(`input[name="q-${CSS.escape(q.id)}"]:checked`)].map(i => Number(i.value));
      quizRoot.querySelectorAll('.choice').forEach(c => c.classList.toggle('picked', c.querySelector('input').checked));
    }
    const check = $('quiz-check');
    if (check) check.disabled = !answered(q, Q.responses[q.id]);
  });
  quizRoot.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    ($('quiz-check') && !$('quiz-check').disabled ? $('quiz-check') : $('quiz-next'))?.click();
  });
  quizRoot.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'quiz-start') startQuiz(quiz.questions.map(q => q.id));
    if (t.id === 'quiz-retry') startQuiz(quiz.questions.map(q => q.id));
    if (t.id === 'quiz-retry-missed') startQuiz(Q.ids.filter(id => !Q.results[id]?.correct));
    if (t.id === 'quiz-check') { const q = question(Q.ids[Q.index]); Q.results[q.id] = grade(q, Q.responses[q.id]); renderQuiz(); $('quiz-next')?.focus({preventScroll: true}); }
    if (t.id === 'quiz-skip') { const q = question(Q.ids[Q.index]); Q.results[q.id] = {...grade(q, q.type === 'order' ? Q.responses[q.id] : []), correct: false, skipped: true}; renderQuiz(); }
    if (t.id === 'quiz-next') finishQuestion();
    if (t.dataset.move) { const pos = Number(t.closest('.order-item').dataset.pos); moveOrder(pos, pos + Number(t.dataset.move)); }
  });
  let dragFrom = null;
  quizRoot.addEventListener('dragstart', e => { const item = e.target.closest?.('.order-item'); if (!item) return; dragFrom = Number(item.dataset.pos); item.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragFrom)); });
  quizRoot.addEventListener('dragover', e => { const item = e.target.closest?.('.order-item'); if (item && dragFrom !== null) { e.preventDefault(); quizRoot.querySelectorAll('.order-item').forEach(el => el.classList.toggle('drop-target', el === item)); } });
  quizRoot.addEventListener('drop', e => { const item = e.target.closest?.('.order-item'); if (item && dragFrom !== null) { e.preventDefault(); const to = Number(item.dataset.pos), from = dragFrom; dragFrom = null; moveOrder(from, to); } });
  quizRoot.addEventListener('dragend', () => { dragFrom = null; quizRoot.querySelectorAll('.order-item').forEach(el => el.classList.remove('dragging', 'drop-target')); });

  // ---- Line-note linking and concept popovers ----
  function linkNotes(index, on) { document.querySelectorAll(`[data-note="${index}"]`).forEach(el => el.classList.toggle('linked', on)); }
  function flash(el) { if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  function showNote(index, fromCode) {
    const s = step(), note = notesOf(s)[index];
    if (fromCode) { const item = $('line-notes').querySelector(`li[data-note="${index}"]`); item?.scrollIntoView({block: 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth'}); flash(item); return; }
    const file = s.sources.findIndex(src => src.path === note.file && src.start <= note.line && note.line <= src.end);
    if (file >= 0 && file !== sourceIndex) { sourceIndex = file; renderSource(); }
    const line = $('code').querySelector(`[data-line="${note.line}"]`);
    if (line) { $('code').scrollTop = Math.max(0, line.offsetTop - $('code').clientHeight / 2); if (narrow.matches) line.scrollIntoView({block: 'center'}); flash(line); }
  }
  function showTerm(el) {
    const c = concepts[Number(el.dataset.term)], pop = $('term-pop'), r = el.getBoundingClientRect();
    pop.innerHTML = `<b>${esc(c.term)}</b>${rich(c.definition, false)}`;
    pop.hidden = false;
    const width = Math.min(320, innerWidth - 24);
    pop.style.width = `${width}px`;
    pop.style.left = `${Math.max(12, Math.min(r.left, innerWidth - width - 12))}px`;
    pop.style.top = `${r.bottom + 8 + pop.offsetHeight > innerHeight ? r.top - pop.offsetHeight - 8 : r.bottom + 8}px`;
  }
  const hideTerm = () => { $('term-pop').hidden = true; };
  document.addEventListener('mouseover', e => { const n = e.target.closest('[data-note]'); if (n) linkNotes(n.dataset.note, true); const t = e.target.closest('.term'); if (t) showTerm(t); });
  document.addEventListener('mouseout', e => { const n = e.target.closest('[data-note]'); if (n) linkNotes(n.dataset.note, false); if (e.target.closest('.term')) hideTerm(); });
  document.addEventListener('focusin', e => { const t = e.target.closest?.('.term'); if (t) showTerm(t); });
  document.addEventListener('focusout', e => { if (e.target.closest?.('.term')) hideTerm(); });
  addEventListener('scroll', hideTerm, true);

  // ---- Wiring ----
  $('title').textContent = data.title; $('repo-label').textContent = data.repoLabel;
  $('scenario').innerHTML = data.scenarios.map((s, i) => `<option value="${i}">${String.fromCharCode(65 + i)}. ${esc(s.title)}</option>`).join('');
  $('scenario').addEventListener('change', e => choose(Number(e.target.value)));
  $('previous').addEventListener('click', () => { stop(); go(stepIndex - 1); });
  $('next').addEventListener('click', () => { stop(); go(stepIndex + 1); });
  $('scrubber').addEventListener('input', e => { stop(); go(Number(e.target.value)); });
  $('speed').addEventListener('change', stop);
  $('theme').addEventListener('click', toggleTheme);
  prefersDark.addEventListener('change', syncTheme);
  $('toggle-outline').addEventListener('click', () => setOutline(!outlineOpen()));
  $('outline-scrim').addEventListener('click', () => setOutline(false));
  $('return-quiz').addEventListener('click', () => setView('quiz'));
  $('play').addEventListener('click', () => {
    if (timer) { stop(); return; }
    if (stepIndex === scenario().steps.length - 1) go(0);
    $('play').textContent = '❚❚ Pause'; $('play').setAttribute('aria-label', 'Pause walkthrough');
    timer = setInterval(() => go(stepIndex + 1), Number($('speed').value));
  });
  document.addEventListener('click', e => {
    const t = e.target;
    const source = t.closest('[data-source]'), jump = t.closest('[data-step]'), viewBtn = t.closest('[data-view]'), start = t.closest('[data-start-scenario]'), review = t.closest('[data-review]'), note = t.closest('[data-note]'), term = t.closest('.term');
    if (!term) hideTerm(); else showTerm(term);
    if (source) { sourceIndex = Number(source.dataset.source); renderSource(); $('file-tabs').querySelector(`[data-source="${sourceIndex}"]`).focus(); }
    if (note) showNote(Number(note.dataset.note), Boolean(t.closest('#code')));
    if (start) { choose(Number(start.dataset.startScenario), Number(start.dataset.startStep || 0)); return; }
    if (review) { returnQuestion = Q.index; const [si, i] = review.dataset.review.split(':').map(Number); choose(si, i); $('return-quiz').textContent = `↩ Back to quiz · question ${returnQuestion + 1}`; $('return-quiz').hidden = false; return; }
    if (jump) { const fromOutline = Boolean(t.closest('#outline')); stop(); if (view !== 'walk') { stepIndex = Number(jump.dataset.step); setView('walk'); } else go(Number(jump.dataset.step)); if (narrow.matches && fromOutline) setOutline(false); return; }
    if (viewBtn) { setView(viewBtn.dataset.view); if (viewBtn.dataset.anchor === 'map') $('ov-map')?.scrollIntoView(); }
  });
  $('tab-overview').parentElement.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const order = ['overview', 'walk', 'quiz'], next = order[(order.indexOf(view) + (e.key === 'ArrowRight' ? 1 : 2)) % 3];
    setView(next); $(`tab-${next}`).focus();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { hideTerm(); if (document.body.classList.contains('outline-open')) setOutline(false); }
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.target.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('.views') && ['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const k = e.key.toLowerCase();
    if (k === 't') toggleTheme();
    if (['1', '2', '3'].includes(k)) setView(['overview', 'walk', 'quiz'][Number(k) - 1]);
    if (view !== 'walk') return;
    if (k === 'm') setView('overview');
    if (k === '[') setOutline(!outlineOpen());
    const onControl = ['BUTTON', 'SUMMARY', 'A'].includes(e.target.tagName);
    if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key) || (e.key === ' ' && !onControl)) {
      e.preventDefault();
      if (e.key === ' ') $('play').click();
      else { stop(); go(e.key === 'Home' ? 0 : e.key === 'End' ? scenario().steps.length - 1 : stepIndex + (e.key === 'ArrowRight' ? 1 : -1)); }
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  syncTheme();
  setOutline(!narrow.matches);

  // Deep links: #overview, #quiz, #walk/<scenario>/<step>, and the earlier #<scenario>/<step>.
  const parts = location.hash.slice(1).split('/');
  const walkLink = parts[0] === 'walk' ? parts.slice(1) : data.scenarios.some(s => s.id === parts[0]) ? parts : null;
  const initial = walkLink ? Math.max(0, data.scenarios.findIndex(s => s.id === walkLink[0])) : 0;
  const initialStep = walkLink ? Math.max(0, data.scenarios[initial].steps.findIndex(s => s.id === walkLink[1])) : 0;
  choose(initial, initialStep, false);
  setView(walkLink ? 'walk' : parts[0] === 'quiz' ? 'quiz' : 'overview');
})();
