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

const CLASS_ID = '60560';
const SECTION_ID = '795'; // Section 2
const QUIZ_ITEM_ID = '7756'; // Quiz: DP - Section 2

async function run() {
  console.log(`Starting automated solver for Section 2 Quiz (item=${QUIZ_ITEM_ID})...`);

  const { browser, context } = await oa.ensureBrowser();
  try {
    const item = await oa.findItemUrl(context, CLASS_ID, SECTION_ID, QUIZ_ITEM_ID);
    console.log(`Found quiz: ${item.name} (${item.url.split('&cs=')[0]})`);

    console.log(`Opening assessment...`);
    const appPage = await oa.startAssessment(context, item.url);
    console.log(`Assessment page: ${appPage.url().split('&cs=')[0]}`);

    console.log(`Answering questions automatically...`);
    const res = await oa.runQuiz(context, {
      provider: 'gemini',
      model: process.env.ORACLE_QUIZ_GEMINI_MODEL || 'gemini-3.5-flash',
      delayMs: 800,
      onProgress: (r) => {
        console.log(`  [Q${r.sequence}] Answer: ${r.letters.join('+')} | ${r.question.slice(0, 70)}...`);
      }
    });

    console.log(`\nSection 2 Assessment completed!`);

    // Read score if on Score Summary page
    const page = oa.findAppPage(context);
    if (page) {
      const scoreText = await page.evaluate(() => {
        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
        return [...document.querySelectorAll('h1,h2,h3,h4,p,span,div')]
          .map(x => clean(x.textContent))
          .filter(x => /PERCENTAGE SCORED|Mastery Score/i.test(x))[0] || '';
      }).catch(() => '');
      if (scoreText) {
        console.log(`Result: ${scoreText}`);
      }
    }
  } finally {
    await oa.disconnect(browser);
    console.log(`Finished Section 2 quiz and stopped as requested.`);
  }
}

run().catch((err) => {
  console.error('Error solving Section 2 quiz:', err);
  process.exit(1);
});
