'use strict';

const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envPath);
}

const oa = require('../src');

async function solveCurrentQuizIfOpen(context) {
  const page = oa.findAppPage(context);
  if (page && oa.isAssessmentPage(page)) {
    console.log(`\nDetected already open assessment on: ${page.url().split('&cs=')[0]}`);
    console.log('Answering questions with Gemini...');
    try {
      const res = await oa.runQuiz(context, {
        provider: 'gemini',
        model: 'gemini-3.1-flash-lite',
        delayMs: 800,
        onProgress: (r) => {
          console.log(`  [Q${r.sequence}] Answer: ${r.letters.join('+')} | ${r.question.slice(0, 70)}...`);
        }
      });
      console.log(`Assessment finished! URL: ${res.url.split('&cs=')[0]}`);
      await logScore(context);
    } catch (e) {
      console.error('Error finishing current open quiz:', e.message);
    }
    return true;
  }
  return false;
}

async function logScore(context) {
  const page = oa.findAppPage(context);
  if (!page) return;
  await page.waitForTimeout(2000);
  const scoreInfo = await page.evaluate(() => {
    const clean = s => (s || '').replace(/\s+/g, ' ').trim();
    const texts = [...document.querySelectorAll('h1, h2, h3, h4, p, span, div, td')]
      .map(x => clean(x.textContent))
      .filter(x => /PERCENTAGE SCORED|Mastery Score|Score:/i.test(x));
    return texts[0] || '';
  }).catch(() => '');
  if (scoreInfo) {
    console.log(`Score: ${scoreInfo}`);
  }
}

async function solveQuizForItem(context, classCourseId, sectionP15Id, quizItem) {
  console.log(`\n----------------------------------------------------`);
  console.log(`Starting Assessment: ${quizItem.name} (item=${quizItem.p15Id})`);

  let appPage = oa.findAppPage(context);
  const alreadyOnQuiz = appPage && oa.isAssessmentPage(appPage) && appPage.url().includes(String(quizItem.p15Id));

  if (!alreadyOnQuiz) {
    appPage = await oa.startAssessment(context, quizItem.url);
  }

  if (!oa.isAssessmentPage(appPage)) {
    console.error(`Could not reach assessment page 190 for ${quizItem.name}. Current URL: ${appPage.url()}`);
    return false;
  }

  console.log(`Assessment page: ${appPage.url().split('&cs=')[0]}`);
  console.log(`Answering questions automatically with Gemini...`);

  const res = await oa.runQuiz(context, {
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite',
    delayMs: 800,
    onProgress: (r) => {
      console.log(`  [Q${r.sequence}] Answer: ${r.letters.join('+')} | ${r.question.slice(0, 70)}...`);
    }
  });

  console.log(`Assessment completed! Final URL: ${res.url.split('&cs=')[0]}`);
  await logScore(context);
  return true;
}

async function run() {
  const { browser, context } = await oa.ensureBrowser();
  try {
    // 1. Finish currently open quiz if any
    await solveCurrentQuizIfOpen(context);

    // 2. Fetch all classes
    console.log('\nFetching classes from Student Hub...');
    const { classes } = await oa.listClasses(context);
    console.log(`Found ${classes.length} classes:`);
    classes.forEach((c, idx) => console.log(`  ${idx + 1}. ${c.name} (${c.classCourseId})`));

    // Process each class
    for (const c of classes) {
      console.log(`\n======================================================`);
      console.log(`CHECKING CLASS: ${c.name} (ID: ${c.classCourseId})`);

      // Open class outline (Page 14)
      const { page } = await oa.openClass(context, c.classCourseId);
      if (!/p=63000:14:/.test(page.url())) {
        const backBtn = page.locator('button[data-otel-label="BACK_TO_COURSE"]');
        if (await backBtn.count()) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
            backBtn.click()
          ]);
          await page.waitForTimeout(2500);
        }
      }

      // Check section completion percentages on Page 14
      const sections = await page.evaluate(() => {
        const clean = s => (s || '').replace(/\s+/g, ' ').trim();
        const results = [];
        const seen = new Set();
        for (const a of document.querySelectorAll('a[href*="FROM_COURSE_OUTLINE"]')) {
          const parent = a.closest('tr, li, .t-MediaList-item, .t-Card') || a.parentElement;
          const text = clean(parent ? parent.textContent : a.textContent);
          const m = text.match(/(.*?)\s+(\d+%)$/);
          const href = a.href;
          const idMatch = href.match(/P15_ID,P15_COURSE_ID,P15_CLASS_COURSE_ID:(\d+),(\d+),(\d+)/);
          if (idMatch) {
            const sid = idMatch[1];
            if (seen.has(sid)) continue;
            seen.add(sid);
            results.push({
              sid,
              name: m ? m[1] : text,
              percentStr: m ? m[2] : 'Unknown',
              percent: m ? parseInt(m[2], 10) : 0,
              href
            });
          }
        }
        return results;
      });

      console.log(`Class has ${sections.length} sections in outline.`);
      const incompleteSections = sections.filter(s => s.percent < 100);

      if (incompleteSections.length === 0) {
        console.log(`All sections in "${c.name}" are 100% completed! Skipping class.`);
        continue;
      }

      console.log(`Found ${incompleteSections.length} incomplete section(s) in "${c.name}":`);
      incompleteSections.forEach(s => console.log(`  - [${s.percentStr}] ${s.name} (P15_ID=${s.sid})`));

      // Process each incomplete section
      for (const section of incompleteSections) {
        console.log(`\n>>> Processing Section: ${section.name} (P15_ID=${section.sid}, current progress: ${section.percentStr})`);

        let itemsRes;
        try {
          itemsRes = await oa.listItems(context, c.classCourseId, section.sid);
        } catch (err) {
          console.error(`Failed to list items for section ${section.sid}: ${err.message}`);
          continue;
        }

        const quizzes = itemsRes.items.filter(
          it => (it.type === 'quiz' || it.type === 'exam' || /quiz|exam|test|assessment/i.test(it.name)) &&
                !/review/i.test(it.name)
        );

        if (quizzes.length === 0) {
          console.log(`No quiz or exam in section "${section.name}".`);
          continue;
        }

        console.log(`Found ${quizzes.length} quiz/exam item(s) in section:`);
        for (const q of quizzes) {
          console.log(`  Assessment: ${q.name} (item=${q.p15Id}, status=${q.status || 'unknown'})`);
          try {
            await solveQuizForItem(context, c.classCourseId, section.sid, q);
          } catch (err) {
            console.error(`Error solving ${q.name}:`, err.message);
          }
        }
      }
    }

    console.log('\n======================================================');
    console.log('All pending quizzes processing complete!');

  } finally {
    await oa.disconnect(browser);
  }
}

run().catch((err) => {
  console.error('Fatal solver error:', err);
  process.exit(1);
});
