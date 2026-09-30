// Optional browser regression runner. Requires Playwright and its Chromium browser.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const file = resolve(process.argv[2]);
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  await page.clock.install();
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => {if (/^https?:/.test(request.url())) requests.push(request.url());});
  await page.goto(pathToFileURL(file).href);
  const scenarios = await page.locator('#scenario option').count();
  let count = 0;
  for (let scenario=0;scenario<scenarios;scenario++) {
    await page.selectOption('#scenario',String(scenario));
    const steps = await page.locator('#jump option').count();
    for(let i=0;i<steps;i++) {
      await page.selectOption('#jump',String(i));
      assert.equal(await page.locator('#position').innerText(),`Step ${i+1} of ${steps}`);
      assert.ok(await page.locator('.code-line.focus').count());
      assert.ok(await page.locator('#visuals .visual').count());
      if (await page.locator('#file-tabs button').count()>1) {
        await page.locator('#file-tabs button').nth(1).click();
        assert.equal(await page.locator('#file-tabs button').nth(1).getAttribute('aria-selected'),'true');
        await page.locator('#file-tabs button').first().click();
      }
      const before = await page.locator('#visuals').innerHTML();
      if(i<steps-1) {
        await page.click('#next');
        await page.click('#previous');
        assert.equal(await page.locator('#visuals').innerHTML(),before,'Reverse must restore exact snapshot');
      }
      count++;
    }
    assert.equal(await page.locator('#outcome').isVisible(),true);
    await page.locator('body').click({position:{x:2,y:2}});
    await page.keyboard.press('Home');
    assert.equal(await page.locator('#position').innerText(),`Step 1 of ${steps}`);
    if(steps>1) {
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('#position').innerText(),`Step 2 of ${steps}`);
    }
    await page.click('#open-overview');
    assert.equal(await page.locator('#overview').isVisible(),true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#overview').isVisible(),false);
  }
  await page.selectOption('#scenario','0');
  const steps = await page.locator('#jump option').count();
  const lastTick = page.locator('#timeline .tick').last();
  await lastTick.click();
  assert.equal(await page.locator('#position').innerText(),`Step ${steps} of ${steps}`,'Timeline tick must seek');
  const firstNode = await page.evaluate(() => JSON.parse(document.getElementById('walkthrough-data').textContent).scenarios[0].steps[0].node);
  const nodeIndex = await page.evaluate(id => JSON.parse(document.getElementById('walkthrough-data').textContent).graph.nodes.findIndex(n => n.id === id), firstNode);
  await page.locator('#minimap .graph-node').nth(nodeIndex).click();
  assert.equal(await page.locator('#position').innerText(),`Step 1 of ${steps}`,'Minimap node must jump to its step');
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lightBackground = await background();
  await page.click('#theme');
  assert.notEqual(await background(),lightBackground,'Theme toggle must change palette');
  await page.screenshot({path:join(dirname(file),'desktop-dark.png'),fullPage:true,animations:'disabled'});
  await page.click('#theme');
  assert.equal(await background(),lightBackground);
  await page.selectOption('#scenario','0');
  if(steps>1) {
    await page.click('#play');
    assert.equal(await page.locator('#play').innerText(),'Pause');
    await page.clock.runFor(6001);
    assert.equal(await page.locator('#scrubber').inputValue(),'1');
    await page.locator('body').click({position:{x:2,y:2}});
    if(steps>2) {
      await page.keyboard.press('Space');
      assert.equal(await page.locator('#play').innerText(),'Play','Space must pause active playback');
      await page.clock.runFor(6001);
      assert.equal(await page.locator('#scrubber').inputValue(),'1');
    }
  }
  if(steps>1) await page.selectOption('#jump','1');
  const savedHash = new URL(page.url()).hash;
  await page.reload();
  assert.equal(new URL(page.url()).hash,savedHash,'Reload must preserve deep link');
  const rangeValue = await page.locator('#scrubber').inputValue();
  await page.locator('#scrubber').focus();
  await page.keyboard.press('End');
  assert.equal(await page.locator('#scrubber').inputValue(),String(steps-1));
  await page.selectOption('#jump',rangeValue);
  await page.screenshot({path:join(dirname(file),'desktop.png'),fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile must not overflow horizontally');
  if(steps>1 && await page.locator('#changes .change').count()) {
    const before=await page.locator('#changes .change').first().locator('.change-before').boundingBox();
    const after=await page.locator('#changes .change').first().locator('.change-after').boundingBox();
    assert.ok(after.y>=before.y+before.height,'Mobile before/after values must stack legibly');
  }
  await page.screenshot({path:join(dirname(file),'mobile.png'),fullPage:true,animations:'disabled'});
  if(steps>1) {
    const html=readFileSync(file,'utf8');
    const match=html.match(/(<script type="application\/json" id="walkthrough-data">)([\s\S]*?)(<\/script>)/);
    assert.ok(match,'Walkthrough JSON payload must exist');
    const payload=JSON.parse(match[2]);
    payload.scenarios[0].steps[1].state.nestedOnly={score:7};
    payload.scenarios[0].steps[1].visuals.push({type:'text',title:'New nested value',path:'/nestedOnly/score'});
    payload.scenarios[0].steps[1].watch.push({label:'New nested value',path:'/nestedOnly/score'});
    delete payload.scenarios[0].steps[0].state.nestedOnly;
    const variant=html.replace(match[0],`${match[1]}${JSON.stringify(payload).replace(/</g,'\\u003c')}${match[3]}`);
    await page.setContent(variant,{waitUntil:'load'});
    await page.locator('#scrubber').focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    assert.match(await page.locator('#visuals').innerText(),/New nested value[\s\S]*7/);
  }
  assert.deepEqual(errors,[],'Browser runtime errors');
  assert.deepEqual(requests,[],'Offline dashboard must make no network requests');
  console.log(JSON.stringify({scenarios,steps:count,errors,networkRequests:requests,screenshots:dirname(file)}));
} finally {
  await browser.close();
}
