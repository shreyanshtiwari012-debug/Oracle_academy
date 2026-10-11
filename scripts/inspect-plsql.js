'use strict';

const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envPath);
}

const oa = require('../src');
const CLASS_ID = '60559'; // PLSQL class

async function inspect() {
  const { browser, context } = await oa.ensureBrowser();
  try {
    const { cls, sections } = await oa.listSections(context, CLASS_ID);
    console.log(`Class: ${cls.name} (${cls.classCourseId})`);
    console.log(`Sections (${sections.length}):`);

    const fullReport = [];

    for (const section of sections) {
      console.log(`\nChecking Section: ${section.name} (P15_ID=${section.p15Id})`);
      try {
        const { items } = await oa.listItems(context, CLASS_ID, section.p15Id);
        const sectionData = {
          sectionName: section.name,
          p15Id: section.p15Id,
          items: items.map(it => ({
            name: it.name,
            type: it.type,
            status: it.status,
            p15Id: it.p15Id,
            url: it.url
          }))
        };
        fullReport.push(sectionData);

        for (const it of items) {
          const mark = it.status === 'Completed' ? '✓' : (it.status || '?');
          console.log(`  [${mark}] ${it.type.padEnd(8)} (P15_ID=${it.p15Id}) ${it.name}`);
        }
      } catch (err) {
        console.error(`  Error reading items for ${section.name}:`, err.message);
      }
    }

    fs.writeFileSync(path.resolve(__dirname, 'plsql-status.json'), JSON.stringify(fullReport, null, 2));
    console.log('\nWrote status to scripts/plsql-status.json');
  } finally {
    await oa.disconnect(browser);
  }
}

inspect().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
