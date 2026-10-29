// Integration test for Firebase Authentication, Cloud Firestore & Security Rules
// Runs against Firebase Local Emulator Suite.

import assert from 'node:assert';
import { initializeApp, deleteApp } from 'firebase/app';
import { 
  getAuth, 
  connectAuthEmulator, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  signInAnonymously
} from 'firebase/auth';
import { 
  getFirestore, 
  connectFirestoreEmulator, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc 
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "fake-api-key-for-emulator",
  authDomain: "handcricket-e6b39.firebaseapp.com",
  projectId: "handcricket-e6b39"
};

async function runAuthAndProfileTests() {
  console.log('\n--- Running Auth & Firestore Security Rules Tests ---');

  // App 1: Alice
  const appAlice = initializeApp(firebaseConfig, 'alice-app');
  const authAlice = getAuth(appAlice);
  const dbAlice = getFirestore(appAlice);
  connectAuthEmulator(authAlice, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(dbAlice, '127.0.0.1', 8080);

  // App 2: Bob
  const appBob = initializeApp(firebaseConfig, 'bob-app');
  const authBob = getAuth(appBob);
  const dbBob = getFirestore(appBob);
  connectAuthEmulator(authBob, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(dbBob, '127.0.0.1', 8080);

  // App 3: Unauthenticated
  const appAnon = initializeApp(firebaseConfig, 'anon-app');
  const dbAnon = getFirestore(appAnon);
  connectFirestoreEmulator(dbAnon, '127.0.0.1', 8080);

  try {
    // 1. Create Alice and Bob accounts
    const aliceEmail = `alice_${Date.now()}@test.com`;
    const bobEmail = `bob_${Date.now()}@test.com`;

    const aliceCred = await createUserWithEmailAndPassword(authAlice, aliceEmail, 'password123');
    const bobCred = await createUserWithEmailAndPassword(authBob, bobEmail, 'password123');

    const aliceUid = aliceCred.user.uid;
    const bobUid = bobCred.user.uid;
    console.log(`✓ Accounts created: Alice (${aliceUid.slice(0, 6)}...), Bob (${bobUid.slice(0, 6)}...)`);

    // 2. Alice writes valid profile
    const validAliceProfile = {
      username: 'AliceChampion',
      coins: 150,
      xp: 220,
      wins: 3,
      gamesPlayed: 5,
      currentStreak: 2,
      bestStreak: 2,
      rankTier: 1,
      rankStars: 2,
      rankGmLevel: 1,
      achievements: ['first_win', 'score10'],
      ownedAvatars: ['starter'],
      matchHistory: [{ result: 'win', opponent: 'Bot', myScore: 24, oppScore: 12, date: Date.now() }],
      activeAvatar: 'starter',
      cloud_migrated: true,
      email: aliceEmail,
      uid: aliceUid,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await setDoc(doc(dbAlice, 'users', aliceUid), validAliceProfile);
    console.log('✓ Alice successfully wrote valid profile to users/{aliceUid}');

    // 3. Alice reads her own profile
    const aliceRead = await getDoc(doc(dbAlice, 'users', aliceUid));
    assert.strictEqual(aliceRead.exists(), true);
    assert.strictEqual(aliceRead.data().username, 'AliceChampion');
    console.log('✓ Alice successfully read her own profile');

    // 4. Security: Alice tries to write invalid profile (negative coins) -> MUST FAIL
    try {
      await updateDoc(doc(dbAlice, 'users', aliceUid), { coins: -50 });
      assert.fail('Should have rejected negative coins');
    } catch (err) {
      assert(err.message.includes('permission-denied') || err.code === 'permission-denied');
      console.log('✓ Security: Negative coins write was rejected by firestore.rules');
    }

    // 5. Security: Alice tries to write illegal keys (schema pollution) -> MUST FAIL
    try {
      await updateDoc(doc(dbAlice, 'users', aliceUid), { hackedKey: 'malicious_data' });
      assert.fail('Should have rejected unknown keys');
    } catch (err) {
      assert(err.message.includes('permission-denied') || err.code === 'permission-denied');
      console.log('✓ Security: Schema pollution with illegal keys rejected by firestore.rules');
    }

    // 6. Security: Bob tries to read Alice's private user document -> MUST FAIL
    try {
      await getDoc(doc(dbBob, 'users', aliceUid));
      assert.fail('Bob should not read Alice users document');
    } catch (err) {
      assert(err.message.includes('permission-denied') || err.code === 'permission-denied');
      console.log('✓ Security: Cross-user private profile read rejected by firestore.rules');
    }

    // 7. Security: Bob tries to overwrite Alice's user document -> MUST FAIL
    try {
      await setDoc(doc(dbBob, 'users', aliceUid), validAliceProfile);
      assert.fail('Bob should not write to Alice users document');
    } catch (err) {
      assert(err.message.includes('permission-denied') || err.code === 'permission-denied');
      console.log('✓ Security: Cross-user private profile write rejected by firestore.rules');
    }

    // 8. Public Profiles: Alice creates public profile
    const alicePublic = {
      userId: aliceUid,
      username: 'AliceChampion',
      rankTier: 1,
      rankStars: 2,
      rankGmLevel: 1,
      wins: 3,
      gamesPlayed: 5,
      xp: 220,
      activeAvatar: 'starter',
      updatedAt: Date.now()
    };
    await setDoc(doc(dbAlice, 'publicProfiles', aliceUid), alicePublic);
    console.log('✓ Alice created publicProfiles/{aliceUid}');

    // 9. Bob reads Alice's public profile -> MUST SUCCEED
    const bobReadsAlicePublic = await getDoc(doc(dbBob, 'publicProfiles', aliceUid));
    assert.strictEqual(bobReadsAlicePublic.exists(), true);
    assert.strictEqual(bobReadsAlicePublic.data().username, 'AliceChampion');
    console.log('✓ Bob successfully read Alice public profile for leaderboard');

    // 10. Security: Bob tries to tamper with Alice's public profile -> MUST FAIL
    try {
      await updateDoc(doc(dbBob, 'publicProfiles', aliceUid), { wins: 0 });
      assert.fail('Bob should not alter Alice public profile');
    } catch (err) {
      assert(err.message.includes('permission-denied') || err.code === 'permission-denied');
      console.log('✓ Security: Cross-user public profile tampering rejected by firestore.rules');
    }

    // 11. Security: Unauthenticated client tries to read or write -> MUST FAIL
    try {
      await getDoc(doc(dbAnon, 'publicProfiles', aliceUid));
      assert.fail('Unauthenticated user should not read');
    } catch (err) {
      assert(err.message.includes('permission-denied') || err.code === 'permission-denied');
      console.log('✓ Security: Unauthenticated request rejected by firestore.rules');
    }

    // 12. Local progress migration simulation
    const localLegacySave = {
      username: 'OldLocalPro',
      wins: 12,
      gamesPlayed: 18,
      coins: 480,
      xp: 850,
      currentStreak: 4,
      bestStreak: 5,
      rankTier: 2,
      rankStars: 3,
      rankGmLevel: 1,
      achievements: ['first_win', 'score50', 'hat_trick'],
      ownedAvatars: ['starter', 'ninja'],
      matchHistory: []
    };

    // Migrate Bob using local save
    const migratedBob = {
      username: localLegacySave.username,
      coins: localLegacySave.coins,
      xp: localLegacySave.xp,
      wins: localLegacySave.wins,
      gamesPlayed: localLegacySave.gamesPlayed,
      currentStreak: localLegacySave.currentStreak,
      bestStreak: localLegacySave.bestStreak,
      rankTier: localLegacySave.rankTier,
      rankStars: localLegacySave.rankStars,
      rankGmLevel: localLegacySave.rankGmLevel,
      achievements: localLegacySave.achievements,
      ownedAvatars: localLegacySave.ownedAvatars,
      matchHistory: [],
      activeAvatar: 'starter',
      cloud_migrated: true,
      email: bobEmail,
      uid: bobUid,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await setDoc(doc(dbBob, 'users', bobUid), migratedBob);
    const bobDoc = await getDoc(doc(dbBob, 'users', bobUid));
    assert.strictEqual(bobDoc.data().wins, 12);
    assert.strictEqual(bobDoc.data().coins, 480);
    console.log('✓ Local player progress migration successfully saved to Firestore');

    // 13. Security: Creating user with coins exceeding starter cap (e.g. 5000 > 2000) -> MUST FAIL
    const charlieEmail = `charlie_${Date.now()}@test.com`;
    const charlieCred = await createUserWithEmailAndPassword(authBob, charlieEmail, 'password123');
    const charlieUid = charlieCred.user.uid;
    try {
      await setDoc(doc(dbBob, 'users', charlieUid), {
        ...migratedBob,
        email: charlieEmail,
        uid: charlieUid,
        coins: 5000 // exceeds starter cap of 2000
      });
      assert.fail('Should reject starter coins > 2000');
    } catch (err) {
      assert(err.message.includes('permission-denied') || err.code === 'permission-denied');
      console.log('✓ Security: Starter cap on create (coins > 2000) rejected by firestore.rules');
    }

    // 14. Security: Alice attempts illegal jump in wins (+2 in single update) -> MUST FAIL
    try {
      await updateDoc(doc(dbAlice, 'users', aliceUid), { wins: 5 }); // Alice had 3, 5 > 3 + 1
      assert.fail('Should reject wins delta > 1');
    } catch (err) {
      assert(err.message.includes('permission-denied') || err.code === 'permission-denied');
      console.log('✓ Security: Rate-limit on wins update (> +1) rejected by firestore.rules');
    }

    // 15. Security: Alice attempts illegal coin inflation (+500) -> MUST FAIL
    try {
      await updateDoc(doc(dbAlice, 'users', aliceUid), { coins: 650 }); // Alice had 150, 650 > 150 + 250
      assert.fail('Should reject coin inflation > 250');
    } catch (err) {
      assert(err.message.includes('permission-denied') || err.code === 'permission-denied');
      console.log('✓ Security: Rate-limit on coins update (> +250) rejected by firestore.rules');
    }

    // 16. Security: Alice attempts self-awarding rankTier -> MUST FAIL
    try {
      await updateDoc(doc(dbAlice, 'users', aliceUid), { rankTier: 5 });
      assert.fail('Should reject rankTier modification');
    } catch (err) {
      assert(err.message.includes('permission-denied') || err.code === 'permission-denied');
      console.log('✓ Security: Unauthorized rankTier update rejected by firestore.rules');
    }

    // 17. Security: Alice attempts removing an unlocked achievement -> MUST FAIL
    try {
      await updateDoc(doc(dbAlice, 'users', aliceUid), { achievements: ['score10'] }); // removes 'first_win'
      assert.fail('Should reject removing achievements');
    } catch (err) {
      assert(err.message.includes('permission-denied') || err.code === 'permission-denied');
      console.log('✓ Security: Removing unlocked achievement rejected by firestore.rules');
    }

    // 18. Security: PublicProfiles wins rate limit violation -> MUST FAIL
    try {
      await updateDoc(doc(dbAlice, 'publicProfiles', aliceUid), { wins: 10 }); // Alice had 3, 10 > 3 + 1
      assert.fail('Should reject publicProfiles wins jump');
    } catch (err) {
      assert(err.message.includes('permission-denied') || err.code === 'permission-denied');
      console.log('✓ Security: Rate-limit on publicProfiles wins update rejected by firestore.rules');
    }

    // 19. Legitimate progress update: +1 win, +1 gamesPlayed, +50 coins, +100 xp, +1 achievement -> MUST SUCCEED
    await updateDoc(doc(dbAlice, 'users', aliceUid), {
      wins: 4,
      gamesPlayed: 6,
      currentStreak: 3,
      bestStreak: 3,
      coins: 200,
      xp: 320,
      achievements: ['first_win', 'score10', 'streak3'],
      updatedAt: Date.now()
    });
    console.log('✓ Legitimate progress update within rate limits succeeded');

    // 20. Legitimate public profile sync -> MUST SUCCEED
    await updateDoc(doc(dbAlice, 'publicProfiles', aliceUid), {
      wins: 4,
      gamesPlayed: 6,
      xp: 320,
      updatedAt: Date.now()
    });
    console.log('✓ Legitimate public profile sync within rate limits succeeded');

    console.log('\n✅ All Auth & Firestore Security Rules tests passed!\n');
  } finally {
    await deleteApp(appAlice);
    await deleteApp(appBob);
    await deleteApp(appAnon);
  }
}

export { runAuthAndProfileTests };

if (process.argv[1]?.endsWith('test-auth-and-profiles.js')) {
  runAuthAndProfileTests().catch(err => {
    console.error('❌ Auth test failed:', err);
    process.exit(1);
  });
}
