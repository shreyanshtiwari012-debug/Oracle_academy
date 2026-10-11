'use strict';
const oa = require('../src');

async function main() {
  const { browser, context } = await oa.ensureBrowser();
  try {
    const { classes } = await oa.listClasses(context);
    console.log('Available Classes:');
    classes.forEach(c => {
      console.log(`- ${c.name} | classCourseId: ${c.classCourseId} | courseId: ${c.courseId} | meta: ${c.meta}`);
    });
  } finally {
    await oa.disconnect(browser);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
