// Master Test Runner for Firebase Emulators Suite
// Executes both Auth/Firestore and RTDB tests inside the emulator lifecycle.

import './test-html-load.js';
import { runAuthAndProfileTests } from './test-auth-and-profiles.js';
import { runMultiplayerRTDBTests } from './test-multiplayer-rtdb.js';
import { runAuditRegressionTests } from './test-audit-regression.js';

async function main() {
  console.log('========================================================');
  console.log('  HAND CRICKET — FIREBASE EMULATOR INTEGRATION TESTS   ');
  console.log('========================================================');

  try {
    await runAuthAndProfileTests();
    await runMultiplayerRTDBTests();
    await runAuditRegressionTests();
    console.log('🎉 ALL INTEGRATION & AUDIT TESTS PASSED SUCCESSFULLY! 🎉\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST RUN FAILED:', err);
    process.exit(1);
  }
}

main();
