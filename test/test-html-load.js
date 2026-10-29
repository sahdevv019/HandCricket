// Verification of index.html structure and client script loading

import assert from 'node:assert';
import fs from 'node:fs';

console.log('Verifying index.html and module integrity...');

const indexPath = fs.existsSync('./public/index.html') ? './public/index.html' : './index.html';
const html = fs.readFileSync(indexPath, 'utf8');

// 1. PeerJS removed
assert(!html.includes('cdnjs.cloudflare.com/ajax/libs/peerjs'), 'PeerJS CDN must be removed');
assert(!html.includes('class PeerNetwork'), 'PeerNetwork must be removed');

// 2. Firebase modules loaded
assert(html.includes('./js/firebase-config.js'), 'firebase-config.js must be loaded');
assert(html.includes('./js/auth-manager.js'), 'auth-manager.js must be loaded');
assert(html.includes('./js/profile-sync.js'), 'profile-sync.js must be loaded');
assert(html.includes('./js/multiplayer-rtdb.js'), 'multiplayer-rtdb.js must be loaded');

// 3. Auth UI
assert(html.includes('id="googleAuthBtn"'), 'Google Auth button must exist');
assert(html.includes('handleGoogleSignIn()'), 'Google sign in handler must exist');
assert(html.includes('handleGuestPlay()'), 'Guest play handler must exist');
assert(html.includes('handleEmailAuth()'), 'Email auth handler must exist');
assert(html.includes('handleSignOut()'), 'Sign out handler must exist');
assert(html.includes('id="cloudSyncStatus"'), 'Cloud sync status element must exist');

// 4. Ranked Paused modal
assert(html.includes('id="rankedPausedModal"'), 'Ranked Paused modal must exist');
assert(html.includes('showRankedPausedModal()'), 'showRankedPausedModal function must be wired');

// 5. Reconnection banner
assert(html.includes('id="reconnectBanner"'), 'Reconnect banner must exist');
assert(html.includes('handleClaimWin()'), 'Claim win handler must exist');

// 6. Security rules exist
assert(fs.existsSync('./firestore.rules'), 'firestore.rules must exist');
assert(fs.existsSync('./database.rules.json'), 'database.rules.json must exist');
assert(fs.existsSync('./firebase.json'), 'firebase.json must exist');

console.log('✓ All HTML & script structure checks passed successfully!');
