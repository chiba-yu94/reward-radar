// Freeze reviewed examples as well as the clock, so future editorial updates do not age test fixtures.
import {execFileSync} from 'node:child_process';
execFileSync('python3',['-c',`
from pathlib import Path
from radar.pipeline import inputs, publish, stamp
rows, sources = inputs(Path('tests/fixtures/reviewed'))
publish(rows, sources, {}, Path('var/published.json'), Path('var/test-operations.sqlite'), stamp('2026-11-08T12:00:00Z'))
`]);
execFileSync(process.execPath,['site/build.mjs'],{env:{...process.env,SITE_ORIGIN:'https://freebietrail.com',QA_NOW:'2026-11-08T12:00:00Z'}});
