'use strict';
const oa = require('../src');

async function main() {
  const { browser, context } = await oa.ensureBrowser();
  try {
    const page = oa.findAppPage(context);
    console.log('Current URL before click:', page.url());

    // Check what item is currently active or shown
    const stateBefore = await page.evaluate(() => {
      const activeLink = document.querySelector('a.is-active, .is-selected, .t-TreeNav-item.is-current');
      const h = document.querySelector('h1, h2, h3.t-Breadcrumb-title');
      const btn = document.querySelector('#nextModButton');
      return {
        title: document.title,
        heading: h ? h.innerText.trim() : null,
        activeLink: activeLink ? activeLink.innerText.trim() : null,
        nextBtnText: btn ? btn.innerText.trim() : null,
        nextBtnDisabled: btn ? btn.classList.contains('apex_disabled') : null
      };
    });
    console.log('State before:', stateBefore);

    console.log('Clicking #nextModButton...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {}),
      page.click('#nextModButton')
    ]);

    await page.waitForTimeout(3000);

    console.log('Current URL after click:', page.url());
    const stateAfter = await page.evaluate(() => {
      const activeLink = document.querySelector('a.is-active, .is-selected, .t-TreeNav-item.is-current');
      const h = document.querySelector('h1, h2, h3.t-Breadcrumb-title');
      const btn = document.querySelector('#nextModButton');
      const allButtons = [...document.querySelectorAll('button')].map(b => ({
        id: b.id,
        text: b.innerText.trim(),
        visible: b.offsetParent !== null
      }));
      return {
        title: document.title,
        heading: h ? h.innerText.trim() : null,
        activeLink: activeLink ? activeLink.innerText.trim() : null,
        nextBtnText: btn ? btn.innerText.trim() : null,
        nextBtnDisabled: btn ? btn.classList.contains('apex_disabled') : null,
        allButtons
      };
    });
    console.log('State after:', stateAfter);

  } finally {
    await oa.disconnect(browser);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
