'use strict';
const oa = require('../src');

async function main() {
  const { browser, context } = await oa.ensureBrowser();
  try {
    const page = oa.findAppPage(context);
    console.log('Inspecting current page 15 elements...');

    const btnInfo = await page.evaluate(() => {
      const btn = document.querySelector('#nextModButton');
      const allBtns = [...document.querySelectorAll('button')].map(b => ({
        id: b.id,
        text: b.innerText.trim(),
        visible: b.offsetParent !== null,
        classes: b.className
      }));

      // Let's also see if there's any button with "Save Progress" or similar
      const saveProgress = [...document.querySelectorAll('button, a, input')].filter(el =>
        /save progress/i.test(el.innerText || el.value || '')
      ).map(el => ({
        tag: el.tagName,
        id: el.id,
        text: (el.innerText || el.value || '').trim(),
        visible: el.offsetParent !== null
      }));

      return {
        nextModButton: btn ? {
          text: btn.innerText.trim(),
          onclick: btn.getAttribute('onclick'),
          visible: btn.offsetParent !== null
        } : null,
        allButtons: allBtns,
        saveProgressButtons: saveProgress
      };
    });

    console.log('Button details:', JSON.stringify(btnInfo, null, 2));
  } finally {
    await oa.disconnect(browser);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
