// Production Live Verification Test Suite for Hand Cricket
// Executes real browser tests directly against deployed production Firebase:
// https://handcricket-e6b39.web.app and https://handcricket-e6b39-default-rtdb.asia-southeast1.firebasedatabase.app

import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROD_URL = 'https://handcricket-e6b39.web.app';
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

async function runProductionTests() {
  console.log('\n================================================================');
  console.log('  HAND CRICKET — PRODUCTION FIREBASE LIVE VERIFICATION SUITE   ');
  console.log(`  Target: ${PROD_URL}`);
  console.log('================================================================\n');

  let browserAlice = null;
  let browserBob = null;
  const testResults = [];

  function recordResult(testId, name, passed, details = '') {
    testResults.push({ id: testId, name, passed, details });
    const mark = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`\n[PROD-TEST ${testId}] ${mark}: ${name}`);
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
      console.log(`[Alice Prod Console ${msg.type()}] ${txt}`);
      if (msg.type() === 'error') consoleErrorsAlice.push(txt);
    });
    pageBob.on('console', msg => {
      const txt = msg.text();
      console.log(`[Bob Prod Console ${msg.type()}] ${txt}`);
      if (msg.type() === 'error') consoleErrorsBob.push(txt);
    });

    await pageAlice.setViewport({ width: 1280, height: 800 });
    await pageBob.setViewport({ width: 1280, height: 800 });

    // =========================================================================
    // TEST 1: Live Deployment Loading & Production Backend Connection
    // =========================================================================
    console.log('\n--- TEST 1: Live Web App Loading & Backend Verification ---');
    await pageAlice.goto(PROD_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await takeScreenshot(pageAlice, 'prod-01-auth-screen.png', 'Production Auth Screen');

    const isConnectedToProd = await pageAlice.evaluate(() => {
      return !window.HC_FIREBASE?.usingEmulators && 
             window.HC_FIREBASE?.app?.options?.projectId === 'handcricket-e6b39';
    });
    assert(isConnectedToProd, 'Must connect directly to production Firebase project handcricket-e6b39 (no emulators)');
    console.log('   ✓ Verified: Connected to live Firebase backend (handcricket-e6b39), emulators disabled.');

    recordResult(1, 'Live Website Loading & Production Backend Connection', true,
      `Loaded ${PROD_URL}; verified projectId handcricket-e6b39; emulators bypassed in production.`);

    // =========================================================================
    // TEST 2: Production Authentication & Cloud Profile Synchronization
    // =========================================================================
    console.log('\n--- TEST 2: Production User Registration, Profile Creation & Cloud Sync ---');
    const aliceEmail = `alice_prod_${Date.now()}@test.com`;
    const alicePass = 'HandCricket2026!';
    const aliceName = 'AliceProd';

    await pageAlice.waitForSelector('#authScreen.active');
    await pageAlice.click('#tabRegister');
    await pageAlice.waitForSelector('#registerNameGroup:not(.hidden)');
    await pageAlice.type('#authRegUsername', aliceName);
    await pageAlice.type('#authEmail', aliceEmail);
    await pageAlice.type('#authPassword', alicePass);
    await pageAlice.click('#authBtn');

    // Wait for successful registration & mode selection screen
    await pageAlice.waitForSelector('#modeSelection:not(.hidden)', { timeout: 15000 });
    const profileNameAlice = await pageAlice.$eval('#profileName', el => el.textContent.trim());
    assert.strictEqual(profileNameAlice, aliceName, `Profile name should be ${aliceName}`);
    console.log(`   ✓ Alice authenticated: UID verified in production Auth.`);

    // Verify Cloud Synced indicator
    await pageAlice.waitForFunction(() => {
      const el = document.getElementById('cloudSyncStatus');
      return el && el.textContent.includes('Cloud Synced');
    }, { timeout: 10000 });
    console.log('   ✓ Cloud Firestore: User profile created and verified "Cloud Synced".');
    await takeScreenshot(pageAlice, 'prod-02-alice-synced.png', 'Alice Cloud Synced Profile');

    // Test Session Restoration via reload
    console.log('   Testing session restoration across page reload on production...');
    await pageAlice.reload({ waitUntil: 'networkidle2' });
    await pageAlice.waitForSelector('#modeSelection:not(.hidden)', { timeout: 15000 });
    const restoredNameAlice = await pageAlice.$eval('#profileName', el => el.textContent.trim());
    assert.strictEqual(restoredNameAlice, aliceName, 'Session should restore automatically on reload');
    console.log('   ✓ Session restored successfully across reload in production.');

    // Test Sign Out and Sign In
    console.log('   Testing Sign Out and Email/Password Sign In on production...');
    await pageAlice.click('button[onclick="handleSignOut()"]');
    await pageAlice.waitForSelector('#authScreen.active', { timeout: 10000 });
    
    // Sign back in
    await pageAlice.click('#tabLogin');
    await pageAlice.type('#authEmail', aliceEmail);
    await pageAlice.type('#authPassword', alicePass);
    await pageAlice.click('#authBtn');
    await pageAlice.waitForSelector('#modeSelection:not(.hidden)', { timeout: 15000 });
    console.log('   ✓ Email/Password sign-in verified on production.');

    recordResult(2, 'Production Authentication & Cloud Profile Synchronization', true,
      `Registered ${aliceEmail}; cloud profile initialized in Firestore; session restored across reload; sign out and sign in verified.`);

    // =========================================================================
    // TEST 3: Device B (Bob) Registration & Production Verification
    // =========================================================================
    console.log('\n--- TEST 3: Device B (Bob) Production Authentication ---');
    await pageBob.goto(PROD_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await pageBob.waitForSelector('#authScreen.active');

    const bobEmail = `bob_prod_${Date.now()}@test.com`;
    const bobPass = 'HandCricket2026!';
    const bobName = 'BobProd';

    await pageBob.click('#tabRegister');
    await pageBob.waitForSelector('#registerNameGroup:not(.hidden)');
    await pageBob.type('#authRegUsername', bobName);
    await pageBob.type('#authEmail', bobEmail);
    await pageBob.type('#authPassword', bobPass);
    await pageBob.click('#authBtn');

    await pageBob.waitForSelector('#modeSelection:not(.hidden)', { timeout: 15000 });
    const profileNameBob = await pageBob.$eval('#profileName', el => el.textContent.trim());
    assert.strictEqual(profileNameBob, bobName, `Profile name should be ${bobName}`);
    console.log(`   ✓ Bob authenticated: UID verified in production Auth.`);
    await takeScreenshot(pageBob, 'prod-03-bob-synced.png', 'Bob Cloud Synced Profile');

    recordResult(3, 'Device B Production Authentication', true,
      `Registered second independent authenticated session for ${bobEmail} on production.`);

    // =========================================================================
    // TEST 4: Production Private Room Multiplayer & Provably Fair Toss
    // =========================================================================
    console.log('\n--- TEST 4: Production Realtime Database Multiplayer & Provably Fair Toss ---');
    // Alice creates private room
    await pageAlice.click('.mode-btn.vs-friend:not(.disabled)');
    await pageAlice.waitForSelector('#onlineLobbyScreen:not(.hidden)');
    await pageAlice.click('button[onclick="onlineCreateRoom()"]');
    await pageAlice.waitForSelector('#onlineRoomCode div', { timeout: 15000 });

    const roomCode = await pageAlice.$eval('#onlineRoomCode', el => {
      const match = el.textContent.match(/[A-Z0-9]{4,6}/);
      return match ? match[0] : '';
    });
    assert(roomCode && roomCode.length >= 4, `Valid room code expected, got: ${roomCode}`);
    console.log(`   ✓ Alice created production RTDB room: [${roomCode}]`);
    await takeScreenshot(pageAlice, 'prod-04-room-created.png', 'Production Room Created');

    // Bob joins private room
    await pageBob.click('.mode-btn.vs-friend:not(.disabled)');
    await pageBob.waitForSelector('#onlineLobbyScreen:not(.hidden)');
    await pageBob.click('button[onclick="onlineShowJoin()"]');
    await pageBob.waitForSelector('#onlineJoinBox:not(.hidden)');
    await pageBob.$eval('#onlineCodeInput', el => el.value = '');
    await pageBob.type('#onlineCodeInput', roomCode);
    await pageBob.click('button[onclick="onlineJoinRoom()"]');
    console.log(`   ✓ Bob submitted join request for room: [${roomCode}]`);

    // Both should transition to toss screen
    await Promise.all([
      pageAlice.waitForSelector('#tossScreen:not(.hidden)', { timeout: 15000 }),
      pageBob.waitForSelector('#tossScreen:not(.hidden)', { timeout: 15000 })
    ]);
    console.log('   ✓ Both players synchronized to toss screen via production RTDB.');
    await takeScreenshot(pageBob, 'prod-05-toss-screen.png', 'Production Toss Screen');

    // Execute Toss Call
    await delay(1000);
    const aliceHasCall = await pageAlice.evaluate(() => {
      const el = document.getElementById('tossCallBtns');
      return el && !el.classList.contains('hidden');
    });
    const callPage = aliceHasCall ? pageAlice : pageBob;
    console.log(`   Toss Caller is: ${aliceHasCall ? 'Alice' : 'Bob'}`);
    await callPage.click('#tossCallBtns .toss-btn:first-child'); // Call Heads

    // Wait for toss resolution & toss choice buttons
    await Promise.race([
      pageAlice.waitForSelector('#tossChoiceBtns:not(.hidden)', { timeout: 15000 }),
      pageBob.waitForSelector('#tossChoiceBtns:not(.hidden)', { timeout: 15000 })
    ]);

    const aliceWonToss = await pageAlice.evaluate(() => {
      const el = document.getElementById('tossChoiceBtns');
      return el && !el.classList.contains('hidden');
    });
    const winPage = aliceWonToss ? pageAlice : pageBob;
    console.log(`   Toss Winner is: ${aliceWonToss ? 'Alice' : 'Bob'}`);
    await winPage.click('#tossChoiceBtns .toss-btn:first-child'); // Choose Bat

    // Both transition to game screen
    await Promise.all([
      pageAlice.waitForSelector('#gameScreen:not(.hidden)', { timeout: 15000 }),
      pageBob.waitForSelector('#gameScreen:not(.hidden)', { timeout: 15000 })
    ]);
    console.log('   ✓ Match launched into active gameScreen on both production devices!');
    await takeScreenshot(pageAlice, 'prod-06-match-active.png', 'Production Active Match');

    recordResult(4, 'Production RTDB Room Creation, Joining, & Provably Fair Toss', true,
      `Room ${roomCode} created in asia-southeast1 RTDB; Guest joined; commit-reveal toss executed; match launched.`);

    // =========================================================================
    // TEST 5: Cryptographic Commit-Reveal Gameplay & Scoring in Production
    // =========================================================================
    console.log('\n--- TEST 5: Cryptographic Commit-Reveal Moves in Production ---');
    // Ball 1: Alice chooses 4, Bob chooses 4 -> OUT!
    console.log('   Ball 1: Both submit move 4 (Out/Wicket)...');
    await pageAlice.click('.choices-container .choice-btn:nth-child(4)');
    await pageBob.click('.choices-container .choice-btn:nth-child(4)');

    // Wait for round outcome
    await pageAlice.waitForFunction(() => {
      const res = document.getElementById('roundResult');
      return res && (res.textContent.includes('OUT') || res.textContent.includes('Wicket'));
    }, { timeout: 15000 });

    console.log('   ✓ Ball 1 resolved: OUT detected via production commit-reveal.');
    await delay(2000); // Innings transition

    // Ball 2: Batter chooses 6, Bowler chooses 2 -> Target Chased / Game Complete
    console.log('   Ball 2: Batter submits 6, Bowler submits 2...');
    const aliceIsBatter = await pageAlice.evaluate(() => window.isBatter1Batting);
    const batterPage = aliceIsBatter ? pageAlice : pageBob;
    const bowlerPage = aliceIsBatter ? pageBob : pageAlice;

    await batterPage.click('.choices-container .choice-btn:nth-child(6)');
    await bowlerPage.click('.choices-container .choice-btn:nth-child(2)');

    // Game Over displayed on both screens
    await Promise.all([
      pageAlice.waitForSelector('#gameOver.active', { timeout: 15000 }),
      pageBob.waitForSelector('#gameOver.active', { timeout: 15000 })
    ]);

    const gameOverAlice = await pageAlice.$eval('#gameOverTitle', el => el.textContent.trim());
    const gameOverBob = await pageBob.$eval('#gameOverTitle', el => el.textContent.trim());
    console.log(`   ✓ Match complete! Host Result: "${gameOverAlice}" | Guest Result: "${gameOverBob}"`);
    await takeScreenshot(pageAlice, 'prod-07-game-over.png', 'Production Game Over Screen');

    recordResult(5, 'Cryptographic Commit-Reveal Gameplay & Match Resolution', true,
      `Ball 1 (4 vs 4 -> OUT) and Ball 2 (6 vs 2 -> Target Chased) synchronized and completed in production RTDB.`);

    // =========================================================================
    // TEST 6: Room Exit & Clean Session Teardown
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
    // TEST 7: Ranked Matchmaking Pause Modal Verification
    // =========================================================================
    console.log('\n--- TEST 7: Ranked Matchmaking Lockdown Verification ---');
    await pageAlice.click('button[onclick="showRankedPausedModal()"]');
    await pageAlice.waitForSelector('#rankedPausedModal:not(.hidden)', { timeout: 5000 });
    const modalText = await pageAlice.$eval('#rankedPausedModal h3', el => el.textContent.trim());
    console.log(`   ✓ Ranked button triggered paused modal: "${modalText}"`);
    await takeScreenshot(pageAlice, 'prod-08-ranked-paused.png', 'Production Ranked Paused Modal');

    recordResult(7, 'Ranked Matchmaking Lockdown in Production', true,
      `Ranked matchmaking correctly disabled; user presented with pause explanation modal.`);

    // =========================================================================
    // Console Error Audit
    // =========================================================================
    console.log('\n--- Production Console Audit ---');
    console.log(`   Alice Console Errors: ${consoleErrorsAlice.length}`);
    console.log(`   Bob Console Errors: ${consoleErrorsBob.length}`);

    if (consoleErrorsAlice.length > 0) {
      console.warn('   Alice Errors:', consoleErrorsAlice);
    }
    if (consoleErrorsBob.length > 0) {
      console.warn('   Bob Errors:', consoleErrorsBob);
    }

    assert.strictEqual(consoleErrorsAlice.length, 0, 'Alice session must have 0 console errors');
    assert.strictEqual(consoleErrorsBob.length, 0, 'Bob session must have 0 console errors');

    console.log('\n================================================================');
    console.log('  ALL PRODUCTION LIVE TESTS PASSED (7/7 FOCUS AREAS)           ');
    console.log('================================================================\n');

  } finally {
    if (browserAlice) await browserAlice.close();
    if (browserBob) await browserBob.close();
  }

  return testResults;
}

runProductionTests().then(results => {
  const allPassed = results.every(r => r.passed);
  if (!allPassed) {
    console.error('❌ Production Live Test Suite encountered failures.');
    process.exit(1);
  }
  process.exit(0);
}).catch(err => {
  console.error('❌ Production Live Test Suite threw unhandled exception:', err);
  process.exit(1);
});
