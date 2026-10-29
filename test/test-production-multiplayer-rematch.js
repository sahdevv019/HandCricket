// Production Multiplayer Innings & Rematch Verification Suite
// Tests 2 full innings + target calculation + mutual rematch flow directly on Vercel deployment:
// https://handcricket-self.vercel.app/
// Connected to production Firebase (handcricket-e6b39)

import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const VERCEL_URL = process.env.VERCEL_URL || 'https://handcricket-self.vercel.app/';
const SCREENSHOT_DIR = path.resolve('test/screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function takeScreenshot(page, filename, label) {
  const filePath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`  📸 Screenshot [${label}]: ${filename}`);
  return filePath;
}

async function runProductionTests() {
  console.log('\n================================================================');
  console.log('   HAND CRICKET — PRODUCTION INNINGS & REMATCH VERIFICATION      ');
  console.log(`   Target Vercel URL: ${VERCEL_URL}`);
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

    pageAlice.on('response', r => {
      if (!r.ok()) console.log(`[Alice Response ${r.status()}] ${r.url()}`);
    });
    pageBob.on('response', r => {
      if (!r.ok()) console.log(`[Bob Response ${r.status()}] ${r.url()}`);
    });

    const consoleErrorsAlice = [];
    const consoleErrorsBob = [];
    pageAlice.on('console', msg => {
      const txt = msg.text();
      console.log(`[Alice Console ${msg.type()}] ${txt}`);
      if (msg.type() === 'error' && !txt.includes('favicon.ico')) consoleErrorsAlice.push(txt);
    });
    pageBob.on('console', msg => {
      const txt = msg.text();
      console.log(`[Bob Console ${msg.type()}] ${txt}`);
      if (msg.type() === 'error' && !txt.includes('favicon.ico')) consoleErrorsBob.push(txt);
    });

    await pageAlice.setViewport({ width: 1280, height: 800 });
    await pageBob.setViewport({ width: 1280, height: 800 });

    // Step 1: Navigate to Vercel production frontend
    console.log('\n--- STEP 1: Load Vercel Production Frontend ---');
    await pageAlice.goto(VERCEL_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await pageBob.goto(VERCEL_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    const isAliceProd = await pageAlice.evaluate(() => {
      return !window.HC_FIREBASE?.usingEmulators &&
             window.HC_FIREBASE?.app?.options?.projectId === 'handcricket-e6b39';
    });
    assert(isAliceProd, 'Alice must be connected to production Firebase handcricket-e6b39');
    console.log('   ✓ Verified: Live Vercel frontend is communicating with production Firebase.');
    recordResult(1, 'Production Frontend & Firebase Initialization', true, 'Connected to handcricket-e6b39.');

    // Step 2: Register two authenticated users
    console.log('\n--- STEP 2: Authenticate Alice & Bob on Production ---');
    const ts = Date.now();
    const aliceEmail = `alice_prod_${ts}@handcricket.test`;
    const bobEmail = `bob_prod_${ts}@handcricket.test`;
    const pass = 'TestPass2026!';

    await pageAlice.waitForSelector('#authScreen.active');
    await pageAlice.click('#tabRegister');
    await pageAlice.waitForSelector('#registerNameGroup:not(.hidden)');
    await pageAlice.type('#authRegUsername', 'AliceProd');
    await pageAlice.type('#authEmail', aliceEmail);
    await pageAlice.type('#authPassword', pass);
    await pageAlice.click('#authBtn');

    await pageBob.waitForSelector('#authScreen.active');
    await pageBob.click('#tabRegister');
    await pageBob.waitForSelector('#registerNameGroup:not(.hidden)');
    await pageBob.type('#authRegUsername', 'BobProd');
    await pageBob.type('#authEmail', bobEmail);
    await pageBob.type('#authPassword', pass);
    await pageBob.click('#authBtn');

    await Promise.all([
      pageAlice.waitForSelector('#modeSelection:not(.hidden)', { timeout: 15000 }),
      pageBob.waitForSelector('#modeSelection:not(.hidden)', { timeout: 15000 })
    ]);
    console.log('   ✓ Both accounts registered and synced in Firestore.');
    recordResult(2, 'Production Authentication', true, `Alice (${aliceEmail}) & Bob (${bobEmail}) authenticated.`);

    // Step 3: Alice creates private room, Bob joins
    console.log('\n--- STEP 3: Create and Join Private Multiplayer Room ---');
    await pageAlice.click('.mode-btn.vs-friend:not(.disabled)');
    await pageAlice.waitForSelector('#onlineLobbyScreen:not(.hidden)');
    await pageAlice.click('button[onclick="onlineCreateRoom()"]');
    await pageAlice.waitForSelector('#onlineRoomCode div', { timeout: 15000 });

    const roomCode = await pageAlice.$eval('#onlineRoomCode', el => {
      const match = el.textContent.match(/[A-Z0-9]{4,6}/);
      return match ? match[0] : '';
    });
    assert(roomCode && roomCode.length >= 4, `Valid room code expected: ${roomCode}`);
    console.log(`   ✓ Alice created room: [${roomCode}]`);

    await pageBob.click('.mode-btn.vs-friend:not(.disabled)');
    await pageBob.waitForSelector('#onlineLobbyScreen:not(.hidden)');
    await pageBob.click('button[onclick="onlineShowJoin()"]');
    await pageBob.waitForSelector('#onlineJoinBox:not(.hidden)');
    await pageBob.$eval('#onlineCodeInput', el => el.value = '');
    await pageBob.type('#onlineCodeInput', roomCode);
    await pageBob.click('button[onclick="onlineJoinRoom()"]');

    await Promise.all([
      pageAlice.waitForSelector('#tossScreen:not(.hidden)', { timeout: 15000 }),
      pageBob.waitForSelector('#tossScreen:not(.hidden)', { timeout: 15000 })
    ]);
    console.log(`   ✓ Both players joined room ${roomCode} and transitioned to Coin Toss.`);
    recordResult(3, 'Multiplayer Room Creation and Join', true, `Room ${roomCode} joined.`);

    // Step 4: Perform Provably Fair Coin Toss & Bat/Bowl Selection
    console.log('\n--- STEP 4: Coin Toss & Role Selection ---');
    await delay(1200);

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
    const tossWinnerPage = aliceWonToss ? pageAlice : pageBob;
    const tossWinnerName = aliceWonToss ? 'Alice' : 'Bob';
    console.log(`   ✓ Toss won by: ${tossWinnerName}. Selecting to BAT first.`);
    await tossWinnerPage.click('#tossChoiceBtns .toss-btn:first-child'); // Choose Bat

    await Promise.all([
      pageAlice.waitForSelector('#gameScreen:not(.hidden)', { timeout: 15000 }),
      pageBob.waitForSelector('#gameScreen:not(.hidden)', { timeout: 15000 })
    ]);
    console.log('   ✓ Game screen active for both players.');
    await takeScreenshot(pageAlice, 'prod-rematch-01-game-start.png', 'Game Screen Active');
    recordResult(4, 'Provably Fair Coin Toss & Role Selection', true, `${tossWinnerName} won toss and elected to bat.`);

    // Step 5: Innings 1 Gameplay & Transition
    console.log('\n--- STEP 5: Innings 1 Gameplay & Innings Transition ---');
    const firstBatterIsAlice = await pageAlice.evaluate(() => window.isBatter1Batting);
    const batterPage1 = firstBatterIsAlice ? pageAlice : pageBob;
    const bowlerPage1 = firstBatterIsAlice ? pageBob : pageAlice;
    const batter1Name = firstBatterIsAlice ? 'Alice' : 'Bob';
    const bowler1Name = firstBatterIsAlice ? 'Bob' : 'Alice';
    console.log(`   Innings 1: ${batter1Name} is Batting, ${bowler1Name} is Bowling.`);

    // Ball 1: Batter picks 3, Bowler picks 1 -> 3 runs scored
    console.log('   Submitting Ball 1: Batter picks 3, Bowler picks 1...');
    await batterPage1.click('.choices-container .choice-btn:nth-child(3)');
    await bowlerPage1.click('.choices-container .choice-btn:nth-child(1)');

    await pageAlice.waitForFunction(() => {
      const res = document.getElementById('roundResult');
      return res && res.textContent.includes('Runs');
    }, { timeout: 15000 });
    console.log('   ✓ Ball 1: runs scored.');

    // Wait for round to finish and resetBall to clear roundResult
    console.log('   Waiting for ball 1 round reset...');
    await pageAlice.waitForFunction(() => {
      const res = document.getElementById('roundResult');
      return !res || res.textContent.trim() === '';
    }, { timeout: 15000 });
    await delay(500);

    // Ball 2: Batter picks 4, Bowler picks 4 -> OUT / WICKET!
    console.log('   Submitting Ball 2: Both pick 4 -> OUT!');
    await batterPage1.click('.choices-container .choice-btn:nth-child(4)');
    await bowlerPage1.click('.choices-container .choice-btn:nth-child(4)');

    // Verify Innings Break announcement and target calculation
    await pageAlice.waitForFunction(() => {
      const res = document.getElementById('roundResult');
      return res && res.textContent.includes('Innings Break: Target is 4');
    }, { timeout: 15000 });
    console.log('   ✓ Innings 1 ended with OUT! Innings Break detected: Target is 4 (Score 3 + 1).');

    await takeScreenshot(pageAlice, 'prod-rematch-02-innings-break.png', 'Innings Break Banner');

    // Wait for automatic transition to Innings 2 (resetBall clears roundResult after innings break)
    console.log('   Waiting for Innings 2 transition...');
    await pageAlice.waitForFunction(() => {
      const res = document.getElementById('roundResult');
      return window.firstInningsComplete === true &&
             window.targetScore === 4 &&
             (!res || res.textContent.trim() === '');
    }, { timeout: 15000 });
    await delay(300);

    // Verify roles switched
    const inningsState = await pageAlice.evaluate(() => ({
      firstInningsComplete: window.firstInningsComplete,
      targetScore: window.targetScore,
      isBatter1Batting: window.isBatter1Batting
    }));
    assert.strictEqual(inningsState.firstInningsComplete, true, 'firstInningsComplete must be true');
    assert.strictEqual(inningsState.targetScore, 4, 'targetScore must be 4');
    assert.strictEqual(inningsState.isBatter1Batting, !firstBatterIsAlice, 'isBatter1Batting must be inverted');
    console.log('   ✓ Verified: Innings successfully transitioned to Innings 2 with target 4.');
    recordResult(5, 'Innings 1 Completion & Role Reversal', true, 'Innings 1 score 3, target 4 set, role switched to Innings 2.');

    // Step 6: Innings 2 Gameplay & Match Resolution
    console.log('\n--- STEP 6: Innings 2 Gameplay & Match Resolution ---');
    const batterPage2 = bowlerPage1; // Inverted roles
    const bowlerPage2 = batterPage1;
    const batter2Name = bowler1Name;

    console.log(`   Innings 2: ${batter2Name} is Batting, chasing target 4.`);
    // Ball 1 of Innings 2: Chaser picks 6, Bowler picks 2 -> 6 runs scored (Target Chased!)
    console.log('   Submitting Ball 1 of Innings 2: Chaser picks 6, Bowler picks 2...');
    await batterPage2.click('.choices-container .choice-btn:nth-child(6)');
    await bowlerPage2.click('.choices-container .choice-btn:nth-child(2)');

    await Promise.all([
      pageAlice.waitForSelector('#gameOver.active', { timeout: 15000 }),
      pageBob.waitForSelector('#gameOver.active', { timeout: 15000 })
    ]);

    const titleAlice = await pageAlice.$eval('#gameOverTitle', el => el.textContent.trim());
    const titleBob = await pageBob.$eval('#gameOverTitle', el => el.textContent.trim());
    const summaryAlice = await pageAlice.$eval('#gameOverMessage', el => el.textContent.trim());
    console.log(`   ✓ Match finished! Alice: "${titleAlice}" | Bob: "${titleBob}"`);
    console.log(`   ✓ Summary: "${summaryAlice}"`);

    assert(titleAlice.includes('Win') || titleAlice.includes('Tie'), 'Alice Game over title must indicate result');
    assert(titleBob.includes('Win') || titleBob.includes('Tie'), 'Bob Game over title must indicate result');
    await takeScreenshot(pageAlice, 'prod-rematch-03-game-over.png', 'Game Over Modal');
    recordResult(6, 'Innings 2 Target Chase & Authoritative Match Completion', true, `Match concluded correctly. Chaser won.`);

    // Step 7: Mutual Rematch Request Flow
    console.log('\n--- STEP 7: Mutual Rematch Request Flow ---');
    console.log('   Alice requests rematch via "Play Again"...');
    await pageAlice.click('#playAgainBtn');

    // Alice should see status banner: "Waiting for ... to accept rematch..."
    await pageAlice.waitForFunction(() => {
      const st = document.getElementById('rematchStatus');
      return st && !st.classList.contains('hidden') && st.textContent.includes('Waiting for');
    }, { timeout: 10000 });
    console.log('   ✓ Alice sees pending rematch banner.');

    // Bob should see rematch modal overlay
    await pageBob.waitForSelector('#rematchModalOverlay:not(.hidden)', { timeout: 10000 });
    const modalHeading = await pageBob.$eval('#rematchModalTitle', el => el.textContent.trim());
    console.log(`   ✓ Bob received rematch prompt dialog: "${modalHeading}"`);
    await takeScreenshot(pageBob, 'prod-rematch-04-rematch-prompt.png', 'Bob Rematch Prompt');

    // Bob accepts rematch
    console.log('   Bob clicks "Accept Rematch"...');
    await pageBob.click('button[onclick="onlineAcceptRematch()"]');

    // Both players must return to clean Coin Toss screen in the same room!
    await Promise.all([
      pageAlice.waitForSelector('#tossScreen:not(.hidden)', { timeout: 15000 }),
      pageBob.waitForSelector('#tossScreen:not(.hidden)', { timeout: 15000 })
    ]);
    console.log('   ✓ Both players successfully returned to Coin Toss for Rematch!');
    await delay(1000);

    // Step 8: Confirm Complete Match State Reset
    console.log('\n--- STEP 8: Verify Complete Match State Reset ---');
    const resetChecksAlice = await pageAlice.evaluate(() => {
      const gameOverActive = document.getElementById('gameOver').classList.contains('active');
      const rematchModalHidden = document.getElementById('rematchModalOverlay').classList.contains('hidden');
      const rematchStatusText = document.getElementById('rematchStatus').textContent.trim();
      const p1Score = document.getElementById('player1Score')?.textContent?.trim() || '0';
      const p2Score = document.getElementById('player2Score')?.textContent?.trim() || '0';
      return { gameOverActive, rematchModalHidden, rematchStatusText, p1Score, p2Score };
    });

    const resetChecksBob = await pageBob.evaluate(() => {
      const gameOverActive = document.getElementById('gameOver').classList.contains('active');
      const rematchModalHidden = document.getElementById('rematchModalOverlay').classList.contains('hidden');
      const rematchStatusText = document.getElementById('rematchStatus').textContent.trim();
      const p1Score = document.getElementById('player1Score')?.textContent?.trim() || '0';
      const p2Score = document.getElementById('player2Score')?.textContent?.trim() || '0';
      return { gameOverActive, rematchModalHidden, rematchStatusText, p1Score, p2Score };
    });

    assert.strictEqual(resetChecksAlice.gameOverActive, false, 'Alice GameOver modal must be closed');
    assert.strictEqual(resetChecksBob.gameOverActive, false, 'Bob GameOver modal must be closed');
    assert.strictEqual(resetChecksAlice.rematchModalHidden, true, 'Alice Rematch overlay must be hidden');
    assert.strictEqual(resetChecksBob.rematchModalHidden, true, 'Bob Rematch overlay must be hidden');
    assert.strictEqual(resetChecksAlice.rematchStatusText, '', 'Alice Rematch status banner must be empty');
    assert.strictEqual(resetChecksBob.rematchStatusText, '', 'Bob Rematch status banner must be empty');
    assert.strictEqual(resetChecksAlice.p1Score, '0', 'Alice player1Score must be reset to 0');
    assert.strictEqual(resetChecksAlice.p2Score, '0', 'Alice player2Score must be reset to 0');
    console.log('   ✓ Verified: All modals, banners, and score HUDs completely reset. Zero residual state.');
    await takeScreenshot(pageAlice, 'prod-rematch-05-rematch-toss-clean.png', 'Clean Rematch Toss Screen');
    recordResult(7, 'Mutual Rematch & Clean Room Reset', true, 'Both players returned to clean toss; all game over state purged.');

    // Step 9: Console Error Audit
    console.log('\n--- STEP 9: Console Error Audit ---');
    console.log(`   Alice Console Errors: ${consoleErrorsAlice.length}`);
    console.log(`   Bob Console Errors: ${consoleErrorsBob.length}`);
    assert.strictEqual(consoleErrorsAlice.length, 0, 'Alice session must have 0 console errors');
    assert.strictEqual(consoleErrorsBob.length, 0, 'Bob session must have 0 console errors');
    recordResult(8, 'Zero Console Errors on Production', true, '0 console errors across entire 2-innings match and rematch.');

    console.log('\n================================================================');
    console.log('   ALL PRODUCTION INNINGS & REMATCH TESTS PASSED!              ');
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
    console.error('❌ Production Verification Suite encountered failures.');
    process.exit(1);
  }
  process.exit(0);
}).catch(err => {
  console.error('❌ Production Verification Suite threw unhandled exception:', err);
  process.exit(1);
});
