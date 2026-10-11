'use strict';

const fs = require('fs');
const path = require('path');

// Load .env if present
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath);
  } catch (e) {
    // manual fallback parse
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

const CLASS_ID = process.argv[2] || '60560';
const START_SECTION = process.argv[3] || '816'; // Section 3

async function run() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('ERROR: No GEMINI_API_KEY or OPENAI_API_KEY found in .env');
    console.error('Please add your key to .env first.');
    process.exit(1);
  }

  const provider = process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY ? 'openai' : 'gemini';
  console.log(`Starting automated quiz solver for Class ${CLASS_ID}...`);
  console.log(`Using LLM provider: ${provider}`);

  const { browser, context } = await oa.ensureBrowser();
  try {
    const { cls, sections } = await oa.listSections(context, CLASS_ID);
    console.log(`Class: ${cls.name}`);
    console.log(`Total sections: ${sections.length}`);

    // Filter starting from START_SECTION
    let startIndex = sections.findIndex(s => String(s.p15Id) === String(START_SECTION));
    if (startIndex === -1) {
      console.log(`Start section ${START_SECTION} not found; checking from beginning.`);
      startIndex = 0;
    }

    const targetSections = sections.slice(startIndex);
    console.log(`Processing ${targetSections.length} section(s) starting from ${targetSections[0].name} (P15_ID=${targetSections[0].p15Id})\n`);

    for (const section of targetSections) {
      console.log(`====================================================`);
      console.log(`Checking Section: ${section.name} (P15_ID=${section.p15Id})`);

      let items;
      try {
        const res = await oa.listItems(context, CLASS_ID, section.p15Id);
        items = res.items;
      } catch (err) {
        console.error(`Failed to list items for section ${section.p15Id}: ${err.message}`);
        continue;
      }

      const quizzes = items.filter(it => (it.type === 'quiz' || it.type === 'exam') && !/review/i.test(it.name));
      if (quizzes.length === 0) {
        console.log(`[No Quiz/Exam] in this section. Moving to next section.\n`);
        continue;
      }

      for (const quiz of quizzes) {
        console.log(`\nFound Assessment: ${quiz.name} (item=${quiz.p15Id}, status=${quiz.status || 'Unknown'})`);

        if (quiz.status === 'Completed') {
          console.log(`Quiz "${quiz.name}" is already Completed. Skipping.`);
          continue;
        }

        try {
          let appPage = oa.findAppPage(context);
          const alreadyOnQuiz = appPage && oa.isAssessmentPage(appPage) && appPage.url().includes(String(quiz.p15Id));

          if (!alreadyOnQuiz) {
            console.log(`Starting assessment: ${quiz.name}...`);
            appPage = await oa.startAssessment(context, quiz.url);
          } else {
            console.log(`Already on assessment page for ${quiz.name}. Resuming...`);
          }

          console.log(`Assessment page: ${appPage.url().split('&cs=')[0]}`);
          console.log(`Answering questions automatically...`);
          const res = await oa.runQuiz(context, {
            provider,
            model: process.env.ORACLE_QUIZ_GEMINI_MODEL || 'gemini-3.5-flash',
            delayMs: 800,
            onProgress: (r) => {
              console.log(`  [Q${r.sequence}] Answer: ${r.letters.join('+')} | ${r.question.slice(0, 70)}...`);
            }
          });

          console.log(`Assessment completed! Final page: ${res.url.split('&cs=')[0]}`);

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
        } catch (err) {
          console.error(`Error solving quiz ${quiz.name}:`, err);
          throw err; // Stop on unexpected error rather than silently skipping
        }
      }
      console.log(`\nCompleted processing for ${section.name}.\n`);
    }

    console.log('All targeted sections processed successfully!');
  } finally {
    await oa.disconnect(browser);
  }
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
