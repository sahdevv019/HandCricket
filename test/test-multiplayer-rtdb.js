// Integration test for Firebase Realtime Database Private Multiplayer
// Verifies atomic operations, round identifiers, presence, security rules, and state transitions.

import assert from 'node:assert';
import { initializeApp, deleteApp } from 'firebase/app';
import { 
  getAuth, 
  connectAuthEmulator, 
  createUserWithEmailAndPassword 
} from 'firebase/auth';
import { 
  getDatabase, 
  connectDatabaseEmulator, 
  ref, 
  set, 
  get, 
  update 
} from 'firebase/database';

const firebaseConfig = {
  apiKey: "fake-api-key-for-emulator",
  authDomain: "handcricket-e6b39.firebaseapp.com",
  projectId: "handcricket-e6b39",
  databaseURL: "http://127.0.0.1:9000?ns=handcricket-e6b39-default-rtdb"
};

async function runMultiplayerRTDBTests() {
  console.log('\n--- Running Realtime Database Multiplayer & Security Rules Tests ---');

  const appHost = initializeApp(firebaseConfig, 'host-app');
  const authHost = getAuth(appHost);
  const dbHost = getDatabase(appHost);
  connectAuthEmulator(authHost, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectDatabaseEmulator(dbHost, '127.0.0.1', 9000);

  const appGuest = initializeApp(firebaseConfig, 'guest-app');
  const authGuest = getAuth(appGuest);
  const dbGuest = getDatabase(appGuest);
  connectAuthEmulator(authGuest, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectDatabaseEmulator(dbGuest, '127.0.0.1', 9000);

  const appEve = initializeApp(firebaseConfig, 'eve-app');
  const authEve = getAuth(appEve);
  const dbEve = getDatabase(appEve);
  connectAuthEmulator(authEve, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectDatabaseEmulator(dbEve, '127.0.0.1', 9000);

  try {
    // 1. Authenticate Host, Guest, and Eve (stranger)
    const hostCred = await createUserWithEmailAndPassword(authHost, `host_${Date.now()}@test.com`, 'password123');
    const guestCred = await createUserWithEmailAndPassword(authGuest, `guest_${Date.now()}@test.com`, 'password123');
    const eveCred = await createUserWithEmailAndPassword(authEve, `eve_${Date.now()}@test.com`, 'password123');

    const hostUid = hostCred.user.uid;
    const guestUid = guestCred.user.uid;
    const eveUid = eveCred.user.uid;
    const roomId = 'TEST' + Math.floor(10 + Math.random() * 89);
    console.log(`✓ Players ready: Host (${hostUid.slice(0, 5)}), Guest (${guestUid.slice(0, 5)}), Room: ${roomId}`);

    // 2. Host creates private room
    const roomRefHost = ref(dbHost, `rooms/${roomId}`);
    await set(roomRefHost, {
      meta: {
        hostUid,
        hostName: 'HostPlayer',
        status: 'waiting',
        createdAt: Date.now()
      },
      presence: {
        host: { online: true, lastSeen: Date.now() }
      }
    });
    console.log('✓ Host created room with status: waiting');

    // 3. Security: Eve (non-participant) tries to write host move -> MUST FAIL
    try {
      await set(ref(dbEve, `rooms/${roomId}/rounds/1/hostMove`), 4);
      assert.fail('Eve should not be allowed to write moves');
    } catch (err) {
      assert(err.message.includes('PERMISSION_DENIED') || err.message.includes('permission_denied'));
      console.log('✓ Security: Stranger cannot write to private room');
    }

    // 4. Guest joins room
    const roomRefGuest = ref(dbGuest, `rooms/${roomId}`);
    await update(roomRefGuest, {
      'meta/guestUid': guestUid,
      'meta/guestName': 'GuestPlayer',
      'meta/status': 'toss',
      'presence/guest/online': true,
      'presence/guest/lastSeen': Date.now()
    });
    console.log('✓ Guest joined room; status transitioned to: toss');

    // 5. Toss phase
    // Host sets caller = guest
    await update(ref(dbHost, `rooms/${roomId}/toss`), { caller: 'guest', status: 'calling' });

    // Guest submits call = heads
    await update(ref(dbGuest, `rooms/${roomId}/toss`), { call: 'heads', status: 'flipped' });
    console.log('✓ Guest submitted toss call: heads');

    // Host flips coin and resolves winner = guest
    await update(ref(dbHost, `rooms/${roomId}/toss`), { result: 'heads', winner: 'guest', status: 'deciding' });

    // Guest chooses bat
    const hostBatsFirst = false; // guest bats first
    await update(roomRefGuest, {
      'toss/decision': 'bat',
      'toss/hostBatsFirst': hostBatsFirst,
      'meta/status': 'playing',
      'game': {
        roundIndex: 1,
        hostBatsFirst: false,
        isBatter1Batting: false, // guest is batting
        player1Score: 0,
        player2Score: 0,
        currentBall: 1,
        firstInningsComplete: false,
        targetScore: null,
        gameOver: false
      }
    });
    console.log('✓ Toss complete: Guest won toss and chose to bat first');

    // 6. Round 1 Moves: Guest bats, Host bowls
    // Security check: Invalid run value (e.g. 9) -> MUST FAIL
    try {
      await set(ref(dbHost, `rooms/${roomId}/rounds/1/hostMove`), 9);
      assert.fail('Should reject invalid run value > 6');
    } catch (err) {
      assert(err.message.includes('PERMISSION_DENIED') || err.message.includes('permission_denied'));
      console.log('✓ Security: Invalid run value (9) rejected by database.rules.json');
    }

    // Host submits valid bowling move: 4
    await set(ref(dbHost, `rooms/${roomId}/rounds/1/hostMove`), 4);
    console.log('✓ Host locked in move: 4');

    // Security check: Host tries to overwrite their locked move -> MUST FAIL
    try {
      await set(ref(dbHost, `rooms/${roomId}/rounds/1/hostMove`), 6);
      assert.fail('Should reject move overwrite');
    } catch (err) {
      assert(err.message.toLowerCase().includes('permission') || err.code === 'PERMISSION_DENIED', `Expected permission error but got: ${err.message}`);
      console.log('✓ Security: Locked move cannot be changed or overwritten');
    }

    // Guest submits batting move: 4 (bc === bw -> OUT!)
    await set(ref(dbGuest, `rooms/${roomId}/rounds/1/guestMove`), 4);
    console.log('✓ Guest locked in move: 4');

    // Host resolves Round 1: OUT! First innings ends, target is 0 + 1 = 1. Host bats next!
    await update(roomRefHost, {
      'rounds/1/resolved': true,
      'game/roundIndex': 2,
      'game/isBatter1Batting': true, // Host bats in 2nd innings
      'game/firstInningsComplete': true,
      'game/targetScore': 0,
      'game/currentBall': 1,
      'game/lastBatterChoice': 4,
      'game/lastBowlerChoice': 4,
      'game/roundOutcome': 'out'
    });
    console.log('✓ Round 1 resolved: Guest OUT! Innings switched. Host chasing target 1.');

    // 7. Round 2 Moves: Host bats, Guest bowls
    await set(ref(dbHost, `rooms/${roomId}/rounds/2/hostMove`), 6);
    await set(ref(dbGuest, `rooms/${roomId}/rounds/2/guestMove`), 2);

    // Host resolves Round 2: 6 runs scored. 6 > 0 -> Host WINS!
    await update(roomRefHost, {
      'rounds/2/resolved': true,
      'meta/status': 'finished',
      'game/roundIndex': 3,
      'game/player1Score': 6,
      'game/gameOver': true,
      'game/winner': 'host',
      'game/lastBatterChoice': 6,
      'game/lastBowlerChoice': 2,
      'game/roundOutcome': 'runs',
      'game/roundRuns': 6
    });
    console.log('✓ Round 2 resolved: Host hit 6, chased target and won match! Status: finished');

    // 8. Presence & Reconnection Simulation
    await update(ref(dbGuest, `rooms/${roomId}/presence/guest`), { online: false, lastSeen: Date.now() });
    let presenceSnap = await get(ref(dbHost, `rooms/${roomId}/presence/guest`));
    assert.strictEqual(presenceSnap.val().online, false);
    console.log('✓ Presence detection: Guest disconnect simulated (online: false)');

    // Reconnection
    await update(ref(dbGuest, `rooms/${roomId}/presence/guest`), { online: true, lastSeen: Date.now() });
    presenceSnap = await get(ref(dbHost, `rooms/${roomId}/presence/guest`));
    assert.strictEqual(presenceSnap.val().online, true);
    console.log('✓ Reconnection: Guest reconnected (online: true), match state verified intact');

    const finalGameSnap = await get(ref(dbGuest, `rooms/${roomId}/game`));
    assert.strictEqual(finalGameSnap.val().gameOver, true);
    assert.strictEqual(finalGameSnap.val().winner, 'host');
    assert.strictEqual(finalGameSnap.val().player1Score, 6);

    console.log('\n✅ All RTDB Private Multiplayer & Security Rules tests passed!\n');
  } finally {
    await deleteApp(appHost);
    await deleteApp(appGuest);
    await deleteApp(appEve);
  }
}

export { runMultiplayerRTDBTests };

if (process.argv[1]?.endsWith('test-multiplayer-rtdb.js')) {
  runMultiplayerRTDBTests().catch(err => {
    console.error('❌ RTDB test failed:', err);
    process.exit(1);
  });
}
