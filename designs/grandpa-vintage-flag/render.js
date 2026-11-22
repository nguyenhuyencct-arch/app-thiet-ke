// Renders design.svg -> print PNG (transparent, 4500x5400) + previews on shirt colours.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, 'design.svg'), 'utf8');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 4500, height: 5400 } });
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await p.screenshot({ path: path.join(__dirname, 'design-print.png'), omitBackground: true });
  for (const [name, bg] of [['navy', '#1F2A44'], ['charcoal', '#3A3A3C'], ['black', '#141414']]) {
    const q = await b.newPage({ viewport: { width: 900, height: 1080 } });
    const small = svg.replace('width="4500" height="5400"', 'width="900" height="1080"');
    await q.setContent(`<html><body style="margin:0;background:${bg}">${small}</body></html>`);
    await q.screenshot({ path: path.join(__dirname, `preview-${name}.png`) });
  }
  await b.close();
})();
