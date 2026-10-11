'use strict';

/**
 * Automated Course Progress & Quiz Solver for Oracle Academy:
 * "Database Design – English" (Class ID 60373)
 *
 * Workflow:
 * 1. Open Course Outline on Page 14.
 * 2. Check each section:
 *    - If already 100% complete, skip it.
 *    - If incomplete (< 100%):
 *      a. Open the section on Page 15.
 *      b. Walk through subsections:
 *         - Click "Save and Continue" (#nextModButton).
 *         - When a Quiz or Exam card is reached:
 *           * Open assessment (Page 190).
 *           * Solve all questions with Gemini AI (targeting > 70%).
 *           * Read and display percentage score.
 *           * Return to Course Outline (Page 14).
 *         - If no quiz in section (e.g. Sections 10, 11), reach "Save Progress" and click it.
 *      c. Return to Page 14 and verify 100% completion.
 * 3. Repeat until every section and assessment in Database Design is 100% completed.
 */

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

/**
 * Scrapes all section/exam links from Course Outline (Page 14).
 */
async function getOutlineSections(page) {
  return page.evaluate(() => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const results = [];
    const seen = new Set();

    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.href || '';
      if (!/FROM_COURSE_OUTLINE/.test(href)) continue;

      const m = href.match(/P15_ID,P15_COURSE_ID,P15_CLASS_COURSE_ID:(\d+),(\d+),(\d+)/);
      if (!m) continue;

      const p15Id = m[1];
      if (seen.has(p15Id)) continue;
      seen.add(p15Id);

      const rawText = clean(a.textContent || a.innerText);
      const is100 = rawText.includes('100%');
      const isExam = /exam|midterm|final/i.test(rawText);
      const isResources = /course resources/i.test(rawText);

      results.push({
        rawText,
        p15Id,
        courseId: m[2],
        classCourseId: m[3],
        url: href,
        is100,
        isExam,
        isResources
      });
    }

    return results;
  });
}

/**
 * Fully walks through a section on Page 15:
 * saves subsections, solves any quizzes/exams with Gemini AI, and clicks Save Progress.
 */
async function processSection(page, context, section) {
  console.log(`\n======================================================`);
  console.log(`Processing: ${section.rawText} (P15_ID=${section.p15Id})`);
  console.log(`======================================================`);

  console.log(`Opening section URL: ${section.url}`);
  await page.goto(section.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const MAX_STEPS = 50;
  let quizSolved = false;
  let saveProgressClicked = false;

  for (let step = 1; step <= MAX_STEPS; step++) {
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
        hasSaveProgress: Boolean(saveProgressEl),
        saveProgressId: saveProgressEl ? saveProgressEl.id : null
      };
    });

    console.log(`  [Step ${step}] Heading: ${state.heading || 'N/A'}`);

    // Case 1: Quiz / Assessment Card
    if (state.isQuizCard && (state.hasOpenAssess || state.hasStartBtn)) {
      console.log(`  >>> Reached Quiz/Exam card: "${state.heading}". Starting attempt...`);

      const trigger = page.locator('#open_assess_id');
      if (await trigger.count()) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {}),
          trigger.click()
        ]);
        await page.waitForTimeout(4000);
      }

      if (!oa.isAssessmentPage(page)) {
        const start = page.locator('button[data-otel-label="START"]');
        if (await start.count()) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {}),
            start.click()
          ]);
          await page.waitForTimeout(4000);
        }
      }

      if (oa.isAssessmentPage(page)) {
        console.log(`  >>> On Page 190 assessment. Solving questions with Gemini AI...`);
        const quizRes = await oa.runQuiz(context, {
          provider: 'gemini',
          delayMs: 800,
          onProgress: (r) => {
            console.log(`      [Q${r.sequence}] Selected: ${r.letters.join('+')} | ${r.question.slice(0, 70)}...`);
          }
        });
        console.log(`  >>> Assessment completed! Answered ${quizRes.results.length} questions.`);

        // Extract score
        await page.waitForTimeout(3000);
        const scoreText = await page.evaluate(() => {
          const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
          const matches = [...document.querySelectorAll('h1,h2,h3,h4,p,span,div,td')]
            .map(x => clean(x.textContent))
            .filter(x => /PERCENTAGE SCORED|Mastery Score/i.test(x));
          return matches.slice(0, 2).join(' | ');
        }).catch(() => '');
        console.log(`  >>> Result Score: ${scoreText}`);
        quizSolved = true;

        // Check if there is a Save Progress button on page or return to Section 15 / Course Outline
        const spOnQuiz = await page.evaluate(() => {
          const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
          const btn = [...document.querySelectorAll('button, a.t-Button, input[type=button]')]
            .find(el => /save progress/i.test(clean(el.innerText || el.value || '')) && el.offsetParent !== null);
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        });

        if (spOnQuiz) {
          console.log(`  Clicked Save Progress on quiz page!`);
          await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(3000);
          saveProgressClicked = true;
        } else {
          // Navigate to section on Page 15 to check if Save Progress is present
          console.log(`  Checking Page 15 section for Save Progress button...`);
          await page.goto(section.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
          await page.waitForTimeout(3000);
          const clickedSP = await page.evaluate(() => {
            const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
            const btn = [...document.querySelectorAll('button, a.t-Button, input[type=button]')]
              .find(el => /save progress/i.test(clean(el.innerText || el.value || '')) && el.offsetParent !== null);
            if (btn) {
              btn.click();
              return true;
            }
            return false;
          });
          if (clickedSP) {
            console.log(`  Clicked Save Progress on Page 15!`);
            await page.waitForTimeout(3000);
            saveProgressClicked = true;
          }
        }
        break;
      } else {
        console.error(`  Failed to navigate to Page 190. Current URL: ${page.url()}`);
        break;
      }
    }

    // Case 2: Save Progress button is directly visible (e.g. at the end of non-quiz sections)
    if (state.hasSaveProgress) {
      console.log(`  Found "Save Progress" button! Clicking to finalize section...`);
      const btnSel = state.saveProgressId ? `#${state.saveProgressId}` : 'button:has-text("Save Progress")';
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
        page.click(btnSel)
      ]);
      await page.waitForTimeout(3000);
      saveProgressClicked = true;
      break;
    }

    // Case 3: "Save and Continue" is available
    if (state.hasNext) {
      console.log(`  Clicking "Save and Continue"...`);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
        page.click('#nextModButton')
      ]);
      await page.waitForTimeout(2000);
    } else {
      // Neither next nor quiz nor save progress found
      console.log(`  No action button found. Checking if Save Progress appears after delay...`);
      await page.waitForTimeout(2000);
      const lateSP = await page.evaluate(() => {
        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const btn = [...document.querySelectorAll('button, a.t-Button, input[type=button]')]
          .find(el => /save progress/i.test(clean(el.innerText || el.value || '')) && el.offsetParent !== null);
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
      if (lateSP) {
        console.log(`  Late "Save Progress" clicked!`);
        await page.waitForTimeout(3000);
        saveProgressClicked = true;
      }
      break;
    }
  }

  return { quizSolved, saveProgressClicked };
}

async function run() {
  console.log(`================================================================`);
  console.log(`Oracle Academy Full Course Automator`);
  console.log(`Target Course: Database Design – English (Class ID ${CLASS_ID})`);
  console.log(`Strategy:`);
  console.log(` - Inspect outline on Page 14`);
  console.log(` - Skip any section marked 100%`);
  console.log(` - For incomplete sections: walk subsections, click "Save and Continue",`);
  console.log(`   solve quizzes/exams using Gemini AI (> 70%), then click "Save Progress".`);
  console.log(`================================================================\n`);

  const { browser, context } = await oa.ensureBrowser();

  try {
    // 1. Open Class Course Outline (Page 14)
    console.log(`Navigating to Course Outline (Page 14)...`);
    const { page, cls } = await oa.openClass(context, CLASS_ID);
    console.log(`Loaded class: ${cls.name} (Class ID: ${cls.id})\n`);

    // 2. Loop until all sections are 100%
    let outerLoop = 0;
    while (outerLoop < 30) {
      outerLoop++;

      // Make sure we are on Page 14
      if (!page.url().includes(':14:')) {
        console.log(`Returning to Page 14 Course Outline...`);
        await oa.openClass(context, CLASS_ID);
        await page.waitForTimeout(3000);
      }

      // Read current status of all sections
      const sections = await getOutlineSections(page);
      console.log(`\n--- Course Outline Status (Pass ${outerLoop}) ---`);
      const incomplete = [];
      for (const s of sections) {
        if (s.is100) {
          console.log(`  [100% COMPLETE] ${s.rawText}`);
        } else {
          console.log(`  [INCOMPLETE]   ${s.rawText} (P15_ID=${s.p15Id})`);
          incomplete.push(s);
        }
      }

      if (incomplete.length === 0) {
        console.log(`\n🎉 ALL SECTIONS IN DATABASE DESIGN – ENGLISH ARE 100% COMPLETE! 🎉`);
        break;
      }

      // Process the first incomplete section
      const target = incomplete[0];
      console.log(`\n>>> Next Target: ${target.rawText}`);
      await processSection(page, context, target);

      // Brief pause before next outline check
      await page.waitForTimeout(3000);
    }

    // 3. Final Verification
    console.log(`\n================================================================`);
    console.log(`FINAL OUTLINE VERIFICATION`);
    console.log(`================================================================`);
    await oa.openClass(context, CLASS_ID);
    await page.waitForTimeout(3000);
    const finalSections = await getOutlineSections(page);
    for (const s of finalSections) {
      console.log(`  ${s.is100 ? '✅' : '❌'} ${s.rawText}`);
    }
    console.log(`================================================================\n`);

  } finally {
    await oa.disconnect(browser);
  }
}

run().catch(err => {
  console.error('Fatal error in course automator:', err);
  process.exit(1);
});
