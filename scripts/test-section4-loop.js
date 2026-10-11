'use strict';
const oa = require('../src');

async function main() {
  const { browser, context } = await oa.ensureBrowser();
  try {
    const page = oa.findAppPage(context);
    console.log('Testing Save and Continue progression in Section 4...');

    for (let step = 1; step <= 25; step++) {
      const state = await page.evaluate(() => {
        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const heading = clean(document.querySelector('h1, h2, h3.t-Breadcrumb-title')?.innerText);
        const nextBtn = document.querySelector('#nextModButton');
        const allBtns = [...document.querySelectorAll('button, a.t-Button, input[type=button]')]
          .filter(b => b.offsetParent !== null)
          .map(b => ({ id: b.id, text: clean(b.innerText || b.value) }));
        
        const saveProgressBtn = allBtns.find(b => /save progress/i.test(b.text));

        return {
          heading,
          nextBtn: nextBtn ? {
            text: clean(nextBtn.innerText || nextBtn.value),
            disabled: nextBtn.classList.contains('apex_disabled') || nextBtn.disabled,
            visible: nextBtn.offsetParent !== null
          } : null,
          saveProgressBtn,
          allBtns
        };
      });

      console.log(`[Step ${step}] Heading: ${state.heading}`);
      console.log(`         Next Button:`, state.nextBtn);
      if (state.saveProgressBtn) {
        console.log(`         *** FOUND SAVE PROGRESS BUTTON:`, state.saveProgressBtn);
      }

      // If Save Progress button exists, or if nextBtn text is 'Save Progress'
      if (state.saveProgressBtn) {
        console.log('Clicking Save Progress button...');
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
          page.click(`#${state.saveProgressBtn.id || 'nextModButton'}`)
        ]);
        await page.waitForTimeout(3000);
        console.log('Clicked Save Progress! Final URL:', page.url());
        break;
      }

      if (!state.nextBtn || state.nextBtn.disabled || !state.nextBtn.visible) {
        console.log('Next button is missing, disabled, or not visible. Stopping.');
        console.log('Visible buttons:', state.allBtns);
        break;
      }

      console.log(`Clicking ${state.nextBtn.text}...`);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
        page.click('#nextModButton')
      ]);

      await page.waitForTimeout(2000);
    }
  } finally {
    await oa.disconnect(browser);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
