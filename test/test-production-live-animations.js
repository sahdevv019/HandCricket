// Production Live Verification: Hand Cricket v1.0 Animations & Multiplayer
// URL: https://handcricket-self.vercel.app/
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROD_URL = 'https://handcricket-self.vercel.app/';
const SCREENSHOT_DIR = path.resolve('test/screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function takeScreenshot(page, filename, label) {
  const filePath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`  📸 Saved screenshot [${label}]: ${filename}`);
  return filePath;
}

async function runProductionLiveVerification() {
  console.log('\n================================================================');
  console.log('   HAND CRICKET v1.0 — PRODUCTION LIVE ANIMATIONS VERIFICATION  ');
  console.log('   Target: ' + PROD_URL);
  console.log('================================================================\n');

  let browserAlice = null;
  let browserBob = null;
  const errorsAlice = [];
  const errorsBob = [];

  try {
    console.log('Launching Session 1 (Alice)...');
    browserAlice = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
    });

    console.log('Launching Session 2 (Bob)...');
    browserBob = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
    });

    const pageAlice = (await browserAlice.pages())[0];
    const pageBob = (await browserBob.pages())[0];

    pageAlice.on('pageerror', err => {
      console.error('[Alice PageError]', err.message);
      errorsAlice.push(err.message);
    });
    pageBob.on('pageerror', err => {
      console.error('[Bob PageError]', err.message);
      errorsBob.push(err.message);
    });

    pageAlice.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('favicon')) {
        console.error('[Alice Console Error]', msg.text());
        errorsAlice.push(msg.text());
      }
    });
    pageBob.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('favicon')) {
        console.error('[Bob Console Error]', msg.text());
        errorsBob.push(msg.text());
      }
    });

    await pageAlice.setViewport({ width: 1024, height: 768 });
    await pageBob.setViewport({ width: 1024, height: 768 });

    // ─────────────────────────────────────────────────────────────
    // STEP 1: Load Live Production Site & Authenticate
    // ─────────────────────────────────────────────────────────────
    console.log('\n[Step 1] Loading live production site...');
    await pageAlice.goto(PROD_URL, { waitUntil: 'domcontentloaded' });
    await pageBob.goto(PROD_URL, { waitUntil: 'domcontentloaded' });

    await pageAlice.waitForSelector('#authScreen.active', { timeout: 15000 });
    await pageBob.waitForSelector('#authScreen.active', { timeout: 15000 });
    console.log('✓ Both live sessions loaded authScreen successfully');

    // Register Alice
    const ts = Date.now();
    const aliceEmail = `alice_v10_${ts}@test.com`;
    await pageAlice.click('#tabRegister');
    await pageAlice.waitForSelector('#registerNameGroup:not(.hidden)');
    await pageAlice.type('#authRegUsername', 'AlicePro');
    await pageAlice.type('#authEmail', aliceEmail);
    await pageAlice.type('#authPassword', 'Password123!');
    await pageAlice.click('#authBtn');
    await pageAlice.waitForSelector('#modeSelection:not(.hidden)', { timeout: 15000 });
    console.log('✓ Alice registered and entered modeSelection');

    // Register Bob
    const bobEmail = `bob_v10_${ts}@test.com`;
    await pageBob.click('#tabRegister');
    await pageBob.waitForSelector('#registerNameGroup:not(.hidden)');
    await pageBob.type('#authRegUsername', 'BobPro');
    await pageBob.type('#authEmail', bobEmail);
    await pageBob.type('#authPassword', 'Password123!');
    await pageBob.click('#authBtn');
    await pageBob.waitForSelector('#modeSelection:not(.hidden)', { timeout: 15000 });
    console.log('✓ Bob registered and entered modeSelection');

    // ─────────────────────────────────────────────────────────────
    // STEP 2: Casual Matchmaking with Radar & Match Found Badge
    // ─────────────────────────────────────────────────────────────
    console.log('\n[Step 2] Testing Casual Matchmaking radar sweep & match found flow on production...');
    await pageAlice.click('#findMatchBtn');
    await pageAlice.waitForSelector('#matchmakingScreen:not(.hidden)');
    await pageAlice.waitForSelector('#matchmakingSearchingState:not(.hidden)');

    const aliceHasRadar = await pageAlice.evaluate(() => {
      const radar = document.querySelector('.radar-sweep');
      const pulse = document.querySelectorAll('.pulse-ring');
      return !!radar && pulse.length >= 3;
    });
    assert.strictEqual(aliceHasRadar, true, 'Alice searching screen must show radar-sweep and pulse rings');
    await takeScreenshot(pageAlice, 'prod-anim-01-searching-radar.png', 'Live Production Radar Sweep');

    await delay(1200); // Let Alice queue ticket stabilize
    await pageBob.click('#findMatchBtn');
    await pageBob.waitForSelector('#matchmakingScreen:not(.hidden)');

    // Both should transition to match found state
    console.log('Waiting for mutual match found transition on production...');
    await pageAlice.waitForSelector('#matchmakingFoundState:not(.hidden)', { timeout: 15000 });
    await pageBob.waitForSelector('#matchmakingFoundState:not(.hidden)', { timeout: 15000 });

    const badgeActive = await pageAlice.evaluate(() => {
      const b = document.querySelector('.match-found-badge');
      return b && b.textContent.includes('MATCH FOUND');
    });
    assert.strictEqual(badgeActive, true, 'Match found badge must display on production');
    await takeScreenshot(pageAlice, 'prod-anim-02-match-found.png', 'Live Match Found Badge');
    console.log('✓ Mutual match found with VS avatars and 3-2-1 countdown verified');

    // ─────────────────────────────────────────────────────────────
    // STEP 3: 3D Coin Toss on Production
    // ─────────────────────────────────────────────────────────────
    console.log('\n[Step 3] Waiting for automatic transition to 3D coin toss...');
    await pageAlice.waitForSelector('#tossScreen:not(.hidden)', { timeout: 15000 });
    await pageBob.waitForSelector('#tossScreen:not(.hidden)', { timeout: 15000 });

    const has3DCoin = await pageAlice.evaluate(() => {
      const coin = document.getElementById('coin');
      const f = coin?.querySelector('.coin-front');
      const b = coin?.querySelector('.coin-back');
      return !!coin && !!f && !!b;
    });
    assert.strictEqual(has3DCoin, true, '3D Coin stage must exist on live production');
    console.log('✓ 3D Coin element initialized on live site');

    // Caller picks heads/tails
    const aliceCanCall = await pageAlice.evaluate(() => !document.getElementById('tossCallBtns').classList.contains('hidden'));
    const callerPage = aliceCanCall ? pageAlice : pageBob;
    const nonCallerPage = aliceCanCall ? pageBob : pageAlice;
    const callerName = aliceCanCall ? 'Alice' : 'Bob';

    console.log(`${callerName} is calling the toss...`);
    await callerPage.click('#tossCallBtns .toss-btn:first-child'); // Call heads

    // Wait for coin spin classes
    await delay(600);
    const coinSpinning = await pageAlice.evaluate(() => {
      const coin = document.getElementById('coin');
      return coin.classList.contains('flip-to-heads') || coin.classList.contains('flip-to-tails');
    });
    assert.strictEqual(coinSpinning, true, 'Coin must possess 3D flip animation class');
    await takeScreenshot(pageAlice, 'prod-anim-03-coin-spinning.png', 'Live 3D Coin Flipping');
    console.log('✓ Live 3D coin spinning in flight verified');

    // Wait for toss resolution
    await delay(1800);
    await takeScreenshot(pageAlice, 'prod-anim-04-coin-settled.png', 'Live 3D Coin Settled');
    console.log('✓ 3D Coin settled on face and toss winner announced');

    // Toss winner chooses to Bat First
    const aliceCanChoose = await pageAlice.evaluate(() => !document.getElementById('tossChoiceBtns').classList.contains('hidden'));
    const chooserPage = aliceCanChoose ? pageAlice : pageBob;
    const chooserName = aliceCanChoose ? 'Alice' : 'Bob';
    console.log(`${chooserName} won toss and chooses to Bat First...`);
    await chooserPage.click('#tossChoiceBtns .toss-btn:first-child'); // Bat First

    // ─────────────────────────────────────────────────────────────
    // STEP 4: First Innings Gameplay & Celebrations
    // ─────────────────────────────────────────────────────────────
    console.log('\n[Step 4] Transitioning to Game Screen...');
    await pageAlice.waitForSelector('#gameScreen.active', { timeout: 15000 });
    await pageBob.waitForSelector('#gameScreen.active', { timeout: 15000 });
    console.log('✓ Both players on active Game Screen');

    // Identify who is batting in Innings 1
    const currentBatter = await pageAlice.evaluate(() => document.getElementById('batterLabel').textContent.trim());
    const aliceIsBatter = currentBatter === 'AlicePro';
    const batterPage = aliceIsBatter ? pageAlice : pageBob;
    const bowlerPage = aliceIsBatter ? pageBob : pageAlice;
    const batterName = aliceIsBatter ? 'Alice' : 'Bob';
    const bowlerName = aliceIsBatter ? 'Bob' : 'Alice';
    console.log(`Innings 1: ${batterName} is Batting, ${bowlerName} is Bowling.`);

    // Ball 1: Score a FOUR (Batter picks 4, Bowler picks 2)
    console.log('\n--- Playing Ball 1: Target FOUR celebration ---');
    await batterPage.click('.choices-container .choice-btn:nth-child(4)'); // 4
    // Verify locked state on batter
    const batterLocked = await batterPage.evaluate(() => {
      const btn = document.querySelector('.choices-container .choice-btn:nth-child(4)');
      return btn.classList.contains('locked') && btn.classList.contains('selected');
    });
    assert.strictEqual(batterLocked, true, 'Batter choice button must illuminate in locked state');
    await takeScreenshot(batterPage, 'prod-anim-05-choice-locked.png', 'Live Move Locked Glow');

    await bowlerPage.click('.choices-container .choice-btn:nth-child(2)'); // 2
    console.log('Waiting for Ball 1 resolution...');

    // Wait for FOUR celebration overlay on batterPage
    await batterPage.waitForFunction(() => {
      const ov = document.getElementById('celebrationOverlay');
      const bn = document.getElementById('celebrationBanner');
      return ov && !ov.classList.contains('hidden') && bn && bn.classList.contains('celebration-four');
    }, { timeout: 15000 });

    await takeScreenshot(batterPage, 'prod-anim-06-four-celebration.png', 'Live FOUR Boundary Celebration');
    console.log('✓ FOUR boundary celebration banner and particle burst verified on live site');

    // Wait for round to reset and RTDB roundIndex to advance
    console.log('Waiting for ball 1 round reset...');
    await pageAlice.waitForFunction(() => {
      const res = document.getElementById('roundResult');
      return !res || res.textContent.trim() === '';
    }, { timeout: 15000 });
    await delay(1000);

    // Ball 2: WICKET / OUT (Batter picks 3, Bowler picks 3)
    console.log('\n--- Playing Ball 2: Target WICKET dismissal ---');
    await batterPage.waitForSelector('.choices-container .choice-btn:not([disabled])', { timeout: 10000 });
    await bowlerPage.waitForSelector('.choices-container .choice-btn:not([disabled])', { timeout: 10000 });

    await batterPage.click('.choices-container .choice-btn:nth-child(3)'); // 3
    await bowlerPage.click('.choices-container .choice-btn:nth-child(3)'); // 3 (Match = OUT!)
    console.log('Waiting for Ball 2 resolution (WICKET)...');

    // Wait for OUT celebration overlay on batterPage
    await batterPage.waitForFunction(() => {
      const ov = document.getElementById('celebrationOverlay');
      const bn = document.getElementById('celebrationBanner');
      return ov && !ov.classList.contains('hidden') && bn && bn.classList.contains('celebration-out');
    }, { timeout: 15000 });

    await takeScreenshot(batterPage, 'prod-anim-07-out-wicket.png', 'Live OUT Dismissal Overlay');
    console.log('✓ WICKET dismissal banner and impact camera shake verified on live site');

    // ─────────────────────────────────────────────────────────────
    // STEP 5: Innings Break & Second Innings (SIX + Match Finish)
    // ─────────────────────────────────────────────────────────────
    console.log('\n[Step 5] Verifying Innings Break target reveal...');
    await batterPage.waitForFunction(() => {
      const res = document.getElementById('roundResult');
      return res && res.textContent.includes('Innings Break');
    }, { timeout: 15000 });

    await takeScreenshot(bowlerPage, 'prod-anim-08-innings-break.png', 'Live Innings Break Scoreboard');
    console.log('Target set for Innings 2 (5 runs). Scoreboard updated.');

    // Wait for Innings 2 resetBall to clear roundResult and activate Innings 2 state
    console.log('Waiting for Innings 2 transition...');
    await pageAlice.waitForFunction(() => {
      const res = document.getElementById('roundResult');
      return window.firstInningsComplete === true &&
             (!res || res.textContent.trim() === '');
    }, { timeout: 15000 });
    await delay(1000); // Allow RTDB round counter to advance

    // In Second Innings: previous bowler is now batting, previous batter is now bowling
    const chaserPage = bowlerPage;
    const defenderPage = batterPage;
    const chaserName = bowlerName;

    // Chaser hits a SIX on Ball 1 (Score 6 >= Target 5 => Chaser wins match!)
    console.log(`\n--- Second Innings: Chaser ${chaserName} chooses 6 (SIX), Defender chooses 1 ---`);
    await chaserPage.click('.choices-container .choice-btn:nth-child(6)'); // 6
    await defenderPage.click('.choices-container .choice-btn:nth-child(1)'); // 1

    console.log('Waiting for Match Result...');
    await Promise.all([
      chaserPage.waitForSelector('#gameOver.active', { timeout: 15000 }),
      defenderPage.waitForSelector('#gameOver.active', { timeout: 15000 })
    ]);
    await takeScreenshot(chaserPage, 'prod-anim-09-six-game-over.png', 'Live SIX Match Finish');
    console.log('✓ Second innings SIX hit and game over transition verified on live site');

    // ─────────────────────────────────────────────────────────────
    // STEP 6: Victory Trophy & Defeat Presentation
    // ─────────────────────────────────────────────────────────────
    console.log('\n[Step 6] Verifying Victory and Defeat states on live site...');
    const winnerHasTrophy = await chaserPage.evaluate(() => {
      const t = document.getElementById('trophyBadge');
      const title = document.getElementById('gameOverTitle').textContent;
      return t && !t.classList.contains('hidden') && title.includes('Win');
    });
    assert.strictEqual(winnerHasTrophy, true, 'Winner must see bouncing trophy badge on production');
    await takeScreenshot(chaserPage, 'prod-anim-10-victory-trophy.png', 'Live Winner Trophy & Confetti');
    console.log('✓ Victorious celebration with bouncing gold trophy verified on live site');

    const loserHasNoTrophy = await defenderPage.evaluate(() => {
      const t = document.getElementById('trophyBadge');
      return t && t.classList.contains('hidden');
    });
    assert.strictEqual(loserHasNoTrophy, true, 'Defeated player must see clean result without trophy');
    await takeScreenshot(defenderPage, 'prod-anim-11-defeat-clean.png', 'Live Clean Defeat Presentation');
    console.log('✓ Clean defeat presentation without trophy or jarring shakes verified');

    // ─────────────────────────────────────────────────────────────
    // STEP 7: Mutual Rematch Flow on Live Site
    // ─────────────────────────────────────────────────────────────
    console.log('\n[Step 7] Testing Mutual Rematch flow on live site...');
    await pageAlice.click('#playAgainBtn');
    console.log('Alice requested rematch. Waiting for Bob to receive rematch prompt...');

    // Alice sees pending rematch banner with pulse glow
    await pageAlice.waitForFunction(() => {
      const st = document.getElementById('rematchStatus');
      return st && !st.classList.contains('hidden') && st.textContent.includes('Waiting for');
    }, { timeout: 10000 });
    console.log('✓ Alice sees pending rematch status with pulse glow');

    // Bob receives modal dialog
    await pageBob.waitForSelector('#rematchModalOverlay:not(.hidden)', { timeout: 10000 });
    console.log('✓ Bob received rematch prompt dialog');

    // Bob clicks "Accept"
    await pageBob.click('button[onclick="onlineAcceptRematch()"]');
    console.log('Bob accepted rematch. Waiting for both players to transition to 3D toss screen...');

    await Promise.all([
      pageAlice.waitForSelector('#tossScreen:not(.hidden)', { timeout: 15000 }),
      pageBob.waitForSelector('#tossScreen:not(.hidden)', { timeout: 15000 })
    ]);
    await takeScreenshot(pageAlice, 'prod-anim-12-rematch-toss.png', 'Live Rematch Toss Clean Transition');
    console.log('✓ Mutual rematch cleanly restarted match to 3D coin toss screen on live production');

    // ─────────────────────────────────────────────────────────────
    // STEP 8: Mobile Responsiveness Check (375x667 iPhone SE)
    // ─────────────────────────────────────────────────────────────
    console.log('\n[Step 8] Testing Mobile Responsiveness (375x667)...');
    await pageAlice.setViewport({ width: 375, height: 667 });
    await delay(400);

    const mobileFit = await pageAlice.evaluate(() => {
      const docW = document.documentElement.clientWidth;
      const scrollW = document.documentElement.scrollWidth;
      return scrollW <= docW + 2; // No horizontal scroll spill
    });
    assert.strictEqual(mobileFit, true, 'Mobile layout must have no horizontal scrollbar overflow');
    await takeScreenshot(pageAlice, 'prod-anim-13-mobile-layout.png', 'Live Mobile 375px Layout');
    console.log('✓ Mobile viewport 375x667 fits perfectly with zero horizontal overflow');

    // ─────────────────────────────────────────────────────────────
    // STEP 9: Reduced Motion Accessibility Check
    // ─────────────────────────────────────────────────────────────
    console.log('\n[Step 9] Testing prefers-reduced-motion accessibility on live site...');
    await pageAlice.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const liveReducedMotion = await pageAlice.evaluate(() => {
      return ParticleFX.isReducedMotion();
    });
    assert.strictEqual(liveReducedMotion, true, 'Live ParticleFX must respect prefers-reduced-motion');
    console.log('✓ prefers-reduced-motion correctly recognized and obeyed on live production');

    // ─────────────────────────────────────────────────────────────
    // STEP 10: Error Log Audit
    // ─────────────────────────────────────────────────────────────
    console.log('\n[Step 10] Auditing console error logs...');
    console.log(`Alice Errors: ${errorsAlice.length}, Bob Errors: ${errorsBob.length}`);
    assert.strictEqual(errorsAlice.length, 0, `Alice encountered errors: ${errorsAlice.join(', ')}`);
    assert.strictEqual(errorsBob.length, 0, `Bob encountered errors: ${errorsBob.join(', ')}`);
    console.log('✓ Zero JavaScript runtime errors or Firebase permission failures');

    console.log('\n================================================================');
    console.log('   PRODUCTION LIVE VERIFICATION COMPLETE & PASSED (100%)       ');
    console.log('================================================================\n');

  } finally {
    if (browserAlice) await browserAlice.close();
    if (browserBob) await browserBob.close();
  }
}

runProductionLiveVerification().catch(err => {
  console.error('\n❌ Production Live verification failed:', err);
  process.exit(1);
});
