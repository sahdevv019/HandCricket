# Hand Cricket — Google Firebase Backend (Spark Plan ₹0)

A web-based Hand Cricket game backed entirely by **Google Firebase's free Spark Tier** with zero billing account requirement ($0 / ₹0 cost).

## Architecture & Services Used

1. **Firebase Authentication**
   - **Google Sign-In**: One-click authentication with account selection.
   - **Email & Password**: Account registration and sign in.
   - **Guest Mode / Offline**: Fully playable against computer AI and boss challenge without internet or login.
   - **Session Restoration**: Seamless session resumption using `onAuthStateChanged`.

2. **Cloud Firestore (`firestore.rules`)**
   - **Player Profiles (`users/{userId}`)**: XP, coins, wins, win streaks, career statistics, unlocked avatars, match history, and daily mission progress.
   - **Public Profiles (`publicProfiles/{userId}`)**: Sanitized public standing for leaderboards and player cards.
   - **One-Time Local Migration**: Existing browser local storage progress (`hc_save_v2`) is automatically migrated to the cloud upon account creation/sign-in.
   - **Strict Security Rules**: Verified by devil's advocate security checks. Strict type and bound validation, prevention of schema pollution, rejection of negative values, and complete isolation between users.

3. **Firebase Realtime Database (`database.rules.json`)**
   - **Private Multiplayer Rooms (`/rooms/{roomId}`)**: 5-character shareable room codes.
   - **Authoritative Coin Toss**: Synchronized heads/tails calls and bat/bowl choices.
   - **Atomic Round Moves**: Moves submitted under `/rooms/{roomId}/rounds/{roundIndex}/(hostMove|guestMove)`. Once locked, moves cannot be modified or overwritten.
   - **Connection Presence & Timeout Recovery**: Uses `.info/connected` and `onDisconnect()`. Disconnections trigger a 25-second recovery countdown banner; if opponent fails to reconnect, the online player can claim victory by forfeit.
   - **Cheat Transparency**: Ranked online matchmaking is explicitly paused pending server-authoritative validation; client-side logic makes no false claims about cheat-proof ranked ladder play.

4. **Firebase Hosting**
   - Static zero-build web deployment configured in `firebase.json` with cache-control headers and single-page app rewrites.

---

## Local Development & Emulator Suite

All features can be tested locally using the Firebase Emulator Suite without incurring any cost or needing cloud resources.

### Prerequisites
- Node.js (v18+)
- Java (JDK 11+) for Firestore/RTDB emulators

### Running Tests
Execute the automated integration test suite (runs Auth, Firestore Rules, RTDB Multiplayer, and Reconnection tests inside emulators):
```bash
npm test
```

### Starting the Emulators
Start the local Firebase Emulator Suite (Auth, Firestore, RTDB, Hosting, and Emulator UI):
```bash
npm run emulators
```
- **Web App**: http://127.0.0.1:5000
- **Emulator UI**: http://127.0.0.1:4000
- **Auth Emulator**: http://127.0.0.1:9099
- **Firestore Emulator**: http://127.0.0.1:8080
- **Realtime Database Emulator**: http://127.0.0.1:9000

---

## Production Deployment to Firebase (Spark Plan)

1. **Login to Firebase**:
   ```bash
   npx firebase-tools login
   ```
2. **Select or Set Project**:
   ```bash
   npx firebase-tools use handcricket-e6b39
   ```
3. **Deploy Security Rules & Frontend**:
   ```bash
   npm run deploy
   ```
   *(Deploys Hosting, Firestore Security Rules, and Realtime Database Security Rules)*
