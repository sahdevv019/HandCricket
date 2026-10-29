// Private Multiplayer Backend for Hand Cricket using Firebase Realtime Database
// Operates on Firebase free Spark tier with atomic operations, round identifiers, presence & timeout recovery.

import { rtdb, auth } from "./firebase-config.js";
import {
  ref,
  set,
  get,
  update,
  remove,
  onValue,
  off,
  onDisconnect,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-database.js";

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 unambiguous chars
function generateRoomCode() {
  let s = '';
  for (let i = 0; i < 5; i++) {
    s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return s;
}

// Cryptographic SHA-256 helper for tamper-proof commit-reveal
export async function sha256Hex(str) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(String(str));
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return '';
}

class RTDBMultiplayer {
  constructor() {
    this.roomId = null;
    this.roomCode = null;
    this.isHost = false;
    this.roomRef = null;
    this.roomListener = null;
    this.presenceRef = null;
    this.oppPresenceRef = null;
    this.oppPresenceListener = null;
    this.connRef = null;
    this.connListener = null;
    this.disconnectTimer = null;
    this.disconnectCountdown = 25;
    this.isResolvingRound = false;
    this.currentRoundIndex = 1;

    // Cryptographic commit-reveal tracking
    this.localMoves = {}; // [roundIdx]: { runs, salt, revealed }
    this.tossHostSeed = null;
    this.tossGuestSeed = null;

    // Callbacks provided by game UI
    this.onStatus = null;
    this.onRoomReady = null;
    this.onGuestJoined = null;
    this.onTossState = null;
    this.onMatchLaunch = null;
    this.onRoundResolved = null;
    this.onReaction = null;
    this.onOpponentDisconnected = null;
    this.onOpponentReconnected = null;
    this.onMatchEnded = null;
  }

  // Ensure user is authenticated (even anonymously) before accessing RTDB
  async ensureAuth() {
    if (auth.authStateReady) {
      try { await auth.authStateReady(); } catch(e) {}
    }
    if (!auth.currentUser) {
      for (let i = 0; i < 20 && !auth.currentUser && !window.HC_AUTH_MANAGER?.initialized; i++) {
        await new Promise(r => setTimeout(r, 50));
      }
    }
    if (!auth.currentUser) {
      if (window.HC_AUTH_MANAGER) {
        await window.HC_AUTH_MANAGER.playAsGuest();
      }
    }
    return auth.currentUser;
  }

  // Set up connection presence listener (.info/connected)
  _setupPresence(role) {
    if (!this.roomId) return;
    this.connRef = ref(rtdb, '.info/connected');
    this.presenceRef = ref(rtdb, `rooms/${this.roomId}/presence/${role}`);

    this.connListener = onValue(this.connRef, (snap) => {
      if (snap.val() === true) {
        // Register online state and onDisconnect hook
        set(this.presenceRef, {
          online: true,
          lastSeen: serverTimestamp()
        });
        onDisconnect(this.presenceRef).set({
          online: false,
          lastSeen: serverTimestamp()
        });
      }
    });

    // Monitor opponent's presence
    const oppRole = role === 'host' ? 'guest' : 'host';
    this.oppPresenceRef = ref(rtdb, `rooms/${this.roomId}/presence/${oppRole}`);
    this.oppPresenceListener = onValue(this.oppPresenceRef, (snap) => {
      const data = snap.val();
      if (!data) return;
      if (data.online === false) {
        this._handleOpponentDisconnect();
      } else if (data.online === true && this.disconnectTimer) {
        this._handleOpponentReconnect();
      }
    });
  }

  _handleOpponentDisconnect() {
    console.warn('[RTDB Net] Opponent disconnected. Starting 25s timeout countdown...');
    this.disconnectCountdown = 25;
    if (this.onOpponentDisconnected) this.onOpponentDisconnected(this.disconnectCountdown);

    if (this.disconnectTimer) clearInterval(this.disconnectTimer);
    this.disconnectTimer = setInterval(() => {
      this.disconnectCountdown--;
      if (this.onOpponentDisconnected) this.onOpponentDisconnected(this.disconnectCountdown);
      if (this.disconnectCountdown <= 0) {
        clearInterval(this.disconnectTimer);
        this.disconnectTimer = null;
        console.warn('[RTDB Net] Opponent reconnection timeout expired.');
      }
    }, 1000);
  }

  _handleOpponentReconnect() {
    console.log('[RTDB Net] Opponent reconnected!');
    if (this.disconnectTimer) {
      clearInterval(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    if (this.onOpponentReconnected) this.onOpponentReconnected();
  }

  // Create a new private room
  async createRoom(playerName, playerAvatar) {
    const user = await this.ensureAuth();
    if (!user) throw new Error('User authentication required.');

    this.isHost = true;
    this.roomCode = generateRoomCode();
    this.roomId = this.roomCode;
    this.currentRoundIndex = 1;
    this.matchLaunched = false;
    this.matchEndedFired = false;
    this.guestJoinedFired = false;
    this.localMoves = {};
    this.tossHostSeed = null;
    this.tossGuestSeed = null;
    this.roomRef = ref(rtdb, `rooms/${this.roomId}`);

    const initialData = {
      meta: {
        hostUid: user.uid,
        hostName: playerName || 'Host Player',
        hostAvatar: playerAvatar || 'starter',
        status: 'waiting',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        mode: 'online'
      },
      presence: {
        host: {
          online: true,
          lastSeen: serverTimestamp()
        }
      }
    };

    await set(this.roomRef, initialData);
    try {
      sessionStorage.setItem('hc_active_room', this.roomCode);
      sessionStorage.setItem('hc_room_role', 'host');
    } catch (e) {}

    this._setupPresence('host');
    this._listenToRoom();

    if (this.onRoomReady) this.onRoomReady(this.roomCode);
    return this.roomCode;
  }

  // Join an existing private room by 5-char code
  async joinRoom(code, playerName, playerAvatar) {
    const user = await this.ensureAuth();
    if (!user) throw new Error('User authentication required.');

    const cleanCode = String(code || '').trim().toUpperCase();
    if (cleanCode.length !== 5) throw new Error('Please enter a valid 5-character room code.');

    this.isHost = false;
    this.roomCode = cleanCode;
    this.roomId = cleanCode;
    this.currentRoundIndex = 1;
    this.matchLaunched = false;
    this.matchEndedFired = false;
    this.guestJoinedFired = false;
    this.localMoves = {};
    this.tossHostSeed = null;
    this.tossGuestSeed = null;
    this.roomRef = ref(rtdb, `rooms/${this.roomId}`);

    const snap = await get(this.roomRef);
    if (!snap.exists()) {
      throw new Error(`Room "${cleanCode}" was not found.`);
    }

    const room = snap.val();
    if (room.meta?.status !== 'waiting') {
      throw new Error('This room has already started or has expired.');
    }
    if (room.meta?.hostUid === user.uid) {
      throw new Error('You cannot join your own room as guest.');
    }

    // Atomic join update
    const updates = {
      'meta/guestUid': user.uid,
      'meta/guestName': playerName || 'Guest Player',
      'meta/guestAvatar': playerAvatar || 'starter',
      'meta/status': 'toss',
      'meta/updatedAt': serverTimestamp(),
      'presence/guest/online': true,
      'presence/guest/lastSeen': serverTimestamp()
    };
    await update(this.roomRef, updates);
    try {
      sessionStorage.setItem('hc_active_room', cleanCode);
      sessionStorage.setItem('hc_room_role', 'guest');
    } catch (e) {}

    this._setupPresence('guest');
    this._listenToRoom();

    // Trigger toss setup on host side
    if (this.onGuestJoined) this.onGuestJoined(room.meta);
  }

  // Realtime synchronization listener on the room
  _listenToRoom() {
    let lastHandledRoundIndex = 0;

    this.roomListener = onValue(this.roomRef, (snapshot) => {
      const data = snapshot.val();
      if (!data || !data.meta) return;

      const meta = data.meta;
      const toss = data.toss;
      const game = data.game;

      // 0. Guest joined detection for Host
      if (this.isHost && meta.guestUid && !this.guestJoinedFired) {
        this.guestJoinedFired = true;
        if (this.onGuestJoined) this.onGuestJoined(meta);
      }

      // 1. Waiting -> Toss transition (Host starts provably fair toss)
      if (meta.status === 'toss' && this.isHost && (!toss || !toss.caller)) {
        this.tossHostSeed = crypto.randomUUID() + '-' + crypto.randomUUID();
        sha256Hex(this.tossHostSeed).then((hostCommit) => {
          update(ref(rtdb, `rooms/${this.roomId}/toss`), {
            caller: 'guest',
            hostCommit,
            status: 'calling',
            updatedAt: serverTimestamp()
          }).catch(console.error);
        });
      }

      // 1b. Guest called toss -> Host reveals seed and computes deterministic toss result
      if (meta.status === 'toss' && this.isHost && toss && toss.status === 'flipped' && toss.call && !toss.result) {
        this._resolveTossFlip(toss.call, toss.caller || 'guest', toss.guestSeed);
      }

      // 2. Toss updates
      if (toss && this.onTossState) {
        this.onTossState(toss, meta);
      }

      // 3. Match launch
      if (meta.status === 'playing' && game && game.roundIndex >= 1) {
        this.currentRoundIndex = game.roundIndex;
        if (this.onMatchLaunch && !this.matchLaunched) {
          this.matchLaunched = true;
          this.onMatchLaunch(game, meta);
        }
      }

      // 3b. Cryptographic Move Reveal Check: reveal player's secret move only when both committed
      if (meta.status === 'playing' && data.rounds) {
        const rIdx = game?.roundIndex || this.currentRoundIndex || 1;
        const roundData = data.rounds[rIdx];
        if (roundData) {
          const role = this.isHost ? 'host' : 'guest';
          const myLocal = this.localMoves[rIdx];
          if (roundData.hostCommit && roundData.guestCommit && myLocal && !myLocal.revealed) {
            myLocal.revealed = true;
            const moveField = role + 'Move';
            const saltField = role + 'Salt';
            update(ref(rtdb, `rooms/${this.roomId}/rounds/${rIdx}`), {
              [moveField]: myLocal.runs,
              [saltField]: myLocal.salt
            }).catch(console.error);
          }
        }
      }

      // 4. Round resolution detection: check if both moves are present for active round
      if (meta.status === 'playing' && game && this.isHost && !this.isResolvingRound) {
        const rIdx = game.roundIndex || 1;
        this.currentRoundIndex = rIdx;
        const currentRoundRef = data.rounds && data.rounds[rIdx];
        if (currentRoundRef && currentRoundRef.hostMove !== undefined && currentRoundRef.guestMove !== undefined && !currentRoundRef.resolved) {
          this._verifyAndResolveRound(rIdx, currentRoundRef, game);
        }
      }

      // 5. Game state updates to client UI
      if (game && game.roundIndex > lastHandledRoundIndex) {
        lastHandledRoundIndex = game.roundIndex;
        this.currentRoundIndex = game.roundIndex;
        if (this.onRoundResolved) {
          this.onRoundResolved(game, meta);
        }
      }

      // 6. Match finished
      if (meta.status === 'finished' && game && game.gameOver) {
        if (this.onMatchEnded && !this.matchEndedFired) {
          this.matchEndedFired = true;
          this.onMatchEnded(game, meta);
        }
      }

      // 7. Reactions
      if (data.reactions && data.reactions.last) {
        const rx = data.reactions.last;
        if (rx.ts !== this.lastReactionTs && rx.uid !== auth.currentUser?.uid) {
          this.lastReactionTs = rx.ts;
          if (this.onReaction) this.onReaction(rx.emoji);
        }
      }
    });
  }

  // Toss: Caller submits Heads or Tails
  async submitTossCall(call) {
    if (!this.roomId) return;
    const cleanCall = call === 'heads' ? 'heads' : 'tails';
    const guestSeed = crypto.randomUUID() + '-' + crypto.randomUUID();
    this.tossGuestSeed = guestSeed;

    await update(ref(rtdb, `rooms/${this.roomId}/toss`), {
      call: cleanCall,
      guestCall: cleanCall,
      guestSeed,
      status: 'flipped',
      updatedAt: serverTimestamp()
    });

    // If host is the caller, resolve flip immediately
    if (this.isHost) {
      this._resolveTossFlip(cleanCall, 'host', guestSeed);
    }
  }

  // Host flips the authoritative coin using provably fair commit-reveal
  async _resolveTossFlip(call, callerRole, guestSeed) {
    let result = 'heads';
    if (this.tossHostSeed && guestSeed) {
      const combined = await sha256Hex(this.tossHostSeed + ':' + guestSeed);
      result = (parseInt(combined.slice(0, 2), 16) % 2 === 0) ? 'heads' : 'tails';
    } else {
      result = Math.random() < 0.5 ? 'heads' : 'tails';
    }

    const callerWon = (call === result);
    const winner = callerWon ? callerRole : (callerRole === 'host' ? 'guest' : 'host');

    const tossUpdate = {
      result,
      winner,
      status: 'deciding',
      updatedAt: serverTimestamp()
    };
    if (this.tossHostSeed) {
      tossUpdate.hostSeed = this.tossHostSeed;
    }

    await update(ref(rtdb, `rooms/${this.roomId}/toss`), tossUpdate);
  }

  // Toss: Winner submits Bat or Bowl
  async submitTossChoice(choice) {
    if (!this.roomId) return;
    const cleanChoice = choice === 'bat' ? 'bat' : 'bowl';
    const snap = await get(ref(rtdb, `rooms/${this.roomId}/toss`));
    const toss = snap.val() || {};

    const winner = toss.winner; // 'host' or 'guest'
    let hostBatsFirst = true;
    if (winner === 'host') {
      hostBatsFirst = (cleanChoice === 'bat');
    } else {
      hostBatsFirst = (cleanChoice === 'bowl');
    }

    // Launch match state
    const gameInit = {
      roundIndex: 1,
      hostBatsFirst,
      isBatter1Batting: hostBatsFirst,
      player1Score: 0,
      player2Score: 0,
      currentBall: 1,
      firstInningsComplete: false,
      targetScore: null,
      momentum: 0,
      sixesThisGame: 0,
      lastBatterChoice: null,
      lastBowlerChoice: null,
      roundOutcome: null,
      roundRuns: 0,
      gameOver: false,
      winner: null,
      ballHistory: []
    };

    const updates = {
      'meta/status': 'playing',
      'meta/updatedAt': serverTimestamp(),
      'toss/decision': cleanChoice,
      'toss/hostBatsFirst': hostBatsFirst,
      'game': gameInit
    };

    await update(this.roomRef, updates);
  }

  // Submit player run move (1..6) for the active round with cryptographic commit
  async submitRunMove(runs, currentRoundIndex) {
    if (!this.roomId) return;
    const cleanRun = Math.max(1, Math.min(6, Number(runs) || 1));
    const rIdx = currentRoundIndex || this.currentRoundIndex || 1;
    const salt = crypto.randomUUID();
    this.localMoves[rIdx] = { runs: cleanRun, salt, revealed: false };

    const commit = await sha256Hex(cleanRun + ':' + salt);
    const role = this.isHost ? 'host' : 'guest';
    const commitField = role + 'Commit';
    const moveField = role + 'Move';
    const saltField = role + 'Salt';

    // Check if opponent already committed
    const roundSnap = await get(ref(rtdb, `rooms/${this.roomId}/rounds/${rIdx}`));
    const roundData = roundSnap.val() || {};
    const oppRole = this.isHost ? 'guest' : 'host';
    const oppCommitField = oppRole + 'Commit';

    if (roundData[oppCommitField]) {
      // Both committed! Reveal immediately
      this.localMoves[rIdx].revealed = true;
      await update(ref(rtdb, `rooms/${this.roomId}/rounds/${rIdx}`), {
        [commitField]: commit,
        [moveField]: cleanRun,
        [saltField]: salt
      });
    } else {
      // Submit commit hash first (hides move from opponent)
      await update(ref(rtdb, `rooms/${this.roomId}/rounds/${rIdx}`), {
        [commitField]: commit
      });
    }
  }

  // Verifies cryptographic commitments before resolving round
  async _verifyAndResolveRound(rIdx, roundData, game) {
    let valid = true;
    if (roundData.hostCommit && typeof roundData.hostCommit === 'string' && roundData.hostCommit.length >= 16) {
      if (roundData.hostSalt) {
        const expected = await sha256Hex(roundData.hostMove + ':' + roundData.hostSalt);
        if (expected !== roundData.hostCommit) {
          console.error('[RTDB Net] Host move tampering detected: hash mismatch!');
          valid = false;
        }
      }
    }
    if (roundData.guestCommit && typeof roundData.guestCommit === 'string' && roundData.guestCommit.length >= 16) {
      if (roundData.guestSalt) {
        const expected = await sha256Hex(roundData.guestMove + ':' + roundData.guestSalt);
        if (expected !== roundData.guestCommit) {
          console.error('[RTDB Net] Guest move tampering detected: hash mismatch!');
          valid = false;
        }
      }
    }
    if (valid) {
      this._resolveRound(rIdx, roundData.hostMove, roundData.guestMove, game);
    }
  }

  // Authoritative host state resolution
  async _resolveRound(rIdx, hostMove, guestMove, prevGame) {
    this.isResolvingRound = true;
    try {
      const p1 = Number(hostMove);
      const p2 = Number(guestMove);
      const isBatter1Batting = prevGame.isBatter1Batting;

      const bc = isBatter1Batting ? p1 : p2; // batter choice
      const bw = isBatter1Batting ? p2 : p1; // bowler choice
      const out = (bc === bw);

      let player1Score = prevGame.player1Score || 0;
      let player2Score = prevGame.player2Score || 0;
      let momentum = prevGame.momentum || 0;
      let sixesThisGame = prevGame.sixesThisGame || 0;
      let firstInningsComplete = prevGame.firstInningsComplete || false;
      let targetScore = prevGame.targetScore || null;
      let currentBall = prevGame.currentBall || 1;
      let gameOver = false;
      let winner = null;
      let nextBatter1Batting = isBatter1Batting;

      const history = Array.isArray(prevGame.ballHistory) ? [...prevGame.ballHistory] : [];
      history.push({ runs: bc, isOut: out });
      if (history.length > 24) history.shift();

      if (out) {
        momentum = 0;
        if (!firstInningsComplete) {
          firstInningsComplete = true;
          targetScore = isBatter1Batting ? player1Score : player2Score;
          nextBatter1Batting = !isBatter1Batting;
          currentBall = 1;
        } else {
          gameOver = true;
        }
      } else {
        momentum++;
        if (bc === 6) sixesThisGame++;
        if (isBatter1Batting) player1Score += bc;
        else player2Score += bc;

        if (firstInningsComplete && (isBatter1Batting ? player1Score : player2Score) > targetScore) {
          gameOver = true;
        } else {
          currentBall++;
        }
      }

      if (gameOver) {
        if (player1Score > player2Score) winner = 'host';
        else if (player2Score > player1Score) winner = 'guest';
        else winner = 'tie';
      }

      const updatedGame = {
        roundIndex: rIdx + 1,
        isBatter1Batting: nextBatter1Batting,
        player1Score,
        player2Score,
        currentBall,
        firstInningsComplete,
        targetScore,
        momentum,
        sixesThisGame,
        lastBatterChoice: bc,
        lastBowlerChoice: bw,
        roundOutcome: out ? 'out' : 'runs',
        roundRuns: bc,
        gameOver,
        winner,
        ballHistory: history
      };

      const updates = {
        [`rounds/${rIdx}/resolved`]: true,
        [`rounds/${rIdx}/resolvedBy`]: 'host',
        'game': updatedGame,
        'meta/updatedAt': serverTimestamp()
      };

      if (gameOver) {
        updates['meta/status'] = 'finished';
      }

      await update(this.roomRef, updates);
    } catch (e) {
      console.error('[RTDB Net] Error resolving round:', e);
    } finally {
      this.isResolvingRound = false;
    }
  }

  // Send an in-match reaction emoji
  async sendReaction(emoji) {
    if (!this.roomId) return;
    const user = auth.currentUser;
    await set(ref(rtdb, `rooms/${this.roomId}/reactions/last`), {
      uid: user?.uid || 'anon',
      emoji: String(emoji).slice(0, 10),
      ts: Date.now()
    });
  }

  // Claim victory if opponent abandoned/timed out
  async claimTimeoutVictory() {
    if (!this.roomId) return;
    const oppRole = this.isHost ? 'guest' : 'host';
    const oppSnap = await get(ref(rtdb, `rooms/${this.roomId}/presence/${oppRole}`));
    const oppPresence = oppSnap.val();
    if (!oppPresence || oppPresence.online !== false) {
      throw new Error('Opponent is currently online or presence unknown.');
    }

    const winner = this.isHost ? 'host' : 'guest';
    await update(this.roomRef, {
      'meta/status': 'finished',
      'meta/abandoned': true,
      'game/gameOver': true,
      'game/winner': winner,
      'game/abandonedByOpponent': true
    });
  }

  // Restore active match session from sessionStorage (e.g. after browser refresh)
  async restoreActiveSession() {
    try {
      const savedRoom = sessionStorage.getItem('hc_active_room');
      const savedRole = sessionStorage.getItem('hc_room_role');
      if (!savedRoom) return null;

      const user = await this.ensureAuth();
      if (!user) return null;

      const roomRef = ref(rtdb, `rooms/${savedRoom}`);
      const snap = await get(roomRef);
      if (!snap.exists()) {
        sessionStorage.removeItem('hc_active_room');
        sessionStorage.removeItem('hc_room_role');
        return null;
      }

      const room = snap.val();
      const status = room.meta?.status;
      if (status !== 'playing' && status !== 'toss' && status !== 'waiting') {
        sessionStorage.removeItem('hc_active_room');
        sessionStorage.removeItem('hc_room_role');
        return null;
      }

      this.roomId = savedRoom;
      this.roomCode = savedRoom;
      this.isHost = (savedRole === 'host') || (room.meta?.hostUid === user.uid);
      this.roomRef = roomRef;
      this.currentRoundIndex = room.game?.roundIndex || 1;

      const role = this.isHost ? 'host' : 'guest';
      this._setupPresence(role);
      this._listenToRoom();

      console.log(`[RTDB Net] Restored active session for room ${savedRoom} as ${role}`);
      return { room, role };
    } catch (e) {
      console.warn('[RTDB Net] Could not restore active session:', e);
      return null;
    }
  }

  // Clean disconnect & leave room
  leaveRoom() {
    try {
      sessionStorage.removeItem('hc_active_room');
      sessionStorage.removeItem('hc_room_role');
    } catch (e) {}

    this.localMoves = {};
    this.tossHostSeed = null;
    this.tossGuestSeed = null;

    if (this.disconnectTimer) {
      clearInterval(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    if (this.roomListener && this.roomRef) {
      off(this.roomRef, 'value', this.roomListener);
      this.roomListener = null;
    }
    if (this.oppPresenceListener && this.oppPresenceRef) {
      off(this.oppPresenceRef, 'value', this.oppPresenceListener);
      this.oppPresenceListener = null;
    }
    if (this.connListener && this.connRef) {
      off(this.connRef, 'value', this.connListener);
      this.connListener = null;
    }
    if (this.presenceRef) {
      set(this.presenceRef, { online: false, lastSeen: serverTimestamp() }).catch(() => {});
    }

    this.roomId = null;
    this.roomCode = null;
    this.isHost = false;
    this.matchLaunched = false;
    this.matchEndedFired = false;
    this.guestJoinedFired = false;
    this.currentRoundIndex = 1;
  }
}

export const rtdbMultiplayer = new RTDBMultiplayer();
window.HC_MULTIPLAYER = rtdbMultiplayer;

// Event-compatible Network Adapter for Hand Cricket
class FirebaseRTDBNetwork {
  constructor(gameId) {
    this.gameId = gameId;
    this._listeners = {};
    this.isHost = false;
    this.roomCode = null;
    this.multiplayer = rtdbMultiplayer;

    this.multiplayer.onRoomReady = (code) => {
      this.roomCode = code;
      this._emit('lobby', code);
    };

    this.multiplayer.onGuestJoined = (meta) => {
      this._emit('connected', meta.guestUid);
    };

    let lastTossStatus = null;
    this.multiplayer.onTossState = (toss, meta) => {
      if (meta.status === 'playing' || meta.status === 'finished') return;
      if (toss.status === lastTossStatus) return;
      lastTossStatus = toss.status;

      if (toss.status === 'calling') {
        const callerIsHost = toss.caller === 'host';
        this._emit('message', null, 'reliable', {
          type: 'init',
          p1: meta.hostName || 'Player 1',
          p2: meta.guestName || 'Player 2',
          callerIsHost
        });
      }
      if (toss.status === 'deciding' && toss.result && toss.winner) {
        this._emit('message', null, 'reliable', {
          type: 'tossResult',
          result: toss.result,
          winnerIsHost: toss.winner === 'host'
        });
      }
    };

    this.multiplayer.onMatchLaunch = (game, meta) => {
      this._emit('message', null, 'reliable', {
        type: 'tossChoice',
        hostBatsFirst: game.hostBatsFirst
      });
    };

    this.multiplayer.onRoundResolved = (game, meta) => {
      this._emit('message', null, 'reliable', {
        type: 'state',
        p1: game.lastBatterChoice,
        p2: game.lastBowlerChoice,
        bc: game.lastBatterChoice,
        bw: game.lastBowlerChoice,
        out: game.roundOutcome === 'out',
        player1Score: game.player1Score,
        player2Score: game.player2Score,
        currentBall: game.currentBall,
        isBatter1Batting: game.isBatter1Batting,
        firstInningsComplete: game.firstInningsComplete,
        targetScore: game.targetScore,
        momentum: game.momentum,
        sixesThisGame: game.sixesThisGame,
        gameOver: game.gameOver
      });
    };

    this.multiplayer.onReaction = (emoji) => {
      this._emit('message', null, 'reliable', { type: 'reaction', emoji });
    };

    this.multiplayer.onOpponentDisconnected = (secondsLeft) => {
      const banner = document.getElementById('reconnectBanner');
      const timerEl = document.getElementById('reconnectTimer');
      const claimBtn = document.getElementById('claimWinBtn');
      if (banner) banner.classList.remove('hidden');
      if (timerEl) timerEl.textContent = secondsLeft;
      if (secondsLeft <= 0 && claimBtn) {
        claimBtn.classList.remove('hidden');
      }
    };

    this.multiplayer.onOpponentReconnected = () => {
      const banner = document.getElementById('reconnectBanner');
      if (banner) {
        banner.innerHTML = '<span>✅ Opponent reconnected!</span>';
        setTimeout(() => banner.classList.add('hidden'), 2000);
      }
    };

    setTimeout(() => this._emit('ready'), 30);
  }

  on(evt, cb) {
    (this._listeners[evt] = this._listeners[evt] || []).push(cb);
  }

  _emit(evt, ...args) {
    (this._listeners[evt] || []).forEach(cb => {
      try { cb(...args); } catch (e) { console.error(e); }
    });
  }

  async create() {
    this.isHost = true;
    try {
      const name = window.onlineName || window.currentPlayer?.username || 'Host';
      const avatar = window.currentPlayer?.activeAvatar || 'starter';
      await this.multiplayer.createRoom(name, avatar);
    } catch (err) {
      this._emit('error', err);
    }
  }

  async join(code) {
    this.isHost = false;
    try {
      const name = window.onlineName || window.currentPlayer?.username || 'Guest';
      const avatar = window.currentPlayer?.activeAvatar || 'starter';
      await this.multiplayer.joinRoom(code, name, avatar);
      this._emit('connected', 'host');
    } catch (err) {
      this._emit('error', err);
    }
  }

  broadcast(channel, data) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'tossCall') {
      this.multiplayer.submitTossCall(data.call);
    } else if (data.type === 'tossChoice') {
      const choice = data.hostBatsFirst ? (this.isHost ? 'bat' : 'bowl') : (this.isHost ? 'bowl' : 'bat');
      this.multiplayer.submitTossChoice(choice);
    } else if (data.type === 'choice') {
      const rIdx = this.multiplayer.currentRoundIndex || 1;
      this.multiplayer.submitRunMove(data.runs, rIdx);
    } else if (data.type === 'reaction') {
      this.multiplayer.sendReaction(data.emoji);
    }
  }

  close() {
    this._listeners = {};
    this.multiplayer.leaveRoom();
  }
}

window.PokiNetlibNetwork = FirebaseRTDBNetwork;
window.FirebaseRTDBNetwork = FirebaseRTDBNetwork;
window.dispatchEvent(new Event('poki-netlib-ready'));
