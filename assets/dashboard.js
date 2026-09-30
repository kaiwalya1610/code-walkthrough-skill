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
  // Missing components yield undefined so a previous snapshot can be compared without it having the path.
  const ptr = (value, path) => path === '' ? value : path.slice(1).split('/').reduce((v, k) => v == null ? undefined : v[k.replace(/~1/g, '/').replace(/~0/g, '~')], value);
  // Entities match by id/name/label; anything else only by exact value, never by position, so a shift is not a change.
  const key = v => isRecord(v) ? v.id ?? v.name ?? v.label : undefined;
  const identity = v => key(v) != null ? `key:${key(v)}` : JSON.stringify(v);
  const describe = v => key(v) != null ? String(key(v)) : clip(v, 40);
  let scenarioIndex = 0, stepIndex = 0, sourceIndex = 0, timer = null;
  const scenario = () => data.scenarios[scenarioIndex];
  const step = () => scenario().steps[stepIndex];
  const previousState = () => stepIndex ? scenario().steps[stepIndex - 1].state : undefined;
  const labels = {observed:'Executed checkpoint', mocked:'Executed with mock', replayed:'Recorded-response replay', inferred:'Inferred • not executed'};
  const badge = kind => labels[kind];
  const prefersDark = matchMedia('(prefers-color-scheme: dark)');

  function tree(value, key = 'Value', depth = 0) {
    if (isObject(value)) {
      const entries = Object.entries(value);
      if (!entries.length) return `<div class="tree-leaf"><span class="tree-key">${esc(key)}</span>${Array.isArray(value) ? '[]' : '{}'}</div>`;
      return `<details ${depth < 1 ? 'open' : ''}><summary>${esc(key)} <span class="muted">(${entries.length} ${Array.isArray(value) ? 'items' : 'fields'})</span></summary><div class="tree-body">${entries.map(([k,v]) => tree(v,k,depth+1)).join('')}</div></details>`;
    }
    return `<div class="tree-leaf"><span class="tree-key">${esc(key)}</span>${esc(text(value))}</div>`;
  }

  function partition(items, render, limit, noun) {
    const first = render(items.slice(0,limit), 0);
    return items.length <= limit ? first : `${first}<details class="more"><summary>Show remaining ${items.length-limit} ${noun} (${items.length} total)</summary>${render(items.slice(limit), limit)}</details>`;
  }

  // Pair each current item with its predecessor by identity.
  function match(before, after) {
    if (!Array.isArray(before)) return {known:false, matched:[], gone:[]};
    const pool = new Map();
    before.forEach(v => { const k = identity(v); pool.set(k, [...(pool.get(k) || []), v]); });
    const matched = after.map(v => pool.get(identity(v))?.shift());
    return {known:true, matched, gone:[...pool.values()].flat()};
  }

  const pill = (kind, label) => `<span class="pill pill-${kind}">${label}</span>`;
  const gone = (m, noun) => m.gone.length ? `<p class="gone-note">Left ${noun} since the previous step: ${m.gone.map(v => `<s>${esc(describe(v))}</s>`).join('')}</p>` : '';
  function delta(before, after) {
    if (before === undefined || same(before, after)) return '';
    if (typeof before !== 'number' || typeof after !== 'number') return '<span class="delta-chip">changed</span>';
    const d = Number((after - before).toPrecision(12));
    return `<span class="delta-chip">${d > 0 ? '+' : '−'}${Math.abs(d)}</span>`;
  }

  function visual(view, state, prior) {
    const value = ptr(state,view.path), old = prior === undefined ? undefined : ptr(prior,view.path);
    const changed = prior !== undefined && !same(old, value);
    let content = '';
    if (view.type === 'text') content = `<div class="value-text ${changed ? 'is-changed' : ''}">${esc(text(value))}</div>`;
    if (view.type === 'tree') content = `<div class="tree">${tree(value,view.title)}</div>`;
    if (view.type === 'metrics') content = `<div class="metrics">${Object.entries(value).map(([label,v]) => {
      const d = isRecord(old) ? delta(old[label], v) : '';
      return `<div class="metric ${d ? 'is-changed' : ''}"><span class="metric-value">${esc(text(v))}${d}</span><span class="metric-label">${esc(label)}</span></div>`;
    }).join('')}</div>`;
    if (view.type === 'bars') {
      const scale = Math.max(...Object.values(value).map(Math.abs), 0) || 1;
      content = `<div class="bars" role="list">${Object.entries(value).map(([label,v]) => {
        const d = isRecord(old) ? delta(old[label], v) : '';
        return `<div class="bar-row ${d ? 'is-changed' : ''}" role="listitem"><span class="bar-label">${esc(label)}</span><span class="bar-track" aria-hidden="true"><span class="bar-fill ${v < 0 ? 'negative' : ''}" style="width:${Math.abs(v) / scale * 100}%"></span></span><span class="bar-value">${esc(text(v))}${d}</span></div>`;
      }).join('')}</div>`;
    }
    if (view.type === 'queue') {
      const m = match(old, value);
      const ghosts = m.gone.map(item => `<div class="queue-item is-gone"><span class="queue-index">Left the queue</span>${esc(describe(item))}</div>`);
      const items = value.map((item,i) => `<div class="queue-item ${m.known && m.matched[i] === undefined ? 'is-new' : ''}"><span class="queue-index">Position ${i+1}${m.known && m.matched[i] === undefined ? pill('new','new') : ''}</span>${isObject(item) ? tree(item, String(item.id ?? item.name ?? 'Item')) : esc(text(item))}</div>`);
      const lane = list => `<div class="queue">${list.join('<span class="queue-arrow" aria-hidden="true">→</span>')}</div>`;
      content = value.length ? lane([...ghosts, ...items]) : `<p class="empty">Queue is empty at this step.</p>${ghosts.length ? lane(ghosts) : ''}`;
    }
    if (view.type === 'records') {
      const m = match(old, value);
      content = partition(value, (rows, offset) => `<div class="records">${rows.map((row,j) => {
        const before = m.matched[offset + j], added = m.known && before === undefined;
        const fields = Object.entries(row).map(([k,v]) => `<dt>${esc(k)}</dt><dd class="${before && !same(before[k], v) ? 'is-changed' : ''}">${isObject(v) ? `<div class="tree">${tree(v,k,1)}</div>` : esc(text(v))}</dd>`).join('');
        const edited = before && !same(before, row);
        return `<article class="record ${added ? 'is-new' : ''}"><div class="record-header"><span>${esc(String(row.id ?? row.name ?? row.label ?? 'Record'))}</span>${added ? pill('new','new') : edited ? pill('changed','updated') : ''}</div><dl>${fields}</dl></article>`;
      }).join('')}</div>`,12,'records') + gone(m, 'this list');
    }
    if (view.type === 'table') {
      const m = match(old, value);
      content = partition(value, (rows, offset) => `<div class="table-scroll"><table><thead><tr>${view.columns.map(c => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((row,j) => {
        const before = m.matched[offset + j];
        return `<tr class="${m.known && before === undefined ? 'is-new' : ''}">${view.columns.map(c => `<td class="${before && !same(before[c], row[c]) ? 'is-changed' : ''}">${esc(text(row[c]))}</td>`).join('')}</tr>`;
      }).join('')}</tbody></table></div>`,50,'rows') + gone(m, 'this table');
    }
    if ((['records','table'].includes(view.type) && !value.length) || (['metrics','bars'].includes(view.type) && !Object.keys(value).length)) {
      content = '<p class="empty">No items at this step.</p>' + (Array.isArray(value) ? gone(match(old, value), 'this list') : '');
    }
    const count = Array.isArray(value) ? `<span class="count">${value.length}</span>` : '';
    return `<section class="visual" data-visual="${esc(view.type)}"><h3>${esc(view.title)}${count}</h3>${content}${view.caption ? `<p class="visual-caption">${esc(view.caption)}</p>` : ''}</section>`;
  }

  function differences(before, after, path = '') {
    if (same(before, after)) return [];
    if (isObject(before) && isObject(after) && Array.isArray(before) === Array.isArray(after)) {
      return [...new Set([...Object.keys(before),...Object.keys(after)])].flatMap(key => differences(before[key],after[key],`${path}/${key.replace(/~/g,'~0').replace(/\//g,'~1')}`));
    }
    return [{path:path || '/',before,after}];
  }

  function renderChanges() {
    if (stepIndex === 0) {
      $('changes').innerHTML = '<p class="muted">Starting snapshot. The example input stays above as you move through the run.</p>';
      return;
    }
    const changes = differences(previousState(),step().state);
    const render = rows => rows.map(c => `<div class="change"><span class="change-path">${esc(c.path)}</span><span class="change-before">${c.before === undefined ? 'Absent' : esc(text(c.before))}</span><span class="change-arrow" aria-label="becomes">→</span><span class="change-after">${c.after === undefined ? 'Removed' : esc(text(c.after))}</span></div>`).join('');
    $('changes').innerHTML = changes.length ? partition(changes,render,8,'changes') : '<p class="muted">Selected values are unchanged. This step explains control flow.</p>';
  }

  function renderSource() {
    const s = step(), source = s.sources[sourceIndex];
    const inline = (s.watch || []).filter(w => w.line && (w.file ?? s.sources[0].path) === source.path);
    $('file-tabs').innerHTML = s.sources.map((src,i) => `<button role="tab" aria-selected="${i===sourceIndex}" data-source="${i}">${esc(src.label || src.path.split('/').at(-1))}</button>`).join('');
    $('source-location').textContent = `${source.path}:${source.start}–${source.end}`;
    $('language').textContent = source.language === 'Text only' ? 'Plain text (language unsupported)' : source.language;
    $('code').innerHTML = `<div class="code-lines has-focus">${source.lines.map(line => {
      const focus = source.focus.includes(line.number);
      const values = inline.filter(w => w.line === line.number).map(w => `<span class="inline-value"><b>${esc(w.label)}</b>${esc(clip(ptr(s.state,w.path)))}</span>`).join('');
      return `<div class="code-line ${focus ? 'focus' : ''}" ${focus ? 'aria-current="true"' : ''}><span class="line-number">${line.number}</span><span class="line-code">${line.html || ' '}${values}</span></div>`;
    }).join('')}</div>`;
    const focused = $('code').querySelector('.focus');
    if (focused) $('code').scrollTop = Math.max(0, focused.offsetTop - $('code').querySelector('.code-lines').offsetTop - 60);
    $('evidence-summary').parentElement.className = `evidence ev ev-${s.evidence.kind}`;
    $('evidence-summary').textContent = badge(s.evidence.kind);
    $('evidence-body').innerHTML = `<p>${esc(s.evidence.detail)}</p><p>Source SHA-256: <code>${esc(source.sha256)}</code></p>${s.evidence.record ? `<p>Checkpoint: <code>${esc(s.evidence.record.path)} · ${esc(s.evidence.record.id)}</code></p>` : '<p>These values are a narrated simulation derived from source inspection.</p>'}<p>Highlighting marks the source discussed by this snapshot; it does not assert that every displayed line executed.</p>`;
  }

  function renderTimeline() {
    const steps = scenario().steps, segments = [];
    steps.forEach((s,i) => { if (segments.at(-1)?.chapter === s.chapter) segments.at(-1).items.push(i); else segments.push({chapter:s.chapter, items:[i]}); });
    $('timeline').innerHTML = segments.map(seg => `<div class="chapter-seg ${seg.items.includes(stepIndex) ? 'current' : ''}" style="--n:${seg.items.length}"><span class="chapter-name" title="${esc(seg.chapter)}">${esc(seg.chapter)}</span><div class="ticks">${seg.items.map(i => {
      const kind = steps[i].evidence.kind;
      return `<button class="tick ev ev-${kind} ${i<stepIndex ? 'done' : i===stepIndex ? 'current' : ''}" data-step="${i}" tabindex="-1" title="${i+1}. ${esc(steps[i].title)} · ${badge(kind)}" aria-label="Step ${i+1}: ${esc(steps[i].title)}"></button>`;
    }).join('')}</div></div>`).join('');
  }

  function renderLanes() {
    const steps = scenario().steps, lanes = [...new Set(steps.map(s=>s.lane))];
    const gutter = 14, dx = 26, dy = 36, top = 18, at = Object.fromEntries(steps.map((s,i) => [s.id,i]));
    const pos = i => [gutter + i*dx, top + lanes.indexOf(steps[i].lane)*dy];
    const width = gutter + steps.length*dx, height = top + lanes.length*dy;
    const tracks = lanes.map((lane,r) => `<line class="lane-track" x1="0" x2="${width}" y1="${top+r*dy}" y2="${top+r*dy}"/>`).join('');
    const links = steps.flatMap((s,i) => s.causes.map(c => { const [x1,y1] = pos(at[c]), [x2,y2] = pos(i), mx = (x1+x2)/2; return `<path class="lane-link ${i===stepIndex ? 'active' : ''}" d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}"/>`; })).join('');
    const dots = steps.map((s,i) => { const [x,y] = pos(i); return `<g class="lane-dot ev ev-${s.evidence.kind} ${i<stepIndex ? 'done' : i===stepIndex ? 'current' : ''}" data-step="${i}"><title>${i+1}. ${esc(s.title)} · ${esc(badge(s.evidence.kind))}</title><circle cx="${x}" cy="${y}" r="7"/><text x="${x}" y="${y+19}" text-anchor="middle">${i+1}</text></g>`; }).join('');
    $('lane-chart').innerHTML = `<div class="lane-names" aria-hidden="true">${lanes.map(l => `<span title="${esc(l)}">${esc(l)}</span>`).join('')}</div><div class="lane-scroll"><svg width="${width+10}" height="${height}" role="img" aria-label="Swimlane chart of ${steps.length} steps across ${lanes.length} lanes; the step list below is equivalent">${tracks}${links}${dots}</svg></div>`;
    const chart = $('lane-chart').querySelector('.lane-scroll');
    chart.scrollLeft = pos(stepIndex)[0] - chart.clientWidth / 2;
    $('lanes').innerHTML = lanes.map(lane => `<div class="lane-row"><strong>${esc(lane)}</strong><div class="lane-events">${steps.map((s,i) => s.lane===lane ? `<button class="lane-event ${i<stepIndex?'done':i===stepIndex?'current':''}" data-step="${i}" title="${esc(s.title)}" aria-label="Step ${i+1}: ${esc(s.title)}" ${i===stepIndex?'aria-current="step"':''}>${i+1}${s.attempt?` · try ${s.attempt}`:''}${s.iteration?` · loop ${s.iteration}`:''}</button>` : '').join('')}</div></div>`).join('');
  }

  // One SVG serves the minimap and the overview. Highlights follow walkthrough order up to this step.
  function graphSvg(mini) {
    const nodes = data.graph.nodes, edges = data.graph.edges, steps = scenario().steps, current = step();
    const map = Object.fromEntries(nodes.map(n => [n.id,n]));
    const visits = {}, totals = {}, walked = new Set();
    steps.forEach((s,i) => { totals[s.node] = (totals[s.node] || 0) + 1; if (i <= stepIndex) visits[s.node] = (visits[s.node] || 0) + 1; if (i && i <= stepIndex) walked.add(`${steps[i-1].node}>${s.node}`); });
    const latest = stepIndex ? `${steps[stepIndex-1].node}>${current.node}` : '';
    const target = id => { const next = steps.findIndex((s,i) => i > stepIndex && s.node === id); return next >= 0 ? next : steps.findIndex(s => s.node === id); };
    const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
    const x0 = Math.min(...xs) - 20, y0 = Math.min(...ys) - 20, w = Math.max(...xs) - x0 + 225, h = Math.max(...ys) - y0 + 90;
    const marker = `arrow-${mini ? 'mini' : 'full'}`;
    const paths = edges.map(e => {
      const a = map[e.from], b = map[e.to], key = `${e.from}>${e.to}`, self = e.from === e.to;
      let d, lx, ly;
      if (self) [d, lx, ly] = [`M ${a.x+155} ${a.y+15} C ${a.x+195} ${a.y-30},${a.x+195} ${a.y+75},${a.x+155} ${a.y+38}`, a.x+200, a.y+26];
      else if (Math.abs(a.y - b.y) < 50) {
        // Same row: connect facing sides so the curve does not cross either box.
        const ax = b.x >= a.x ? a.x+160 : a.x, bx = b.x >= a.x ? b.x : b.x+160, ay = a.y+25, by = b.y+25, mx = (ax+bx)/2;
        [d, lx, ly] = [`M ${ax} ${ay} C ${mx} ${ay},${mx} ${by},${bx} ${by}`, mx, (ay+by)/2 - 7];
      } else {
        const down = b.y > a.y, ax = a.x+80, ay = down ? a.y+50 : a.y, bx = b.x+80, by = down ? b.y : b.y+50, my = (ay+by)/2;
        [d, lx, ly] = [`M ${ax} ${ay} C ${ax} ${my},${bx} ${my},${bx} ${by}`, (ax+bx)/2, my - 5];
      }
      return `<path class="graph-edge ${key===latest ? 'latest' : walked.has(key) ? 'walked' : ''}" d="${d}" marker-end="url(#${marker})"><title>${esc(e.label)}</title></path><text class="graph-label" x="${lx}" y="${ly}" text-anchor="${self ? 'start' : 'middle'}">${esc(e.label)}</text>`;
    }).join('');
    const boxes = nodes.map(n => {
      const jump = target(n.id), active = n.id === current.node;
      const classes = ['graph-node', active && 'active', active && `ev-${current.evidence.kind}`, visits[n.id] && 'visited', !totals[n.id] && 'unused'].filter(Boolean).join(' ');
      const note = totals[n.id] ? `${visits[n.id] || 0} of ${totals[n.id]} visits so far` : 'not visited in this scenario';
      return `<g class="${classes}" transform="translate(${n.x},${n.y})" ${jump >= 0 ? `data-step="${jump}"` : ''}><title>${esc(n.label)}: ${esc(n.description)} (${note})</title><rect width="160" height="50" rx="8"/><text x="80" y="${mini ? 31 : 24}" text-anchor="middle">${esc(mini && n.label.length > 15 ? `${n.label.slice(0,14)}…` : n.label)}</text>${mini ? '' : `<text class="visits" x="80" y="40" text-anchor="middle">${note}</text>`}</g>`;
    }).join('');
    const size = mini ? `width="100%" preserveAspectRatio="xMidYMid meet"` : `width="${w}" height="${h}"`;
    return `<svg ${size} viewBox="${x0} ${y0} ${w} ${h}" role="img" aria-label="Codebase flow; the current step is at ${esc(map[current.node].label)}"><defs><marker id="${marker}" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path class="graph-arrow" d="M0,0 L0,6 L6,3 z"/></marker></defs>${paths}${boxes}</svg>`;
  }

  function renderMinimap() {
    const s = step(), node = data.graph.nodes.find(n => n.id === s.node), steps = scenario().steps;
    const visit = steps.slice(0, stepIndex + 1).filter(e => e.node === s.node).length, total = steps.filter(e => e.node === s.node).length;
    $('minimap-head').innerHTML = `<span class="minimap-head"><strong>Where: ${esc(node.label)}</strong><span>visit ${visit} of ${total} · ${esc(node.description)}</span></span>`;
    $('minimap').innerHTML = `${graphSvg(true)}<p class="minimap-note">Path shows walkthrough order so far, not proof that every edge executed. Select a box to jump to its next step.</p>`;
  }

  function graph() {
    const map = Object.fromEntries(data.graph.nodes.map(n => [n.id,n]));
    return `<div class="graph-scroll">${graphSvg(false)}</div><details><summary>Read nodes &amp; relationships</summary><ul>${data.graph.nodes.map(n=>`<li><b>${esc(n.label)}:</b> ${esc(n.description)}</li>`).join('')}${data.graph.edges.map(e=>`<li>${esc(map[e.from].label)} → ${esc(map[e.to].label)}: ${esc(e.label)}</li>`).join('')}</ul></details>`;
  }

  function renderOverview() {
    const analysis=data.analysis, build=data.build, total=analysis.coverage.length;
    const bar = ['read','skimmed','unread','excluded'].map(k => build.coverageCounts[k] ? `<span class="cov-${k}" style="width:${build.coverageCounts[k]/total*100}%" title="${build.coverageCounts[k]} ${k}"></span>` : '').join('');
    $('overview-body').innerHTML = `<p>${esc(data.summary)}</p><h3>Walkthrough scope</h3><p>${esc(data.scope)}</p><p class="muted">Scenario shown: ${esc(scenario().title)}, step ${stepIndex+1}. Select a box to jump to it.</p>${graph()}<h3>Entry points</h3><ul>${analysis.entrypoints.map(v=>`<li><code>${esc(v)}</code></li>`).join('')}</ul><h3>What the code establishes</h3><ul>${analysis.findings.map(v=>`<li>${esc(v)}</li>`).join('')}</ul><h3>Coverage &amp; limits</h3><p>${analysis.inventoryCount} paths inventoried. ${total} coverage entries recorded. Directory entries can summarize a subsystem; an inventory is not proof of reading.</p><div class="coverage-bar" aria-hidden="true">${bar}</div><div class="coverage-counts">${Object.entries(build.coverageCounts).map(([k,v])=>`<span><b>${v}</b> ${esc(k)}</span>`).join('')}</div><div class="coverage-table"><table><thead><tr><th>Path</th><th>Review</th><th>Reason</th></tr></thead><tbody>${analysis.coverage.map(c=>`<tr><td>${esc(c.path)}</td><td>${esc(c.status)}</td><td>${esc(c.reason)}</td></tr>`).join('')}</tbody></table></div><ul>${analysis.limitations.map(v=>`<li>${esc(v)}</li>`).join('')}</ul><p class="build-info muted">Built ${esc(build.created)}. Commit ${esc(build.commit)}. Working tree: ${esc(build.workingTree)}. ${build.sourceCount} source files checked; ${build.checkpointFiles} checkpoint files loaded. Values and code are frozen into this offline page.</p>`;
  }

  function render() {
    const s=step(), count=scenario().steps.length, prior=previousState(), kind=s.evidence.kind;
    const chapters=[...new Set(scenario().steps.map(e=>e.chapter))];
    $('phase').textContent={before:'Before execution',after:'After execution',return:'Function returned',inferred:'Inferred state'}[s.phase];
    $('lane').textContent=s.lane;
    $('evidence-badge').className=`badge ev ev-${kind}`;$('evidence-badge').textContent=badge(kind);
    $('chapter').innerHTML=`<span>${esc(s.chapter)}</span><span class="crumb-sep">·</span><span class="muted">chapter ${chapters.indexOf(s.chapter)+1} of ${chapters.length}</span>${s.iteration?`<span class="tag">iteration ${s.iteration}</span>`:''}${s.attempt?`<span class="tag">attempt ${s.attempt}</span>`:''}`;
    $('step-title').textContent=s.title;
    $('explanation').textContent=s.explanation;
    $('watch').innerHTML=(s.watch||[]).map(w=>`<div class="watch-row ${prior!==undefined && !same(ptr(prior,w.path),ptr(s.state,w.path)) ? 'changed' : ''}"><strong>${esc(w.label)}</strong><span>${esc(text(ptr(s.state,w.path)))}</span></div>`).join('');
    $('watch').hidden=!s.watch?.length;
    $('visuals').innerHTML=s.visuals.map(v=>visual(v,s.state,prior)).join('');
    const result=ptr(s.state,s.decision?.resultPath ?? '');
    $('decision').innerHTML=s.decision?`<section class="decision"><div class="decision-question"><span class="decision-icon" aria-hidden="true"><span>?</span></span>${esc(s.decision.condition)}<b class="decision-result ${result?'true':'false'}">${result?'True':'False'}</b></div><div class="decision-paths"><div class="taken"><b>✓ Taken</b>${esc(s.decision.taken)}</div><div class="not-taken"><b>✕ Not taken in this run</b>${esc(s.decision.notTaken)}</div></div></section>`:'';
    $('causes').innerHTML=s.causes.length?`<p class="causes">Depends on ${s.causes.map(id=>{const i=scenario().steps.findIndex(e=>e.id===id);return `<button class="secondary" data-step="${i}">${i+1}. ${esc(scenario().steps[i].title)}</button>`;}).join('')}</p>`:'';
    $('position').textContent=`Step ${stepIndex+1} of ${count}`;
    $('scrubber').max=String(count-1);$('scrubber').value=String(stepIndex);$('scrubber').setAttribute('aria-valuetext',`${stepIndex+1} of ${count}: ${s.title}`);
    $('jump').value=String(stepIndex);
    $('previous').disabled=stepIndex===0;$('next').disabled=stepIndex===count-1;
    $('outcome').hidden=stepIndex!==count-1;$('outcome').innerHTML=`<h3>Result of this scenario</h3><p>${esc(scenario().outcome)}</p>`;
    $('announcement').textContent=`Step ${stepIndex+1}: ${s.title}. ${badge(kind)}.`;
    renderSource();renderChanges();renderLanes();renderTimeline();renderMinimap();
    history.replaceState(null,'',`#${scenario().id}/${s.id}`);
  }

  function inputView(input) {
    const rows = Array.isArray(input) && input.length && input.every(isRecord);
    if (!rows) return `<div class="tree">${tree(input,'Input')}</div>`;
    const columns = [...new Set(input.flatMap(Object.keys))];
    return `<div class="table-scroll"><table><thead><tr>${columns.map(c=>`<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${input.map(row=>`<tr>${columns.map(c=>`<td>${c in row ? isObject(row[c]) ? `<div class="tree">${tree(row[c],c,1)}</div>` : esc(text(row[c])) : '<span class="muted">absent</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function stats() {
    const steps=scenario().steps, kinds={};
    steps.forEach(s=>{kinds[s.evidence.kind]=(kinds[s.evidence.kind]||0)+1;});
    const chip=(n,label)=>`<span class="stat"><b>${n}</b> ${label}</span>`;
    return chip(steps.length,'steps')+chip(new Set(steps.map(s=>s.chapter)).size,'chapters')+chip(new Set(steps.map(s=>s.lane)).size,'lanes')+Object.entries(kinds).map(([k,n])=>`<span class="stat ev ev-${k}"><b>${n}</b> ${k}</span>`).join('');
  }

  const isDark = () => (document.documentElement.dataset.theme || (prefersDark.matches ? 'dark' : 'light')) === 'dark';
  function syncTheme() { $('theme').textContent = isDark() ? '☀ Light' : '☾ Dark'; $('theme').setAttribute('aria-label', `Switch to ${isDark() ? 'light' : 'dark'} theme`); }
  function toggleTheme() { document.documentElement.dataset.theme = isDark() ? 'light' : 'dark'; syncTheme(); }

  function stop() { clearInterval(timer);timer=null;$('play').textContent='Play';$('play').setAttribute('aria-label','Play walkthrough'); }
  function go(index) {stepIndex=Math.max(0,Math.min(index,scenario().steps.length-1));sourceIndex=0;render();if(stepIndex===scenario().steps.length-1)stop();}
  function choose(index, position=0) {
    stop();scenarioIndex=index;stepIndex=position;sourceIndex=0;
    $('scenario').value=String(index);$('scenario-summary').textContent=scenario().summary;$('scenario-stats').innerHTML=stats();
    $('input').innerHTML=`<details open><summary>Synthetic input · ${esc(scenario().title)}${Array.isArray(scenario().input)?` · ${scenario().input.length} items`:''}</summary><div class="input-value">${inputView(scenario().input)}</div></details>`;
    $('jump').innerHTML=scenario().steps.map((s,i)=>`<option value="${i}">${i+1}. ${esc(s.chapter)} · ${esc(s.title)}</option>`).join('');
    $('lane-details').open=new Set(scenario().steps.map(s=>s.lane)).size>1;
    render();
  }
  $('title').textContent=data.title;$('repo-label').textContent=data.repoLabel;
  $('scenario').innerHTML=data.scenarios.map((s,i)=>`<option value="${i}">${esc(s.title)}</option>`).join('');
  $('scenario').addEventListener('change',e=>choose(Number(e.target.value)));
  $('previous').addEventListener('click',()=>{stop();go(stepIndex-1);});
  $('next').addEventListener('click',()=>{stop();go(stepIndex+1);});
  $('scrubber').addEventListener('input',e=>{stop();go(Number(e.target.value));});
  $('jump').addEventListener('change',e=>{stop();go(Number(e.target.value));});
  $('speed').addEventListener('change',stop);
  $('theme').addEventListener('click',toggleTheme);
  prefersDark.addEventListener('change',syncTheme);
  $('play').addEventListener('click',()=>{if(timer){stop();return;}if(stepIndex===scenario().steps.length-1)go(0);$('play').textContent='Pause';$('play').setAttribute('aria-label','Pause walkthrough');timer=setInterval(()=>go(stepIndex+1),Number($('speed').value));});
  document.addEventListener('click',e=>{const source=e.target.closest('[data-source]'),jump=e.target.closest('[data-step]');if(source){sourceIndex=Number(source.dataset.source);renderSource();$('file-tabs').querySelector(`[data-source="${sourceIndex}"]`).focus();}if(jump){if($('overview').open)$('overview').close();stop();go(Number(jump.dataset.step));}});
  $('open-overview').addEventListener('click',()=>{stop();renderOverview();$('overview').showModal();});
  $('close-overview').addEventListener('click',()=>$('overview').close());
  document.addEventListener('keydown',e=>{if($('overview').open||/INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY/.test(e.target.tagName)||e.target.isContentEditable||e.metaKey||e.ctrlKey||e.altKey)return;const key=e.key.toLowerCase();if(key==='t')toggleTheme();if(key==='m')$('open-overview').click();if(['ArrowRight','ArrowLeft','Home','End',' '].includes(e.key)){e.preventDefault();if(e.key===' ')$('play').click();else {stop();go(e.key==='Home'?0:e.key==='End'?scenario().steps.length-1:stepIndex+(e.key==='ArrowRight'?1:-1));}}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  syncTheme();
  const [scenarioId,stepId]=location.hash.slice(1).split('/');
  const initial=data.scenarios.findIndex(s=>s.id===scenarioId);
  choose(initial<0?0:initial, initial<0?0:Math.max(0,data.scenarios[initial].steps.findIndex(s=>s.id===stepId)));
})();
