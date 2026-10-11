'use strict';
const oa = require('../src');

async function main() {
  const { browser, context } = await oa.ensureBrowser();
  try {
    const { page, cls } = await oa.openClass(context, '60559');
    console.log(`Class: ${cls.name} (${cls.classCourseId})`);
    console.log(`Current page URL: ${page.url()}`);

    const data = await page.evaluate(() => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const results = [];
      // Look at all links, cards, list items or progress bars on page 14
      const links = document.querySelectorAll('a[href]');
      for (const a of links) {
        const href = a.href || '';
        if (/FROM_COURSE_OUTLINE/.test(href)) {
          let container = a;
          for (let i = 0; i < 5 && container; i++) {
            if (container.parentElement) container = container.parentElement;
          }
          results.push({
            text: clean(a.textContent),
            innerText: clean(a.innerText),
            href,
            parentText: clean(container ? container.innerText : '')
          });
        }
      }
      return results;
    });

    console.log('Found outline links:', JSON.stringify(data, null, 2));
  } finally {
    await oa.disconnect(browser);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
