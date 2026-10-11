'use strict';
const oa = require('../src');

async function main() {
  const { browser, context } = await oa.ensureBrowser();
  try {
    const item = await oa.findItemUrl(context, '60373', '19', '7707');
    console.log(`Quiz item URL: ${item.url}`);
    
    const page = oa.findAppPage(context);
    await page.goto(item.url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const info = await page.evaluate(() => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const buttons = [...document.querySelectorAll('button, a.t-Button, input[type=button]')].map(b => ({
        id: b.id,
        text: clean(b.innerText || b.value),
        visible: b.offsetParent !== null
      }));
      const openAssess = document.querySelector('#open_assess_id');
      const startBtn = document.querySelector('button[data-otel-label="START"]');
      return {
        title: document.title,
        heading: clean(document.querySelector('h1, h2, h3.t-Breadcrumb-title')?.innerText),
        hasOpenAssess: Boolean(openAssess),
        hasStartBtn: Boolean(startBtn),
        buttons: buttons.filter(b => b.visible)
      };
    });

    console.log('Quiz Card Info:', JSON.stringify(info, null, 2));

  } finally {
    await oa.disconnect(browser);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
