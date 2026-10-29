// Firebase Configuration & Service Initialization for Hand Cricket
// Operates 100% on Firebase free Spark tier (zero server costs).

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { 
  getAuth, 
  connectAuthEmulator,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { 
  getFirestore, 
  connectFirestoreEmulator,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { 
  getDatabase, 
  connectDatabaseEmulator,
  ref,
  set,
  get,
  update,
  remove,
  onValue,
  off,
  onDisconnect,
  runTransaction,
  serverTimestamp as rtdbServerTimestamp
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAR6BEGyOrmzMw5Zudg7OYl9PCItSGW2kE",
  authDomain: "handcricket-e6b39.firebaseapp.com",
  projectId: "handcricket-e6b39",
  storageBucket: "handcricket-e6b39.firebasestorage.app",
  messagingSenderId: "608799968953",
  appId: "1:608799968953:web:954832bdf867bae8bc5568",
  databaseURL: "https://handcricket-e6b39-default-rtdb.asia-southeast1.firebasedatabase.app"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);

// Automatically connect to Firebase Local Emulator Suite only during local development/testing.
// In production mode (e.g. *.web.app, *.firebaseapp.com, custom domains), emulators are strictly bypassed.
const isLocalhost = Boolean(
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
  (window.USE_FIREBASE_EMULATOR !== false)
);

let usingEmulators = false;
if (isLocalhost) {
  try {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectDatabaseEmulator(rtdb, '127.0.0.1', 9000);
    usingEmulators = true;
    console.log('[Firebase] Connected to local Firebase Emulator Suite (Auth:9099, Firestore:8080, RTDB:9000)');
  } catch (err) {
    console.warn('[Firebase] Emulator connection skipped or already initialized:', err.message);
  }
} else {
  console.log('[Firebase] Connected to live Firebase backend (handcricket-e6b39)');
}

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Export to window for global game logic integration
window.HC_FIREBASE = {
  app,
  auth,
  db,
  rtdb,
  googleProvider,
  usingEmulators,
  // Auth primitives
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  signInAnonymously,
  // Firestore primitives
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  // RTDB primitives
  ref,
  set,
  get,
  update,
  remove,
  onValue,
  off,
  onDisconnect,
  runTransaction,
  rtdbServerTimestamp
};

export {
  app,
  auth,
  db,
  rtdb,
  googleProvider,
  usingEmulators
};
