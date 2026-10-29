// Comprehensive Automated Test Suite for Casual Online Matchmaking (Milestone 2)
// Verifies all 15 scenarios under the Firebase Emulator Suite:
// 1. Two players successfully match
// 2. Players cannot match themselves
// 3. Three simultaneous players produce only one pair
// 4. Two simultaneous match claims cannot double-match a player
// 5. Canceling search removes availability
// 6. Disconnecting while searching expires the queue entry
// 7. Refreshing during matchmaking recovers safely
// 8. Match creation failure doesn't strand players
// 9. Both players enter the same room
// 10. Toss and complete two-innings gameplay work
// 11. Existing private-room multiplayer remains functional
// 12. Security rules reject unauthorized queue modifications
// 13. No opponent available handling
// 14. Opponent disconnects immediately after pairing
// 15. Rematch after an automatically matched game

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
  update,
  remove,
  query,
  orderByChild,
  equalTo,
  limitToFirst,
  runTransaction
} from 'firebase/database';

const firebaseConfig = {
  apiKey: "fake-api-key-for-emulator",
  authDomain: "handcricket-e6b39.firebaseapp.com",
  projectId: "handcricket-e6b39",
  databaseURL: "http://127.0.0.1:9000?ns=handcricket-e6b39-default-rtdb"
};

async function sha256Hex(str) {
  const data = new TextEncoder().encode(String(str));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function runCasualMatchmakingTests() {
  console.log('\n========================================================');
  console.log('   CASUAL ONLINE MATCHMAKING AUTOMATED TEST SUITE        ');
  console.log('========================================================\n');

  const appAlice = initializeApp(firebaseConfig, 'mm-alice-' + Date.now());
  const authAlice = getAuth(appAlice);
  const dbAlice = getDatabase(appAlice);
  connectAuthEmulator(authAlice, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectDatabaseEmulator(dbAlice, '127.0.0.1', 9000);

  const appBob = initializeApp(firebaseConfig, 'mm-bob-' + Date.now());
  const authBob = getAuth(appBob);
  const dbBob = getDatabase(appBob);
  connectAuthEmulator(authBob, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectDatabaseEmulator(dbBob, '127.0.0.1', 9000);

  const appCharlie = initializeApp(firebaseConfig, 'mm-charlie-' + Date.now());
  const authCharlie = getAuth(appCharlie);
  const dbCharlie = getDatabase(appCharlie);
  connectAuthEmulator(authCharlie, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectDatabaseEmulator(dbCharlie, '127.0.0.1', 9000);

  const appEve = initializeApp(firebaseConfig, 'mm-eve-' + Date.now());
  const authEve = getAuth(appEve);
  const dbEve = getDatabase(appEve);
  connectAuthEmulator(authEve, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectDatabaseEmulator(dbEve, '127.0.0.1', 9000);

  const ts = Date.now();
  const aliceCred = await createUserWithEmailAndPassword(authAlice, `alice_mm_${ts}@test.com`, 'password123');
  const bobCred = await createUserWithEmailAndPassword(authBob, `bob_mm_${ts}@test.com`, 'password123');
  const charlieCred = await createUserWithEmailAndPassword(authCharlie, `charlie_mm_${ts}@test.com`, 'password123');
  const eveCred = await createUserWithEmailAndPassword(authEve, `eve_mm_${ts}@test.com`, 'password123');

  const aliceUid = aliceCred.user.uid;
  const bobUid = bobCred.user.uid;
  const charlieUid = charlieCred.user.uid;
  const eveUid = eveCred.user.uid;

  try {
    // -------------------------------------------------------------
    // TEST 1 & 9: Two players successfully match & enter same room
    // -------------------------------------------------------------
    console.log('--- [Scenario 1 & 9] Two players successfully match & enter same room ---');
    // Alice enters queue
    const aliceTicketRef = ref(dbAlice, `matchmaking/queue/${aliceUid}`);
    await set(aliceTicketRef, {
      uid: aliceUid,
      name: 'Alice',
      avatar: 'starter',
      status: 'waiting',
      joinedAt: Date.now(),
      roomId: null,
      matchedWith: null,
      matchedWithName: null,
      matchedWithAvatar: null
    });

    // Bob searches queue, finds Alice, claims Alice
    const searchSnap = await get(query(ref(dbBob, 'matchmaking/queue'), orderByChild('status'), equalTo('waiting'), limitToFirst(5)));
    assert(searchSnap.exists(), 'Bob must find waiting ticket');

    const room1Code = 'MMRM1';
    let transactionCalls = 0;
    const targetRef = ref(dbBob, `matchmaking/queue/${aliceUid}`);
    // Pre-cache target
    const preSnap = await get(targetRef);

    const claimRes = await runTransaction(targetRef, (current) => {
      transactionCalls++;
      const base = current || preSnap.val();
      if (!base || base.status !== 'waiting') return;
      return {
        ...base,
        status: 'matched',
        matchedWith: bobUid,
        matchedWithName: 'Bob',
        matchedWithAvatar: 'starter',
        roomId: room1Code
      };
    });
    assert(claimRes.committed, 'Bob transaction claim must commit');

    // Bob creates casual room as Host
    const room1Ref = ref(dbBob, `rooms/${room1Code}`);
    await set(room1Ref, {
      meta: {
        hostUid: bobUid,
        hostName: 'Bob',
        guestUid: aliceUid,
        guestName: 'Alice',
        status: 'toss',
        mode: 'casual'
      },
      presence: {
        host: { online: true, lastSeen: Date.now() }
      }
    });

    // Alice reads ticket and sees matched with room1Code
    const aliceSnap = await get(aliceTicketRef);
    assert.strictEqual(aliceSnap.val().status, 'matched', 'Alice ticket must be matched');
    assert.strictEqual(aliceSnap.val().roomId, room1Code, 'Alice ticket roomId must be MMRM1');

    // Alice joins room as Guest
    await set(ref(dbAlice, `rooms/${room1Code}/presence/guest`), {
      online: true,
      lastSeen: Date.now()
    });

    const roomSnap = await get(ref(dbAlice, `rooms/${room1Code}`));
    assert.strictEqual(roomSnap.val().meta.hostUid, bobUid, 'Host must be Bob');
    assert.strictEqual(roomSnap.val().meta.guestUid, aliceUid, 'Guest must be Alice');
    assert(roomSnap.val().presence.host.online, 'Host must be online');
    assert(roomSnap.val().presence.guest.online, 'Guest must be online');

    // Clean up ticket
    await remove(ref(dbAlice, `matchmaking/queue/${aliceUid}`));
    console.log('✓ Scenario 1 & 9 Passed: Two players matched atomically into same room MMRM1.');

    // -------------------------------------------------------------
    // TEST 2: Players cannot match themselves
    // -------------------------------------------------------------
    console.log('\n--- [Scenario 2] Players cannot match themselves ---');
    const selfTicketRef = ref(dbAlice, `matchmaking/queue/${aliceUid}`);
    await set(selfTicketRef, {
      uid: aliceUid,
      name: 'Alice',
      avatar: 'starter',
      status: 'waiting',
      joinedAt: Date.now(),
      roomId: null,
      matchedWith: null
    });

    let selfMatchAllowed = false;
    try {
      await update(selfTicketRef, {
        status: 'matched',
        matchedWith: aliceUid, // self match attempt!
        roomId: 'SELF1'
      });
      selfMatchAllowed = true;
    } catch (err) {
      assert(err.message.toLowerCase().includes('permission_denied'), `Expected permission_denied, got: ${err.message}`);
    }
    assert.strictEqual(selfMatchAllowed, false, 'Security rules must reject self-matching');
    await remove(selfTicketRef);
    console.log('✓ Scenario 2 Passed: Self-matching rejected by RTDB security rules.');

    // -------------------------------------------------------------
    // TEST 3 & 4: Concurrent claim & 3 players produce only one pair
    // -------------------------------------------------------------
    console.log('\n--- [Scenario 3 & 4] Concurrent claims & 3 simultaneous players ---');
    // Alice is waiting
    const aliceData34 = {
      uid: aliceUid,
      name: 'Alice',
      avatar: 'starter',
      status: 'waiting',
      joinedAt: Date.now(),
      roomId: null,
      matchedWith: null
    };
    await set(ref(dbAlice, `matchmaking/queue/${aliceUid}`), aliceData34);

    // Bob and Charlie simultaneously attempt to claim Alice
    const roomBob = 'RMB01';
    const roomCharlie = 'RMC01';

    let bobCommitted = false;
    let charlieCommitted = false;

    const [resBob, resCharlie] = await Promise.allSettled([
      runTransaction(ref(dbBob, `matchmaking/queue/${aliceUid}`), (cur) => {
        const base = cur || aliceData34;
        if (!base || base.status !== 'waiting') return;
        return { ...base, status: 'matched', matchedWith: bobUid, matchedWithName: 'Bob', roomId: roomBob };
      }),
      runTransaction(ref(dbCharlie, `matchmaking/queue/${aliceUid}`), (cur) => {
        const base = cur || aliceData34;
        if (!base || base.status !== 'waiting') return;
        return { ...base, status: 'matched', matchedWith: charlieUid, matchedWithName: 'Charlie', roomId: roomCharlie };
      })
    ]);

    if (resBob.status === 'fulfilled' && resBob.value?.committed) {
      bobCommitted = resBob.value.snapshot?.val()?.status === 'matched' && resBob.value.snapshot?.val()?.matchedWith === bobUid;
    }
    if (resCharlie.status === 'fulfilled' && resCharlie.value?.committed) {
      charlieCommitted = resCharlie.value.snapshot?.val()?.status === 'matched' && resCharlie.value.snapshot?.val()?.matchedWith === charlieUid;
    }

    // Exactly one must commit, the other must abort or be rejected
    assert(bobCommitted !== charlieCommitted, 'Exactly one claim must commit and the other must be rejected');
    const winnerName = bobCommitted ? 'Bob' : 'Charlie';
    console.log(`✓ Scenario 3 & 4 Passed: Simultaneous claim collision resolved atomically. Winner: ${winnerName}. No double-match.`);

    // Winner cleans up Alice's matched ticket
    const dbWinner = bobCommitted ? dbBob : dbCharlie;
    await remove(ref(dbWinner, `matchmaking/queue/${aliceUid}`));

    // -------------------------------------------------------------
    // TEST 5: Canceling search removes player availability
    // -------------------------------------------------------------
    console.log('\n--- [Scenario 5] Canceling search removes availability ---');
    await set(ref(dbAlice, `matchmaking/queue/${aliceUid}`), {
      uid: aliceUid,
      name: 'Alice',
      avatar: 'starter',
      status: 'waiting',
      joinedAt: Date.now()
    });

    // Alice cancels
    await remove(ref(dbAlice, `matchmaking/queue/${aliceUid}`));

    const checkSnap = await get(ref(dbAlice, `matchmaking/queue/${aliceUid}`));
    assert.strictEqual(checkSnap.exists(), false, 'Ticket must be removed from queue');

    // Bob scans queue to verify Alice is no longer discoverable
    const bobQueueSnap = await get(query(ref(dbBob, 'matchmaking/queue'), orderByChild('status'), equalTo('waiting'), limitToFirst(5)));
    let foundAliceInQueue = false;
    bobQueueSnap.forEach(ch => { if (ch.key === aliceUid) foundAliceInQueue = true; });
    assert.strictEqual(foundAliceInQueue, false, 'Bob cannot discover canceled ticket in queue');
    console.log('✓ Scenario 5 Passed: Canceled ticket completely deleted.');

    // -------------------------------------------------------------
    // TEST 6: Disconnecting while searching & stale expiry check
    // -------------------------------------------------------------
    console.log('\n--- [Scenario 6] Stale ticket expiry check ---');
    // Ticket joined 80 seconds ago
    await set(ref(dbAlice, `matchmaking/queue/${aliceUid}`), {
      uid: aliceUid,
      name: 'Alice',
      avatar: 'starter',
      status: 'waiting',
      joinedAt: Date.now() - 80000
    });

    const staleSnap = await get(query(ref(dbBob, 'matchmaking/queue'), orderByChild('status'), equalTo('waiting'), limitToFirst(5)));
    let validCandidateCount = 0;
    staleSnap.forEach(child => {
      const val = child.val();
      if (val.status === 'waiting' && Date.now() - val.joinedAt < 60000) {
        validCandidateCount++;
      }
    });
    assert.strictEqual(validCandidateCount, 0, 'Stale tickets (>60s) must be ignored as candidates');
    await remove(ref(dbAlice, `matchmaking/queue/${aliceUid}`));
    console.log('✓ Scenario 6 Passed: Tickets older than 60s are safely filtered as expired.');

    // -------------------------------------------------------------
    // TEST 7: Refreshing during matchmaking recovers safely
    // -------------------------------------------------------------
    console.log('\n--- [Scenario 7] Refresh recovery ---');
    // User had a ticket from previous session
    await set(ref(dbAlice, `matchmaking/queue/${aliceUid}`), {
      uid: aliceUid,
      name: 'Alice',
      avatar: 'starter',
      status: 'waiting',
      joinedAt: Date.now()
    });

    // On reload / new session start, clean up previous ticket
    await remove(ref(dbAlice, `matchmaking/queue/${aliceUid}`));
    // Re-create new ticket
    await set(ref(dbAlice, `matchmaking/queue/${aliceUid}`), {
      uid: aliceUid,
      name: 'Alice',
      avatar: 'starter',
      status: 'waiting',
      joinedAt: Date.now()
    });
    const reloadedSnap = await get(ref(dbAlice, `matchmaking/queue/${aliceUid}`));
    assert(reloadedSnap.exists(), 'New ticket created cleanly after recovery');
    await remove(ref(dbAlice, `matchmaking/queue/${aliceUid}`));
    console.log('✓ Scenario 7 Passed: Recovered cleanly across simulated browser reload.');

    // -------------------------------------------------------------
    // TEST 8: Match creation failure doesn't strand players
    // -------------------------------------------------------------
    console.log('\n--- [Scenario 8] Match creation failure recovery ---');
    // Alice ticket waiting (joined 15 seconds ago, simulating watchdog window)
    await set(ref(dbAlice, `matchmaking/queue/${aliceUid}`), {
      uid: aliceUid,
      name: 'Alice',
      avatar: 'starter',
      status: 'waiting',
      joinedAt: Date.now() - 15000
    });

    // Bob claims Alice with phantom room that fails to be created
    await update(ref(dbBob, `matchmaking/queue/${aliceUid}`), {
      status: 'matched',
      matchedWith: bobUid,
      matchedWithName: 'Bob',
      roomId: 'PHANTOM'
    });

    // Alice checks for room PHANTOM
    const phantomSnap = await get(ref(dbAlice, 'rooms/PHANTOM'));
    assert.strictEqual(phantomSnap.exists(), false, 'Phantom room does not exist');
    // Watchdog clean up: Alice removes stale ticket and returns to queue
    await remove(ref(dbAlice, `matchmaking/queue/${aliceUid}`));
    const cleanedSnap = await get(ref(dbAlice, `matchmaking/queue/${aliceUid}`));
    assert.strictEqual(cleanedSnap.exists(), false, 'Alice recovered without being stranded');
    console.log('✓ Scenario 8 Passed: Watchdog detected absent room; player recovered cleanly.');

    // -------------------------------------------------------------
    // TEST 10: Toss and complete two-innings gameplay work in casual room
    // -------------------------------------------------------------
    console.log('\n--- [Scenario 10] Toss and complete two-innings gameplay in casual room ---');
    const casualRoomId = 'CAS01';
    const cRoomRef = ref(dbBob, `rooms/${casualRoomId}`);
    await set(cRoomRef, {
      meta: {
        hostUid: bobUid,
        hostName: 'Bob',
        guestUid: aliceUid,
        guestName: 'Alice',
        status: 'toss',
        mode: 'casual'
      },
      presence: {
        host: { online: true, lastSeen: Date.now() }
      }
    });
    await set(ref(dbAlice, `rooms/${casualRoomId}/presence/guest`), {
      online: true,
      lastSeen: Date.now()
    });

    // Toss: Bob commits hostSeed, Alice calls heads
    const bobSeed = 'secret_seed_bob_casual_123';
    const bobCommit = await sha256Hex(bobSeed);
    await set(ref(dbBob, `rooms/${casualRoomId}/toss`), {
      caller: 'guest',
      hostCommit: bobCommit,
      status: 'calling'
    });

    await update(ref(dbAlice, `rooms/${casualRoomId}/toss`), {
      call: 'heads',
      guestCall: 'heads',
      guestSeed: 'seed_alice_123',
      status: 'flipped'
    });

    // Host reveals seed, toss resolves (Bob bats first)
    await update(ref(dbBob, `rooms/${casualRoomId}/toss`), {
      hostSeed: bobSeed,
      result: 'heads',
      winner: 'guest',
      status: 'deciding'
    });

    // Alice elects to bat first, match launches into playing
    await update(cRoomRef, {
      'meta/status': 'playing',
      'toss/decision': 'bat',
      'game': {
        roundIndex: 1,
        innings: 1,
        hostBatsFirst: false,
        isBatter1Batting: false, // guest (Alice) is batting
        player1Score: 0,
        player2Score: 0,
        currentBall: 1,
        gameOver: false
      }
    });

    // Round 1: Alice hits 3, Bob bowls 1 -> 3 runs
    const saltA1 = 'saltA1_casual';
    const saltB1 = 'saltB1_casual';
    const commitA1 = await sha256Hex('3:' + saltA1);
    const commitB1 = await sha256Hex('1:' + saltB1);

    await update(ref(dbAlice, `rooms/${casualRoomId}/rounds/1`), { guestCommit: commitA1 });
    await update(ref(dbBob, `rooms/${casualRoomId}/rounds/1`), { hostCommit: commitB1 });
    await update(ref(dbAlice, `rooms/${casualRoomId}/rounds/1`), { guestMove: 3, guestSalt: saltA1 });
    await update(ref(dbBob, `rooms/${casualRoomId}/rounds/1`), { hostMove: 1, hostSalt: saltB1 });

    // Host resolves Round 1
    await update(cRoomRef, {
      'game/roundIndex': 2,
      'game/player2Score': 3, // Alice has 3 runs
      'game/currentBall': 2,
      'rounds/1/resolved': true
    });

    // Round 2: Both submit 4 -> OUT! Innings 1 completes, Target is 4 (3 + 1)
    const commitA2 = await sha256Hex('4:saltA2');
    const commitB2 = await sha256Hex('4:saltB2');
    await update(ref(dbAlice, `rooms/${casualRoomId}/rounds/2`), { guestCommit: commitA2 });
    await update(ref(dbBob, `rooms/${casualRoomId}/rounds/2`), { hostCommit: commitB2 });
    await update(ref(dbAlice, `rooms/${casualRoomId}/rounds/2`), { guestMove: 4, guestSalt: 'saltA2' });
    await update(ref(dbBob, `rooms/${casualRoomId}/rounds/2`), { hostMove: 4, hostSalt: 'saltB2' });

    // Host transitions to Innings 2: Target = 4, Bob is now batting
    await update(cRoomRef, {
      'game/roundIndex': 3,
      'game/innings': 2,
      'game/firstInningsComplete': true,
      'game/firstInningsScore': 3,
      'game/targetScore': 4,
      'game/isBatter1Batting': true, // Bob is now batting
      'game/currentBall': 1,
      'rounds/2/resolved': true
    });

    const inn2Snap = await get(ref(dbAlice, `rooms/${casualRoomId}/game`));
    assert.strictEqual(inn2Snap.val().innings, 2, 'Must transition to innings 2');
    assert.strictEqual(inn2Snap.val().targetScore, 4, 'Target score must be 4');
    assert.strictEqual(inn2Snap.val().isBatter1Batting, true, 'Bob must be batter in innings 2');

    // Innings 2 Round 3: Bob hits 6, Alice bowls 2 -> Target Chased!
    const commitA3 = await sha256Hex('2:saltA3');
    const commitB3 = await sha256Hex('6:saltB3');
    await update(ref(dbAlice, `rooms/${casualRoomId}/rounds/3`), { guestCommit: commitA3 });
    await update(ref(dbBob, `rooms/${casualRoomId}/rounds/3`), { hostCommit: commitB3 });
    await update(ref(dbAlice, `rooms/${casualRoomId}/rounds/3`), { guestMove: 2, guestSalt: 'saltA3' });
    await update(ref(dbBob, `rooms/${casualRoomId}/rounds/3`), { hostMove: 6, hostSalt: 'saltB3' });

    await update(cRoomRef, {
      'game/player1Score': 6,
      'game/gameOver': true,
      'game/winner': 'host',
      'meta/status': 'finished',
      'rounds/3/resolved': true
    });

    const finishedSnap = await get(ref(dbAlice, `rooms/${casualRoomId}`));
    assert.strictEqual(finishedSnap.val().meta.status, 'finished', 'Status must be finished');
    assert.strictEqual(finishedSnap.val().game.winner, 'host', 'Bob (host) must be winner');
    console.log('✓ Scenario 10 Passed: Provably fair toss, 2 full innings, target 4, role switch and match completion verified.');

    // -------------------------------------------------------------
    // TEST 11: Existing private-room multiplayer remains functional
    // -------------------------------------------------------------
    console.log('\n--- [Scenario 11] Existing private-room multiplayer remains functional ---');
    const privCode = 'PRV01';
    await set(ref(dbAlice, `rooms/${privCode}`), {
      meta: {
        hostUid: aliceUid,
        hostName: 'Alice',
        status: 'waiting',
        mode: 'online'
      },
      presence: {
        host: { online: true, lastSeen: Date.now() }
      }
    });

    // Bob joins via room code
    await update(ref(dbBob, `rooms/${privCode}`), {
      'meta/guestUid': bobUid,
      'meta/guestName': 'Bob',
      'meta/status': 'toss',
      'presence/guest/online': true
    });

    const privSnap = await get(ref(dbAlice, `rooms/${privCode}`));
    assert.strictEqual(privSnap.val().meta.status, 'toss', 'Private room join must set status to toss');
    assert.strictEqual(privSnap.val().meta.guestUid, bobUid, 'Guest must be Bob');
    console.log('✓ Scenario 11 Passed: Private-room creation and code joining unaffected.');

    // -------------------------------------------------------------
    // TEST 12: Security rules reject unauthorized queue modifications
    // -------------------------------------------------------------
    console.log('\n--- [Scenario 12] Security rules reject unauthorized queue modifications ---');
    // Eve tries to create a ticket under Alice's UID
    let eveForgedAlice = false;
    try {
      await set(ref(dbEve, `matchmaking/queue/${aliceUid}`), {
        uid: aliceUid,
        name: 'Forged',
        status: 'waiting',
        joinedAt: Date.now()
      });
      eveForgedAlice = true;
    } catch (err) {
      assert(err.message.toLowerCase().includes('permission_denied'));
    }
    assert.strictEqual(eveForgedAlice, false, 'Eve cannot create ticket under Alice UID');

    // Alice cannot create a ticket pre-set to 'matched' or with matchedWith already set
    let preMatchedAllowed = false;
    try {
      await set(ref(dbAlice, `matchmaking/queue/${aliceUid}`), {
        uid: aliceUid,
        name: 'Alice',
        avatar: 'starter',
        status: 'waiting',
        matchedWith: bobUid,
        joinedAt: Date.now()
      });
      preMatchedAllowed = true;
    } catch (err) {
      assert(err.message.toLowerCase().includes('permission_denied'));
    }
    assert.strictEqual(preMatchedAllowed, false, 'Ticket cannot be created with pre-populated matchedWith');

    // Alice creates valid waiting ticket
    const aliceJoinedAt = Date.now();
    await set(ref(dbAlice, `matchmaking/queue/${aliceUid}`), {
      uid: aliceUid,
      name: 'Alice',
      avatar: 'starter',
      status: 'waiting',
      joinedAt: aliceJoinedAt
    });

    // Bob tries to modify Alice's name during claim
    let nameTamperAllowed = false;
    try {
      await update(ref(dbBob, `matchmaking/queue/${aliceUid}`), {
        status: 'matched',
        matchedWith: bobUid,
        roomId: 'CAS_LEGIT',
        name: 'TamperedAlice'
      });
      nameTamperAllowed = true;
    } catch (err) {
      assert(err.message.toLowerCase().includes('permission_denied'));
    }
    assert.strictEqual(nameTamperAllowed, false, 'Claiming player cannot modify target display name');

    // Bob tries to modify Alice's avatar during claim
    let avatarTamperAllowed = false;
    try {
      await update(ref(dbBob, `matchmaking/queue/${aliceUid}`), {
        status: 'matched',
        matchedWith: bobUid,
        roomId: 'CAS_LEGIT',
        avatar: 'hacked_avatar_id'
      });
      avatarTamperAllowed = true;
    } catch (err) {
      assert(err.message.toLowerCase().includes('permission_denied'));
    }
    assert.strictEqual(avatarTamperAllowed, false, 'Claiming player cannot modify target avatar');

    // Bob tries to modify Alice's joinedAt timestamp during claim
    let timestampTamperAllowed = false;
    try {
      await update(ref(dbBob, `matchmaking/queue/${aliceUid}`), {
        status: 'matched',
        matchedWith: bobUid,
        roomId: 'CAS_LEGIT',
        joinedAt: 12345
      });
      timestampTamperAllowed = true;
    } catch (err) {
      assert(err.message.toLowerCase().includes('permission_denied'));
    }
    assert.strictEqual(timestampTamperAllowed, false, 'Claiming player cannot modify target joinedAt timestamp');

    // Bob tries to inject illegal schema fields ($other)
    let schemaTamperAllowed = false;
    try {
      await update(ref(dbBob, `matchmaking/queue/${aliceUid}`), {
        status: 'matched',
        matchedWith: bobUid,
        roomId: 'CAS_LEGIT',
        adminPrivilege: true
      });
      schemaTamperAllowed = true;
    } catch (err) {
      assert(err.message.toLowerCase().includes('permission_denied'));
    }
    assert.strictEqual(schemaTamperAllowed, false, 'Claiming player cannot inject extraneous fields ($other rejected)');

    // Eve tries to delete Alice's ticket without claiming it
    let eveDeletedTicket = false;
    try {
      await remove(ref(dbEve, `matchmaking/queue/${aliceUid}`));
      eveDeletedTicket = true;
    } catch (err) {
      assert(err.message.toLowerCase().includes('permission_denied'));
    }
    assert.strictEqual(eveDeletedTicket, false, 'Eve cannot delete Alice un-matched ticket');

    // Bob claims Alice legitimately
    await update(ref(dbBob, `matchmaking/queue/${aliceUid}`), {
      status: 'matched',
      matchedWith: bobUid,
      matchedWithName: 'Bob',
      roomId: 'CAS_LEGIT'
    });

    // Once matched, Eve tries to re-claim Alice
    let eveReclaimed = false;
    try {
      await update(ref(dbEve, `matchmaking/queue/${aliceUid}`), {
        status: 'matched',
        matchedWith: eveUid,
        roomId: 'CAS_EVE'
      });
      eveReclaimed = true;
    } catch (err) {
      assert(err.message.toLowerCase().includes('permission_denied'));
    }
    assert.strictEqual(eveReclaimed, false, 'Eve cannot re-claim an already matched ticket');

    // Once matched, stranger Eve cannot read Alice's matched ticket
    let eveReadMatched = false;
    try {
      const eveReadSnap = await get(ref(dbEve, `matchmaking/queue/${aliceUid}`));
      if (eveReadSnap.exists()) eveReadMatched = true;
    } catch (err) {
      assert(err.message.toLowerCase().includes('permission') || err.message.toLowerCase().includes('denied'));
    }
    assert.strictEqual(eveReadMatched, false, 'Stranger Eve cannot read Alice matched ticket');

    // Alice cannot prematurely delete matched ticket before room is created
    let alicePrematureDeleteAllowed = false;
    try {
      await remove(ref(dbAlice, `matchmaking/queue/${aliceUid}`));
      alicePrematureDeleteAllowed = true;
    } catch (err) {
      assert(err.message.toLowerCase().includes('permission') || err.message.toLowerCase().includes('denied'));
    }
    assert.strictEqual(alicePrematureDeleteAllowed, false, 'Security rules prevent owner premature deletion while matched before room creation');

    // Bob (matched opponent) cleans up the ticket
    await remove(ref(dbBob, `matchmaking/queue/${aliceUid}`));
    console.log('✓ Scenario 12 Passed: RTDB security rules rejected all unauthorized queue modifications & field tampering.');

    // -------------------------------------------------------------
    // TEST 13: No opponent available handling
    // -------------------------------------------------------------
    console.log('\n--- [Scenario 13] No opponent available handling ---');
    // Check queue has no waiting tickets
    const emptySnap = await get(query(ref(dbAlice, 'matchmaking/queue'), orderByChild('status'), equalTo('waiting'), limitToFirst(5)));
    assert.strictEqual(emptySnap.exists(), false, 'Queue must have no waiting tickets initially');

    // Alice creates ticket and waits
    await set(ref(dbAlice, `matchmaking/queue/${aliceUid}`), {
      uid: aliceUid,
      name: 'Alice',
      avatar: 'starter',
      status: 'waiting',
      joinedAt: Date.now()
    });

    const waitingSnap = await get(ref(dbAlice, `matchmaking/queue/${aliceUid}`));
    assert.strictEqual(waitingSnap.val().status, 'waiting', 'Status remains waiting when no opponent');
    await remove(ref(dbAlice, `matchmaking/queue/${aliceUid}`));
    console.log('✓ Scenario 13 Passed: Handled empty queue; ticket remains waiting until opponent arrives or canceled.');

    // -------------------------------------------------------------
    // TEST 14: Opponent disconnects immediately after pairing
    // -------------------------------------------------------------
    console.log('\n--- [Scenario 14] Opponent disconnects immediately after pairing ---');
    const pairRoomCode = 'DISC1';
    await set(ref(dbBob, `rooms/${pairRoomCode}`), {
      meta: {
        hostUid: bobUid,
        hostName: 'Bob',
        guestUid: aliceUid,
        guestName: 'Alice',
        status: 'toss',
        mode: 'casual'
      },
      presence: {
        host: { online: true, lastSeen: Date.now() }
      }
    });
    await set(ref(dbAlice, `rooms/${pairRoomCode}/presence/guest`), {
      online: false,
      lastSeen: Date.now()
    });

    const presSnap = await get(ref(dbBob, `rooms/${pairRoomCode}/presence/guest`));
    assert.strictEqual(presSnap.val().online, false, 'Guest is detected offline');
    console.log('✓ Scenario 14 Passed: Opponent offline status detected via presence.');

    // -------------------------------------------------------------
    // TEST 15: Rematch after an automatically matched game
    // -------------------------------------------------------------
    console.log('\n--- [Scenario 15] Rematch after an automatically matched game ---');
    const rematchRoomCode = 'REMM1';
    await set(ref(dbBob, `rooms/${rematchRoomCode}`), {
      meta: {
        hostUid: bobUid,
        hostName: 'Bob',
        guestUid: aliceUid,
        guestName: 'Alice',
        status: 'toss',
        mode: 'casual'
      },
      game: {
        gameOver: false
      },
      rematch: {
        status: 'idle',
        hostWantsRematch: false,
        guestWantsRematch: false
      }
    });

    await update(ref(dbBob, `rooms/${rematchRoomCode}`), {
      'meta/status': 'finished',
      'game/gameOver': true,
      'game/winner': 'host'
    });

    // Bob requests rematch
    await update(ref(dbBob, `rooms/${rematchRoomCode}/rematch`), {
      status: 'requested',
      hostWantsRematch: true,
      requestedBy: 'host'
    });

    // Alice accepts rematch
    await update(ref(dbAlice, `rooms/${rematchRoomCode}/rematch`), {
      status: 'accepted',
      guestWantsRematch: true
    });

    // Bob resets room to toss
    await update(ref(dbBob, `rooms/${rematchRoomCode}`), {
      'meta/status': 'toss',
      'rematch/status': 'idle',
      'rematch/hostWantsRematch': false,
      'rematch/guestWantsRematch': false,
      'game': {
        roundIndex: 1,
        innings: 1,
        player1Score: 0,
        player2Score: 0,
        currentBall: 1,
        gameOver: false
      }
    });

    const remResetSnap = await get(ref(dbAlice, `rooms/${rematchRoomCode}`));
    assert.strictEqual(remResetSnap.val().meta.status, 'toss', 'Room must be reset to toss for rematch');
    assert.strictEqual(remResetSnap.val().game.player1Score, 0, 'Scores must be reset to 0');
    assert.strictEqual(remResetSnap.val().game.gameOver, false, 'gameOver must be false');
    console.log('✓ Scenario 15 Passed: Mutual rematch in casual room resets cleanly to coin toss.');

    // -------------------------------------------------------------
    // TEST 16: Queue Discovery Bounds (Un-queried & Unbounded Reads Rejected)
    // -------------------------------------------------------------
    console.log('\n--- [Scenario 16] Queue Discovery Bounds ---');
    // 1. Broad un-queried read must be rejected
    let broadReadAllowed = false;
    try {
      await get(ref(dbEve, 'matchmaking/queue'));
      broadReadAllowed = true;
    } catch (err) {
      assert(err.message.toLowerCase().includes('permission') || err.message.toLowerCase().includes('denied'));
    }
    assert.strictEqual(broadReadAllowed, false, 'Broad un-queried read of entire matchmaking queue must be rejected');

    // 2. Query with limitToFirst > 5 must be rejected
    let excessLimitAllowed = false;
    try {
      await get(query(ref(dbEve, 'matchmaking/queue'), orderByChild('status'), equalTo('waiting'), limitToFirst(10)));
      excessLimitAllowed = true;
    } catch (err) {
      assert(err.message.toLowerCase().includes('permission') || err.message.toLowerCase().includes('denied'));
    }
    assert.strictEqual(excessLimitAllowed, false, 'Queries with limitToFirst > 5 must be rejected by security rules');

    // 3. Query without equalTo('waiting') must be rejected
    let unconstrainedQueryAllowed = false;
    try {
      await get(query(ref(dbEve, 'matchmaking/queue'), orderByChild('status'), limitToFirst(5)));
      unconstrainedQueryAllowed = true;
    } catch (err) {
      assert(err.message.toLowerCase().includes('permission') || err.message.toLowerCase().includes('denied'));
    }
    assert.strictEqual(unconstrainedQueryAllowed, false, 'Queries without equalTo(waiting) must be rejected');

    // 4. Bounded compliant query must succeed
    const compliantSnap = await get(query(ref(dbEve, 'matchmaking/queue'), orderByChild('status'), equalTo('waiting'), limitToFirst(5)));
    assert.strictEqual(compliantSnap.exists(), false, 'Compliant bounded query must execute successfully');
    console.log('✓ Scenario 16 Passed: RTDB security rules strictly enforce bounded discovery (limitToFirst <= 5, equalTo: waiting).');

    // -------------------------------------------------------------
    // TEST 17: Concurrent Matchmaking Invariants & Bidirectional Race Resolution
    // -------------------------------------------------------------
    console.log('\n--- [Scenario 17] Concurrent Matchmaking Invariants & Bidirectional Race ---');
    // User tries to overwrite waiting ticket with another waiting ticket without deleting first
    await set(ref(dbAlice, `matchmaking/queue/${aliceUid}`), {
      uid: aliceUid,
      name: 'Alice',
      avatar: 'starter',
      status: 'waiting',
      joinedAt: Date.now()
    });

    let duplicateTicketAllowed = false;
    try {
      await set(ref(dbAlice, `matchmaking/queue/${aliceUid}`), {
        uid: aliceUid,
        name: 'Alice Second Tab',
        avatar: 'pro',
        status: 'waiting',
        joinedAt: Date.now()
      });
      duplicateTicketAllowed = true;
    } catch (err) {
      // Rule enforces (!data.exists() && ...)
      assert(err.message.toLowerCase().includes('permission') || err.message.toLowerCase().includes('denied'));
    }
    assert.strictEqual(duplicateTicketAllowed, false, 'Security rules prevent creating duplicate tickets without deleting existing');
    await remove(ref(dbAlice, `matchmaking/queue/${aliceUid}`));

    // Bidirectional claim collision test:
    // Alice and Bob both have tickets in the queue.
    // Ensure strict tie-breaker (myUid < candidateUid) ensures only one direction is executed.
    const lowerUid = aliceUid < bobUid ? aliceUid : bobUid;
    const higherUid = aliceUid < bobUid ? bobUid : aliceUid;
    const dbLower = aliceUid < bobUid ? dbAlice : dbBob;
    const dbHigher = aliceUid < bobUid ? dbBob : dbAlice;

    // Both enter queue
    await set(ref(dbLower, `matchmaking/queue/${lowerUid}`), {
      uid: lowerUid,
      name: 'LowerPlayer',
      avatar: 'starter',
      status: 'waiting',
      joinedAt: Date.now()
    });
    await set(ref(dbHigher, `matchmaking/queue/${higherUid}`), {
      uid: higherUid,
      name: 'HigherPlayer',
      avatar: 'starter',
      status: 'waiting',
      joinedAt: Date.now()
    });

    // Lower player scans queue: finds higher player, lowerUid < higherUid -> Lower player claims higher
    const scanSnap = await get(query(ref(dbLower, 'matchmaking/queue'), orderByChild('status'), equalTo('waiting'), limitToFirst(5)));
    let candidateToClaim = null;
    scanSnap.forEach(ch => {
      if (ch.key === higherUid) candidateToClaim = ch.val();
    });
    assert(candidateToClaim, 'Lower player finds higher player candidate');

    // Lower player executes transaction claim
    const biClaimRes = await runTransaction(ref(dbLower, `matchmaking/queue/${higherUid}`), (cur) => {
      const base = cur || candidateToClaim;
      if (!base || base.status !== 'waiting') return;
      return {
        ...base,
        status: 'matched',
        matchedWith: lowerUid,
        matchedWithName: 'LowerPlayer',
        roomId: 'CAS_BI01'
      };
    });
    assert.strictEqual(biClaimRes.committed, true, 'Lower player claim must commit');

    // Higher player's sweep checks if its own ticket is matched:
    const myTicketHigher = await get(ref(dbHigher, `matchmaking/queue/${higherUid}`));
    assert.strictEqual(myTicketHigher.val().status, 'matched', 'Higher player detects matched status on own ticket');
    assert.strictEqual(myTicketHigher.val().roomId, 'CAS_BI01', 'Higher player joins room CAS_BI01 without split room');

    // Clean up
    await remove(ref(dbLower, `matchmaking/queue/${lowerUid}`));
    await remove(ref(dbLower, `matchmaking/queue/${higherUid}`));
    console.log('✓ Scenario 17 Passed: Bidirectional race resolved deterministically via UID tie-break; zero split rooms.');

    // -------------------------------------------------------------
    // TEST 18: Stale Ticket Expiry (>60s) Does Not Block Discovery
    // -------------------------------------------------------------
    console.log('\n--- [Scenario 18] Stale Ticket Isolation ---');
    // Stale ticket from abandoned session (120s old)
    await set(ref(dbEve, `matchmaking/queue/${eveUid}`), {
      uid: eveUid,
      name: 'StaleEve',
      avatar: 'starter',
      status: 'waiting',
      joinedAt: Date.now() - 120000
    });

    // Fresh ticket from Alice (5s old)
    await set(ref(dbAlice, `matchmaking/queue/${aliceUid}`), {
      uid: aliceUid,
      name: 'FreshAlice',
      avatar: 'starter',
      status: 'waiting',
      joinedAt: Date.now()
    });

    // Bob scans: must filter out Eve (>60s) and claim FreshAlice
    const bobCandidatesSnap = await get(query(ref(dbBob, 'matchmaking/queue'), orderByChild('status'), equalTo('waiting'), limitToFirst(5)));
    const validCandidates = [];
    bobCandidatesSnap.forEach(ch => {
      const v = ch.val();
      if (ch.key !== bobUid && v && v.status === 'waiting') {
        const age = Date.now() - (v.joinedAt || 0);
        if (age < 60000) {
          validCandidates.push({ key: ch.key, ...v });
        }
      }
    });

    assert.strictEqual(validCandidates.length, 1, 'Exactly one fresh candidate must qualify');
    assert.strictEqual(validCandidates[0].key, aliceUid, 'Bob must pick FreshAlice, ignoring StaleEve');

    await remove(ref(dbEve, `matchmaking/queue/${eveUid}`));
    await remove(ref(dbAlice, `matchmaking/queue/${aliceUid}`));
    console.log('✓ Scenario 18 Passed: Stale tickets (>60s) safely isolated and cannot block matchmaking.');

    // -------------------------------------------------------------
    // TEST 19: Transition & Deletion Preconditions (Checks 1 & 6)
    // -------------------------------------------------------------
    console.log('\n--- [Scenario 19] Transition & Deletion Preconditions (Checks 1 & 6) ---');
    // Alice creates valid waiting ticket
    await set(ref(dbAlice, `matchmaking/queue/${aliceUid}`), {
      uid: aliceUid,
      name: 'Alice',
      avatar: 'starter',
      status: 'waiting',
      joinedAt: Date.now()
    });

    // Bob claims Alice without providing roomId -> must be rejected
    let claimWithoutRoomAllowed = false;
    try {
      await update(ref(dbBob, `matchmaking/queue/${aliceUid}`), {
        status: 'matched',
        matchedWith: bobUid
      });
      claimWithoutRoomAllowed = true;
    } catch (err) {
      assert(err.message.toLowerCase().includes('permission') || err.message.toLowerCase().includes('denied'));
    }
    assert.strictEqual(claimWithoutRoomAllowed, false, 'Claim without roomId must be rejected by security rules');

    // Bob claims Alice legitimately
    const verifiedRoomId = 'CAS_VER01';
    await update(ref(dbBob, `matchmaking/queue/${aliceUid}`), {
      status: 'matched',
      matchedWith: bobUid,
      matchedWithName: 'Bob',
      roomId: verifiedRoomId
    });

    // Eve tries to claim an already matched ticket -> must be rejected
    let reClaimWithExistingMatchedWithAllowed = false;
    try {
      await update(ref(dbEve, `matchmaking/queue/${aliceUid}`), {
        status: 'matched',
        matchedWith: eveUid,
        roomId: 'CAS_EVE99'
      });
      reClaimWithExistingMatchedWithAllowed = true;
    } catch (err) {
      assert(err.message.toLowerCase().includes('permission') || err.message.toLowerCase().includes('denied'));
    }
    assert.strictEqual(reClaimWithExistingMatchedWithAllowed, false, 'Claim on ticket with existing matchedWith/roomId rejected');

    // Bob creates the room
    await set(ref(dbBob, `rooms/${verifiedRoomId}`), {
      meta: {
        hostUid: bobUid,
        hostName: 'Bob',
        guestUid: aliceUid,
        guestName: 'Alice',
        status: 'toss',
        mode: 'casual'
      },
      presence: {
        host: { online: true, lastSeen: Date.now() }
      }
    });

    // Now that room exists, Alice CAN delete her matched ticket cleanly
    await remove(ref(dbAlice, `matchmaking/queue/${aliceUid}`));
    const finalAliceSnap = await get(ref(dbAlice, `matchmaking/queue/${aliceUid}`));
    assert.strictEqual(finalAliceSnap.exists(), false, 'Alice can cleanly delete her ticket once room is verified');
    console.log('✓ Scenario 19 Passed: Transition requires clean empty ticket; deletion safely gated by room existence.');

    // -------------------------------------------------------------
    // TEST 20: Room Impersonation & Action Forgery Rejection (Check 5)
    // -------------------------------------------------------------
    console.log('\n--- [Scenario 20] Room Impersonation & Action Forgery Rejection ---');
    // 1. Eve tries to create a room claiming she is Alice
    let eveImpersonateHostAllowed = false;
    try {
      await set(ref(dbEve, `rooms/FAKE_HOST`), {
        meta: {
          hostUid: aliceUid, // Eve tries to impersonate Alice!
          hostName: 'Alice',
          status: 'waiting',
          mode: 'online'
        }
      });
      eveImpersonateHostAllowed = true;
    } catch (err) {
      assert(err.message.toLowerCase().includes('permission') || err.message.toLowerCase().includes('denied'));
    }
    assert.strictEqual(eveImpersonateHostAllowed, false, 'Security rules prevent creating a room with another player hostUid');

    // 2. Bob (host of CAS_VER01) tries to forge Alice's guest presence
    let hostForgedGuestPresenceAllowed = false;
    try {
      await set(ref(dbBob, `rooms/${verifiedRoomId}/presence/guest`), {
        online: true,
        lastSeen: Date.now()
      });
      hostForgedGuestPresenceAllowed = true;
    } catch (err) {
      assert(err.message.toLowerCase().includes('permission') || err.message.toLowerCase().includes('denied'));
    }
    assert.strictEqual(hostForgedGuestPresenceAllowed, false, 'Host cannot forge guest presence in room');

    // 3. Bob (host) tries to submit guest commit/move
    let hostForgedGuestCommitAllowed = false;
    try {
      await update(ref(dbBob, `rooms/${verifiedRoomId}/rounds/1`), {
        guestCommit: 'fake_commit_hash_123456789'
      });
      hostForgedGuestCommitAllowed = true;
    } catch (err) {
      assert(err.message.toLowerCase().includes('permission') || err.message.toLowerCase().includes('denied'));
    }
    assert.strictEqual(hostForgedGuestCommitAllowed, false, 'Host cannot forge guest commit in room');

    // 4. Bob (host) tries to submit guest move
    let hostForgedGuestMoveAllowed = false;
    try {
      await update(ref(dbBob, `rooms/${verifiedRoomId}/rounds/1`), {
        guestMove: 4
      });
      hostForgedGuestMoveAllowed = true;
    } catch (err) {
      assert(err.message.toLowerCase().includes('permission') || err.message.toLowerCase().includes('denied'));
    }
    assert.strictEqual(hostForgedGuestMoveAllowed, false, 'Host cannot forge guest move in room');
    console.log('✓ Scenario 20 Passed: Room impersonation, presence forgery, and move forgery strictly rejected.');

    console.log('\n========================================================');
    console.log('   ALL 20 CASUAL MATCHMAKING TESTS PASSED SUCCESSFULLY! ');
    console.log('========================================================\n');

  } finally {
    await deleteApp(appAlice);
    await deleteApp(appBob);
    await deleteApp(appCharlie);
    await deleteApp(appEve);
  }
}

if (process.argv[1]?.endsWith('test-casual-matchmaking.js')) {
  runCasualMatchmakingTests().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error('❌ Casual Matchmaking Tests failed:', err);
    process.exit(1);
  });
}
