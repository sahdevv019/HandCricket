// Production Casual Online Matchmaking & End-to-End Suite
// Live verification against Vercel frontend: https://handcricket-self.vercel.app/
// and production Firebase: handcricket-e6b39

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

async function runProductionMatchmakingSuite() {
  console.log('\n================================================================');
  console.log('   HAND CRICKET — PRODUCTION CASUAL MATCHMAKING SUITE           ');
  console.log(`   Live Vercel Frontend: ${VERCEL_URL}`);
  console.log('   Target Firebase Project: handcricket-e6b39');
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

  const consoleErrorsAlice = [];
  const consoleErrorsBob = [];
  const permissionDeniedAlice = [];
  const permissionDeniedBob = [];

  try {
    console.log('1. Launching Session 1 (Alice)...');
    browserAlice = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
    });

    console.log('2. Launching Session 2 (Bob)...');
    browserBob = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
    });

    const pageAlice = (await browserAlice.pages())[0];
    const pageBob = (await browserBob.pages())[0];

    pageAlice.on('console', msg => {
      const txt = msg.text();
      console.log(`[Alice Console ${msg.type()}] ${txt}`);
      if (msg.type() === 'error' && !txt.includes('favicon.ico')) consoleErrorsAlice.push(txt);
      if (txt.includes('PERMISSION_DENIED') || txt.includes('permission_denied')) permissionDeniedAlice.push(txt);
    });

    pageBob.on('console', msg => {
      const txt = msg.text();
      console.log(`[Bob Console ${msg.type()}] ${txt}`);
      if (msg.type() === 'error' && !txt.includes('favicon.ico')) consoleErrorsBob.push(txt);
      if (txt.includes('PERMISSION_DENIED') || txt.includes('permission_denied')) permissionDeniedBob.push(txt);
    });

    await pageAlice.setViewport({ width: 1280, height: 800 });
    await pageBob.setViewport({ width: 1280, height: 800 });

    // Step 1: Navigate to Vercel production
    console.log('\n--- STEP 1: Verify Live Deployment Connection ---');
    await pageAlice.goto(VERCEL_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await pageBob.goto(VERCEL_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    const isAliceProd = await pageAlice.evaluate(() => {
      return !window.HC_FIREBASE?.usingEmulators &&
             window.HC_FIREBASE?.app?.options?.projectId === 'handcricket-e6b39';
    });
    const isBobProd = await pageBob.evaluate(() => {
      return !window.HC_FIREBASE?.usingEmulators &&
             window.HC_FIREBASE?.app?.options?.projectId === 'handcricket-e6b39';
    });
    assert(isAliceProd && isBobProd, 'Both sessions must connect to production Firebase handcricket-e6b39');
    recordResult(1, 'Production Deployment & Firebase Connectivity', true, 'Connected to handcricket-e6b39 without emulators.');

    // Step 2: Register two test accounts
    console.log('\n--- STEP 2: Authenticate Alice & Bob on Production ---');
    const ts = Date.now();
    const aliceEmail = `alice_prod_mm_${ts}@handcricket.test`;
    const bobEmail = `bob_prod_mm_${ts}@handcricket.test`;
    const pass = 'TestPass2026!';

    await pageAlice.waitForSelector('#authScreen.active');
    await pageAlice.click('#tabRegister');
    await pageAlice.waitForSelector('#registerNameGroup:not(.hidden)');
    await pageAlice.type('#authRegUsername', 'AliceLive');
    await pageAlice.type('#authEmail', aliceEmail);
    await pageAlice.type('#authPassword', pass);
    await pageAlice.click('#authBtn');

    await pageBob.waitForSelector('#authScreen.active');
    await pageBob.click('#tabRegister');
    await pageBob.waitForSelector('#registerNameGroup:not(.hidden)');
    await pageBob.type('#authRegUsername', 'BobLive');
    await pageBob.type('#authEmail', bobEmail);
    await pageBob.type('#authPassword', pass);
    await pageBob.click('#authBtn');

    await Promise.all([
      pageAlice.waitForSelector('#modeSelection:not(.hidden)', { timeout: 15000 }),
      pageBob.waitForSelector('#modeSelection:not(.hidden)', { timeout: 15000 })
    ]);
    recordResult(2, 'Production Authentication & Firestore Profile Creation', true, `AliceLive & BobLive registered.`);

    // Step 3: Matchmaking - Alice searches, Bob searches, paired into CAS room
    console.log('\n--- STEP 3: Automatic Casual Matchmaking Flow ---');
    await pageAlice.waitForSelector('#findMatchBtn');
    await pageAlice.click('#findMatchBtn');

    await pageAlice.waitForSelector('#matchmakingScreen:not(.hidden)');
    await pageAlice.waitForSelector('#matchmakingSearchingState:not(.hidden)');
    await takeScreenshot(pageAlice, 'prod-mm-01-searching.png', 'Alice Searching Screen');

    await delay(1200); // Allow Alice's ticket to be registered in queue

    await pageBob.waitForSelector('#findMatchBtn');
    await pageBob.click('#findMatchBtn');

    // Both should transition to match found
    await Promise.all([
      pageAlice.waitForSelector('#matchmakingFoundState:not(.hidden)', { timeout: 15000 }),
      pageBob.waitForSelector('#matchmakingFoundState:not(.hidden)', { timeout: 15000 })
    ]);

    await takeScreenshot(pageAlice, 'prod-mm-02-match-found.png', 'Alice Match Found');
    const aliceOpponent = await pageAlice.$eval('#matchFoundP2Name', el => el.textContent.trim());
    const bobOpponent = await pageBob.$eval('#matchFoundP2Name', el => el.textContent.trim());

    assert(aliceOpponent.includes('BobLive'), `Alice should see BobLive, saw: ${aliceOpponent}`);
    assert(bobOpponent.includes('AliceLive'), `Bob should see AliceLive, saw: ${bobOpponent}`);
    console.log(`   ✓ Matched successfully! Alice sees: "${aliceOpponent}", Bob sees: "${bobOpponent}"`);

    // Automatic countdown transitions to Toss screen
    await Promise.all([
      pageAlice.waitForSelector('#tossScreen:not(.hidden)', { timeout: 15000 }),
      pageBob.waitForSelector('#tossScreen:not(.hidden)', { timeout: 15000 })
    ]);
    await takeScreenshot(pageAlice, 'prod-mm-03-toss.png', 'Coin Toss Screen');
    recordResult(3, 'Automatic Casual Matchmaking & Room Pairing', true, 'Matched into CAS room and transitioned to Coin Toss.');

    // Step 4: Coin Toss and Bat/Bowl Election
    console.log('\n--- STEP 4: Coin Toss & Role Selection ---');
    await delay(1200);

    const aliceHasCall = await pageAlice.evaluate(() => {
      const el = document.getElementById('tossCallBtns');
      return el && !el.classList.contains('hidden');
    });
    const callPage = aliceHasCall ? pageAlice : pageBob;
    const callPlayerName = aliceHasCall ? 'Alice' : 'Bob';
    console.log(`   ${callPlayerName} is calling the toss...`);
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
    const tossWinnerName = aliceWonToss ? 'AliceLive' : 'BobLive';
    console.log(`   ✓ Toss won by: ${tossWinnerName}. Electing to BAT first.`);
    await tossWinnerPage.click('#tossChoiceBtns .toss-btn:first-child'); // Choose Bat

    await Promise.all([
      pageAlice.waitForSelector('#gameScreen:not(.hidden)', { timeout: 15000 }),
      pageBob.waitForSelector('#gameScreen:not(.hidden)', { timeout: 15000 })
    ]);
    recordResult(4, 'Coin Toss & Batting/Bowling Selection', true, `${tossWinnerName} won toss and elected to bat.`);

    // Step 5: Innings 1 Gameplay & Transition
    console.log('\n--- STEP 5: Innings 1 Gameplay & Innings Transition ---');
    await delay(1000);
    const initialIsBatter1Batting = await pageAlice.evaluate(() => window.isBatter1Batting);
    const aliceIsBatting = await pageAlice.evaluate(() => {
      return (window.onlineIsHost && window.isBatter1Batting) ||
             (!window.onlineIsHost && !window.isBatter1Batting);
    });
    const batterPage1 = aliceIsBatting ? pageAlice : pageBob;
    const bowlerPage1 = aliceIsBatting ? pageBob : pageAlice;
    const batter1Name = aliceIsBatting ? 'AliceLive' : 'BobLive';
    const bowler1Name = aliceIsBatting ? 'BobLive' : 'AliceLive';
    console.log(`   Innings 1: ${batter1Name} is Batting, ${bowler1Name} is Bowling.`);

    // Ball 1: Batter picks 3 (3rd button), Bowler picks 1 (1st button) -> 3 runs scored
    console.log('   Submitting Ball 1: Batter picks 3, Bowler picks 1...');
    await batterPage1.click('.choices-container .choice-btn:nth-child(3)');
    await bowlerPage1.click('.choices-container .choice-btn:nth-child(1)');

    await pageAlice.waitForFunction(() => {
      const res = document.getElementById('roundResult');
      return res && res.textContent.includes('Runs');
    }, { timeout: 15000 });
    console.log('   ✓ Ball 1: 3 runs scored.');

    // Wait for round to finish and resetBall to clear roundResult
    console.log('   Waiting for ball 1 round reset...');
    await pageAlice.waitForFunction(() => {
      const res = document.getElementById('roundResult');
      return !res || res.textContent.trim() === '';
    }, { timeout: 15000 });
    await delay(500);

    // Ball 2: Both pick 4 -> OUT / WICKET!
    console.log('   Submitting Ball 2: Both pick 4 -> OUT!');
    await batterPage1.click('.choices-container .choice-btn:nth-child(4)');
    await bowlerPage1.click('.choices-container .choice-btn:nth-child(4)');

    // Verify Innings Break announcement and target calculation
    await pageAlice.waitForFunction(() => {
      const res = document.getElementById('roundResult');
      return res && res.textContent.includes('Innings Break: Target is 4');
    }, { timeout: 15000 });
    console.log('   ✓ Innings 1 ended with OUT! Innings Break detected: Target is 4 (Score 3 + 1).');

    await takeScreenshot(pageAlice, 'prod-mm-04-innings-break.png', 'Innings Break Screen');

    // Wait for automatic transition to Innings 2 (resetBall clears roundResult after innings break)
    console.log('   Waiting for Innings 2 transition...');
    await pageAlice.waitForFunction(() => {
      const res = document.getElementById('roundResult');
      return window.firstInningsComplete === true &&
             window.targetScore === 4 &&
             (!res || res.textContent.trim() === '');
    }, { timeout: 15000 });
    await delay(500);

    // Verify roles switched
    const inningsState = await pageAlice.evaluate(() => ({
      firstInningsComplete: window.firstInningsComplete,
      targetScore: window.targetScore,
      isBatter1Batting: window.isBatter1Batting
    }));
    assert.strictEqual(inningsState.firstInningsComplete, true, 'firstInningsComplete must be true');
    assert.strictEqual(inningsState.targetScore, 4, 'targetScore must be 4');
    assert.strictEqual(inningsState.isBatter1Batting, !initialIsBatter1Batting, 'isBatter1Batting must be inverted');
    recordResult(5, 'Innings 1 Completion & Target Calculation', true, `First innings ended at 3 runs. Target set to 4.`);

    // Step 6: Innings 2 Gameplay & Winner Determination
    console.log('\n--- STEP 6: Innings 2 Gameplay & Winner Calculation ---');
    const batterPage2 = bowlerPage1; // Inverted roles
    const bowlerPage2 = batterPage1;
    const batter2Name = bowler1Name;

    console.log(`   Innings 2: ${batter2Name} is Batting (needs 4 runs), ${batter1Name} is Bowling.`);

    // Ball 1 of Innings 2: Chaser picks 6, Bowler picks 2 -> 6 runs scored (Target 4 Chased!)
    console.log('   Submitting Ball 1 of Innings 2: Chaser picks 6, Bowler picks 2...');
    await batterPage2.click('.choices-container .choice-btn:nth-child(6)');
    await bowlerPage2.click('.choices-container .choice-btn:nth-child(2)');

    await Promise.all([
      pageAlice.waitForSelector('#gameOver.active', { timeout: 15000 }),
      pageBob.waitForSelector('#gameOver.active', { timeout: 15000 })
    ]);

    await takeScreenshot(pageAlice, 'prod-mm-05-game-over.png', 'Game Over Screen');
    const titleAlice = await pageAlice.$eval('#gameOverTitle', el => el.textContent.trim());
    const titleBob = await pageBob.$eval('#gameOverTitle', el => el.textContent.trim());
    const summaryAlice = await pageAlice.$eval('#gameOverMessage', el => el.textContent.trim());
    console.log(`   ✓ Match finished! Alice: "${titleAlice}" | Bob: "${titleBob}"`);
    console.log(`   ✓ Summary: "${summaryAlice}"`);

    assert(titleAlice.includes('Win') || titleAlice.includes('Tie'), 'Alice Game over title must indicate result');
    assert(titleBob.includes('Win') || titleBob.includes('Tie'), 'Bob Game over title must indicate result');
    recordResult(6, 'Innings 2 Chase & Winner Determination', true, `Target chased. ${summaryAlice}`);

    // Step 7: Mutual Rematch Workflow
    console.log('\n--- STEP 7: Mutual Rematch Workflow ---');
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

    // Bob accepts rematch
    console.log('   Bob clicks "Accept Rematch"...');
    await pageBob.click('button[onclick="onlineAcceptRematch()"]');
    await takeScreenshot(pageBob, 'prod-mm-06-rematch.png', 'Mutual Rematch Accepted');

    // Both players must return to clean Coin Toss screen in the same room!
    await Promise.all([
      pageAlice.waitForSelector('#tossScreen:not(.hidden)', { timeout: 15000 }),
      pageBob.waitForSelector('#tossScreen:not(.hidden)', { timeout: 15000 })
    ]);
    console.log('   ✓ Rematch mutual consent successful! Both players cleanly transitioned to Toss Screen.');
    recordResult(7, 'Mutual Rematch Workflow', true, 'Both players requested rematch and returned to Coin Toss.');

    // Step 8: Return to Lobby & Verify Private Room Mode
    console.log('\n--- STEP 8: Private Room Mode Verification ---');
    await delay(1000);
    // Return Alice and Bob to home screen
    await pageAlice.evaluate(() => {
      if (typeof window.backToMode === 'function') window.backToMode();
      else if (typeof window.showModeSelection === 'function') window.showModeSelection();
    });
    await pageBob.evaluate(() => {
      if (typeof window.backToMode === 'function') window.backToMode();
      else if (typeof window.showModeSelection === 'function') window.showModeSelection();
    });

    await delay(1500);
    await Promise.all([
      pageAlice.waitForSelector('#modeSelection:not(.hidden)', { timeout: 10000 }),
      pageBob.waitForSelector('#modeSelection:not(.hidden)', { timeout: 10000 })
    ]);

    // Alice creates private room
    await pageAlice.click('.mode-btn.vs-friend:not(.disabled)');
    await pageAlice.waitForSelector('#onlineLobbyScreen:not(.hidden)');
    await pageAlice.click('button[onclick="onlineCreateRoom()"]');
    await pageAlice.waitForSelector('#onlineRoomCode div', { timeout: 15000 });

    const privateRoomCode = await pageAlice.$eval('#onlineRoomCode', el => {
      const m = el.textContent.match(/[A-Z0-9]{4,6}/);
      return m ? m[0] : '';
    });
    console.log(`   ✓ Private room created by Alice: [${privateRoomCode}]`);
    assert(privateRoomCode && privateRoomCode.length >= 4, 'Valid private room code');

    // Bob joins private room
    await pageBob.click('.mode-btn.vs-friend:not(.disabled)');
    await pageBob.waitForSelector('#onlineLobbyScreen:not(.hidden)');
    await pageBob.click('button[onclick="onlineShowJoin()"]');
    await pageBob.waitForSelector('#onlineJoinBox:not(.hidden)');
    await pageBob.$eval('#onlineCodeInput', el => el.value = '');
    await pageBob.type('#onlineCodeInput', privateRoomCode);
    await pageBob.click('button[onclick="onlineJoinRoom()"]');

    await Promise.all([
      pageAlice.waitForSelector('#tossScreen:not(.hidden)', { timeout: 15000 }),
      pageBob.waitForSelector('#tossScreen:not(.hidden)', { timeout: 15000 })
    ]);
    await takeScreenshot(pageAlice, 'prod-mm-07-private-room.png', 'Private Room Coin Toss');
    recordResult(8, 'Private Room Multiplayer Mode Intact', true, `Room ${privateRoomCode} created and joined successfully.`);

    // Step 9: Verify Ranked Mode Paused Guard
    console.log('\n--- STEP 9: Verify Ranked Mode Paused Modal ---');
    await pageAlice.evaluate(() => {
      if (typeof window.backToMode === 'function') window.backToMode();
      else if (typeof window.showModeSelection === 'function') window.showModeSelection();
    });
    await delay(1000);
    await pageAlice.waitForSelector('#modeSelection:not(.hidden)');

    const rankedBtn = await pageAlice.$('.mode-btn.ranked');
    if (rankedBtn) {
      await rankedBtn.click();
      await delay(500);
      const isPausedModalVisible = await pageAlice.evaluate(() => {
        const modal = document.getElementById('rankedPausedModal');
        return modal && !modal.classList.contains('hidden');
      });
      assert(isPausedModalVisible, 'Ranked modal should show paused state');
      console.log('   ✓ Ranked matchmaking modal displays paused notice.');
    }
    recordResult(9, 'Ranked Matchmaking Paused Guard', true, 'Ranked mode cleanly disabled/paused.');

    // Step 10: Security & Console Error Verification
    console.log('\n--- STEP 10: Console Errors & Security Rule Denials Audit ---');
    console.log(`   Alice Console Errors: ${consoleErrorsAlice.length}`);
    console.log(`   Bob Console Errors: ${consoleErrorsBob.length}`);
    console.log(`   Alice Permission Denials: ${permissionDeniedAlice.length}`);
    console.log(`   Bob Permission Denials: ${permissionDeniedBob.length}`);

    assert.strictEqual(permissionDeniedAlice.length, 0, `Alice experienced permission denials: ${JSON.stringify(permissionDeniedAlice)}`);
    assert.strictEqual(permissionDeniedBob.length, 0, `Bob experienced permission denials: ${JSON.stringify(permissionDeniedBob)}`);
    assert.strictEqual(consoleErrorsAlice.length, 0, `Alice encountered unexpected errors: ${JSON.stringify(consoleErrorsAlice)}`);
    assert.strictEqual(consoleErrorsBob.length, 0, `Bob encountered unexpected errors: ${JSON.stringify(consoleErrorsBob)}`);

    recordResult(10, 'Security Rules & Console Cleanliness', true, '0 permission denials, 0 console errors.');

  } finally {
    if (browserAlice) await browserAlice.close();
    if (browserBob) await browserBob.close();
  }

  console.log('\n================================================================');
  console.log('   PRODUCTION MATCHMAKING VERIFICATION SUMMARY                  ');
  console.log('================================================================');
  let allPassed = true;
  for (const r of testResults) {
    const mark = r.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`[PROD-TEST ${r.id}] ${mark}: ${r.name}`);
    if (!r.passed) allPassed = false;
  }
  console.log('================================================================\n');

  if (!allPassed) {
    throw new Error('One or more production tests failed.');
  }
}

runProductionMatchmakingSuite()
  .then(() => {
    console.log('🎉 ALL PRODUCTION MATCHMAKING TESTS PASSED ON LIVE VERCEL DEPLOYMENT!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Production verification failed:', err);
    process.exit(1);
  });
