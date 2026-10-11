'use strict';
const oa = require('../src');

async function main() {
  const { browser, context } = await oa.ensureBrowser();
  try {
    console.log('Opening Section 4 (P15_ID=443)...');
    const page = await oa.openSection(context, '60559', '443');
    console.log('Current URL:', page.url());

    // Dump all links on page 15
    const items = await page.evaluate(() => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const list = [];
      for (const a of document.querySelectorAll('a[href]')) {
        const h = a.href || '';
        if (/p=63000:15:/.test(h)) {
          list.push({
            text: clean(a.textContent),
            href: h,
            parent: clean(a.parentElement?.innerText || '')
          });
        }
      }
      return list;
    });

    console.log(`Found ${items.length} items in Section 4:`);
    items.forEach(it => console.log(`- ${it.text} | URL: ${it.href}`));

    // Also dump all buttons or controls on this page
    const buttons = await page.evaluate(() => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      return [...document.querySelectorAll('button, input[type=button], input[type=submit]')]
        .map(b => ({ text: clean(b.textContent || b.value), id: b.id, name: b.name }));
    });
    console.log('Buttons on Section 4 page:', buttons);

  } finally {
    await oa.disconnect(browser);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
