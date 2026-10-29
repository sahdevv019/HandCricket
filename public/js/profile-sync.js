// Profile & Cross-Device Progress Synchronization for Hand Cricket
// Operates on Cloud Firestore under free Spark tier limits (1 GiB, 50k reads/day, 20k writes/day).

import { db } from "./firebase-config.js";
import { 
  doc, 
  getDoc, 
  setDoc, 
  onSnapshot, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

const HC_STORAGE_KEY = 'hc_save_v2';
const HC_SESSION_KEY = 'hc_session_user';
const HC_MIGRATED_KEY = 'hc_cloud_migrated_v1';

class ProfileSync {
  constructor() {
    this.unsubscribeSnapshot = null;
    this.activeUid = null;
    this.isSyncing = false;
  }

  // Normalizes a profile object with safe defaults matching game schemas
  normalize(save, fallbackUsername = 'Player') {
    save = (save && typeof save === 'object') ? save : {};
    return {
      username: (typeof save.username === 'string' && save.username.trim()) ? save.username.trim().slice(0, 24) : fallbackUsername,
      wins: Number(save.wins) >= 0 ? Number(save.wins) : 0,
      gamesPlayed: Number(save.gamesPlayed) >= 0 ? Number(save.gamesPlayed) : 0,
      achievements: Array.isArray(save.achievements) ? save.achievements.slice(0, 100) : [],
      activeAvatar: typeof save.activeAvatar === 'string' ? save.activeAvatar : (typeof save.avatar === 'string' ? save.avatar : 'starter'),
      ownedAvatars: Array.isArray(save.ownedAvatars) && save.ownedAvatars.length ? save.ownedAvatars.slice(0, 100) : ['starter'],
      currentStreak: Number(save.currentStreak) >= 0 ? Number(save.currentStreak) : 0,
      bestStreak: Number(save.bestStreak) >= 0 ? Number(save.bestStreak) : 0,
      matchHistory: Array.isArray(save.matchHistory) ? save.matchHistory.slice(-50) : [],
      coins: Number(save.coins) >= 0 ? Number(save.coins) : 100,
      xp: Number(save.xp) >= 0 ? Number(save.xp) : 0,
      cosmetics: Array.isArray(save.cosmetics) && save.cosmetics.length ? save.cosmetics.slice(0, 50) : ['classic'],
      activeCosmetic: typeof save.activeCosmetic === 'string' ? save.activeCosmetic : 'classic',
      dailyDate: typeof save.dailyDate === 'string' ? save.dailyDate : '',
      dailyDone: Array.isArray(save.dailyDone) ? save.dailyDone.slice(0, 20) : [],
      rankTier: Number.isFinite(Number(save.rankTier)) ? Math.max(0, Math.min(6, Number(save.rankTier))) : 0,
      rankStars: Number(save.rankStars) >= 0 ? Number(save.rankStars) : 0,
      rankGmLevel: Number(save.rankGmLevel) >= 1 ? Number(save.rankGmLevel) : 1,
      doubleDate: typeof save.doubleDate === 'string' ? save.doubleDate : '',
      doubleUses: Number(save.doubleUses) >= 0 ? Number(save.doubleUses) : 0,
      renameCount: Number(save.renameCount) >= 0 ? Number(save.renameCount) : 0
    };
  }

  // Gathers any existing legacy local progress from localStorage
  getLocalSave() {
    try {
      // 1. Check window.currentPlayer if already in memory
      if (window.currentPlayer && window.currentPlayer.gamesPlayed > 0) {
        return window.currentPlayer;
      }
      // 2. Check current session profile
      const sessionUser = localStorage.getItem(HC_SESSION_KEY);
      if (sessionUser) {
        const key = HC_STORAGE_KEY + '::' + sessionUser.toLowerCase();
        const raw = localStorage.getItem(key);
        if (raw) return JSON.parse(raw);
      }
      // 3. Check generic storage key
      const generic = localStorage.getItem(HC_STORAGE_KEY);
      if (generic) return JSON.parse(generic);
    } catch (e) {
      console.warn('[ProfileSync] Error reading local save:', e);
    }
    return null;
  }

  // Saves to local localStorage cache for instant offline access
  cacheLocally(profile) {
    try {
      const serialized = JSON.stringify(profile);
      localStorage.setItem(HC_STORAGE_KEY, serialized);
      if (this.activeUid) {
        localStorage.setItem(HC_STORAGE_KEY + '::' + this.activeUid.toLowerCase(), serialized);
        localStorage.setItem(HC_SESSION_KEY, this.activeUid);
      }
    } catch (e) {
      console.warn('[ProfileSync] Could not cache profile locally:', e);
    }
  }

  // Initializes guest profile (offline / anonymous)
  initGuestProfile(user) {
    if (this.unsubscribeSnapshot) {
      this.unsubscribeSnapshot();
      this.unsubscribeSnapshot = null;
    }
    this.activeUid = user.uid;
    const localSave = this.getLocalSave();
    const guestProfile = this.normalize(localSave || {}, user.displayName || 'Guest');
    window.currentPlayer = guestProfile;
    this.cacheLocally(guestProfile);
    if (window.updateRetentionUI) window.updateRetentionUI();
    if (window.renderProfileAvatar) window.renderProfileAvatar();
    this._updateSyncIndicator('guest');
  }

  // Initializes Cloud Profile for an authenticated user with automatic migration
  async initCloudProfile(user, fallbackName = 'Player') {
    if (!user || !user.uid) return null;
    if (this._inFlightInit && this._inFlightUid === user.uid) {
      return this._inFlightInit;
    }
    this._inFlightUid = user.uid;
    this._inFlightInit = (async () => {
      if (this.unsubscribeSnapshot) {
        this.unsubscribeSnapshot();
        this.unsubscribeSnapshot = null;
      }
      this.activeUid = user.uid;
      this._updateSyncIndicator('syncing');

      const userDocRef = doc(db, 'users', user.uid);
      let cloudData = null;

      try {
        const snap = await getDoc(userDocRef);
        if (snap.exists()) {
          cloudData = snap.data();
        }
      } catch (err) {
        console.warn('[ProfileSync] Failed to read cloud profile (may be offline):', err.message);
      }

    const localSave = this.getLocalSave();
    let finalProfile = null;

    if (!cloudData) {
      // New cloud user: Check for one-time local migration
      const hasSignificantLocal = localSave && (
        (localSave.wins && localSave.wins > 0) ||
        (localSave.xp && localSave.xp > 0) ||
        (localSave.achievements && localSave.achievements.length > 0) ||
        (localSave.coins && localSave.coins !== 100)
      );

      finalProfile = this.normalize(
        hasSignificantLocal ? localSave : {}, 
        fallbackName || user.displayName || 'Player'
      );
      finalProfile.email = user.email || null;
      finalProfile.uid = user.uid;
      finalProfile.cloud_migrated = true;

      // Write initial cloud profile
      try {
        const payload = {
          ...finalProfile,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };
        console.log('[ProfileSync DEBUG payload]:', JSON.stringify(payload));
        await setDoc(userDocRef, payload);
        await this._syncPublicProfile(finalProfile);
        console.log('[ProfileSync] New cloud profile initialized' + (hasSignificantLocal ? ' with local migration.' : '.'));
        if (hasSignificantLocal && window.showAchToast) {
          window.showAchToast({ icon: '☁️', name: 'Progress Migrated', desc: 'Your offline stats are now backed up to Google Cloud!' });
        }
      } catch (err) {
        console.warn('[ProfileSync] Cloud write deferred:', err.message);
      }
    } else {
      // Existing cloud user: strictly idempotent. If cloud account is already migrated, cloud is authoritative.
      const normalizedCloud = this.normalize(cloudData, fallbackName);
      if (cloudData.cloud_migrated === true) {
        localStorage.setItem(HC_MIGRATED_KEY + '_' + user.uid, '1');
        finalProfile = { ...normalizedCloud, email: user.email || null, uid: user.uid, cloud_migrated: true };
      } else if (localSave && !localStorage.getItem(HC_MIGRATED_KEY + '_' + user.uid)) {
        // One-time un-migrated merge: merge achievements set union and highest progress
        const mergedAch = Array.from(new Set([...(normalizedCloud.achievements || []), ...(localSave.achievements || [])]));
        const mergedAvatars = Array.from(new Set([...(normalizedCloud.ownedAvatars || []), ...(localSave.ownedAvatars || [])]));
        finalProfile = {
          ...normalizedCloud,
          wins: Math.max(normalizedCloud.wins, Number(localSave.wins) || 0),
          gamesPlayed: Math.max(normalizedCloud.gamesPlayed, Number(localSave.gamesPlayed) || 0),
          coins: Math.max(normalizedCloud.coins, Number(localSave.coins) || 0),
          xp: Math.max(normalizedCloud.xp, Number(localSave.xp) || 0),
          bestStreak: Math.max(normalizedCloud.bestStreak, Number(localSave.bestStreak) || 0),
          achievements: mergedAch,
          ownedAvatars: mergedAvatars,
          email: user.email || null,
          uid: user.uid,
          cloud_migrated: true
        };
        localStorage.setItem(HC_MIGRATED_KEY + '_' + user.uid, '1');
        // Push merged state
        setDoc(userDocRef, { ...finalProfile, updatedAt: serverTimestamp() }, { merge: true }).catch(console.warn);
        this._syncPublicProfile(finalProfile).catch(console.warn);
      } else {
        finalProfile = { ...normalizedCloud, email: user.email || null, uid: user.uid };
      }
    }

    // Set globally and cache locally
    window.currentPlayer = finalProfile;
    this.cacheLocally(finalProfile);
    this._updateSyncIndicator('synced');

    if (window.updateRetentionUI) window.updateRetentionUI();
    if (window.renderProfileAvatar) window.renderProfileAvatar();

    // Listen for real-time changes on other tabs/devices
    this.unsubscribeSnapshot = onSnapshot(userDocRef, (docSnap) => {
      if (docSnap.exists() && !this.isSyncing) {
        const remoteData = docSnap.data();
        const merged = this.normalize(remoteData, window.currentPlayer?.username);
        window.currentPlayer = { ...window.currentPlayer, ...merged };
        this.cacheLocally(window.currentPlayer);
        if (window.updateRetentionUI) window.updateRetentionUI();
        if (window.renderProfileAvatar) window.renderProfileAvatar();
      }
    }, (err) => {
      console.warn('[ProfileSync] Snapshot listener warning:', err.message);
    });

    return finalProfile;
  })();

  this._inFlightInit.finally(() => {
    this._inFlightInit = null;
    this._inFlightUid = null;
  });

  return this._inFlightInit;
}

  // Saves player progress to Firestore with optimistic local update
  async save(profile) {
    if (!profile) return;
    const norm = this.normalize(profile, profile.username);
    window.currentPlayer = norm;
    this.cacheLocally(norm);

    if (window.updateRetentionUI) window.updateRetentionUI();

    const auth = window.HC_FIREBASE?.auth;
    const user = auth?.currentUser;

    if (!user || user.isAnonymous) {
      this._updateSyncIndicator('guest');
      return;
    }

    this.isSyncing = true;
    this._updateSyncIndicator('syncing');

    try {
      const userDocRef = doc(db, 'users', user.uid);
      const payload = {
        ...norm,
        email: user.email || null,
        uid: user.uid,
        updatedAt: serverTimestamp()
      };
      await setDoc(userDocRef, payload, { merge: true });
      await this._syncPublicProfile(norm);
      this._updateSyncIndicator('synced');
    } catch (err) {
      console.warn('[ProfileSync] Remote save queued/failed (saved locally):', err.message);
      this._updateSyncIndicator('offline');
    } finally {
      this.isSyncing = false;
    }
  }

  async _syncPublicProfile(profile) {
    const user = window.HC_FIREBASE?.auth?.currentUser;
    if (!user || user.isAnonymous) return;
    try {
      const pubRef = doc(db, 'publicProfiles', user.uid);
      await setDoc(pubRef, {
        userId: user.uid,
        username: profile.username || 'Player',
        rankTier: Number(profile.rankTier) || 0,
        rankStars: Number(profile.rankStars) || 0,
        rankGmLevel: Number(profile.rankGmLevel) || 1,
        wins: Number(profile.wins) || 0,
        gamesPlayed: Number(profile.gamesPlayed) || 0,
        xp: Number(profile.xp) || 0,
        activeAvatar: profile.activeAvatar || 'starter',
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (e) {
      // Non-fatal
    }
  }

  _updateSyncIndicator(status) {
    const el = document.getElementById('cloudSyncStatus');
    if (!el) return;
    if (status === 'synced') {
      el.innerHTML = '☁️ <span style="color:#38ef7d">Cloud Synced</span>';
      el.title = 'Progress saved to Google Cloud Firestore';
    } else if (status === 'syncing') {
      el.innerHTML = '🔄 <span style="color:#ffd166">Syncing…</span>';
    } else if (status === 'guest') {
      el.innerHTML = '💾 <span style="color:#a5a5c0">Guest Mode (Local Only)</span>';
      el.title = 'Sign in with Google or Email to enable cloud cross-device sync';
    } else if (status === 'offline') {
      el.innerHTML = '⚡ <span style="color:#ff6b6b">Saved Locally (Offline)</span>';
    }
  }
}

export const profileSync = new ProfileSync();
window.HC_PROFILE_SYNC = profileSync;
