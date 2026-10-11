'use strict';

const assert = require('assert');
const crypto = require('crypto');
const oa = require('../src');
const db = require('../src/default-browser');

assert.strictEqual(typeof oa.launch, 'function');
assert.strictEqual(typeof oa.login, 'function');
assert.strictEqual(typeof oa.dumpPage, 'function');

assert.ok(oa.isSignonUrl('https://signon.oracle.com/signin'));
assert.ok(oa.isSignonUrl('https://idcs-abc.identity.oraclecloud.com/ui/v1/signin'));
assert.ok(!oa.isSignonUrl('https://academy.oracle.com/pls/f?p=62000'));

assert.ok(oa.isAcademyUrl('https://academy.oracle.com/pls/f?p=62000'));
assert.ok(!oa.isAcademyUrl('https://signon.oracle.com/signin'));

assert.match(oa.HUB_URL, /academy\.oracle\.com/);
assert.match(oa.STUDENT_HUB_URL, /p=63000/);
assert.match(oa.MEMBER_HUB_URL, /p=62000/);

// Chromium cookie decryption round-trip (v10 + sha256(host) prefix).
{
  const key = crypto.randomBytes(16);
  const host = 'academy.oracle.com';
  const plain = 'SESSION12345';
  const prefix = crypto.createHash('sha256').update(host).digest();
  const cipher = crypto.createCipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '));
  const ct = Buffer.concat([cipher.update(Buffer.concat([prefix, Buffer.from(plain)])), cipher.final()]);
  const enc = Buffer.concat([Buffer.from('v10'), ct]).toString('hex');
  assert.strictEqual(db.decryptChromiumValue(enc, host, key), plain);
  assert.strictEqual(db.decryptChromiumValue('', host, key), '');
}

assert.strictEqual(db.chromeTimeToUnix('13348540800000000'), 1704067200);
assert.strictEqual(db.chromeTimeToUnix(0), -1);
assert.strictEqual(db.firefoxTimeToUnix(1791284490916), 1791284490);
assert.strictEqual(db.firefoxTimeToUnix(1791284490), 1791284490);
assert.strictEqual(db.firefoxTimeToUnix(0), -1);
assert.strictEqual(db.sameSiteFromChromium(0), 'None');
assert.strictEqual(db.sameSiteFromChromium(1), 'Lax');
assert.strictEqual(db.sameSiteFromChromium(2), 'Strict');
assert.strictEqual(db.sameSiteFromChromium(-1), undefined);

// Imported cookie expirations must use Playwright's accepted Unix-seconds
// format, and expired or malformed entries must not be revived as session cookies.
const cookieExpiryTest = (async () => {
  let addedCookies;
  const context = {
    async addCookies(cookies) {
      addedCookies = cookies;
    }
  };
  const count = await db.importCookies(context, [
    { name: 'expired', value: 'x', domain: '.oracle.com', expires: -2 },
    { name: 'session', value: 'x', domain: '.oracle.com', expires: 0 },
    { name: 'invalid', value: 'x', domain: '.oracle.com', expires: NaN },
    { name: 'persistent', value: 'x', domain: '.oracle.com', expires: 1700000000.9 },
    { name: 'session-default', value: 'x', domain: '.oracle.com' }
  ]);
  assert.strictEqual(count, 3);
  assert.deepStrictEqual(
    addedCookies.map((cookie) => cookie.expires),
    [-1, 1700000000, -1]
  );

  let currentUrl = 'https://academy.oracle.com/pls/f?p=63000:1:1234567890';
  const page = {
    url: () => currentUrl,
    getByRole: () => ({ count: async () => 0 }),
    async waitForTimeout() {
      currentUrl = 'https://signon.oracle.com/signin';
    }
  };
  const result = await oa.waitForSignIn(page, { timeoutMs: 25 });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.url, 'https://signon.oracle.com/signin');
})();

// Chromium cookie DB lives under <profile>/Network/Cookies on modern builds and
// <profile>/Cookies on older ones; profileDirs must find both.
{
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-profile-'));
  try {
    fs.mkdirSync(path.join(root, 'Default', 'Network'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Default', 'Network', 'Cookies'), '');
    fs.mkdirSync(path.join(root, 'Profile 1'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Profile 1', 'Cookies'), '');
    fs.mkdirSync(path.join(root, 'Guest Profile'), { recursive: true });

    const browser = { kind: 'chromium', dataDir: root };
    assert.deepStrictEqual(db.profileDirs(browser).sort(), ['Default', 'Profile 1']);
    assert.match(
      db.chromiumCookieFile(root, 'Default'),
      /[\\/]Network[\\/]Cookies$/
    );
    assert.match(db.chromiumCookieFile(root, 'Profile 1'), /[\\/]Cookies$/);
    assert.strictEqual(db.chromiumCookieFile(root, 'Guest Profile'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

cookieExpiryTest
  .then(() => console.log('smoke: ok'))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
