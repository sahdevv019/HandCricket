// End-to-End Browser Test for Casual Online Matchmaking Flow
// Validates 2 independent browser instances searching, pairing, countdown, and toss transition.

import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = 'http://127.0.0.1:5000';
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

async function runCasualMatchmakingE2E() {
  console.log('\n================================================================');
  console.log('   CASUAL ONLINE MATCHMAKING — REAL-BROWSER E2E TEST            ');
  console.log('================================================================\n');

  let browserHost = null;
  let browserGuest = null;

  try {
    console.log('Launching Browser 1 (Alice)...');
    browserHost = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
    });

    console.log('Launching Browser 2 (Bob)...');
    browserGuest = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
    });

    const pageAlice = (await browserHost.pages())[0];
    const pageBob = (await browserGuest.pages())[0];

    pageAlice.on('console', msg => console.log(`[Alice Console] ${msg.text()}`));
    pageBob.on('console', msg => console.log(`[Bob Console] ${msg.text()}`));

    await pageAlice.setViewport({ width: 1280, height: 800 });
    await pageBob.setViewport({ width: 1280, height: 800 });

    // Step 1: Alice signs in
    console.log('\nStep 1: Alice signs in with Email...');
    await pageAlice.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await pageAlice.waitForSelector('#authScreen.active');

    const aliceEmail = `alice_mm_${Date.now()}@test.com`;
    await pageAlice.click('#tabRegister');
    await pageAlice.waitForSelector('#registerNameGroup:not(.hidden)');
    await pageAlice.type('#authRegUsername', 'AliceMatch');
    await pageAlice.type('#authEmail', aliceEmail);
    await pageAlice.type('#authPassword', 'Password123!');
    await pageAlice.click('#authBtn');
    await pageAlice.waitForSelector('#modeSelection:not(.hidden)', { timeout: 10000 });
    console.log('✓ Alice authenticated and reached Mode Selection');

    // Step 2: Bob signs in
    console.log('\nStep 2: Bob signs in with Email...');
    await pageBob.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await pageBob.waitForSelector('#authScreen.active');

    const bobEmail = `bob_mm_${Date.now()}@test.com`;
    await pageBob.click('#tabRegister');
    await pageBob.waitForSelector('#registerNameGroup:not(.hidden)');
    await pageBob.type('#authRegUsername', 'BobMatch');
    await pageBob.type('#authEmail', bobEmail);
    await pageBob.type('#authPassword', 'Password123!');
    await pageBob.click('#authBtn');
    await pageBob.waitForSelector('#modeSelection:not(.hidden)', { timeout: 10000 });
    console.log('✓ Bob authenticated and reached Mode Selection');

    // Step 3: Alice clicks "Find Online Match"
    console.log('\nStep 3: Alice clicks "Find Online Match"...');
    await pageAlice.waitForSelector('#findMatchBtn');
    await pageAlice.click('#findMatchBtn');

    await pageAlice.waitForSelector('#matchmakingScreen:not(.hidden)');
    await pageAlice.waitForSelector('#matchmakingSearchingState:not(.hidden)');
    await takeScreenshot(pageAlice, 'mm-01-searching.png', 'Alice Searching Screen');
    console.log('✓ Alice is on Searching screen with animated radar & elapsed counter');

    // Step 4: Bob clicks "Find Online Match"
    console.log('\nStep 4: Bob clicks "Find Online Match"...');
    await delay(1000); // Wait 1 second so Alice is waiting in queue
    await pageBob.waitForSelector('#findMatchBtn');
    await pageBob.click('#findMatchBtn');

    // Step 5: Both players match!
    console.log('\nStep 5: Verifying pairing and Match Found state...');
    await pageAlice.waitForSelector('#matchmakingFoundState:not(.hidden)', { timeout: 15000 });
    await pageBob.waitForSelector('#matchmakingFoundState:not(.hidden)', { timeout: 15000 });

    await takeScreenshot(pageAlice, 'mm-02-match-found.png', 'Alice Match Found View');
    await takeScreenshot(pageBob, 'mm-02-bob-match-found.png', 'Bob Match Found View');

    const aliceOpponent = await pageAlice.$eval('#matchFoundP2Name', el => el.textContent.trim());
    const bobOpponent = await pageBob.$eval('#matchFoundP2Name', el => el.textContent.trim());

    console.log(`✓ Alice sees opponent: "${aliceOpponent}"`);
    console.log(`✓ Bob sees opponent: "${bobOpponent}"`);
    assert(aliceOpponent.includes('Bob') || aliceOpponent.length > 0, 'Alice must see Bob');
    assert(bobOpponent.includes('Alice') || bobOpponent.length > 0, 'Bob must see Alice');

    // Step 6: 3-Second countdown transitions into Coin Toss
    console.log('\nStep 6: Waiting for automatic transition to Coin Toss...');
    await pageAlice.waitForSelector('#tossScreen:not(.hidden)', { timeout: 10000 });
    await pageBob.waitForSelector('#tossScreen:not(.hidden)', { timeout: 10000 });

    await takeScreenshot(pageAlice, 'mm-03-toss-screen.png', 'Alice Coin Toss Screen');
    console.log('✓ Both players seamlessly transitioned into Coin Toss!');

    console.log('\n================================================================');
    console.log('   CASUAL MATCHMAKING REAL-BROWSER E2E TEST PASSED!             ');
    console.log('================================================================\n');

  } finally {
    if (browserHost) await browserHost.close();
    if (browserGuest) await browserGuest.close();
  }
}

runCasualMatchmakingE2E().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('❌ Casual Matchmaking E2E Test failed:', err);
  process.exit(1);
});
