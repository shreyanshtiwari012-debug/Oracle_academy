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

const CLASS_ID = '66559'; // Database Foundations – English - D3 July 2026

const QUIZZES = [
  { sectionName: 'Section 1 - Introduction', sectionId: '211', itemId: '7742', name: 'Quiz: DFo - Section 1' },
  { sectionName: 'Section 2 - Databases and Data Modeling', sectionId: '224', itemId: '7743', name: 'Quiz: DFo - Section 2' },
  { sectionName: 'Section 3 - Refining the Data Model', sectionId: '290', itemId: '7744', name: 'Quiz: DFo - Section 3' },
  { sectionName: 'Section 5 - Mapping to the Physical Model', sectionId: '381', itemId: '7747', name: 'Quiz: DFo - Sections 4 and 5' },
  { sectionName: 'Section 6 - Introduction to SQL', sectionId: '400', itemId: '7749', name: 'Quiz 2: DFo - Section 6 - L5-L9' }
];

async function solveQuiz(context, qInfo, quizNumber, totalQuizzes) {
  console.log(`\n======================================================`);
  console.log(`[${quizNumber}/${totalQuizzes}] Starting: ${qInfo.name}`);
  console.log(`Section: ${qInfo.sectionName} (Section P15_ID=${qInfo.sectionId}, Item=${qInfo.itemId})`);

  let appPage = oa.findAppPage(context);
  const alreadyOnQuiz = appPage && oa.isAssessmentPage(appPage) && appPage.url().includes(String(qInfo.itemId));

  if (!alreadyOnQuiz) {
    console.log(`Fetching fresh link for ${qInfo.name}...`);
    const item = await oa.findItemUrl(context, CLASS_ID, qInfo.sectionId, qInfo.itemId);
    console.log(`Opening assessment...`);
    appPage = await oa.startAssessment(context, item.url);
  } else {
    console.log(`Already on assessment page for ${qInfo.name}. Resuming...`);
  }

  if (!oa.isAssessmentPage(appPage)) {
    throw new Error(`Failed to reach assessment page 190 for ${qInfo.name}. URL: ${appPage.url()}`);
  }

  console.log(`Assessment page: ${appPage.url().split('&cs=')[0]}`);
  console.log(`Solving questions automatically with Gemini AI...`);

  const res = await oa.runQuiz(context, {
    provider: 'gemini',
    delayMs: 800,
    onProgress: (r) => {
      console.log(`  [Q${r.sequence}] Answer: ${r.letters.join('+')} | ${r.question.slice(0, 75)}...`);
    }
  });

  console.log(`Completed ${qInfo.name}! (Answered ${res.results.length} questions)`);

  // Read score if on Score Summary page
  const page = oa.findAppPage(context);
  if (page) {
    await page.waitForTimeout(3000);
    const scoreText = await page.evaluate(() => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const matches = [...document.querySelectorAll('h1,h2,h3,h4,p,span,div,td')]
        .map((x) => clean(x.textContent))
        .filter((x) => /PERCENTAGE SCORED|Mastery Score/i.test(x));
      return matches.slice(0, 2).join(' | ');
    }).catch(() => '');
    if (scoreText) {
      console.log(`Score: ${scoreText}`);
    }
  }

  // Small delay before next quiz
  await new Promise((r) => setTimeout(r, 2000));
}

async function run() {
  console.log(`Automated Solver for Database Foundations – English - D3 July 2026 (Class ${CLASS_ID})`);
  console.log(`Found ${QUIZZES.length} section quizzes to solve.\n`);

  const { browser, context } = await oa.ensureBrowser();
  try {
    for (let i = 0; i < QUIZZES.length; i++) {
      const q = QUIZZES[i];
      try {
        await solveQuiz(context, q, i + 1, QUIZZES.length);
      } catch (err) {
        console.error(`Error solving ${q.name}:`, err.message);
        console.log(`Proceeding to next quiz...`);
      }
    }
    console.log(`\n======================================================`);
    console.log(`All ${QUIZZES.length} section quizzes have been processed!`);
  } finally {
    await oa.disconnect(browser);
    console.log(`Disconnected from browser session.`);
  }
}

run().catch((err) => {
  console.error('Fatal solver error:', err);
  process.exit(1);
});
