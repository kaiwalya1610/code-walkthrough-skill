// Optional browser regression runner. Requires Playwright and its Chromium browser.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const file = resolve(process.argv[2]);
const html = readFileSync(file, 'utf8');
const payloadMatch = html.match(/(<script type="application\/json" id="walkthrough-data">)([\s\S]*?)(<\/script>)/);
assert.ok(payloadMatch, 'Walkthrough JSON payload must exist');
const data = JSON.parse(payloadMatch[2]);
const shot = name => join(dirname(file), name);
const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  await page.clock.install();
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.goto(pathToFileURL(file).href);
  const position = () => page.locator('#position').innerText();
  // Bar widths animate from the previous value; compare the rendered snapshot, not the animation frame.
  const snapshot = async () => (await page.locator('#visuals').innerHTML()).replace(/ style="width:[^"]*"/g, '');

  // Landing page orients first, then starts the walkthrough.
  assert.equal(await page.locator('#view-overview').isVisible(), true, 'Overview is the landing view');
  assert.equal(await page.locator('.scenario-card').count(), data.scenarios.length);
  await page.screenshot({path: shot('overview.png'), animations: 'disabled'});
  await page.locator('.ov-cta button').first().click();
  assert.equal(await page.locator('#view-walk').isVisible(), true);

  let count = 0;
  for (let scenario = 0; scenario < data.scenarios.length; scenario++) {
    await page.selectOption('#scenario', String(scenario));
    const steps = data.scenarios[scenario].steps;
    for (let i = 0; i < steps.length; i++) {
      await page.locator('#outline .ol-step').nth(i).click();
      assert.equal(await position(), `Step ${i + 1} of ${steps.length}`);
      assert.equal(await page.locator('#outline .ol-step[aria-current=step]').count(), 1);
      assert.ok(await page.locator('.code-line.focus').count(), 'Focused source lines');
      assert.ok(await page.locator('#visuals .visual').count(), 'State visuals');
      const notes = steps[i].lineNotes?.length || 0;
      assert.equal(await page.locator('#line-notes li').count(), notes, 'Every line note is listed');
      if (notes) {
        await page.locator('#line-notes li').first().hover();
        assert.ok(await page.locator('.note-marker.linked').count() + (steps[i].lineNotes[0].file ? 1 : 0) >= 1, 'Line note links to its marker');
      }
      if (steps[i].decision) assert.equal(await page.locator('.decision').count(), 1);
      if (await page.locator('#file-tabs button').count() > 1) {
        await page.locator('#file-tabs button').nth(1).click();
        assert.equal(await page.locator('#file-tabs button').nth(1).getAttribute('aria-selected'), 'true');
        await page.locator('#file-tabs button').first().click();
      }
      const before = await snapshot();
      if (i < steps.length - 1) {
        await page.click('#next');
        await page.click('#previous');
        assert.equal(await snapshot(), before, 'Reverse must restore exact snapshot');
      }
      count++;
    }
    assert.equal(await page.locator('#outcome').isVisible(), true, 'Final step shows the outcome');
    await page.locator('#story').click({position: {x: 4, y: 4}});
    await page.keyboard.press('Home');
    assert.equal(await position(), `Step 1 of ${steps.length}`);
    if (steps.length > 1) {
      await page.keyboard.press('ArrowRight');
      assert.equal(await position(), `Step 2 of ${steps.length}`);
    }
  }

  // Seeking from the timeline and the flow strip.
  await page.selectOption('#scenario', '0');
  const steps = data.scenarios[0].steps.length;
  await page.locator('#timeline .tick').last().click();
  assert.equal(await position(), `Step ${steps} of ${steps}`, 'Timeline tick must seek');
  await page.locator('#flow .flow-node').first().click();
  assert.equal(await position(), `Step 1 of ${steps}`, 'Flow node must jump to its step');

  // Concept popovers.
  if (await page.locator('#story .term').count()) {
    await page.locator('#story .term').first().hover();
    assert.equal(await page.locator('#term-pop').isVisible(), true, 'Concept definition appears');
    await page.mouse.move(2, 2);
  }

  // Theme.
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lightBackground = await background();
  await page.click('#theme');
  assert.notEqual(await background(), lightBackground, 'Theme toggle must change palette');
  await page.screenshot({path: shot('desktop-dark.png'), animations: 'disabled'});
  await page.click('#theme');
  assert.equal(await background(), lightBackground);

  // Playback.
  if (steps > 1) {
    await page.click('#play');
    assert.match(await page.locator('#play').innerText(), /Pause/);
    await page.clock.runFor(6001);
    assert.equal(await page.locator('#scrubber').inputValue(), '1');
    await page.locator('#story').click({position: {x: 4, y: 4}});
    if (steps > 2) {
      await page.keyboard.press('Space');
      assert.match(await page.locator('#play').innerText(), /Play/, 'Space must pause active playback');
      await page.clock.runFor(6001);
      assert.equal(await page.locator('#scrubber').inputValue(), '1');
    }
  }

  // Deep link survives reload; section keys switch views.
  const savedHash = new URL(page.url()).hash;
  assert.match(savedHash, /^#walk\//);
  await page.reload();
  assert.equal(new URL(page.url()).hash, savedHash, 'Reload must preserve deep link');
  assert.equal(await page.locator('#view-walk').isVisible(), true);
  await page.screenshot({path: shot('desktop.png'), animations: 'disabled'});
  await page.locator('#story').click({position: {x: 4, y: 4}});
  await page.keyboard.press('1');
  assert.equal(await page.locator('#view-overview').isVisible(), true);
  await page.locator('#view-overview .graph-node[data-step]').first().click();
  assert.equal(await page.locator('#view-walk').isVisible(), true, 'Map node opens the walkthrough');

  // Quiz: answer every question from the payload, missing exactly one, then review and retry it.
  if (data.quiz) {
    await page.click('#tab-quiz');
    await page.click('#quiz-start');
    const wrong = data.quiz.questions.at(-1).id;
    for (const q of data.quiz.questions) {
      const miss = q.id === wrong;
      if (q.type === 'mcq') {
        const want = [].concat(q.answer), picks = miss ? [want.includes(0) ? 1 : 0] : want;
        for (const a of picks) await page.locator('.choice').nth(a).click();
      }
      if (q.type === 'fill') for (let i = 0; i < q.blanks.length; i++) await page.locator('.blank').nth(i).fill(miss ? 'zzz' : q.blanks[i].answers[0]);
      if (q.type === 'code-fill') for (let i = 0; i < q.blanks.length; i++) await page.locator('.code-blank').nth(i).fill(miss ? 'zzz' : q.blanks[i].answers[0]);
      if (q.type === 'order' && !miss) {
        // Responses render as the authored items; move each into place with the accessible buttons.
        for (let target = 0; target < q.items.length; target++) {
          const order = await page.evaluate(() => [...document.querySelectorAll('.order-text')].map(e => e.innerText.replace(/\s+/g, ' ').trim()));
          const at = order.findIndex(t => t === q.items[target].replace(/`/g, '').replace(/\s+/g, ' ').trim());
          for (let k = at; k > target; k--) await page.locator('.order-item').nth(k).locator('[data-move="-1"]').click();
        }
      }
      await page.click('#quiz-check');
      await page.locator('.feedback').waitFor();
      assert.equal(await page.locator('.feedback.ok').count(), miss ? 0 : 1, `Question ${q.id} graded ${miss ? 'wrong' : 'right'}`);
      if (q.type === 'order') await page.screenshot({path: shot('quiz-question.png'), fullPage: true, animations: 'disabled'});
      await page.click('#quiz-next');
    }
    const total = data.quiz.questions.length;
    assert.match(await page.locator('.results h2').innerText(), new RegExp(`${total - 1} of ${total} correct`));
    await page.screenshot({path: shot('quiz-results.png'), fullPage: true, animations: 'disabled'});
    await page.locator('.missed-list [data-review]').first().click();
    assert.equal(await page.locator('#view-walk').isVisible(), true, 'Review link opens the referenced step');
    assert.equal(await page.locator('#return-quiz').isVisible(), true);
    await page.click('#return-quiz');
    assert.equal(await page.locator('.results').isVisible(), true, 'Returning keeps quiz results');
    await page.click('#quiz-retry-missed');
    assert.equal(await page.locator('.quiz-top').innerText().then(t => /of 1\b/.test(t)), true, 'Retry missed asks only missed questions');
  }

  // Mobile: no horizontal overflow in any section; outline is a drawer.
  await page.setViewportSize({width: 390, height: 844});
  for (const tab of ['#tab-overview', '#tab-quiz', '#tab-walk']) {
    await page.click(tab);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Mobile must not overflow horizontally (${tab})`);
  }
  assert.equal(await page.locator('#outline').isVisible(), false, 'Outline is hidden on phones until opened');
  await page.click('#toggle-outline');
  await page.locator('#outline .ol-step').nth(1).click();
  assert.equal(await position(), `Step 2 of ${data.scenarios[0].steps.length}`);
  await page.locator('#changes-box > summary').click();
  if (await page.locator('#changes .change').count()) {
    const before = await page.locator('#changes .change').first().locator('.change-before').boundingBox();
    const after = await page.locator('#changes .change').first().locator('.change-after').boundingBox();
    assert.ok(after.y >= before.y + before.height, 'Mobile before/after values must stack legibly');
  }
  await page.screenshot({path: shot('mobile.png'), fullPage: true, animations: 'disabled'});

  // A value present only in a later snapshot renders without a previous counterpart.
  if (data.scenarios[0].steps.length > 1) {
    const payload = structuredClone(data);
    payload.scenarios[0].steps[1].state.nestedOnly = {score: 7};
    payload.scenarios[0].steps[1].visuals.push({type: 'text', title: 'New nested value', path: '/nestedOnly/score'});
    (payload.scenarios[0].steps[1].watch ||= []).push({label: 'New nested value', path: '/nestedOnly/score'});
    delete payload.scenarios[0].steps[0].state.nestedOnly;
    const variant = html.replace(payloadMatch[0], `${payloadMatch[1]}${JSON.stringify(payload).replace(/</g, '\\u003c')}${payloadMatch[3]}`);
    await page.setViewportSize({width: 1440, height: 1000});
    await page.setContent(variant, {waitUntil: 'load'});
    await page.click('#tab-walk');
    await page.locator('#story').click({position: {x: 4, y: 4}});
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    assert.match(await page.locator('#visuals').innerText(), /New nested value[\s\S]*7/);
  }
  assert.deepEqual(errors, [], 'Browser runtime errors');
  assert.deepEqual(requests, [], 'Offline dashboard must make no network requests');
  console.log(JSON.stringify({scenarios: data.scenarios.length, steps: count, questions: data.quiz?.questions.length || 0, errors, networkRequests: requests, screenshots: dirname(file)}));
} finally {
  await browser.close();
}
