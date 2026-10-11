'use strict';

const fs = require('fs');
const path = require('path');

// Load .env
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath);
  } catch (e) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)?\s*$/);
      if (match && !match[1].startsWith('#')) {
        process.env[match[1]] = (match[2] || '').trim();
      }
    }
  }
}

const oa = require('../src');

const CLASS_ID = '60373'; // Database Design – English
const SECTION_ID = '19';  // Section 2 - Entities and Attributes

async function testSection2() {
  console.log('Testing full section completion on Section 2 (P15_ID=19)...');
  const { browser, context } = await oa.ensureBrowser();

  try {
    // 1. Open Section 2 from Course Outline
    const { page } = await oa.openClass(context, CLASS_ID);
    console.log(`On Course Outline: ${page.url()}`);

    // Find fresh link for Section 2
    const sectionHref = await page.evaluate((sid) => {
      for (const a of document.querySelectorAll('a[href]')) {
        if (!/FROM_COURSE_OUTLINE/.test(a.href || '')) continue;
        const m = a.href.match(/P15_ID,P15_COURSE_ID,P15_CLASS_COURSE_ID:(\d+),/);
        if (m && m[1] === sid) return a.href;
      }
      return null;
    }, SECTION_ID);

    if (!sectionHref) throw new Error('Could not find Section 2 link on Page 14');
    console.log(`Navigating to Section 2: ${sectionHref}`);
    await page.goto(sectionHref, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // 2. Step through subsections with "Save and Continue"
    let step = 0;
    while (step < 30) {
      step++;
      const state = await page.evaluate(() => {
        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const heading = clean(document.querySelector('h1, h2, h3.t-Breadcrumb-title')?.innerText);
        const nextBtn = document.querySelector('#nextModButton');
        const isNextVisible = nextBtn ? nextBtn.offsetParent !== null : false;
        const isNextDisabled = nextBtn ? nextBtn.classList.contains('apex_disabled') || nextBtn.disabled : true;

        const openAssess = document.querySelector('#open_assess_id');
        const startBtn = document.querySelector('button[data-otel-label="START"]');
        const isQuizCard = Boolean(openAssess || startBtn || /quiz|exam/i.test(heading));

        const saveProgressEl = [...document.querySelectorAll('button, a.t-Button, input[type=button]')]
          .find(el => /save progress/i.test(clean(el.innerText || el.value || '')) && el.offsetParent !== null);

        return {
          heading,
          hasNext: Boolean(nextBtn) && isNextVisible && !isNextDisabled,
          isQuizCard,
          hasOpenAssess: Boolean(openAssess),
          hasStartBtn: Boolean(startBtn),
          saveProgressId: saveProgressEl ? saveProgressEl.id : null,
          hasSaveProgress: Boolean(saveProgressEl)
        };
      });

      console.log(`[Step ${step}] Heading: ${state.heading}`);

      // If we are on the Quiz card
      if (state.isQuizCard && (state.hasOpenAssess || state.hasStartBtn)) {
        console.log(`>>> Reached Quiz Card: ${state.heading}! Starting quiz attempt...`);

        // Click trigger to navigate to Page 190
        const trigger = page.locator('#open_assess_id');
        if (await trigger.count()) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
            trigger.click()
          ]);
          await page.waitForTimeout(4000);
        }

        if (!oa.isAssessmentPage(page)) {
          const start = page.locator('button[data-otel-label="START"]');
          if (await start.count()) {
            await start.click().catch(() => {});
            await page.waitForTimeout(4000);
          }
        }

        if (oa.isAssessmentPage(page)) {
          console.log(`>>> On Page 190 assessment. Solving questions with Gemini AI...`);
          const quizRes = await oa.runQuiz(context, {
            provider: 'gemini',
            delayMs: 800,
            onProgress: (r) => {
              console.log(`    [Q${r.sequence}] Selected: ${r.letters.join('+')} | ${r.question.slice(0, 75)}...`);
            }
          });
          console.log(`>>> Quiz finished! Answered ${quizRes.results.length} questions.`);

          // Check score
          await page.waitForTimeout(3000);
          const score = await page.evaluate(() => {
            const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
            const matches = [...document.querySelectorAll('h1,h2,h3,h4,p,span,div,td')]
              .map(x => clean(x.textContent))
              .filter(x => /PERCENTAGE SCORED|Mastery Score/i.test(x));
            return matches.slice(0, 2).join(' | ');
          }).catch(() => '');
          console.log(`>>> Quiz Score: ${score}`);

          // Now return to Section 2 Page 15 to click "Save Progress"
          console.log(`Returning to Section 2 to click Save Progress...`);
          await page.goto(sectionHref, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(3000);

          // Find and click Save Progress
          const spClicked = await page.evaluate(() => {
            const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
            const btn = [...document.querySelectorAll('button, a.t-Button, input[type=button]')]
              .find(el => /save progress/i.test(clean(el.innerText || el.value || '')) && el.offsetParent !== null);
            if (btn) {
              btn.click();
              return true;
            }
            return false;
          });

          if (spClicked) {
            console.log(`Clicked Save Progress button! Waiting for navigation to Page 14...`);
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
            await page.waitForTimeout(3000);
          }
          break;
        } else {
          console.error(`Failed to reach Page 190. Current URL: ${page.url()}`);
          break;
        }
      }

      // If Save and Continue is available, click it
      if (state.hasNext) {
        console.log(`Clicking Save and Continue...`);
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
          page.click('#nextModButton')
        ]);
        await page.waitForTimeout(2000);
      } else if (state.hasSaveProgress) {
        console.log(`Found Save Progress button without quiz! Clicking...`);
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
          page.click(`#${state.saveProgressId || 'B91060267635211656'}`)
        ]);
        await page.waitForTimeout(3000);
        break;
      } else {
        console.log(`Neither Next nor Quiz nor Save Progress found. Stopping.`);
        break;
      }
    }

    // 3. Verify on Course Outline (Page 14)
    console.log(`Verifying Section 2 on Course Outline...`);
    await oa.openClass(context, CLASS_ID);
    await page.waitForTimeout(3000);

    const s2Text = await page.evaluate((sid) => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      for (const a of document.querySelectorAll('a[href]')) {
        if (!/FROM_COURSE_OUTLINE/.test(a.href || '')) continue;
        const m = a.href.match(/P15_ID,P15_COURSE_ID,P15_CLASS_COURSE_ID:(\d+),/);
        if (m && m[1] === sid) return clean(a.textContent || a.innerText);
      }
      return null;
    }, SECTION_ID);

    console.log(`\n======================================================`);
    console.log(`Section 2 Outline Status: ${s2Text}`);
    console.log(`======================================================\n`);

  } finally {
    await oa.disconnect(browser);
  }
}

testSection2().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
