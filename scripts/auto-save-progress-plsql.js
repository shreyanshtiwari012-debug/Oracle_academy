'use strict';

/**
 * Automated Section Progress Saver for Oracle Academy:
 * "Database Programming with PLSQL – English"
 *
 * Workflow:
 * 1. Checks all sections on the Course Outline (Page 14).
 * 2. Skips sections that are already 100% complete.
 * 3. Skips Midterm / Final Exams ("Leave the mid sem exam and end sem exam").
 * 4. For each incomplete section (<100%):
 *    - Opens the section (Page 15).
 *    - Iterates through each subsection, clicking "Save and Continue" (#nextModButton).
 *    - When all subsections are saved, detects the "Save Progress" button and clicks it.
 *    - Returns to Course Outline (Page 14), verifies 100% completion, and moves to the next section.
 */

const fs = require('fs');
const path = require('path');

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

const CLASS_ID = '60559'; // Database Programming with PLSQL – English

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
 * Steps through a section on Page 15, clicking "Save and Continue" on each subsection
 * and clicking "Save Progress" when finished.
 */
async function processSection(page, section) {
  console.log(`\n======================================================`);
  console.log(`Processing Section: ${section.name} (P15_ID=${section.p15Id})`);
  console.log(`Current Progress: ${section.percent !== null ? section.percent + '%' : 'Not Started'}`);

  // Navigate into the section
  console.log(`Opening section URL...`);
  await page.goto(section.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const MAX_SUBSECTIONS = 60;
  let savedCount = 0;
  let saveProgressClicked = false;

  for (let step = 1; step <= MAX_SUBSECTIONS; step++) {
    // Inspect current subsection state
    const state = await page.evaluate(() => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const heading = clean(document.querySelector('h1, h2, h3.t-Breadcrumb-title')?.innerText);

      // Check for any visible button or link matching "Save Progress"
      const candidates = [...document.querySelectorAll('button, a.t-Button, input[type=button], input[type=submit]')];
      const saveProgressEl = candidates.find((el) => {
        const txt = clean(el.innerText || el.value || '');
        return /save progress/i.test(txt) && el.offsetParent !== null;
      });

      const nextBtn = document.querySelector('#nextModButton');
      const isNextDisabled = nextBtn
        ? nextBtn.classList.contains('apex_disabled') || nextBtn.disabled
        : true;
      const isNextVisible = nextBtn ? nextBtn.offsetParent !== null : false;

      return {
        heading,
        saveProgressButtonId: saveProgressEl ? (saveProgressEl.id || null) : null,
        hasSaveProgress: Boolean(saveProgressEl),
        hasNext: Boolean(nextBtn) && isNextVisible && !isNextDisabled,
        nextText: nextBtn ? clean(nextBtn.innerText || nextBtn.value) : null
      };
    });

    // Check if Save Progress button appeared
    if (state.hasSaveProgress) {
      console.log(`  [Step ${step}] Reached end of subsections! Found "Save Progress" button.`);
      console.log(`  Clicking "Save Progress"...`);
      const btnSelector = state.saveProgressButtonId
        ? `#${state.saveProgressButtonId}`
        : 'button:has-text("Save Progress")';

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
        page.click(btnSelector)
      ]);

      await page.waitForTimeout(3000);
      saveProgressClicked = true;
      console.log(`  "Save Progress" clicked successfully! Redirected back to Course Outline.`);
      break;
    }

    // Otherwise, check if "Save and Continue" is available
    if (state.hasNext) {
      savedCount++;
      const itemTitle = state.heading ? state.heading.split(' - ').slice(-1)[0] : 'Item';
      console.log(`  [Sub-section ${savedCount}] Saving & continuing: "${itemTitle}"...`);

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
        page.click('#nextModButton')
      ]);

      await page.waitForTimeout(2000);
    } else {
      // Neither Next nor Save Progress was immediately found
      console.log(`  [Step ${step}] Neither Next button nor Save Progress button visible.`);
      // Check again after a brief pause in case rendering was delayed
      await page.waitForTimeout(2000);
      const finalCheck = await page.evaluate(() => {
        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const candidates = [...document.querySelectorAll('button, a.t-Button, input[type=button]')];
        const sp = candidates.find((el) => /save progress/i.test(clean(el.innerText || el.value || '')) && el.offsetParent !== null);
        return { hasSaveProgress: Boolean(sp), id: sp ? sp.id : null };
      });

      if (finalCheck.hasSaveProgress) {
        console.log(`  Found "Save Progress" button on second check! Clicking...`);
        const sel = finalCheck.id ? `#${finalCheck.id}` : 'button:has-text("Save Progress")';
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
          page.click(sel)
        ]);
        await page.waitForTimeout(3000);
        saveProgressClicked = true;
        break;
      }

      console.log(`  Stopping subsection walk for ${section.name}.`);
      break;
    }
  }

  return { savedCount, saveProgressClicked };
}

async function run() {
  console.log(`================================================================`);
  console.log(`Oracle Academy Auto Section Progress Saver`);
  console.log(`Course: Database Programming with PLSQL – English (Class ID ${CLASS_ID})`);
  console.log(`Rules:`);
  console.log(` - Skip sections already 100% complete`);
  console.log(` - Leave Midterm and Final exams untouched`);
  console.log(` - Walk all subsections, click 'Save and Continue', then 'Save Progress'`);
  console.log(`================================================================\n`);

  const { browser, context } = await oa.ensureBrowser();

  try {
    // Open class course outline (Page 14)
    console.log(`Navigating to Course Outline (Page 14)...`);
    const { page, cls } = await oa.openClass(context, CLASS_ID);
    console.log(`Loaded outline for: ${cls.name}`);

    // Read all section links
    const sections = await getOutlineSections(page);
    console.log(`\nFound ${sections.length} total outline items:`);

    const toProcess = [];
    for (const s of sections) {
      if (s.isExam) {
        console.log(`  [SKIP EXAM]       ${s.name} (${s.percent !== null ? s.percent + '%' : 'Exam'})`);
      } else if (s.isResources) {
        console.log(`  [SKIP RESOURCES]  ${s.name}`);
      } else if (s.is100) {
        console.log(`  [SKIP 100%]       ${s.name} (100% Complete)`);
      } else {
        console.log(`  [QUEUED FOR RUN]  ${s.name} (Currently ${s.percent !== null ? s.percent + '%' : '0%'})`);
        toProcess.push(s);
      }
    }

    if (toProcess.length === 0) {
      console.log(`\nAll non-exam sections are already 100% completed! Nothing to do.`);
      return;
    }

    console.log(`\nStarting automated walkthrough for ${toProcess.length} incomplete section(s)...\n`);

    for (let i = 0; i < toProcess.length; i++) {
      const target = toProcess[i];
      console.log(`\n>>> [${i + 1}/${toProcess.length}] Next: ${target.name}`);

      // Ensure we are on page 14 to get the freshest link with current checksum
      const currentUrl = page.url();
      if (!currentUrl.includes(':14:')) {
        console.log(`Returning to Page 14 course outline...`);
        await oa.openClass(context, CLASS_ID);
        await page.waitForTimeout(2000);
      }

      // Re-read outline sections to get fresh CSRF/checksum URL
      const currentSections = await getOutlineSections(page);
      const freshTarget = currentSections.find((s) => s.p15Id === target.p15Id);

      if (!freshTarget) {
        console.error(`Could not locate section link for P15_ID=${target.p15Id} on outline page. Skipping.`);
        continue;
      }

      if (freshTarget.is100) {
        console.log(`Section ${freshTarget.name} is already 100% complete! Skipping.`);
        continue;
      }

      // Process the section
      const result = await processSection(page, freshTarget);
      console.log(`Finished walkthrough for ${freshTarget.name}: ${result.savedCount} sub-sections saved.`);

      // Ensure we are back on Page 14 and verify updated percentage
      if (!page.url().includes(':14:')) {
        await oa.openClass(context, CLASS_ID);
        await page.waitForTimeout(2000);
      }

      const updatedSections = await getOutlineSections(page);
      const verified = updatedSections.find((s) => s.p15Id === target.p15Id);
      if (verified) {
        console.log(`New Progress for ${verified.name}: ${verified.percent !== null ? verified.percent + '%' : 'Unknown'}`);
      }

      // Small cooldown between sections
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Final Report
    console.log(`\n======================================================`);
    console.log(`FINAL PROGRESS REPORT:`);
    console.log(`======================================================`);
    const finalSections = await getOutlineSections(page);
    for (const s of finalSections) {
      if (s.isExam) {
        console.log(`  [EXAM]      ${s.name} (${s.percent !== null ? s.percent + '%' : 'Exam'})`);
      } else {
        const mark = s.is100 ? '✓ 100%' : `${s.percent}%`;
        console.log(`  [SECTION]   ${s.name.padEnd(55)} : ${mark}`);
      }
    }
    console.log(`======================================================\n`);

  } finally {
    await oa.disconnect(browser);
    console.log(`Disconnected from browser session.`);
  }
}

run().catch((err) => {
  console.error('Fatal script error:', err);
  process.exit(1);
});
