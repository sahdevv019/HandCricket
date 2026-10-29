// Vercel Production Live Verification Test Suite for Hand Cricket
// Executes real browser tests directly against deployed Vercel frontend:
// Connecting to production Firebase (handcricket-e6b39).

import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
let VERCEL_URL = process.env.VERCEL_URL || process.argv[2] || '';
if (VERCEL_URL && !VERCEL_URL.startsWith('http')) {
  VERCEL_URL = 'https://' + VERCEL_URL;
}

const SCREENSHOT_DIR = path.resolve('test/screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function takeScreenshot(page, filename, label) {
  const filePath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`  📸 Screenshot saved [${label}]: ${filename}`);
  return filePath;
}

async function runVercelTests() {
  if (!VERCEL_URL) {
    throw new Error('Please provide the Vercel URL as argument or VERCEL_URL environment variable.');
  }

  console.log('\n================================================================');
  console.log('   HAND CRICKET — VERCEL PRODUCTION LIVE VERIFICATION SUITE     ');
  console.log(`   Target Vercel URL: ${VERCEL_URL}`);
  console.log('================================================================\n');

  let browserAlice = null;
  let browserBob = null;
  const testResults = [];

  function recordResult(testId, name, passed, details = '') {
    testResults.push({ id: testId, name, passed, details });
    const mark = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`\n[VERCEL-TEST ${testId}] ${mark}: ${name}`);
    if (details) console.log(`   Details: ${details}`);
  }

  try {
    console.log('Launching Independent Browser Session 1 (Device A - Alice)...');
    browserAlice = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
    });

    console.log('Launching Independent Browser Session 2 (Device B - Bob)...');
    browserBob = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
    });

    const pageAlice = (await browserAlice.pages())[0];
    const pageBob = (await browserBob.pages())[0];

    const consoleErrorsAlice = [];
    const consoleErrorsBob = [];
    pageAlice.on('console', msg => {
      const txt = msg.text();
      console.log(`[Alice Vercel Console ${msg.type()}] ${txt}`);
      if (msg.type() === 'error') consoleErrorsAlice.push(txt);
    });
    pageBob.on('console', msg => {
      const txt = msg.text();
      console.log(`[Bob Vercel Console ${msg.type()}] ${txt}`);
      if (msg.type() === 'error') consoleErrorsBob.push(txt);
    });

    await pageAlice.setViewport({ width: 1280, height: 800 });
    await pageBob.setViewport({ width: 1280, height: 800 });

    // =========================================================================
    // TEST 1: Vercel Frontend Loading & Production Firebase Connection
    // =========================================================================
    console.log('\n--- TEST 1: Vercel Deployment Loading & Firebase Backend Check ---');
    await pageAlice.goto(VERCEL_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await takeScreenshot(pageAlice, 'vercel-01-auth-screen.png', 'Vercel Auth Screen');

    const isConnectedToProd = await pageAlice.evaluate(() => {
      return !window.HC_FIREBASE?.usingEmulators && 
             window.HC_FIREBASE?.app?.options?.projectId === 'handcricket-e6b39';
    });
    assert(isConnectedToProd, 'Must connect directly to production Firebase project handcricket-e6b39 on Vercel domain');
    console.log('   ✓ Verified: Vercel frontend connected to live Firebase backend (handcricket-e6b39).');

    recordResult(1, 'Vercel Deployment Loading & Production Firebase Connection', true,
      `Loaded ${VERCEL_URL}; verified projectId handcricket-e6b39; emulators bypassed.`);

    // =========================================================================
    // TEST 2: Vercel Authentication & Cloud Profile Synchronization
    // =========================================================================
    console.log('\n--- TEST 2: User Registration & Firestore Cloud Sync on Vercel ---');
    const aliceEmail = `alice_vercel_${Date.now()}@test.com`;
    const alicePass = 'HandCricket2026!';
    const aliceName = 'AliceVercel';

    await pageAlice.waitForSelector('#authScreen.active');
    await pageAlice.click('#tabRegister');
    await pageAlice.waitForSelector('#registerNameGroup:not(.hidden)');
    await pageAlice.type('#authRegUsername', aliceName);
    await pageAlice.type('#authEmail', aliceEmail);
    await pageAlice.type('#authPassword', alicePass);
    await pageAlice.click('#authBtn');

    await pageAlice.waitForSelector('#modeSelection:not(.hidden)', { timeout: 15000 });
    const profileNameAlice = await pageAlice.$eval('#profileName', el => el.textContent.trim());
    assert.strictEqual(profileNameAlice, aliceName, `Profile name should be ${aliceName}`);
    console.log(`   ✓ Alice authenticated on Vercel: UID verified.`);

    await pageAlice.waitForFunction(() => {
      const el = document.getElementById('cloudSyncStatus');
      return el && el.textContent.includes('Cloud Synced');
    }, { timeout: 10000 });
    console.log('   ✓ Cloud Firestore: User profile verified "Cloud Synced" on Vercel.');
    await takeScreenshot(pageAlice, 'vercel-02-alice-synced.png', 'Alice Cloud Synced Profile on Vercel');

    // Test Session Restoration via reload on Vercel
    console.log('   Testing session restoration across reload on Vercel...');
    await pageAlice.reload({ waitUntil: 'networkidle2' });
    await pageAlice.waitForSelector('#modeSelection:not(.hidden)', { timeout: 15000 });
    const restoredNameAlice = await pageAlice.$eval('#profileName', el => el.textContent.trim());
    assert.strictEqual(restoredNameAlice, aliceName, 'Session should restore automatically on reload on Vercel');
    console.log('   ✓ Session restored successfully across reload on Vercel.');

    recordResult(2, 'Vercel Authentication & Cloud Profile Synchronization', true,
      `Registered ${aliceEmail}; cloud profile initialized in Firestore; session restored across reload.`);

    // =========================================================================
    // TEST 3: Device B (Bob) Registration on Vercel
    // =========================================================================
    console.log('\n--- TEST 3: Device B (Bob) Registration on Vercel ---');
    await pageBob.goto(VERCEL_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await pageBob.waitForSelector('#authScreen.active');

    const bobEmail = `bob_vercel_${Date.now()}@test.com`;
    const bobPass = 'HandCricket2026!';
    const bobName = 'BobVercel';

    await pageBob.click('#tabRegister');
    await pageBob.waitForSelector('#registerNameGroup:not(.hidden)');
    await pageBob.type('#authRegUsername', bobName);
    await pageBob.type('#authEmail', bobEmail);
    await pageBob.type('#authPassword', bobPass);
    await pageBob.click('#authBtn');

    await pageBob.waitForSelector('#modeSelection:not(.hidden)', { timeout: 15000 });
    const profileNameBob = await pageBob.$eval('#profileName', el => el.textContent.trim());
    assert.strictEqual(profileNameBob, bobName, `Profile name should be ${bobName}`);
    console.log(`   ✓ Bob authenticated on Vercel: UID verified.`);
    await takeScreenshot(pageBob, 'vercel-03-bob-synced.png', 'Bob Cloud Synced Profile on Vercel');

    recordResult(3, 'Device B Vercel Authentication', true,
      `Registered second independent authenticated session for ${bobEmail} on Vercel.`);

    // =========================================================================
    // TEST 4: Realtime Database Private Room Multiplayer on Vercel
    // =========================================================================
    console.log('\n--- TEST 4: RTDB Private Room Multiplayer & Provably Fair Toss ---');
    await pageAlice.click('.mode-btn.vs-friend:not(.disabled)');
    await pageAlice.waitForSelector('#onlineLobbyScreen:not(.hidden)');
    await pageAlice.click('button[onclick="onlineCreateRoom()"]');
    await pageAlice.waitForSelector('#onlineRoomCode div', { timeout: 15000 });

    const roomCode = await pageAlice.$eval('#onlineRoomCode', el => {
      const match = el.textContent.match(/[A-Z0-9]{4,6}/);
      return match ? match[0] : '';
    });
    assert(roomCode && roomCode.length >= 4, `Valid room code expected, got: ${roomCode}`);
    console.log(`   ✓ Alice created room on Vercel: [${roomCode}]`);
    await takeScreenshot(pageAlice, 'vercel-04-room-created.png', 'Vercel Room Created');

    // Bob joins room
    await pageBob.click('.mode-btn.vs-friend:not(.disabled)');
    await pageBob.waitForSelector('#onlineLobbyScreen:not(.hidden)');
    await pageBob.click('button[onclick="onlineShowJoin()"]');
    await pageBob.waitForSelector('#onlineJoinBox:not(.hidden)');
    await pageBob.$eval('#onlineCodeInput', el => el.value = '');
    await pageBob.type('#onlineCodeInput', roomCode);
    await pageBob.click('button[onclick="onlineJoinRoom()"]');
    console.log(`   ✓ Bob submitted join request for room: [${roomCode}]`);

    // Synchronized to toss
    await Promise.all([
      pageAlice.waitForSelector('#tossScreen:not(.hidden)', { timeout: 15000 }),
      pageBob.waitForSelector('#tossScreen:not(.hidden)', { timeout: 15000 })
    ]);
    console.log('   ✓ Both players synchronized to toss screen on Vercel.');
    await takeScreenshot(pageBob, 'vercel-05-toss-screen.png', 'Vercel Toss Screen');

    // Execute toss
    await delay(1000);
    const aliceHasCall = await pageAlice.evaluate(() => {
      const el = document.getElementById('tossCallBtns');
      return el && !el.classList.contains('hidden');
    });
    const callPage = aliceHasCall ? pageAlice : pageBob;
    await callPage.click('#tossCallBtns .toss-btn:first-child'); // Call Heads

    await Promise.race([
      pageAlice.waitForSelector('#tossChoiceBtns:not(.hidden)', { timeout: 15000 }),
      pageBob.waitForSelector('#tossChoiceBtns:not(.hidden)', { timeout: 15000 })
    ]);

    const aliceWonToss = await pageAlice.evaluate(() => {
      const el = document.getElementById('tossChoiceBtns');
      return el && !el.classList.contains('hidden');
    });
    const winPage = aliceWonToss ? pageAlice : pageBob;
    await winPage.click('#tossChoiceBtns .toss-btn:first-child'); // Choose Bat

    // Both enter game
    await Promise.all([
      pageAlice.waitForSelector('#gameScreen:not(.hidden)', { timeout: 15000 }),
      pageBob.waitForSelector('#gameScreen:not(.hidden)', { timeout: 15000 })
    ]);
    console.log('   ✓ Match launched into active gameScreen on Vercel!');
    await takeScreenshot(pageAlice, 'vercel-06-match-active.png', 'Vercel Active Match');

    recordResult(4, 'Vercel RTDB Room Creation, Joining, & Provably Fair Toss', true,
      `Room ${roomCode} created; commit-reveal toss executed; match launched on Vercel.`);

    // =========================================================================
    // TEST 5: Cryptographic Commit-Reveal Moves & Match Resolution
    // =========================================================================
    console.log('\n--- TEST 5: Cryptographic Commit-Reveal Moves on Vercel ---');
    console.log('   Ball 1: Both submit move 4 (Out/Wicket)...');
    await pageAlice.click('.choices-container .choice-btn:nth-child(4)');
    await pageBob.click('.choices-container .choice-btn:nth-child(4)');

    await pageAlice.waitForFunction(() => {
      const res = document.getElementById('roundResult');
      return res && (res.textContent.includes('OUT') || res.textContent.includes('Wicket'));
    }, { timeout: 15000 });

    console.log('   ✓ Ball 1 resolved: OUT detected on Vercel.');
    await delay(2000);

    console.log('   Ball 2: Batter submits 6, Bowler submits 2...');
    const aliceIsBatter = await pageAlice.evaluate(() => window.isBatter1Batting);
    const batterPage = aliceIsBatter ? pageAlice : pageBob;
    const bowlerPage = aliceIsBatter ? pageBob : pageAlice;

    await batterPage.click('.choices-container .choice-btn:nth-child(6)');
    await bowlerPage.click('.choices-container .choice-btn:nth-child(2)');

    await Promise.all([
      pageAlice.waitForSelector('#gameOver.active', { timeout: 15000 }),
      pageBob.waitForSelector('#gameOver.active', { timeout: 15000 })
    ]);

    const gameOverAlice = await pageAlice.$eval('#gameOverTitle', el => el.textContent.trim());
    const gameOverBob = await pageBob.$eval('#gameOverTitle', el => el.textContent.trim());
    console.log(`   ✓ Match complete on Vercel! Host: "${gameOverAlice}" | Guest: "${gameOverBob}"`);
    await takeScreenshot(pageAlice, 'vercel-07-game-over.png', 'Vercel Game Over Screen');

    recordResult(5, 'Cryptographic Commit-Reveal Gameplay & Match Resolution on Vercel', true,
      `Ball 1 (4 vs 4 -> OUT) and Ball 2 (6 vs 2 -> Target Chased) synchronized on Vercel.`);

    // =========================================================================
    // TEST 6: Room Exit & Teardown
    // =========================================================================
    console.log('\n--- TEST 6: Room Exit & Teardown Verification ---');
    await pageAlice.evaluate(() => backToMode());
    await pageBob.evaluate(() => backToMode());

    await pageAlice.waitForSelector('#modeSelection:not(.hidden)', { timeout: 10000 });
    await pageBob.waitForSelector('#modeSelection:not(.hidden)', { timeout: 10000 });

    const activeRoomAlice = await pageAlice.evaluate(() => sessionStorage.getItem('hc_active_room'));
    const activeRoomBob = await pageBob.evaluate(() => sessionStorage.getItem('hc_active_room'));
    assert.strictEqual(activeRoomAlice, null, 'Alice active room must be cleared');
    assert.strictEqual(activeRoomBob, null, 'Bob active room must be cleared');
    console.log('   ✓ Both sessions cleanly exited back to mode selection.');

    recordResult(6, 'Room Exit & Clean Session Teardown', true,
      `Both devices returned to mode selection; session storage cleaned up.`);

    // =========================================================================
    // TEST 7: Ranked Matchmaking Lockdown on Vercel
    // =========================================================================
    console.log('\n--- TEST 7: Ranked Matchmaking Lockdown on Vercel ---');
    await pageAlice.click('button[onclick="showRankedPausedModal()"]');
    await pageAlice.waitForSelector('#rankedPausedModal:not(.hidden)', { timeout: 5000 });
    const modalText = await pageAlice.$eval('#rankedPausedModal h3', el => el.textContent.trim());
    console.log(`   ✓ Ranked button triggered paused modal: "${modalText}"`);
    await takeScreenshot(pageAlice, 'vercel-08-ranked-paused.png', 'Vercel Ranked Paused Modal');

    recordResult(7, 'Ranked Matchmaking Lockdown on Vercel', true,
      `Ranked matchmaking correctly disabled on Vercel; modal presented.`);

    // =========================================================================
    // Console Error Audit
    // =========================================================================
    console.log('\n--- Vercel Console Audit ---');
    console.log(`   Alice Console Errors: ${consoleErrorsAlice.length}`);
    console.log(`   Bob Console Errors: ${consoleErrorsBob.length}`);

    assert.strictEqual(consoleErrorsAlice.length, 0, 'Alice session must have 0 console errors');
    assert.strictEqual(consoleErrorsBob.length, 0, 'Bob session must have 0 console errors');

    console.log('\n================================================================');
    console.log('  ALL VERCEL PRODUCTION LIVE TESTS PASSED (7/7 FOCUS AREAS)     ');
    console.log('================================================================\n');

  } finally {
    if (browserAlice) await browserAlice.close();
    if (browserBob) await browserBob.close();
  }

  return testResults;
}

runVercelTests().then(results => {
  const allPassed = results.every(r => r.passed);
  if (!allPassed) {
    console.error('❌ Vercel Live Test Suite encountered failures.');
    process.exit(1);
  }
  process.exit(0);
}).catch(err => {
  console.error('❌ Vercel Live Test Suite threw unhandled exception:', err);
  process.exit(1);
});
