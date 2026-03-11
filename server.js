const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

const fs = require('fs');

// ============================================================
//  SESSION MANAGEMENT — Persistent Auction Archive
// ============================================================
const SESSIONS_DIR = path.join(__dirname, 'sessions');
const AUTOSAVE_PATH = path.join(SESSIONS_DIR, '_autosave.json');

// Create sessions folder if it doesn't exist
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    console.log('[Session Manager] Created sessions/ folder.');
}

// Helper: write state snapshot to a file
function writeSessionFile(filePath, label) {
    try {
        const snapshot = {
            label: label || 'Unnamed',
            savedAt: new Date().toISOString(),
            state: {
                players: state.players,
                teams: state.teams,
                auctionHistory: state.auctionHistory,
                auctionState: state.auctionState,
                settings: state.settings
            }
        };
        fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error('[Session Manager] Write error:', err);
        return false;
    }
}

// Helper: auto-backup (called after every sell/unsold)
function autoBackup() {
    writeSessionFile(AUTOSAVE_PATH, '__autosave__');
}

// REST: Save a named session
app.use(express.json());

app.post('/api/session/save', (req, res) => {
    const label = (req.body && req.body.label) ? req.body.label.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() : 'Session';
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
    const filename = `${dateStr}_${label.replace(/\s+/g, '-')}.json`;
    const filePath = path.join(SESSIONS_DIR, filename);
    const ok = writeSessionFile(filePath, label);
    if (ok) {
        io.emit('session:saved', { filename, label, savedAt: now.toISOString() });
        res.json({ success: true, filename, label });
    } else {
        res.status(500).json({ success: false, error: 'Failed to write session file.' });
    }
});

// REST: List all saved sessions
app.get('/api/session/list', (req, res) => {
    try {
        const files = fs.readdirSync(SESSIONS_DIR)
            .filter(f => f.endsWith('.json') && f !== '_autosave.json')
            .map(f => {
                try {
                    const raw = fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8');
                    const parsed = JSON.parse(raw);
                    return { filename: f, label: parsed.label || f, savedAt: parsed.savedAt || null };
                } catch { return { filename: f, label: f, savedAt: null }; }
            })
            .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
        res.json({ success: true, sessions: files });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// REST: Load a saved session into live state
app.post('/api/session/load', (req, res) => {
    const filename = req.body && req.body.filename;
    if (!filename) return res.status(400).json({ success: false, error: 'No filename provided.' });
    const filePath = path.join(SESSIONS_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'Session file not found.' });
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed.state) return res.status(400).json({ success: false, error: 'Invalid session file.' });
        // Stop any running timer/timeouts before loading
        clearInterval(timerInterval);
        if (nextPlayerTimeout) { clearTimeout(nextPlayerTimeout); nextPlayerTimeout = null; }
        // Restore state
        state.players = parsed.state.players || [];
        state.teams = parsed.state.teams || [];
        state.auctionHistory = parsed.state.auctionHistory || [];
        state.auctionState = parsed.state.auctionState || { status: 'idle', queue: [], currentIndex: -1, currentBid: 0, currentBidTeam: null, timerRemaining: 30, bids: [] };
        if (parsed.state.settings) state.settings = parsed.state.settings;
        // Normalize mid-flight statuses to 'paused' so admin sees Resume button
        // and no timer is running on a restored session
        const midFlightStatuses = ['live', 'awaiting_next'];
        if (midFlightStatuses.includes(state.auctionState.status)) {
            state.auctionState.status = 'paused';
        }
        // Broadcast restored state to ALL connected clients
        io.emit('state:full', state);
        io.emit('session:loaded', { filename, label: parsed.label, savedAt: parsed.savedAt });
        res.json({ success: true, filename, label: parsed.label });
        console.log(`[Session Manager] Loaded session: ${filename}`);
    } catch (err) {
        console.error('[Session Manager] Load error:', err);
        res.status(500).json({ success: false, error: 'Failed to parse session file.' });
    }
});

// REST: Delete a saved session
app.delete('/api/session/delete', (req, res) => {
    const filename = req.body && req.body.filename;
    if (!filename) return res.status(400).json({ success: false, error: 'Cannot delete this file.' });
    const filePath = path.join(SESSIONS_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'File not found.' });
    try {
        fs.unlinkSync(filePath);
        res.json({ success: true, filename });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to delete file.' });
    }
});

app.use(express.static(path.join(__dirname, 'frontend')));
app.use(express.static(__dirname));

// DIAGNOSTIC LOGGING
console.log("--- SERVER DIRECTORY LISTING ---");
try {
    const files = fs.readdirSync(__dirname);
    console.log("Files in root:", files);
} catch (err) {
    console.log("Error reading directory:", err);
}
console.log("-------------------------------");

app.get('/', (req, res) => {
    const frontendIndex = path.join(__dirname, 'frontend', 'index.html');
    const rootIndex = path.join(__dirname, 'index.html');

    if (fs.existsSync(frontendIndex)) {
        res.sendFile(frontendIndex);
    } else if (fs.existsSync(rootIndex)) {
        res.sendFile(rootIndex);
    } else {
        res.status(404).send("Error: index.html not found on server. Please check your upload.");
    }
});

const MAX_SQUAD = 25;
const NEXT_PLAYER_DELAY_MS = 5000; // Show SOLD/UNSOLD overlay then auto-advance to next player
const POOL_TRANSITION_SECONDS = 20;

const uid = () => '_' + Math.random().toString(36).substr(2, 9);
const bidInc = l => l < 100 ? 10 : l < 500 ? 25 : 50;

let nextPlayerTimeout = null;

let state = {
    players: [], teams: [], auctionHistory: [],
    auctionState: { status: 'idle', queue: [], currentIndex: -1, currentBid: 0, currentBidTeam: null, timerRemaining: 30, bids: [], pendingPoolSwitch: null, currentPool: 'all' },
    settings: { timerDuration: 30, extension: 10, threshold: 5 },
    adminUser: 'admin', adminPass: 'ipl2026'
};
let timerInterval = null;
let introInterval = null;
let transitionInterval = null;

function buildQueue(pool = "all") {
    let available = state.players.filter(p => !p.sold && !p.isUnsold);
    if (pool === "Uncapped") {
        return available.filter(p => p.playerStatus === "Uncapped").map(p => p.id);
    } else if (pool !== "all") {
        return available.filter(p => p.category === pool).map(p => p.id);
    }
    const m = available.filter(p => p.marquee).map(p => p.id);
    const cats = ['Batsman', 'Bowler', 'All-Rounder', 'Wicketkeeper'];
    const r = [];
    cats.forEach(c => available.filter(p => !p.marquee && p.category === c).forEach(p => r.push(p.id)));
    const missing = available.filter(p => !p.marquee && !cats.includes(p.category)).map(p => p.id);
    return [...new Set([...m, ...r, ...missing])];
}

function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (state.auctionState.status !== 'live') return;
        state.auctionState.timerRemaining--;
        io.emit('timer:tick', state.auctionState.timerRemaining);

        if (state.auctionState.timerRemaining <= 0) {
            clearInterval(timerInterval);
            resolvePlayer();
        }
    }, 1000);
}

function resolvePlayer() {
    const qItem = state.auctionState.queue[state.auctionState.currentIndex];
    const pid = (typeof qItem === 'object' && qItem !== null) ? qItem.id : qItem;
    const p = state.players.find(x => x.id === pid);
    if (!p || p.sold) { nextPlayer(); return; }
    if (state.auctionState.currentBidTeam) sellPlayer(p, state.auctionState.currentBidTeam, state.auctionState.currentBid);
    else markUnsold(p);
}

function normalizePoolName(poolName) {
    const raw = String(poolName || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    if (!raw) return '';
    if (raw === 'all' || raw === 'allplayers') return 'all';
    if (raw === 'batsman' || raw === 'batsmen') return 'batsman';
    if (raw === 'bowler' || raw === 'bowlers') return 'bowler';
    if (raw === 'allrounder' || raw === 'allrounders') return 'allrounder';
    if (raw === 'wicketkeeper' || raw === 'wicketkeepers' || raw === 'wk') return 'wicketkeeper';
    if (raw === 'uncapped') return 'uncapped';
    return raw;
}

function getPoolFromQueueItem(qItem, player) {
    if (qItem && typeof qItem === 'object' && qItem.aiPoolName) return qItem.aiPoolName;
    if (state.auctionState.currentPool) return state.auctionState.currentPool;
    if (player && String(player.playerStatus || '').trim().toLowerCase() === 'uncapped') return 'Uncapped';
    if (player && player.category) return player.category;
    return 'Current Pool';
}

function isPlayerInPool(player, poolName) {
    if (!player) return false;
    const pool = normalizePoolName(poolName);
    if (pool === 'all') return true;
    if (pool === 'uncapped') return String(player.playerStatus || '').trim().toLowerCase() === 'uncapped';
    const category = normalizePoolName(player.category);
    if (pool === 'batsman') return category === 'batsman';
    if (pool === 'bowler') return category === 'bowler';
    if (pool === 'allrounder') return category === 'allrounder';
    if (pool === 'wicketkeeper') return category === 'wicketkeeper';
    return category === pool;
}

const clearAllTimers = () => {
    clearInterval(timerInterval);
    if (introInterval) { clearInterval(introInterval); introInterval = null; }
    if (transitionInterval) { clearInterval(transitionInterval); transitionInterval = null; }
    if (nextPlayerTimeout) { clearTimeout(nextPlayerTimeout); nextPlayerTimeout = null; }
};

function scheduleNextPlayer() {
    if (nextPlayerTimeout) clearTimeout(nextPlayerTimeout);
    nextPlayerTimeout = setTimeout(() => {
        nextPlayerTimeout = null;
        if (state.auctionState.status === 'awaiting_next') {
            state.auctionState.status = 'live';
            nextPlayer();
        }
    }, NEXT_PLAYER_DELAY_MS);
}

function sellPlayer(p, teamId, price) {
    const t = state.teams.find(x => x.id == teamId);
    if (!t) return;
    t.purse -= price;
    p.sold = true; p.soldTo = teamId; p.soldPrice = price;
    state.auctionHistory.push({ playerId: p.id, playerName: p.name, category: p.category, teamId, teamName: t.name, price, status: 'sold', ts: Date.now() });
    clearInterval(timerInterval);
    state.auctionState.status = 'awaiting_next';
    io.emit('player:sold', { player: p, team: t, price, auctionHistory: state.auctionHistory });
    autoBackup(); // Auto-save after every sell
    scheduleNextPlayer();
}

function markUnsold(p) {
    p.isUnsold = true;
    state.auctionHistory.push({ playerId: p.id, playerName: p.name, category: p.category, teamId: null, teamName: null, price: 0, status: 'unsold', ts: Date.now() });
    clearInterval(timerInterval);
    state.auctionState.status = 'awaiting_next';
    io.emit('player:unsold', { player: p, auctionHistory: state.auctionHistory });
    autoBackup(); // Auto-save after every unsold
    scheduleNextPlayer();
}

function nextPlayer() {
    // If admin queued a pool switch, apply it now between players (never mid-player).
    const pendingPool = state.auctionState.pendingPoolSwitch;
    if (pendingPool) {
        clearInterval(timerInterval);
        if (nextPlayerTimeout) { clearTimeout(nextPlayerTimeout); nextPlayerTimeout = null; }

        let available = state.players.filter(p => !p.sold && !p.isUnsold);
        let newQueue;
        if (pendingPool === 'all') {
            newQueue = available.map(p => p.id);
        } else if (pendingPool === 'Uncapped') {
            newQueue = available.filter(p => p.playerStatus === 'Uncapped').map(p => p.id);
        } else {
            newQueue = available.filter(p => p.category === pendingPool).map(p => p.id);
        }

        if (!newQueue.length) {
            state.auctionState.pendingPoolSwitch = null;
            io.emit('toast:incoming', { msg: 'No unsold players in pool: ' + pendingPool, type: 'warning' });
            // Continue normal flow if chosen pool has no available players.
        } else {
            const prevPool = state.auctionState.currentPool || 'Previous Pool';
            state.auctionState.queue = newQueue;
            state.auctionState.currentIndex = -1;
            state.auctionState.currentPool = pendingPool;
            state.auctionState.pendingPoolSwitch = null;
            state.auctionState.status = 'pool_transition_manual';

            const firstP = state.players.find(x => x.id === newQueue[0]);
            const pName = firstP ? firstP.name : '—';

            io.emit('auction:pool_transition', {
                prevPool,
                nextPool: pendingPool,
                nextPlayerName: pName,
                duration: POOL_TRANSITION_SECONDS,
                isManual: true
            });

            let t = POOL_TRANSITION_SECONDS;
            if (transitionInterval) clearInterval(transitionInterval);
            transitionInterval = setInterval(() => {
                t--;
                io.emit('auction:pool_transition_tick', { remaining: t, nextPool: pendingPool, isManual: true });
                if (t <= 0) {
                    clearInterval(transitionInterval);
                    transitionInterval = null;
                    state.auctionState.status = 'live';
                    nextPlayer();
                }
            }, 1000);
            return;
        }
    }

    const prevIndex = state.auctionState.currentIndex;
    state.auctionState.currentIndex++;

    if (state.auctionState.currentIndex >= state.auctionState.queue.length) {
        clearInterval(timerInterval);
        state.auctionState.status = 'ended';
        io.emit('auction:ended', { players: state.players, teams: state.teams, auctionHistory: state.auctionHistory });
        return;
    }

    const qItem = state.auctionState.queue[state.auctionState.currentIndex];
    const pid = (typeof qItem === 'object' && qItem !== null) ? qItem.id : qItem;
    const p = state.players.find(x => x.id === pid);
    const currentPoolFromItem = (typeof qItem === 'object' && qItem !== null && qItem.aiPoolName) ? qItem.aiPoolName : null;
    if (currentPoolFromItem) {
        state.auctionState.currentPool = currentPoolFromItem;
    }

    // Skip already resolved players
    if (!p || p.sold || p.isUnsold) {
        console.log(`[Queue] Skipping player ${p ? p.name : pid} because they are already resolved (Sold: ${p ? p.sold : '?'}, Unsold: ${p ? p.isUnsold : '?'})`);
        nextPlayer();
        return;
    }

    // ── POOL TRANSITION DETECTION (AI Autonomous mode only) ──
    // If queue items carry aiPoolName, check if pool has changed from previous item
    const prevQItem = prevIndex >= 0 ? state.auctionState.queue[prevIndex] : null;
    const prevPool = (prevQItem && typeof prevQItem === 'object') ? prevQItem.aiPoolName : null;
    const currPool = (typeof qItem === 'object' && qItem !== null) ? qItem.aiPoolName : null;

    if (prevPool && currPool && prevPool !== currPool) {
        // Pool has changed — pause the game and show a short transition announcement.
        clearInterval(timerInterval);
        state.auctionState.status = 'pool_transition';

        // Find the next player name for the announcement
        const nextPlayerName = p ? p.name : 'first player';

        io.emit('auction:pool_transition', {
            prevPool,
            nextPool: currPool,
            nextPlayerName,
            duration: POOL_TRANSITION_SECONDS
        });

        // Countdown broadcast every second
        let transitionTimer = POOL_TRANSITION_SECONDS;
        transitionInterval = setInterval(() => {
            transitionTimer--;
            io.emit('auction:pool_transition_tick', { remaining: transitionTimer, nextPool: currPool });
            if (transitionTimer <= 0) {
                clearInterval(transitionInterval);
                transitionInterval = null;
                // Now actually start this player
                state.auctionState.currentBid = p.basePrice;
                state.auctionState.currentBidTeam = null;
                state.auctionState.bids = [];
                state.auctionState.timerRemaining = state.settings.timerDuration;
                state.auctionState.status = 'live';
                io.emit('player:next', { player: p, auctionState: { ...state.auctionState }, queueLen: state.auctionState.queue.length });
                startTimer();
            }
        }, 1000);
        return;
    }

    // Normal next player (same pool or non-AI mode)
    state.auctionState.currentBid = p.basePrice;
    state.auctionState.currentBidTeam = null;
    state.auctionState.bids = [];
    state.auctionState.timerRemaining = state.settings.timerDuration;
    state.auctionState.status = 'live';
    io.emit('player:next', { player: p, auctionState: { ...state.auctionState }, queueLen: state.auctionState.queue.length });
    startTimer();
}

io.on('connection', socket => {
    console.log('Connected:', socket.id);
    socket.emit('state:full', state);

    socket.on('auction:start', (payload) => {
        let pool = payload && payload.pool ? payload.pool : "all";
        if (!state.players.filter(p => !p.sold).length || !state.teams.length) return;

        state.auctionState.queue = buildQueue(pool);
        state.auctionState.currentIndex = -1;
        state.auctionState.currentPool = pool;
        state.auctionState.status = 'manual_intro'; // New status for manual mode transition

        // Find first player for the announcement
        const q0 = state.auctionState.queue[0];
        const p0 = state.players.find(x => x.id === q0);
        const p0Name = p0 ? p0.name : 'the first player';

        io.emit('auction:started', { ...state.auctionState });

        let introTimer = 60;
        if (introInterval) clearInterval(introInterval);

        io.emit('auction:manual_intro_tick', { remaining: introTimer, pool: pool, nextPlayer: p0Name });

        introInterval = setInterval(() => {
            introTimer--;
            if (introTimer > 0) {
                io.emit('auction:manual_intro_tick', { remaining: introTimer, pool: pool, nextPlayer: p0Name });
            } else {
                clearInterval(introInterval);
                introInterval = null;
                io.emit('auction:manual_intro_end');
                state.auctionState.status = 'live';
                nextPlayer();
            }
        }, 1000);
    });

    socket.on('auction:start_autonomous', ({ queue }) => {
        if (!queue || !queue.length) return;
        state.auctionState.queue = queue;
        state.auctionState.currentIndex = -1;
        state.auctionState.currentPool = null;
        state.auctionState.status = 'ai_intro'; // Set status to our new phase

        // Grab info for the UI - FIND THE FIRST ACTUAL PLAYER (skip sold ones)
        let firstIndex = 0;
        let firstItem = queue[0];
        let firstPlayer = null;

        for (let i = 0; i < queue.length; i++) {
            const item = queue[i];
            const p = state.players.find(px => px.id === (item.id || item));
            if (p && !p.sold && !p.isUnsold) {
                firstItem = item;
                firstPlayer = p;
                firstIndex = i;
                break;
            }
        }

        const firstPool = firstItem ? (firstItem.aiPoolName || 'the first pool') : 'the first pool';
        const firstName = firstPlayer ? firstPlayer.name : 'first player';

        io.emit('auction:started', { ...state.auctionState });

        let introTimer = 60;

        // Broadcast initial tick
        io.emit('auction:ai_intro_tick', { remaining: introTimer, firstPool, firstName });

        // Start perfect 1-second server interval for synchronized countdown
        if (introInterval) clearInterval(introInterval);
        introInterval = setInterval(() => {
            introTimer--;
            if (introTimer > 0) {
                io.emit('auction:ai_intro_tick', { remaining: introTimer, firstPool, firstName });
            } else {
                clearInterval(introInterval);
                introInterval = null;
                io.emit('auction:ai_intro_end');
                state.auctionState.status = 'live';
                // Move index to just BEFORE the first player so nextPlayer() lands on it
                state.auctionState.currentIndex = firstIndex - 1;
                nextPlayer();
            }
        }, 1000);
    });

    socket.on('auction:start_unsold', ({ queue }) => {
        if (!queue || !queue.length) return;
        state.auctionState.queue = queue;
        state.auctionState.currentIndex = -1;
        state.auctionState.currentPool = 'unsold';
        state.auctionState.status = 'live';
        io.emit('auction:started', { ...state.auctionState });
        nextPlayer();
    });

    // Manual mode pool switch: admin picks a new pool mid-auction
    socket.on('auction:switch_pool', ({ pool }) => {
        if (!pool) return;
        // Queue switch and apply only after current player resolves.
        state.auctionState.pendingPoolSwitch = pool;

        const currentQItem = state.auctionState.queue && state.auctionState.queue[state.auctionState.currentIndex];
        const currentPid = (typeof currentQItem === 'object' && currentQItem !== null) ? currentQItem.id : currentQItem;
        const currentP = currentPid ? state.players.find(x => x.id === currentPid) : null;
        const isCurrentResolved = !currentP || currentP.sold || currentP.isUnsold;

        if (isCurrentResolved || state.auctionState.status === 'awaiting_next') {
            io.emit('toast:incoming', { msg: 'Pool switch applied before the next player.', type: 'info' });
            if (nextPlayerTimeout) { clearTimeout(nextPlayerTimeout); nextPlayerTimeout = null; }
            state.auctionState.status = 'live';
            nextPlayer();
        } else {
            io.emit('toast:incoming', { msg: 'Pool switch queued. It will apply after current player is completed.', type: 'info' });
        }
    });

    socket.on('auction:pause', () => {
        clearAllTimers();
        state.auctionState.status = 'paused';
        io.emit('auction:paused', { timerRemaining: state.auctionState.timerRemaining });
    });

    socket.on('auction:resume', () => {
        // Check if current player is already resolved (e.g., resuming from saved session after sell/unsold)
        const currentQItem = state.auctionState.queue && state.auctionState.queue[state.auctionState.currentIndex];
        const currentPid = (typeof currentQItem === 'object' && currentQItem !== null) ? currentQItem.id : currentQItem;
        const currentP = currentPid ? state.players.find(x => x.id === currentPid) : null;
        const isCurrentResolved = !currentP || currentP.sold || currentP.isUnsold;

        state.auctionState.status = 'live';
        io.emit('auction:resumed', { timerRemaining: state.auctionState.timerRemaining });

        if (isCurrentResolved) {
            // Current player already settled — advance to next
            nextPlayer();
        } else {
            // Current player still pending — resume their timer
            startTimer();
        }
    });

    // manual end triggered by admin; broadcast final summary to all
    socket.on('auction:end', () => {
        clearInterval(timerInterval);
        if (introInterval) { clearInterval(introInterval); introInterval = null; }
        if (transitionInterval) { clearInterval(transitionInterval); transitionInterval = null; }
        if (nextPlayerTimeout) { clearTimeout(nextPlayerTimeout); nextPlayerTimeout = null; }
        state.auctionState.status = 'ended';
        io.emit('auction:ended', { players: state.players, teams: state.teams, auctionHistory: state.auctionHistory });
    });

    socket.on('auction:requestState', () => {
        socket.emit('state:full', state);
    });

    socket.on('auction:reset', () => {
        clearAllTimers();
        state.players = state.players.map(p => ({ ...p, sold: false, soldTo: null, soldPrice: 0, isUnsold: false }));
        state.teams = state.teams.map(t => ({ ...t, purse: t.initialPurse }));
        state.auctionHistory = [];
        state.auctionState = { status: 'idle', queue: [], currentIndex: -1, currentBid: 0, currentBidTeam: null, timerRemaining: state.settings.timerDuration, bids: [], pendingPoolSwitch: null, currentPool: 'all' };
        io.emit('state:full', state);
    });

    socket.on('admin:full_reset', () => {
        clearAllTimers();
        state.players = [];
        state.teams = [];
        state.auctionHistory = [];
        state.auctionState = { status: 'idle', queue: [], currentIndex: -1, currentBid: 0, currentBidTeam: null, timerRemaining: state.settings.timerDuration, bids: [], pendingPoolSwitch: null, currentPool: 'all' };
        if (fs.existsSync(AUTOSAVE_PATH)) {
            try { fs.unlinkSync(AUTOSAVE_PATH); } catch (e) { }
        }
        io.emit('state:full', state);
        io.emit('auction:force_logout');
    });

    socket.on('bid:place', ({ teamId }) => {
        if (state.auctionState.status !== 'live') {
            console.log(`[Bid Blocked] Auction status is ${state.auctionState.status} (live expected).`);
            socket.emit('bid:error', 'Auction is not live');
            return;
        }

        // Use == to handle string/number type mismatch from JSON session files
        const t = state.teams.find(x => x.id == teamId);
        if (!t) {
            console.log(`[Bid Error] Team not found for ID: ${teamId}`);
            socket.emit('bid:error', 'Team not found');
            return;
        }

        if (state.players.filter(p => p.soldTo == teamId).length >= (t.maxSquad || MAX_SQUAD)) {
            socket.emit('bid:error', 'Squad is full');
            return;
        }

        // Ensure values are strict numbers to prevent string concatenation bugs
        let currentAmount = parseFloat(state.auctionState.currentBid) || 0;
        let pPurse = parseFloat(t.purse) || 0;
        const inc = parseFloat(bidInc(currentAmount)) || 0;
        const newBid = currentAmount + inc;

        if (pPurse < newBid) { socket.emit('bid:error', 'Insufficient purse on server'); return; }
        if (state.auctionState.currentBidTeam == teamId) { socket.emit('bid:error', 'Already highest bidder on server'); return; }

        state.auctionState.currentBid = newBid;
        state.auctionState.currentBidTeam = teamId;
        state.auctionState.bids.push({ teamId, teamName: t.name, amount: newBid });

        // Reset timer to 25 seconds if bid placed during Going Once/Twice/Last Call stages
        const remaining = state.auctionState.timerRemaining;
        if (remaining <= 18) {
            state.auctionState.timerRemaining = 25;
        } else if (remaining <= state.settings.threshold) {
            state.auctionState.timerRemaining = state.auctionState.timerRemaining + state.settings.extension;
        }
        io.emit('bid:placed', { teamId, teamName: t.name, amount: newBid, timerRemaining: state.auctionState.timerRemaining, bids: state.auctionState.bids });
    });

    // Notify admin if an autosave exists (for recovery banner)
    socket.on('session:check_autosave', () => {
        if (fs.existsSync(AUTOSAVE_PATH)) {
            try {
                const raw = fs.readFileSync(AUTOSAVE_PATH, 'utf8');
                const parsed = JSON.parse(raw);
                socket.emit('session:autosave_found', { savedAt: parsed.savedAt });
            } catch { /* ignore */ }
        }
    });

    // Load autosave via socket (for recovery banner button)
    socket.on('session:load_autosave', () => {
        if (!fs.existsSync(AUTOSAVE_PATH)) return;
        try {
            const raw = fs.readFileSync(AUTOSAVE_PATH, 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed.state) return;
            clearInterval(timerInterval);
            if (nextPlayerTimeout) { clearTimeout(nextPlayerTimeout); nextPlayerTimeout = null; }
            state.players = parsed.state.players || [];
            state.teams = parsed.state.teams || [];
            state.auctionHistory = parsed.state.auctionHistory || [];
            state.auctionState = parsed.state.auctionState || state.auctionState;
            if (parsed.state.settings) state.settings = parsed.state.settings;
            // Normalize mid-flight statuses to 'paused' (same as REST load)
            const midFlight = ['live', 'awaiting_next'];
            if (midFlight.includes(state.auctionState.status)) {
                state.auctionState.status = 'paused';
            }
            io.emit('state:full', state);
            io.emit('session:loaded', { filename: '_autosave.json', label: 'Auto-Recovery', savedAt: parsed.savedAt });
        } catch (err) { console.error('[Session Manager] Autosave load error:', err); }
    });

    socket.on('quicksell', ({ teamId, price }) => {
        // quicksell feature removed in update 20d22a6 - kept handler stub for compatibility
        console.log('quicksell called but feature is disabled');
    });

    socket.on('player:skip', () => {
        // skip feature removed in update 20d22a6 - admin must now mark unsold via normal workflow
        console.log('player:skip called but feature is disabled');
    });



    socket.on('admin:reset_auction', () => {
        clearAllTimers();
        state.auctionState = { status: 'idle', queue: [], currentIndex: -1, currentBid: 0, currentBidTeam: null, timerSecs: 30, timerRemaining: 30, bids: [], undoStack: [], pendingPoolSwitch: null, currentPool: 'all' };
        io.emit('state:full', state);
    });

    socket.on('admin:forcesell', () => {
        if (state.auctionState.status !== 'live') return;
        const qItem = state.auctionState.queue[state.auctionState.currentIndex];
        const pid = (typeof qItem === 'object' && qItem !== null) ? qItem.id : qItem;
        const p = state.players.find(x => x.id === pid);
        if (!p || p.sold || p.isUnsold) return;
        if (state.auctionState.currentBidTeam) {
            sellPlayer(p, state.auctionState.currentBidTeam, state.auctionState.currentBid);
        }
    });

    socket.on('admin:forceskip', () => {
        if (state.auctionState.status !== 'live') return;
        const qItem = state.auctionState.queue[state.auctionState.currentIndex];
        const pid = (typeof qItem === 'object' && qItem !== null) ? qItem.id : qItem;
        const p = state.players.find(x => x.id === pid);
        if (!p || p.sold || p.isUnsold) return;
        markUnsold(p);
    });

    socket.on('auction:next', () => {
        if (state.auctionState.status !== 'awaiting_next') return;
        if (nextPlayerTimeout) { clearTimeout(nextPlayerTimeout); nextPlayerTimeout = null; }
        state.auctionState.status = 'live';
        nextPlayer();
    });

    socket.on('player:revert', pid => {
        const p = state.players.find(x => x.id === pid);
        if (!p || !p.sold) return;
        const t = state.teams.find(x => x.id === p.soldTo);
        if (t) t.purse += p.soldPrice;
        p.sold = false; p.soldTo = null; p.soldPrice = 0;
        state.auctionHistory = state.auctionHistory.filter(h => h.playerId !== pid);
        io.emit('state:full', state);
    });

    socket.on('player:undo_sale', payload => {
        const playerId = payload && payload.playerId;
        const historyIndex = payload && Number.isInteger(payload.historyIndex) ? payload.historyIndex : -1;
        if (!playerId) return;

        const p = state.players.find(x => x.id === playerId);
        if (!p || !p.sold) return;

        const t = state.teams.find(x => x.id === p.soldTo);
        if (t) t.purse += (p.soldPrice || 0);

        p.sold = false;
        p.isUnsold = false;
        p.soldTo = null;
        p.soldPrice = 0;

        if (historyIndex >= 0 && historyIndex < state.auctionHistory.length) {
            const h = state.auctionHistory[historyIndex];
            if (h && h.playerId === playerId && h.status === 'sold') {
                state.auctionHistory.splice(historyIndex, 1);
            } else {
                for (let i = state.auctionHistory.length - 1; i >= 0; i--) {
                    if (state.auctionHistory[i].playerId === playerId && state.auctionHistory[i].status === 'sold') {
                        state.auctionHistory.splice(i, 1);
                        break;
                    }
                }
            }
        } else {
            for (let i = state.auctionHistory.length - 1; i >= 0; i--) {
                if (state.auctionHistory[i].playerId === playerId && state.auctionHistory[i].status === 'sold') {
                    state.auctionHistory.splice(i, 1);
                    break;
                }
            }
        }

        if (!Array.isArray(state.auctionState.queue)) state.auctionState.queue = [];

        // Remove future duplicates and reinsert right after current player.
        state.auctionState.queue = state.auctionState.queue.filter((qItem, idx) => {
            if (idx <= state.auctionState.currentIndex) return true;
            const qid = (qItem && typeof qItem === 'object') ? qItem.id : qItem;
            return qid !== playerId;
        });

        let insertAt = Math.max((state.auctionState.currentIndex || 0) + 1, 0);
        if (insertAt > state.auctionState.queue.length) insertAt = state.auctionState.queue.length;
        state.auctionState.queue.splice(insertAt, 0, playerId);

        io.emit('state:full', state);
        io.emit('toast:incoming', { msg: `${p.name} moved back into queue after current player.`, type: 'warning' });
    });

    socket.on('undo:last', () => {
        const last = [...state.auctionHistory].reverse().find(h => h.status === 'sold');
        if (!last) return;
        const p = state.players.find(x => x.id === last.playerId);
        const t = p ? state.teams.find(x => x.id === p.soldTo) : null;
        if (t) t.purse += p.soldPrice;
        if (p) { p.sold = false; p.soldTo = null; p.soldPrice = 0; }
        state.auctionHistory = state.auctionHistory.filter(h => h.playerId !== last.playerId);
        io.emit('state:full', state);
    });

    socket.on('players:save', data => {
        if (!Array.isArray(data)) return;
        // SAFE MERGE: only update non-auction fields (imported data, base prices, names)
        // NEVER let client overwrite sold/isUnsold/soldTo/soldPrice set by server
        if (state.auctionState && state.auctionState.status === 'idle') {
            // Only allow full replace when auction is NOT running
            state.players = data;
        } else {
            // During live auction: safe merge only non-critical fields
            data.forEach(cp => {
                const sp = state.players.find(x => x.id === cp.id);
                if (sp) {
                    // Only update safe metadata fields, never touch sold state
                    ['name', 'category', 'basePrice', 'nationality', 'marquee', 'rating', 'playerStatus', 'battingHand', 'bowlingHand'].forEach(f => {
                        if (cp[f] !== undefined) sp[f] = cp[f];
                    });
                } else {
                    state.players.push(cp); // New player added
                }
            });
        }
        io.emit('players:updated', state.players);
    });
    socket.on('teams:save', data => {
        if (!Array.isArray(data)) return;
        if (state.auctionState && state.auctionState.status === 'idle') {
            // Only allow full replace when auction is NOT running
            state.teams = data;
        } else {
            // During live auction: safe merge only non-critical fields, never touch purse
            data.forEach(ct => {
                const st = state.teams.find(x => x.id === ct.id);
                if (st) {
                    ['name', 'username', 'logo', 'maxSquad', 'initialPurse'].forEach(f => {
                        if (ct[f] !== undefined) st[f] = ct[f];
                    });
                } else {
                    state.teams.push(ct);
                }
            });
        }
        io.emit('teams:updated', state.teams);
    });

    socket.on('settings:save', s => {
        state.settings = s;
        io.emit('settings:updated', s);
        io.emit('auctionState:sync', state);
    });

    socket.on('admin:changepass', ({ current, newPass }, cb) => {
        if (current !== state.adminPass) { socket.emit('admin:passresult', false); return; }
        if (newPass.length < 4) { socket.emit('admin:passresult', false); return; }
        state.adminPass = newPass;
        socket.emit('admin:passresult', true);
    });

    socket.on('demo:load', () => {
        clearInterval(timerInterval);
        const dp = [
            { name: 'Virat Kohli', category: 'Batsman', basePrice: 200, marquee: true, nationality: 'Indian' },
            { name: 'Rohit Sharma', category: 'Batsman', basePrice: 200, marquee: true, nationality: 'Indian' },
            { name: 'MS Dhoni', category: 'Wicketkeeper', basePrice: 200, marquee: true, nationality: 'Indian' },
            { name: 'Jasprit Bumrah', category: 'Bowler', basePrice: 200, marquee: true, nationality: 'Indian' },
            { name: 'Hardik Pandya', category: 'All-Rounder', basePrice: 200, marquee: true, nationality: 'Indian' },
            { name: 'KL Rahul', category: 'Batsman', basePrice: 150, marquee: false, nationality: 'Indian' },
            { name: 'Shubman Gill', category: 'Batsman', basePrice: 100, marquee: false, nationality: 'Indian' },
            { name: 'Ravindra Jadeja', category: 'All-Rounder', basePrice: 175, marquee: false, nationality: 'Indian' },
            { name: 'Mohammed Shami', category: 'Bowler', basePrice: 125, marquee: false, nationality: 'Indian' },
            { name: 'Yuzvendra Chahal', category: 'Bowler', basePrice: 100, marquee: false, nationality: 'Indian' },
            { name: 'Sanju Samson', category: 'Wicketkeeper', basePrice: 100, marquee: false, nationality: 'Indian' },
            { name: 'Rishabh Pant', category: 'Wicketkeeper', basePrice: 150, marquee: false, nationality: 'Indian' },
            { name: 'Pat Cummins', category: 'All-Rounder', basePrice: 200, marquee: true, nationality: 'Australian' },
            { name: 'Jos Buttler', category: 'Batsman', basePrice: 150, marquee: false, nationality: 'English' },
            { name: 'Rashid Khan', category: 'Bowler', basePrice: 200, marquee: true, nationality: 'Afghan' }
        ];
        const dt = [
            { name: 'Chennai Super Kings', code: 'CSK', username: 'csk', password: 'csk123', initialPurse: 10000, maxSquad: 25, logo: '' },
            { name: 'Mumbai Indians', code: 'MI', username: 'mi', password: 'mi123', initialPurse: 10000, maxSquad: 25, logo: '' },
            { name: 'Royal Challengers', code: 'RCB', username: 'rcb', password: 'rcb123', initialPurse: 10000, maxSquad: 25, logo: '' },
            { name: 'Kolkata Knight Riders', code: 'KKR', username: 'kkr', password: 'kkr123', initialPurse: 10000, maxSquad: 25, logo: '' }
        ];
        state.players = dp.map(p => ({ ...p, id: uid(), image: '', sold: false }));
        state.teams = dt.map(t => ({ ...t, id: uid(), purse: t.initialPurse }));
        state.auctionHistory = [];
        state.auctionState = { status: 'idle', queue: [], currentIndex: -1, currentBid: 0, currentBidTeam: null, timerRemaining: state.settings.timerDuration, bids: [], pendingPoolSwitch: null, currentPool: 'all' };
        io.emit('state:full', state);
    });

    socket.on('full:reset', () => {
        clearInterval(timerInterval);
        state.players = []; state.teams = []; state.auctionHistory = [];
        state.auctionState = { status: 'idle', queue: [], currentIndex: -1, currentBid: 0, currentBidTeam: null, timerRemaining: state.settings.timerDuration, bids: [], pendingPoolSwitch: null, currentPool: 'all' };
        io.emit('state:full', state);
    });

    socket.on('unsold:start', () => {
        const unsold = state.players.filter(p => p.sold && !p.soldTo);
        if (!unsold.length) return;
        state.auctionState.queue = unsold.map(p => p.id);
        state.auctionState.currentIndex = -1;
        state.auctionState.currentPool = 'unsold';
        state.auctionState.status = 'live';
        io.emit('auction:started', { ...state.auctionState });
        nextPlayer();
    });

    socket.on('state:request', () => socket.emit('auctionState:sync', state));

    // POWERFUL NEW SYNC: Handle full state push from Admin
    socket.on('auctionState:update', (data) => {
        // Update server-side memory
        state.players = data.players || state.players;
        state.teams = data.teams || state.teams;
        state.auctionHistory = data.history || state.auctionHistory;
        state.auctionState = data.auction || state.auctionState;
        state.aiModeActive = data.aiModeActive;
        state.aiPool = data.aiPool;
        state.ts = data.ts;

        // Broadcast to all other clients
        socket.broadcast.emit('auctionState:sync', data);
    });

    // Handle toast broadcasting from Admin to everyone (except sender)
    socket.on('admin:toast', (data) => {
        socket.broadcast.emit('toast:incoming', data);
    });

    // Handle Fun UI Overlays (Strategy) from Admin

    socket.on('admin:strategy', (data) => {
        socket.broadcast.emit('ui:strategy', data);
    });

    // Handle Cinematic Banners (Sold, Unsold, Next Player)
    socket.on('admin:uisold', () => {
        socket.broadcast.emit('ui:sold');
    });

    socket.on('admin:uiunsold', () => {
        socket.broadcast.emit('ui:unsold');
    });



    socket.on('disconnect', () => console.log('Disconnected:', socket.id));
});

// Sync full state when someone connects
io.on('connect', (socket) => {
    socket.emit('auctionState:sync', {
        ts: Date.now(),
        players: state.players,
        teams: state.teams,
        history: state.auctionHistory,
        auction: state.auctionState,
        aiModeActive: state.aiModeActive,
        aiPool: state.aiPool
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log('IPL Auction Server: http://localhost:' + PORT));
