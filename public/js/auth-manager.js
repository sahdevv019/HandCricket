// Authentication Manager for Hand Cricket
// Handles Google Sign-In, Email/Password (Sign In & Register), and Guest Play (Offline Mode).

import { 
  auth, 
  googleProvider 
} from "./firebase-config.js";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInWithPopup, 
  signInWithRedirect, 
  signOut, 
  onAuthStateChanged,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";

class AuthManager {
  constructor() {
    this.currentUser = null;
    this.isGuest = false;
    this.authListeners = [];
    this.initialized = false;
  }

  init(callback) {
    if (callback) this.authListeners.push(callback);

    onAuthStateChanged(auth, async (user) => {
      this.currentUser = user;
      if (user) {
        this.isGuest = user.isAnonymous;
      }
      this.initialized = true;
      this._notifyListeners(user);
    });
  }

  onUserChange(callback) {
    this.authListeners.push(callback);
    if (this.initialized) {
      callback(this.currentUser);
    }
  }

  _notifyListeners(user) {
    this.authListeners.forEach(cb => {
      try {
        cb(user);
      } catch (e) {
        console.error('[AuthManager] listener error:', e);
      }
    });
  }

  async signInWithEmail(email, password) {
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      this.currentUser = cred.user;
      this.isGuest = false;
      return { success: true, user: cred.user };
    } catch (err) {
      console.warn('[AuthManager] signInWithEmail error:', err.code, err.message);
      return { success: false, error: this._friendlyError(err) };
    }
  }

  async registerWithEmail(email, password, username) {
    try {
      const cleanUsername = String(username || '').trim().slice(0, 24) || 'Player';
      this.pendingUsername = cleanUsername;
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      this.currentUser = cred.user;
      this.isGuest = false;

      // Initialize profile in Firestore with migration of local save
      if (window.HC_PROFILE_SYNC) {
        await window.HC_PROFILE_SYNC.initCloudProfile(cred.user, cleanUsername);
      }

      this.pendingUsername = null;
      return { success: true, user: cred.user };
    } catch (err) {
      this.pendingUsername = null;
      console.warn('[AuthManager] registerWithEmail error:', err.code, err.message);
      return { success: false, error: this._friendlyError(err) };
    }
  }

  async signInWithGoogle() {
    try {
      let cred;
      try {
        cred = await signInWithPopup(auth, googleProvider);
      } catch (popupErr) {
        if (popupErr.code === 'auth/popup-blocked' || popupErr.code === 'auth/cancelled-popup-request') {
          console.warn('[AuthManager] Popup blocked, falling back to redirect...');
          await signInWithRedirect(auth, googleProvider);
          return { pendingRedirect: true };
        }
        throw popupErr;
      }

      this.currentUser = cred.user;
      this.isGuest = false;

      const fallbackName = cred.user.displayName || (cred.user.email ? cred.user.email.split('@')[0] : 'Player');
      if (window.HC_PROFILE_SYNC) {
        await window.HC_PROFILE_SYNC.initCloudProfile(cred.user, fallbackName);
      }

      return { success: true, user: cred.user };
    } catch (err) {
      console.warn('[AuthManager] Google sign-in failed:', err.code, err.message);
      return { success: false, error: this._friendlyError(err) };
    }
  }

  async playAsGuest() {
    try {
      // First try Firebase anonymous auth (works online and with emulator)
      const cred = await signInAnonymously(auth);
      this.currentUser = cred.user;
      this.isGuest = true;
      if (window.HC_PROFILE_SYNC) {
        await window.HC_PROFILE_SYNC.initGuestProfile(cred.user);
      }
      return { success: true, user: cred.user, isAnonymous: true };
    } catch (err) {
      console.warn('[AuthManager] Anonymous auth offline or failed, using local guest mode:', err.message);
      // Offline fallback: pure local guest
      const localGuestUid = 'guest-local-' + Math.random().toString(36).substring(2, 9);
      const guestObj = {
        uid: localGuestUid,
        isAnonymous: true,
        displayName: 'Guest Player',
        email: null
      };
      this.currentUser = guestObj;
      this.isGuest = true;
      if (window.HC_PROFILE_SYNC) {
        window.HC_PROFILE_SYNC.initGuestProfile(guestObj);
      }
      this._notifyListeners(guestObj);
      return { success: true, user: guestObj, isAnonymous: true, offline: true };
    }
  }

  async signOut() {
    try {
      if (auth.currentUser) {
        await signOut(auth);
      }
    } catch (e) {
      console.warn('[AuthManager] signOut error:', e);
    }
    this.currentUser = null;
    this.isGuest = false;
    this._notifyListeners(null);
  }

  _friendlyError(err) {
    if (!err || !err.code) return err?.message || 'Authentication failed. Please try again.';
    switch (err.code) {
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Invalid email or password.';
      case 'auth/email-already-in-use':
        return 'An account already exists with that email.';
      case 'auth/weak-password':
        return 'Password should be at least 6 characters.';
      case 'auth/network-request-failed':
        return 'Network connection error. Check your internet connection.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please try again in a few moments.';
      default:
        return err.message || 'Authentication error.';
    }
  }
}

export const authManager = new AuthManager();
window.HC_AUTH_MANAGER = authManager;
