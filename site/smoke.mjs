import assert from 'node:assert/strict';
import {setTimeout as wait} from 'node:timers/promises';

const origin = process.env.SITE_ORIGIN || 'http://127.0.0.1:8787';
for (const lang of ['ja','en']) {
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(origin + '/' + lang + '/', {redirect:'error',signal:AbortSignal.timeout(12_000)});
    if (response.ok) break;
    await wait(2500);
  }
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  const body = await response.text();
  assert.ok(body.includes(`<html lang="${lang}">`));
  if (process.env.SITE_ORIGIN) assert.ok(body.includes(`rel="canonical" href="${origin}/${lang}/"`));
  const directory = await fetch(`${origin}/${lang}/opportunities/`,{redirect:'error'});
  assert.equal(directory.status,200);
  assert.match(await directory.text(), /id="filters"/);
  console.log(`/${lang}/ and /${lang}/opportunities/: HTTP 200, HTML and CSP verified`);
}
const dataset = await fetch(origin + '/opportunities.json');
assert.equal(dataset.status,200);
assert.ok((await dataset.json()).records.length > 0);
assert.equal((await fetch(origin + '/missing-smoke-page/')).status,404);
