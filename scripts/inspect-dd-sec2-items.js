'use strict';
const oa = require('../src');

async function main() {
  const { browser, context } = await oa.ensureBrowser();
  try {
    const { items } = await oa.listItems(context, '60373', '19');
    console.log(`Section 2 items (${items.length}):`);
    items.forEach((it, idx) => {
      console.log(`[${idx + 1}] [${it.status || 'Active'}] ${it.type} (P15_ID=${it.p15Id}): ${it.name}`);
    });
  } finally {
    await oa.disconnect(browser);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
