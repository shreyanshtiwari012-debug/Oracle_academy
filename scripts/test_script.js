'use strict';

/**
 * test_script.js
 *
 * Interactive Oracle Academy Automation Script:
 * 1. Connects to the active browser session (reuse login).
 * 2. Fetches and lists all enrolled classes and their IDs from Student Hub.
 * 3. Prompts the user to select a specific class.
 * 4. Navigates into the selected class and processes each section:
 *    - Skips 100% completed sections.
 *    - Walks through subsections, clicking "Save and Continue".
 *    - When encountering quizzes/exams, runs AI solver (Gemini/OpenAI).
 *    - Checks score percentage. If score <= 70% (or not > 70%), retries up to 3 attempts.
 *    - Clicks "Save Progress" to complete the section.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Load .env if present
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

function promptUser(questionText) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(questionText, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

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
      const isExam = /exam|midterm|final/i.test(rawText);
      const isResources = /course resources/i.test(rawText);
      const percentMatch = rawText.match(/(\d+)%\s*$/);
      const percent = percentMatch ? parseInt(percentMatch[1], 10) : null;
      const cleanName = rawText.replace(/\s*\d+%\s*$/, '').trim();

      results.push({
        rawText,
        name: cleanName,
        p15Id,
        courseId: m[2],
        classCourseId: m[3],
        url: href,
        percent,
        isExam,
        isResources,
        is100: percent === 100
      });
    }

    return results;
  });
}

/**
 * Fully walks through a section on Page 15:
 * - saves subsections
 * - solves quizzes/exams with AI, checks score (>70%), retries up to 3 times if needed
 * - clicks Save Progress
 */
async function processSection(page, context, section, provider, model) {
  console.log(`\n======================================================`);
  console.log(`Processing Section: ${section.name} (P15_ID=${section.p15Id})`);
  console.log(`Current Progress: ${section.percent !== null ? section.percent + '%' : 'Not Started'}`);
  console.log(`======================================================`);

  console.log(`Opening section URL: ${section.url}`);
  await page.goto(section.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const MAX_STEPS = 60;
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

      let attempt = 0;
      let passed = false;
      const maxAttempts = 3;

      while (attempt < maxAttempts && !passed) {
        attempt++;
        console.log(`  >>> Attempt ${attempt} of ${maxAttempts} for quiz "${state.heading}"...`);

        // Navigate / start assessment
        await page.goto(section.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(2000);

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
          console.log(`  >>> On Page 190 assessment. Solving questions with ${provider}...`);
          try {
            const quizRes = await oa.runQuiz(context, {
              provider,
              model,
              delayMs: 800,
              onProgress: (r) => {
                console.log(`      [Q${r.sequence}] Selected: ${r.letters.join('+')} | ${r.question.slice(0, 60)}...`);
              }
            });
            console.log(`  >>> Assessment completed! Answered ${quizRes.results.length} questions.`);
          } catch (err) {
            console.error(`  >>> Error during quiz run: ${err.message}`);
          }

          // Extract score
          await page.waitForTimeout(3000);
          const scoreInfo = await page.evaluate(() => {
            const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
            const matches = [...document.querySelectorAll('h1,h2,h3,h4,p,span,div,td')]
              .map(x => clean(x.textContent))
              .filter(x => /PERCENTAGE SCORED|Mastery Score|Score:/i.test(x));
            return matches.slice(0, 3).join(' | ');
          }).catch(() => '');

          console.log(`  >>> Result Score: ${scoreInfo || 'Score not detected'}`);

          // Parse numeric score percentage if possible
          const pctMatch = scoreInfo.match(/(\d+(?:\.\d+)?)%/);
          const scoreVal = pctMatch ? parseFloat(pctMatch[1]) : 0;

          if (scoreVal > 70) {
            console.log(`  >>> Success! Score ${scoreVal}% is > 70%.`);
            passed = true;
          } else {
            console.log(`  >>> Score ${scoreVal}% is <= 70%. Retrying quiz...`);
          }
        } else {
          console.error(`  >>> Failed to reach Page 190 assessment.`);
        }
      }

      // After quiz attempt(s), look for Save Progress or return to Section 15
      await page.waitForTimeout(2000);
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
        console.log(`  >>> Clicked Save Progress after quiz!`);
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(3000);
        saveProgressClicked = true;
      } else {
        console.log(`  >>> Returning to section page (Page 15)...`);
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
          console.log(`  >>> Clicked Save Progress on section page!`);
          await page.waitForTimeout(3000);
          saveProgressClicked = true;
        }
      }
      break;
    }

    // Case 2: Save Progress button is directly visible
    if (state.hasSaveProgress) {
      console.log(`  >>> Found "Save Progress" button! Clicking to finalize section...`);
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
      console.log(`  >>> Clicking "Save and Continue"...`);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
        page.click('#nextModButton')
      ]);
      await page.waitForTimeout(2000);
    } else {
      console.log(`  >>> No action button found. Checking if Save Progress appears after delay...`);
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
        console.log(`  >>> Late "Save Progress" clicked!`);
        await page.waitForTimeout(3000);
        saveProgressClicked = true;
      }
      break;
    }
  }

  return { saveProgressClicked };
}

async function run() {
  console.log(`================================================================`);
  console.log(`Oracle Academy Interactive Test Script`);
  console.log(`================================================================\n`);

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('ERROR: No GEMINI_API_KEY or OPENAI_API_KEY found in environment (.env).');
    process.exit(1);
  }
  const provider = process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY ? 'openai' : 'gemini';
  const model = process.env.ORACLE_QUIZ_GEMINI_MODEL || 'gemini-3.1-flash-lite';
  console.log(`Using AI provider: ${provider} (model: ${model})`);

  console.log(`Connecting to browser session...`);
  const { browser, context } = await oa.ensureBrowser();

  try {
    console.log(`Fetching classes from Student Hub...`);
    const { classes } = await oa.listClasses(context);

    if (!classes || classes.length === 0) {
      console.log(`No classes found. Make sure you are logged in using 'npx oracle-academy login --playwright'.`);
      return;
    }

    console.log(`\nFound ${classes.length} class(es):`);
    classes.forEach((c, idx) => {
      console.log(`  [${idx + 1}] ${c.name} (Class ID: ${c.classCourseId || c.id})`);
    });

    const answer = await promptUser(`\nEnter the number or Class ID of the class you want to run: `);
    let selectedClass = classes.find(c => String(c.classCourseId || c.id) === answer);
    if (!selectedClass) {
      const idx = parseInt(answer, 10);
      if (!isNaN(idx) && idx >= 1 && idx <= classes.length) {
        selectedClass = classes[idx - 1];
      }
    }

    if (!selectedClass) {
      console.error(`Invalid selection "${answer}". Exiting.`);
      return;
    }

    const classId = selectedClass.classCourseId || selectedClass.id;
    console.log(`\nSelected Class: ${selectedClass.name} (ID: ${classId})`);

    // Open class course outline (Page 14)
    console.log(`Opening Course Outline (Page 14)...`);
    const { page, cls } = await oa.openClass(context, classId);
    console.log(`Successfully opened: ${cls.name}\n`);

    // Loop through outline sections
    let outerLoop = 0;
    while (outerLoop < 30) {
      outerLoop++;

      if (!page.url().includes(':14:')) {
        console.log(`Returning to Page 14 Course Outline...`);
        await oa.openClass(context, classId);
        await page.waitForTimeout(3000);
      }

      const sections = await getOutlineSections(page);
      console.log(`\n--- Course Outline Status (Pass ${outerLoop}) ---`);
      const incomplete = [];
      for (const s of sections) {
        console.log(`  [P15_ID: ${s.p15Id}] ${s.name} - Progress: ${s.percent !== null ? s.percent + '%' : 'Not Started'}${s.is100 ? ' (100%)' : ''}`);
        if (!s.is100) {
          incomplete.push(s);
        }
      }

      if (incomplete.length === 0) {
        console.log(`\nAll sections are 100% complete! Congratulations!`);
        break;
      }

      console.log(`\nFound ${incomplete.length} incomplete section(s) to process.`);
      const targetSection = incomplete[0];

      await processSection(page, context, targetSection, provider, model);
      await page.waitForTimeout(3000);
    }

  } finally {
    await oa.disconnect(browser);
    console.log(`\nDisconnected from browser session.`);
  }
}

run().catch((err) => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
