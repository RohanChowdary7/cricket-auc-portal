// IPL AUCTION 2026 - script.js
const ADMIN_USER_KEY = "ipl_admin_user", ADMIN_PASS_KEY = "ipl_admin_pass", SESSION_KEY = "ipl_session", PLAYERS_KEY = "ipl_players", TEAMS_KEY = "ipl_teams", HISTORY_KEY = "ipl_history", AUCTION_KEY = "ipl_auction", SETTINGS_KEY = "ipl_settings", MAX_SQUAD = 25;
const WATCHLIST_PREFIX = "ipl_wl_";
const IMPORT_BATSMAN_LOGO = "assets/batsmen-logo.jpeg";
const IMPORT_BOWLER_LOGO = "assets/bowler-logo.jpeg";
const IMPORT_ALLROUNDER_LOGO = "assets/Allrounder-logo.jpeg";
const IMPORT_WK_LOGO = "assets/WK-logo.jpeg";
const DEFAULT_PLAYER_SILHOUETTE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='35' r='22' fill='%23444'/%3E%3Cellipse cx='50' cy='80' rx='35' ry='25' fill='%23444'/%3E%3C/svg%3E";
let players = [], teams = [], auctionHistory = [], auctionState = { status: "idle", queue: [], currentIndex: -1, currentBid: 0, currentBidTeam: null, timerSecs: 30, timerRemaining: 30, bids: [], undoStack: [] }, settings = { timerDuration: 30, extension: 10, threshold: 5 }, currentUser = null, timerInterval = null, pendingConfirm = null;
var poolTransitionDuration = 20;
let masterVolume = parseFloat(localStorage.getItem("ipl_volume") || 0.5);
// AI Mode state
var aiModeActive = false, aiPool = "all", auctionStartTime = null;
var _lastHistoryLen = 0;
var _priorityNews = [];
var _tickerClockInterval = null;
var _lastTickerHTML = "";
var socket = null;

var videoIntroStarted = false;
function startVideoSequence() {
    var vid = document.getElementById("introVideo");
    if (!vid || videoIntroStarted) return;
    try {
        videoIntroStarted = true;
        vid.currentTime = 0;
        vid.volume = typeof masterVolume !== "undefined" ? masterVolume : 0.5;
        vid.play().catch(function (e) { console.log("Video autoplay blocked", e); });
    } catch (e) { }
}

function stopVideoSequence() {
    var vid = document.getElementById("introVideo");
    videoIntroStarted = false;
    if (vid) { try { vid.pause(); } catch (e) { } }
}

var bgmStarted = false;
function startBGM() {
    var bgm = document.getElementById("introBgm");
    if (!bgm || bgmStarted) return;
    try {
        bgmStarted = true;
        bgm.currentTime = 0;
        bgm.volume = typeof masterVolume !== "undefined" ? masterVolume : 0.5;
        bgm.play().catch(function (e) { console.log("BGM autoplay blocked", e); });
    } catch (e) { }
}

function stopBGM() {
    var bgm = document.getElementById("introBgm");
    bgmStarted = false;
    if (bgm) { try { bgm.pause(); } catch (e) { } }
}

// SAFE DOM HELPERS to prevent script crashes if an element is missing
function safeBind(id, eventType, handler) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(eventType, handler);
}
function safeGet(id) {
    var el = document.getElementById(id);
    if (!el) {
        // Return a mock element to prevent "cannot read property classList of null"
        return { classList: { add: function () { }, remove: function () { }, toggle: function () { }, contains: function () { return false; } }, style: {}, innerHTML: "", textContent: "", dataset: {}, addEventListener: function () { } };
    }
    return el;
}
function safeSetText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function safeSetHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }


function getRatingTierClass(rating) {
    var val = parseInt(rating) || 0;
    if (val >= 91) return " rating-tier-1";
    if (val >= 81) return " rating-tier-2";
    if (val >= 71) return " rating-tier-3";
    if (val >= 61) return " rating-tier-4";
    return " rating-tier-5";
}
function getRatingStyleObj(rating) {
    var val = parseInt(rating) || 0;
    if (val >= 91) return { color: "#00e5ff", glow: "0, 229, 255" };
    if (val >= 81) return { color: "#00ff66", glow: "0, 255, 102" };
    if (val >= 71) return { color: "#ffcc00", glow: "255, 204, 0" };
    if (val >= 61) return { color: "#ff6a00", glow: "255, 106, 0" };
    return { color: "#ff3366", glow: "255, 51, 102" };
}

// country flag helper: map names to emoji or return text as fallback
function getFlagEmoji(country) {
    if (!country) return "";
    const map = {
        "India": "🇮🇳",
        "Australia": "🇦🇺",
        "England": "🇬🇧",
        "New Zealand": "🇳🇿",
        "South Africa": "🇿🇦",
        "Pakistan": "🇵🇰",
        "West Indies": "🇻🇮",
        "Sri Lanka": "🇱🇰",
        "Bangladesh": "🇧🇩",
        "Afghanistan": "🇦🇫",
        "Zimbabwe": "🇿🇼",
        "Ireland": "🇮🇪",
        "Netherlands": "🇳🇱",
        "Scotland": "🏴",
        "UAE": "🇦🇪",
        "Oman": "🇴🇲"
    };
    return map[country] || country;
}

try {
    if (typeof io !== "undefined") {
        socket = io();
        socket.on("connect", function () {
            console.log("Connected to auction server");
            _updateSyncDot("live");
            // Auto sync every 10 seconds for bidders
            setInterval(function () {
                if (socket && socket.connected) {
                    socket.emit("auction:requestState");
                }
            }, 10000);
        });
        socket.on("state:full", function (data) {
            try {
                if (!data) return;
                players = data.players || players;
                teams = data.teams || teams;
                auctionHistory = data.auctionHistory || data.history || auctionHistory;
                auctionState = data.auctionState || auctionState;
                if (data.settings) settings = data.settings;
                _lastSyncTs = Date.now();
                _serverStateReceived = true;

                // Fix AI Mode button state from queue payload (ONLY on page refresh, not when admin explicitly turned it off)
                if (!_aiStopRequested && auctionState.queue && auctionState.queue.length > 0 && typeof auctionState.queue[0] === 'object' && auctionState.queue[0] && auctionState.queue[0].aiPoolName) {
                    aiModeActive = true;
                    if (typeof _updateAiModeUI === "function") _updateAiModeUI();
                }

                var st = auctionState.status || "idle";

                // ----- STAGE VISIBILITY: SERVER IS ALWAYS THE TRUTH -----
                var stageEl = document.getElementById("auctionStage");
                var emptyEl = document.getElementById("emptyAuction");

                if (st === "live" || st === "paused" || st === "awaiting_next") {
                    // Show the live auction stage
                    if (stageEl) stageEl.classList.remove("hidden");
                    if (emptyEl) emptyEl.classList.add("hidden");

                    // Render the current player card
                    if (auctionState.currentIndex >= 0 && auctionState.currentIndex < auctionState.queue.length) {
                        var qItem = auctionState.queue[auctionState.currentIndex];
                        var pidVal = (typeof qItem === 'object' && qItem !== null) ? qItem.id : qItem;
                        var p = players.find(function (x) { return x.id === pidVal; });
                        if (p && typeof renderCurrentPlayer === "function") {
                            renderCurrentPlayer(p);
                            updateBidUI();
                            updateQueue();
                            renderTimer(auctionState.timerRemaining, settings.timerDuration);
                        }
                    }

                    // Force correct buttons and badge
                    if (typeof updateStatusBadge === "function") updateStatusBadge(st);
                    if (typeof showAuctionButtons === "function") showAuctionButtons(st);

                } else if (st === "ai_intro" || st === "manual_intro") {
                    if (stageEl) stageEl.classList.add("hidden");
                    if (typeof updateStatusBadge === "function") updateStatusBadge(st);
                    if (typeof showAuctionButtons === "function") showAuctionButtons(st);
                } else {
                    // idle — show empty state
                    if (stageEl) stageEl.classList.add("hidden");
                    if (emptyEl) emptyEl.classList.remove("hidden");
                    if (typeof updateStatusBadge === "function") updateStatusBadge(st);
                    if (typeof showAuctionButtons === "function") showAuctionButtons(st);
                }

                // Re-render all data tabs
                renderAll();
                renderSquad();
                updatePlayerStats();
                updateNewsTicker();
                _updateSyncDot("live");
            } catch (err) {
                console.error("Critical error in state:full handler:", err);
            }
        });

        socket.on("auctionState:sync", function (data) { _applyRemoteState(data); });
        socket.on("toast:incoming", function (data) { toast(data.msg, data.type, null, true); });

        // Granular Sync Listeners for Real-Time UI
        socket.on("timer:tick", function (remaining) {
            renderTimer(remaining, settings.timerDuration);
            auctionState.timerRemaining = remaining;

            // Aggressively force live state evaluation when the server actively ticks the timer!
            if (auctionState.status !== "live" && auctionState.status !== "paused") {
                auctionState.status = "live";
                if (typeof updateStatusBadge === "function") updateStatusBadge("live");
                if (typeof showAuctionButtons === "function") showAuctionButtons("live");
            }
        });

        socket.on("going_overlay", function (data) {
            showGoingOverlay(data.text, data.stage);
            playBeep(440 + (data.stage * 110), 200);
        });

        socket.on("player:sold", function (data) {
            var teamName = (data.team && data.team.name) || data.teamName;
            var price = data.price != null ? data.price : 0;
            if (data.auctionHistory) { auctionHistory = data.auctionHistory; }

            // Sync the sold team's purse from server's authoritative value
            if (data.team && data.team.id) {
                var tIdx = teams.findIndex(function (x) { return x.id === data.team.id; });
                if (tIdx >= 0) {
                    teams[tIdx].purse = data.team.purse; // Server is the source of truth
                }
            }

            // Update players array with sold status
            var playerId = data.playerId || (data.player && data.player.id);
            var soldToTeamId = (data.team && data.team.id) || data.teamId;
            if (playerId) {
                var pIdx = players.findIndex(function (p) { return p.id === playerId; });
                if (pIdx >= 0) {
                    players[pIdx].sold = true;
                    players[pIdx].isUnsold = false;
                    players[pIdx].soldPrice = price;
                    players[pIdx].soldTo = soldToTeamId;
                }
            }
            showCinematicStatus("SOLD!", data.playerName, teamName, price);
            showStampOnSpotlight("sold");
            launchConfetti();
            renderPlayers(); renderTeams(); renderHistory(); renderPurseTable(); renderSquad();
            updateNewsTicker();
            playSoldSound();
            toast((data.playerName || "Player") + " SOLD to " + (teamName || "Team") + " for " + fmtPrice(price) + "!", "success", 4000, true);
        });

        socket.on("player:unsold", function (data) {
            if (data.auctionHistory) { auctionHistory = data.auctionHistory; }
            // Update players array with unsold status
            var playerId = data.playerId || (data.player && data.player.id);
            if (playerId) {
                var pIdx = players.findIndex(function (p) { return p.id === playerId; });
                if (pIdx >= 0) {
                    players[pIdx].isUnsold = true;
                    players[pIdx].sold = false;
                }
            }
            showCinematicStatus("UNSOLD", data.playerName, null, null);
            showStampOnSpotlight("unsold");
            renderPlayers(); renderHistory(); renderSquad();
            updateNewsTicker();
            playUnsoldSound();
            toast((data.playerName || "Player") + " went UNSOLD.", "warning", 3000, true);
        });

        // --- NEW REAL-TIME BIDDING AND STATE SYNC ---
        socket.on("bid:placed", function (data) {
            _updateSyncDot("receiving");
            auctionState.currentBid = parseFloat(data.amount) || 0;
            auctionState.currentBidTeam = data.teamId;
            auctionState.timerRemaining = data.timerRemaining;
            if (typeof renderTimer === "function") renderTimer(auctionState.timerRemaining, settings.timerDuration);
            if (data.bids) auctionState.bids = data.bids;

            updateBidUI();
            playBeep(880, 150);
            highlightTeam(data.teamId);
            showBidFlash(data.teamName, fmtPrice(data.amount));
            _updateSyncDot("live");
        });

        socket.on("bid:error", function (msg) {
            toast(msg, "error", 3000, true);
        });

        socket.on('auction:ai_intro_tick', function (data) {
            if (!currentUser) {
                var aiOverlay = document.getElementById("aiIntroOverlay");
                if (aiOverlay) aiOverlay.classList.add("hidden");
                return;
            }
            var overlay = document.getElementById("aiIntroOverlay");
            var display = document.getElementById("aiIntroTimerDisplay");
            var title = document.getElementById("aiIntroTitle");

            if (overlay) {
                overlay.classList.remove("hidden");
                overlay.classList.add("active");

                startBGM();

                var rem = data.remaining;
                display.textContent = rem;

                if (rem > 30) {
                    title.textContent = "WELCOME TO GCL AUCTION";
                    overlay.classList.remove("urgent");
                } else if (rem > 10) {
                    title.textContent = "STARTING POOL: " + data.firstPool.toUpperCase();
                    if (rem === 30) playBeep(200, 400); // Pool reveal sound
                    overlay.classList.remove("urgent");
                } else if (rem > 5) {
                    title.textContent = "GOOD LUCK!";
                    if (rem === 10) playBeep(250, 400); // Good luck sound
                    overlay.classList.remove("urgent");
                } else {
                    title.textContent = "FIRST PLAYER IS: " + data.firstName.toUpperCase();
                    overlay.classList.add("urgent");
                    if (rem <= 5 && rem > 0) playBeep(880, 200); // Standard ticking beep
                    if (rem === 1) playBeep(1200, 400); // Final higher pitch beep
                }
            }
        });

        socket.on('auction:ai_intro_end', function () {
            stopBGM();
            var overlay = document.getElementById("aiIntroOverlay");
            if (overlay) {
                overlay.classList.remove("active");
                overlay.classList.add("hidden");
            }
            auctionState.status = "live";
            if (typeof updateStatusBadge === "function") updateStatusBadge("live");
            if (typeof showAuctionButtons === "function") showAuctionButtons("live");
        });

        socket.on('auction:manual_intro_tick', function (data) {
            if (!currentUser) {
                var manOverlay = document.getElementById("manualIntroOverlay");
                if (manOverlay) manOverlay.classList.add("hidden");
                return;
            }
            var overlay = document.getElementById("manualIntroOverlay");
            var display = document.getElementById("manualIntroTimerDisplay");
            var title = document.getElementById("manualIntroTitle");

            if (overlay) {
                overlay.classList.remove("hidden");
                overlay.classList.add("active");

                startBGM();
                startVideoSequence();

                var rem = data.remaining;
                if (display) display.textContent = rem;

                if (rem > 30) {
                    if (title) title.textContent = "AUCTION STARTING";
                    overlay.classList.remove("urgent");
                } else if (rem > 10) {
                    if (title) title.textContent = "PREPARING NEXT TIER...";
                    if (rem === 30) playBeep(200, 400);
                    overlay.classList.remove("urgent");
                } else if (rem > 5) {
                    if (title) title.textContent = "GET READY!";
                    if (rem === 10) playBeep(250, 400);
                    overlay.classList.remove("urgent");
                } else {
                    if (title) title.textContent = "STARTING IN...";
                    overlay.classList.add("urgent");
                    if (rem <= 5 && rem > 0) playBeep(880, 200);
                    if (rem === 1) playBeep(1200, 400);
                }
            }
        });

        socket.on('auction:manual_intro_end', function () {
            stopBGM();
            stopVideoSequence();
            var overlay = document.getElementById("manualIntroOverlay");
            if (overlay) {
                overlay.classList.remove("active");
                overlay.classList.add("hidden");
            }
            auctionState.status = "live";
            if (typeof updateStatusBadge === "function") updateStatusBadge("live");
            if (typeof showAuctionButtons === "function") showAuctionButtons("live");
        });

        // ── POOL TRANSITION: shown 20s between AI autonomous pools or manual switch ──
        socket.on('auction:pool_transition', function (data) {
            if (!currentUser) {
                var poolOverlay = document.getElementById("poolTransitionOverlay");
                if (poolOverlay) poolOverlay.classList.add("hidden");
                return;
            }
            var overlay = document.getElementById("poolTransitionOverlay");
            if (!overlay) return;

            var prevLabel = document.getElementById("poolTransitionPrevLabel");
            var titleEl = document.getElementById("poolTransitionTitle");
            var nameEl = document.getElementById("poolTransitionPoolName");
            var firstEl = document.getElementById("poolTransitionPlayerName");
            var timerEl = document.getElementById("poolTransitionTimer");
            var barEl = document.getElementById("poolTransitionBar");

            if (prevLabel) prevLabel.textContent = (data.prevPool || "PREVIOUS POOL").toUpperCase() + " — COMPLETE";
            if (titleEl) titleEl.textContent = data.isManual ? "MANUALLY CHANGED POOL:" : "NEXT POOL:";
            if (nameEl) nameEl.textContent = (data.nextPool || "NEXT").toUpperCase();
            if (firstEl) firstEl.textContent = data.nextPlayerName || "—";
            poolTransitionDuration = data.duration || 20;
            if (timerEl) timerEl.textContent = poolTransitionDuration;
            if (barEl) barEl.style.width = "100%";

            // Show overlay
            overlay.classList.remove("hidden");
            overlay.classList.add("active");

            // Play pool reveal beeps
            playBeep(200, 400);
            setTimeout(function () { playBeep(300, 400); }, 500);
            setTimeout(function () { playBeep(440, 600); }, 1100);

            auctionState.status = "pool_transition";
            if (typeof updateStatusBadge === "function") updateStatusBadge("pool_transition");
        });

        socket.on('auction:pool_transition_tick', function (data) {
            if (!currentUser) return;
            var timerEl = document.getElementById("poolTransitionTimer");
            var barEl = document.getElementById("poolTransitionBar");

            if (timerEl) timerEl.textContent = data.remaining;
            if (barEl) barEl.style.width = ((data.remaining / Math.max(1, poolTransitionDuration)) * 100) + "%";

            // Tick beep for last 5 seconds
            if (data.remaining > 0 && data.remaining <= 5) playBeep(880, 150);

            if (data.remaining <= 0) {
                var overlay = document.getElementById("poolTransitionOverlay");
                if (overlay) {
                    overlay.classList.remove("active");
                    overlay.classList.add("hidden");
                }
                auctionState.status = "live";
                if (typeof updateStatusBadge === "function") updateStatusBadge("live");
                if (typeof showAuctionButtons === "function") showAuctionButtons("live");
            }
        });

        socket.on("auction:started", function (data) {
            auctionState = Object.assign({}, auctionState, data);
            document.getElementById("emptyAuction").classList.add("hidden");

            // Check if we are in ai intro phase
            if (auctionState.status === "ai_intro") {
                navTo("auction");
                document.getElementById("auctionStage").classList.add("hidden");
                showAuctionButtons("hidden");
            } else {
                navTo("auction");
                document.getElementById("auctionStage").classList.remove("hidden");
                renderAll();
            }
            toast("Auction started!", "success", 3000, true);
        });

        socket.on("player:next", function (data) {
            _updateSyncDot("receiving");
            auctionState = Object.assign({}, auctionState, data.auctionState);
            var p = data.player;
            if (p) {
                // Show Next Player transition banner for 3 seconds before loading the new player
                var npBanner = document.getElementById("nextPlayerBanner");
                var npName = document.getElementById("npBannerName");
                if (npBanner && npName) {
                    npName.textContent = p.name;
                    npBanner.classList.remove("hidden");
                    playBeep(440, 200);
                    setTimeout(function () {
                        npBanner.classList.add("hidden");
                        renderCurrentPlayer(p);
                        updateBidUI();
                        updateQueue();
                        renderTimer(auctionState.timerRemaining, settings.timerDuration);
                        if (typeof updateStatusBadge === "function") updateStatusBadge(auctionState.status);
                        if (typeof showAuctionButtons === "function") showAuctionButtons(auctionState.status);
                        _updateSyncDot("live");
                    }, 3000);
                } else {
                    renderCurrentPlayer(p);
                    updateBidUI();
                    updateQueue();
                    renderTimer(auctionState.timerRemaining, settings.timerDuration);
                    if (typeof updateStatusBadge === "function") updateStatusBadge(auctionState.status);
                    if (typeof showAuctionButtons === "function") showAuctionButtons(auctionState.status);
                    _updateSyncDot("live");
                }
            }
        });

        socket.on("auction:paused", function (data) {
            auctionState.status = "paused";
            if (data && typeof data.timerRemaining === "number") {
                auctionState.timerRemaining = data.timerRemaining;
                renderTimer(auctionState.timerRemaining, settings.timerDuration);
            }
            hideGoingOverlay();
            updateStatusBadge("paused");
            showAuctionButtons("paused");
            updateBidUI(); // FIX: Explicitly refresh bidder buttons
            restoreAuction();
            toast("Auction paused by Admin.", "warning", 3000, true);
        });

        socket.on("auction:resumed", function (data) {
            auctionState.status = "live";
            if (data && typeof data.timerRemaining === "number") {
                auctionState.timerRemaining = data.timerRemaining;
                renderTimer(auctionState.timerRemaining, settings.timerDuration);
            }
            updateStatusBadge("live");
            showAuctionButtons("live");
            updateBidUI(); // FIX: Explicitly refresh bidder buttons
            updateQueue();
            restoreAuction();
            toast("Auction resumed!", "success", 3000, true);
        });

        // when the server announces auction end, make sure every client shows summary
        socket.on("auction:ended", function (data) {
            // update local arrays in case server sends refreshed info
            if (data && data.players) players = data.players;
            if (data && data.teams) teams = data.teams;
            if (data && data.auctionHistory) auctionHistory = data.auctionHistory;
            auctionState.status = "ended";
            endAuction(true); // bypass admin check
            updateNewsTicker();
            toast("Auction complete \u2014 thank you for participating!", "info", 6000, true);
        });

        // --- BANTER AND STRATEGY OVERLAY SYNC ---

        socket.on("ui:strategy", function (data) {
            if (currentUser && currentUser.role !== "admin") {
                showStrategyOverlay(data.title, data.desc, data.teamColor, data.teamName, data.relevantPlayers);
            }
        });

        socket.on("ui:sold", function (data) {
            if (currentUser && currentUser.role !== "admin") {
                showStampOnSpotlight("sold");
                launchConfetti();
                playSoldSound();
            }
        });

        socket.on("ui:unsold", function (data) {
            if (currentUser && currentUser.role !== "admin") {
                showStampOnSpotlight("unsold");
                playUnsoldSound();
            }
        });

        socket.on("auction:force_logout", function () {
            // Local storage wipe
            localStorage.clear();
            sessionStorage.clear();

            // In-memory data wipe
            players = [];
            teams = [];
            auctionHistory = [];
            auctionState = {
                status: "idle",
                queue: [],
                currentIndex: -1,
                currentBid: 0,
                currentBidTeam: null,
                timerSecs: 30,
                timerRemaining: 30,
                bids: [],
                undoStack: []
            };

            // Stop any ticker/timer
            if (timerInterval) clearInterval(timerInterval);

            // Reset current user and UI
            currentUser = null;
            renderAll();
            showLogin();

            toast("Auction hard reset by Admin.", "warning");
        });

        socket.on("ui:nextplayer", function (name) {
            if (currentUser && currentUser.role !== "admin") {
                document.getElementById("soldBanner").classList.add("hidden");
                document.getElementById("unsoldBanner").classList.add("hidden");
                var npBanner = document.getElementById("nextPlayerBanner");
                var npName = document.getElementById("npBannerName");
                if (npBanner && npName) {
                    npName.textContent = name;
                    npBanner.classList.remove("hidden");
                    playBeep(440, 200);
                    setTimeout(function () { npBanner.classList.add("hidden"); }, 3000);
                }
            }
        });

        // ============ SESSION MANAGEMENT SOCKET LISTENERS ============
        socket.on("session:loaded", function (data) {
            toast("📂 Session \"" + (data.label || data.filename) + "\" loaded! Restoring state...", "info", 4000, true);
            // Defer showAuctionButtons so it runs AFTER renderAll() from state:full completes
            setTimeout(function () {
                var st = auctionState.status || "idle";
                if (typeof showAuctionButtons === "function") showAuctionButtons(st);
                if (typeof updateStatusBadge === "function") updateStatusBadge(st);
            }, 300);
        });

        socket.on("session:autosave_found", function (data) {
            var banner = document.getElementById("autosaveBanner");
            var timeEl = document.getElementById("autosaveTime");
            if (banner && currentUser && currentUser.role === "admin") {
                if (timeEl && data.savedAt) {
                    timeEl.textContent = new Date(data.savedAt).toLocaleString("en-IN");
                }
                banner.classList.remove("hidden");
            }
        });
        // =============================================================
    }
} catch (e) {
    console.warn("Socket.io not available - running in local mode");
}

var save = function (k, v) { localStorage.setItem(k, JSON.stringify(v)); };
var load = function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
var saveSession = function (v) { sessionStorage.setItem(SESSION_KEY, JSON.stringify(v)); };
var loadSession = function (d) { try { var v = sessionStorage.getItem(SESSION_KEY); return v ? JSON.parse(v) : d; } catch (e) { return d; } };

// ── Real-time sync channel (instant cross-tab, no page refresh needed) ──
var _bc = null;
try { _bc = new BroadcastChannel("ipl_auction_sync"); } catch (e) { }
var _lastSyncTs = 0;
var _serverStateReceived = false; // Becomes true once server sends state:full


function persist() {
    save(PLAYERS_KEY, players); save(TEAMS_KEY, teams);
    save(HISTORY_KEY, auctionHistory); save(AUCTION_KEY, auctionState);
    save("ai_mode_active", aiModeActive); save("ai_pool", aiPool);

    var payload = {
        ts: Date.now(),
        players: players,
        teams: teams,
        history: auctionHistory,
        auction: auctionState,
        aiModeActive: aiModeActive,
        aiPool: aiPool
    };

    // 1. Cross-tab sync (same computer)
    if (_bc) { try { _bc.postMessage(payload); } catch (e) { } }

    // 2. Push players/teams to server (Server uses safe-merge during live auctions)
    if (socket && currentUser && currentUser.role === "admin") {
        socket.emit("players:save", players);
        socket.emit("teams:save", teams);
        socket.emit("settings:save", settings);
    }

    _lastSyncTs = payload.ts;
    _updateSyncDot("live");
}

function _updateSyncDot(status) {
    var dot = document.getElementById("syncDot");
    if (!dot) return;
    dot.className = "sync-dot sync-" + status;
    dot.title = status === "live" ? "Live — synced" : status === "receiving" ? "Receiving update..." : "Offline";
}

function _applyRemoteState(data) {
    if (!data || data.ts <= _lastSyncTs) return; // stale update
    _lastSyncTs = data.ts;
    players = data.players || players;
    teams = data.teams || teams;
    auctionHistory = data.history || auctionHistory;

    // Sync AI Mode state
    if (typeof data.aiModeActive !== "undefined") {
        var changed = (aiModeActive !== data.aiModeActive);
        aiModeActive = data.aiModeActive;
        aiPool = data.aiPool || aiPool;
        if (changed) _updateAiModeUI();
    }


    // Only update auction state for non-admin (they don't control it)
    if (!currentUser || currentUser.role !== "admin") {
        var prev = auctionState.currentIndex;
        auctionState = data.auction || auctionState;
        // If current player changed → re-render auction stage
        if (auctionState.currentIndex !== prev) {
            var pid = auctionState.queue[auctionState.currentIndex];
            var p = players.find(function (x) { return x.id === pid; });
            if (p && !p.sold) { renderCurrentPlayer(p); updateBidUI(); updateQueue(); }
        }
        renderTimer(auctionState.timerRemaining, settings ? settings.timerDuration : 30);
    }
    renderTeams(); renderPurseTable(); renderHistory(); renderAnalytics(); updatePlayerStats();
    updateNewsTicker();
    _updateSyncDot("live");
}
// helper used by loadAll to ensure we always have an array
function _ensureArray(v) {
    if (Array.isArray(v)) return v;
    console.warn("Expected array but got", v, "– resetting to [].");
    return [];
}

function loadAll() {
    // load raw values first
    var rawPlayers = load(PLAYERS_KEY, []);
    var rawTeams = load(TEAMS_KEY, []);
    var rawHistory = load(HISTORY_KEY, []);

    // make sure we always work with arrays to avoid runtime errors when
    // persistent data gets corrupted or contains a primitive value
    players = _ensureArray(rawPlayers);
    teams = _ensureArray(rawTeams);
    auctionHistory = _ensureArray(rawHistory);

    // other persisted objects may be more structured
    auctionState = load(AUCTION_KEY, { status: "idle", queue: [], currentIndex: -1, currentBid: 0, currentBidTeam: null, timerSecs: 30, timerRemaining: 30, bids: [], undoStack: [] });
    settings = load(SETTINGS_KEY, { timerDuration: 30, extension: 10, threshold: 5 });
    aiModeActive = load("ai_mode_active", false);
    aiPool = load("ai_pool", "all");

    // backwards‑compat password fix
    if (!localStorage.getItem(ADMIN_USER_KEY)) {
        localStorage.setItem(ADMIN_USER_KEY, "admin");
        localStorage.setItem(ADMIN_PASS_KEY, "ipl2026");
    } else if (localStorage.getItem(ADMIN_PASS_KEY) === "ipl2025") {
        // Force update if still using old password
        localStorage.setItem(ADMIN_PASS_KEY, "ipl2026");
    }
}
var uid = function () { return "_" + Math.random().toString(36).substr(2, 9); };
function fmtPrice(l) { if (l === 0) return "₹0"; if (l < 100) return "₹" + l + "L"; return l % 100 === 0 ? "₹" + (l / 100) + "Cr" : "₹" + (l / 100).toFixed(2) + "Cr"; }
function escapeHTML(text) {
    return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function _tickerItem(text, cls) {
    return '<span class="' + cls + '">' + escapeHTML(text) + '</span>';
}
function updateNewsTickerClock() {
    var refreshed = document.getElementById("newsTickerRefresh");
    if (!refreshed) return;
    refreshed.textContent = "SYNC " + new Date().toLocaleTimeString("en-IN", { hour12: false });
}
function ensureNewsTickerClock() {
    updateNewsTickerClock();
    if (_tickerClockInterval) return;
    _tickerClockInterval = setInterval(updateNewsTickerClock, 1000);
}
function _getTeamStrategyTag(team) {
    var squad = players.filter(function (p) { return p.soldTo === team.id; });
    var spent = (team.initialPurse || 0) - (team.purse || 0);
    var avg = squad.length ? Math.round(spent / squad.length) : 0;
    var marquees = squad.filter(function (p) { return p.marquee; }).length;

    var tag = "Balanced Build";
    if (marquees >= 3) tag = "Star Collectors";
    else if (spent < (team.initialPurse || 0) * 0.5 && squad.length > 8) tag = "Value Seekers";
    else if (spent > (team.initialPurse || 0) * 0.85) tag = "Big Spenders";
    else if (squad.length > (MAX_SQUAD * 0.8)) tag = "Depth Specialists";
    else if (avg > 500) tag = "Quality over Quantity";

    return {
        teamName: team.name || "Team",
        tag: tag,
        spent: spent,
        playersCount: squad.length
    };
}
function _buildAiStrategyTickerLine() {
    if (!teams || !teams.length) return "AI STRATEGY: Waiting for teams";

    var summary = teams.map(_getTeamStrategyTag)
        .sort(function (a, b) { return b.spent - a.spent; });

    var top = summary.map(function (s) {
        return s.teamName + " -> " + s.tag + " (" + s.playersCount + "P, " + fmtPrice(s.spent) + " spent)";
    });

    return "AI STRATEGY BREAKDOWN: " + top.join(" | ");
}
function updateNewsTicker() {
    var bar = document.getElementById("newsTickerBar");
    var content = document.getElementById("newsTickerContent");
    if (!bar || !content) return;

    var sold = (auctionHistory || []).filter(function (h) { return h.status === "sold"; });
    var unsold = (auctionHistory || []).filter(function (h) { return h.status === "unsold"; });
    var topBuys = sold.slice().sort(function (a, b) { return (b.price || 0) - (a.price || 0); }).slice(0, 3);
    var lastSold = sold.length ? sold[sold.length - 1] : null;
    var lastUnsold = unsold.length ? unsold[unsold.length - 1] : null;

    var items = [];
    if (_priorityNews.length) {
        _priorityNews.slice(-3).forEach(function (n) {
            items.push(_tickerItem(n.text, n.type === "alert" ? "nt-alert" : "nt-info"));
        });
    }

    if (topBuys.length) {
        var topText = "TOP BUYS: " + topBuys.map(function (h, i) {
            return (i + 1) + ") " + h.playerName + " " + fmtPrice(h.price || 0) + " (" + (h.teamName || "Team") + ")";
        }).join(" | ");
        items.push(_tickerItem(topText, "nt-record"));
    } else {
        items.push(_tickerItem("TOP BUYS: No sold players yet", "nt-record"));
    }

    items.push(_tickerItem(_buildAiStrategyTickerLine(), "nt-commentary"));

    if (lastSold) {
        items.push(_tickerItem("LAST SOLD: " + lastSold.playerName + " to " + (lastSold.teamName || "Team") + " for " + fmtPrice(lastSold.price || 0), "nt-sold"));
    } else {
        items.push(_tickerItem("LAST SOLD: Waiting for first sale", "nt-sold"));
    }

    if (lastUnsold) {
        items.push(_tickerItem("LAST UNSOLD: " + lastUnsold.playerName, "nt-unsold"));
    } else {
        items.push(_tickerItem("LAST UNSOLD: None", "nt-unsold"));
    }

    var html = items.join('<span class="nt-sep">|</span>');
    if (html !== _lastTickerHTML) {
        _lastTickerHTML = html;
        content.innerHTML = html;

        // Restart animation only when ticker text really changed.
        content.style.animation = "none";
        void content.offsetWidth;
        content.style.animation = "tickerScroll 45s linear infinite";
    }

    updateNewsTickerClock();
}
function getWatchlist() { if (!currentUser || currentUser.role !== "team") return new Set(); try { return new Set(JSON.parse(localStorage.getItem(WATCHLIST_PREFIX + currentUser.teamId) || "[]")); } catch (e) { return new Set(); } }
function saveWatchlist(set) { if (!currentUser || currentUser.role !== "team") return; localStorage.setItem(WATCHLIST_PREFIX + currentUser.teamId, JSON.stringify([...set])); }
function toggleWatchlist(pid) { var wl = getWatchlist(); if (wl.has(pid)) wl.delete(pid); else wl.add(pid); saveWatchlist(wl); renderPlayers(); }
function bidIncrement(l) { if (l < 100) return 10; if (l < 500) return 25; return 50; }
function toast(msg, type, dur, noBroadcast) {
    type = type || "info"; dur = dur || 3000;
    const el = document.createElement("div"); el.className = "toast toast-" + type;
    el.innerHTML = "<span>[" + type + "]</span><span>" + msg + "</span>";
    document.getElementById("toastContainer").appendChild(el);
    setTimeout(function () { el.classList.add("toast-out"); setTimeout(function () { el.remove(); }, 350); }, dur);

    // Broadcast update to others via server if Admin and not a received broadcast
    if (!noBroadcast && socket && currentUser && currentUser.role === "admin") {
        socket.emit("admin:toast", { msg, type });
    }
}
function playBeep(freq, dur) {
    if (!masterVolume || masterVolume <= 0) return;
    freq = freq || 660; dur = dur || 150;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = freq;
        g.gain.setValueAtTime(masterVolume * 0.2, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur / 1000);
        o.start(); o.stop(ctx.currentTime + dur / 1000);
        setTimeout(function () { ctx.close(); }, dur + 100);
    } catch (e) { }
}
function playSound(url) {
    if (!masterVolume || masterVolume <= 0) return;
    try {
        var audio = new Audio(url);
        audio.volume = masterVolume;
        audio.play().catch(function (e) { console.log("Sound play failed", e); });
    } catch (e) { }
}
function showConfirm(title, msg, onYes) {
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmMessage").textContent = msg;
    pendingConfirm = onYes;
    openModal("modalConfirm");
}
function showAlert(title, msg, icon) {
    var iconEl = document.getElementById("alertIcon");
    var alertTitle = document.getElementById("alertTitle");
    var alertMsg = document.getElementById("alertMessage");
    if (iconEl) iconEl.textContent = icon || "ℹ️";
    if (alertTitle) alertTitle.textContent = title || "Alert";
    if (alertMsg) alertMsg.textContent = msg || "Message";
    openModal("modalAlert");
}
function openModal(id) { var el = document.getElementById(id); if (el) { el.classList.remove("hidden"); el.classList.add("active"); } }
function closeModal(id) { var el = document.getElementById(id); if (el) { el.classList.remove("active"); el.classList.add("hidden"); } }
function displayCategory(category) { return category === "All-Rounder" ? "All Rounder" : (category || ""); }
function getCategoryDefaultLogo(category) {
    var c = (category || "").toLowerCase().replace(/\s+/g, "");
    if (c === "batsman") return IMPORT_BATSMAN_LOGO;
    if (c === "bowler") return IMPORT_BOWLER_LOGO;
    if (c === "all-rounder" || c === "allrounder") return IMPORT_ALLROUNDER_LOGO;
    if (c === "wicketkeeper" || c === "wk") return IMPORT_WK_LOGO;
    return "";
}
function getEffectivePlayerImage(p) {
    if (!p) return "";
    var categoryLogo = getCategoryDefaultLogo(p.category);
    if (categoryLogo) return categoryLogo;
    return p.image || "";
}
function getRatingTierClass(rating) {
    if (!rating) return "";
    var r = parseInt(rating, 10);
    if (isNaN(r)) return "";
    if (r >= 91) return " rating-tier-1";
    if (r >= 81) return " rating-tier-2";
    if (r >= 71) return " rating-tier-3";
    if (r >= 61) return " rating-tier-4";
    return " rating-tier-5";
}
function initAuth() { const s = loadSession(null); if (s) { currentUser = s; showApp(); return; } showLogin(); }
function hideGlobalAuctionOverlays() {
    ["aiIntroOverlay", "manualIntroOverlay", "poolTransitionOverlay", "aiPoolAnnouncement", "strategyOverlay", "goingOverlay"].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.classList.add("hidden");
        el.classList.remove("active");
        el.classList.remove("fadeOut");
    });
}
function showLogin() { hideGlobalAuctionOverlays(); document.getElementById("loginPage").classList.add("active"); document.getElementById("mainApp").classList.add("hidden"); }
function doLogout() {
    clearInterval(timerInterval);
    currentUser = null;
    sessionStorage.removeItem(SESSION_KEY);
    showLogin();
}
function showApp() {
    document.getElementById("loginPage").classList.remove("active");
    document.getElementById("mainApp").classList.remove("hidden");
    applyRole();
    renderAll();

    // Remember last visited tab
    var lastTab = localStorage.getItem("ipl_last_tab") || "auction";
    var isSpectator = currentUser && currentUser.role === "spectator";
    if (isSpectator) {
        lastTab = "auction";
    } else if (currentUser && currentUser.role !== "admin" && lastTab === "admin") {
        lastTab = "auction";
    }
    navTo(lastTab);

    // Set up everything if it's auction tab
    restoreAuction();

}
function applyRole() {
    if (!currentUser) return;
    const isAdmin = currentUser.role === "admin";
    const isSpectator = currentUser.role === "spectator";

    document.body.classList.toggle("spectator", !!isSpectator);

    document.querySelectorAll(".admin-only").forEach(function (el) { el.classList.toggle("hidden", !isAdmin); });
    document.querySelectorAll(".admin-only-nav").forEach(function (el) { el.classList.toggle("hidden", !isAdmin); });
    document.querySelectorAll(".team-only").forEach(function (el) { el.classList.toggle("hidden", isAdmin || isSpectator); });

    safeSetText("userAvatar", currentUser.name ? currentUser.name[0].toUpperCase() : "U");
    safeSetText("userNameDisplay", currentUser.name || "User");

    // Spectator & Team specific UI tweaks
    if (isSpectator || (currentUser && currentUser.role === "team")) {
        const aiBtn = document.getElementById("btnAiMode");
        if (aiBtn) aiBtn.classList.add("hidden");
    }

    if (isSpectator) {
        // Hide all nav links except branding and user/logout
        document.querySelectorAll(".nav-links > li").forEach(function (li) {
            const hasLogout = li.querySelector(".btn-logout") || li.querySelector("#logoutBtn");
            const isBranding = li.classList.contains("nav-brand");
            if (!hasLogout && !isBranding) {
                li.classList.add("hidden");
            }
        });
        const navUser = document.getElementById("navUser");
        if (navUser && navUser.parentElement) {
            navUser.parentElement.classList.remove("hidden");
        }
        navTo("auction");
        const burger = document.getElementById("hamburger");
        if (burger) burger.classList.add("hidden");
    } else {
        // Restore nav links for others (Admins and Teams)
        document.querySelectorAll(".nav-links > li").forEach(function (li) {
            li.classList.remove("hidden");
            // If it's an admin-only link and we are not admin, keep it hidden
            if (li.classList.contains("admin-only-nav") && !isAdmin) {
                li.classList.add("hidden");
            }
        });
        const burger = document.getElementById("hamburger");
        if (burger) burger.classList.remove("hidden");
    }
}
function navTo(section) {
    if (!currentUser) return;

    var isAdmin = currentUser.role === "admin";
    if (!isAdmin && section === "admin") {
        toast("Access Denied: Admin Panel.", "error");
        section = "auction";
    }

    var isSpectator = currentUser.role === "spectator";
    if (isSpectator && section !== "auction") {
        // If they try to navigate elsewhere, force them back to auction
        // But only if we aren't already there to avoid recursion
        return;
    }

    localStorage.setItem("ipl_last_tab", section);

    document.querySelectorAll(".section").forEach(function (s) { s.classList.remove("active"); s.classList.add("hidden"); });
    document.querySelectorAll(".nav-link").forEach(function (l) { l.classList.remove("active"); });
    const sec = document.getElementById("section" + section.charAt(0).toUpperCase() + section.slice(1));
    if (sec) { sec.classList.remove("hidden"); sec.classList.add("active"); }
    const lnk = document.querySelector("[data-section=\"" + section + "\"]");
    if (lnk) lnk.classList.add("active");
    document.getElementById("navLinks").classList.remove("open");
    document.getElementById("hamburger").classList.remove("open");
    if (section === "analytics") renderAnalytics();
    if (section === "purse") renderPurseTable();
    if (section === "history") renderHistory();
    if (section === "teams") renderTeams();
    if (section === "admin") renderAdminPanel();
}
function teamName(id) { const t = teams.find(function (t) { return t.id === id; }); return t ? t.name : "---"; }
function filteredPlayers() {
    const q = (document.getElementById("playerSearch").value || "").toLowerCase().trim();
    const cat = (document.getElementById("playerCatFilter").value || "").trim();
    const st = (document.getElementById("playerStatusFilter").value || "").trim();

    return players.filter(function (p) {
        // Search term match
        const nameMatch = !q || (p.name || "").toLowerCase().includes(q);

        // Category match 
        const pCat = (p.category || "").trim();
        const catMatch = !cat || pCat.toLowerCase() === cat.toLowerCase();

        // Status match logic
        let statusMatch = true;
        if (st === "sold") statusMatch = !!p.sold;
        else if (st === "unsold") statusMatch = !!p.isUnsold;
        else if (st === "upcoming") statusMatch = !p.sold && !p.isUnsold;

        return nameMatch && catMatch && statusMatch;
    });
}
function updatePlayerStats() {
    const total = players.length;
    const sold = players.filter(function (p) { return p.sold; }).length;
    const unsold = players.filter(function (p) { return p.isUnsold; }).length;
    const upcoming = players.filter(function (p) { return !p.sold && !p.isUnsold; }).length;
    const marquee = players.filter(function (p) { return p.marquee; }).length;

    document.getElementById("statTotal").textContent = total;
    document.getElementById("statSold").textContent = sold;
    document.getElementById("statUnsold").textContent = unsold;
    document.getElementById("statRemaining").textContent = upcoming;
    document.getElementById("statMarquee").textContent = marquee;
}
function renderPlayers(list) {
    list = list || filteredPlayers();
    const grid = document.getElementById("playerGrid"), empty = document.getElementById("playerEmpty");
    if (!grid || !empty) return; // Exit if elements don't exist
    updatePlayerStats();

    if (!list.length) {
        grid.innerHTML = "";
        empty.classList.remove("hidden");
        return;
    }
    empty.classList.add("hidden");
    const isAdmin = currentUser && currentUser.role === "admin";
    const isSpectator = currentUser && currentUser.role === "spectator";
    var watchlist = getWatchlist();
    grid.innerHTML = list.map(function (p) {
        const isCurrent = auctionState.currentIndex >= 0 && auctionState.queue[auctionState.currentIndex] === p.id;
        var inWL = !isAdmin && !isSpectator && watchlist.has(p.id);
        const isUpcoming = !p.sold && !p.isUnsold;

        // Status Tag Logic
        let statusTag = "";
        if (p.sold) statusTag = '<div class="status-tag-mini status-tag-sold">Sold in this auction</div>';
        else if (p.isUnsold) statusTag = '<div class="status-tag-mini status-tag-unsold">Unsold in this auction</div>';
        else if (isUpcoming) statusTag = '<div class="status-tag-mini status-tag-upcoming">Upcoming</div>';

        let h = "<div class=\"player-card" + (p.sold ? " sold" : "") + (p.isUnsold ? " unsold" : "") + (isCurrent ? " current" : "") + "\" id=\"pc-" + p.id + "\">";
        h += statusTag;
        h += "<div class=\"pc-img-wrap\">";
        var cardImg = getEffectivePlayerImage(p);
        if (cardImg) {
            var cardFallback = getCategoryDefaultLogo(p.category);
            var cardErr = cardFallback ? " onerror=\"this.onerror=null;this.src='" + cardFallback + "'\"" : "";
            h += "<img src=\"" + cardImg + "\" alt=\"" + p.name + "\"" + cardErr + " />";
        } else {
            h += "<div class=\"pc-img-placeholder\">" + p.name.charAt(0) + "</div>";
        }
        h += p.sold ? "<div class=\"pc-sold-stamp\">SOLD</div>" : (p.isUnsold ? "<div class=\"pc-unsold-stamp\">UNSOLD</div>" : "");
        h += p.marquee ? "<span class=\"pc-marquee\">MQ</span>" : "";
        h += isAdmin ? "<input type=\"checkbox\" class=\"pc-checkbox\" data-id=\"" + p.id + "\" />" : "";
        h += !isAdmin && !isSpectator && !p.sold ? "<button class=\"pc-watchlist-btn" + (inWL ? " active" : "") + "\" onclick=\"toggleWatchlist('" + p.id + "')\" title=\"" + (inWL ? "Remove from watchlist" : "Add to watchlist") + "\">" + (inWL ? "🔖" : "🔈") + "</button>" : "";
        h += "</div><div class=\"pc-body\">";

        // Special format for All-Rounder and Custom
        if (p.category === "All-Rounder" || p.category === "Custom") {
            // 1st line - Player name
            h += "<div class=\"pc-name\" title=\"" + p.name + "\">" + p.name + "</div>";

            // 2nd line - Category and Base price
            h += "<div class=\"pc-cat-base\">";
            h += "<span class=\"cat-badge cat-" + p.category + "\">" + displayCategory(p.category) + "</span>";
            h += "<span class=\"pc-base\">Base: " + fmtPrice(p.basePrice) + "</span>";
            h += "</div>";

            // Rating in center with batting/bowling on sides
            h += "<div class=\"pc-rating-row\">";
            // Left side - Batting
            h += "<div class=\"pc-bat-side\">";
            h += "<span class=\"pc-bat-label\">BAT</span>";
            h += "</div>";
            // Center - Rating
            if (p.overall) h += "<div class=\"pc-rating-center" + getRatingTierClass(p.overall) + "\">" + p.overall + "</div>";
            // Right side - Bowling
            h += "<div class=\"pc-bowl-side\">";
            h += "<span class=\"pc-bowl-label\">BWL</span>";
            h += "</div>";
            h += "</div>";
        } else {
            // Original format for Batsman, Bowler, Wicketkeeper
            h += "<div class=\"pc-name\" title=\"" + p.name + "\">" + p.name + "</div>";

            // Show category and country
            h += "<div class=\"pc-meta\">";
            h += "<span class=\"cat-badge cat-" + p.category + "\">" + displayCategory(p.category) + "</span>";
            if (p.nationality) h += "<span class=\"pc-country\">" + p.nationality + "</span>";
            h += "</div>";

            // Show batting archetype for Batsman, Wicketkeeper
            let playerInfo = "";
            if (p.category === "Batsman" || p.category === "Wicketkeeper") {
                if (p.batStyle) playerInfo += p.batStyle;
            }
            if (playerInfo) h += "<div class=\"pc-archetype\">" + playerInfo + "</div>";

            // Show bowling archetype for Bowler
            if (p.category === "Bowler") {
                let bowlerInfo = [];
                if (p.bowlType) bowlerInfo.push(p.bowlType);
                else if (p.bowlHand) bowlerInfo.push(p.bowlHand);

                if (p.bowlStyle) bowlerInfo.push(p.bowlStyle);

                if (bowlerInfo.length > 0) {
                    h += "<div class=\"pc-archetype\">" + bowlerInfo.join(" • ") + "</div>";
                }
            }

            h += "<div class=\"pc-base\">Base: <span>" + fmtPrice(p.basePrice) + "</span></div>";

            // Show overall rating
            if (p.overall) h += "<div class=\"pc-rating-overall\">Overall: <span class=\"" + getRatingTierClass(p.overall).trim() + "\">" + p.overall + "</span></div>";
        }

        h += p.sold ? "<div style=\"font-size:.75rem;color:var(--success);margin-bottom:8px\">Sold: " + fmtPrice(p.soldPrice) + " to " + teamName(p.soldTo) + "</div>" : "";
        if (isAdmin) {
            h += "<div class=\"pc-actions\">";
            h += "<button class=\"btn btn-secondary btn-sm\" onclick=\"editPlayer('" + p.id + "')\">Edit</button>";
            h += "<button class=\"btn btn-danger btn-sm\" onclick=\"deletePlayer('" + p.id + "')\">Del</button>";
            h += p.sold ? "<button class=\"btn btn-warning btn-sm\" onclick=\"openRevertSingle('" + p.id + "')\">Revert</button>" : "";
            h += "</div>";
        }
        h += "</div></div>";
        return h;
    }).join("");
    grid.querySelectorAll(".pc-checkbox").forEach(function (cb) { cb.addEventListener("change", updateBulkBtn); });
}
function updateBulkBtn() { const any = document.querySelectorAll(".pc-checkbox:checked").length > 0; document.getElementById("btnBulkDelete").classList.toggle("hidden", !any); }
function openAddPlayer() {
    document.getElementById("modalPlayerTitle").textContent = "Add Player"; document.getElementById("playerFormId").value = ""; document.getElementById("playerForm").reset(); document.getElementById("pImagePreview").classList.add("hidden"); document.getElementById("playerFormError").classList.add("hidden");
    // removed nationality flag preview
    setMarquee(false); openModal("modalPlayer");
}
function setMarquee(val) {
    document.getElementById("pMarquee").value = val ? "true" : "false";
    document.getElementById("pMarqueeYes").classList.toggle("active", val);
    document.getElementById("pMarqueeNo").classList.toggle("active", !val);
}

function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
        });
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

function editPlayer(id) {
    const p = players.find(function (x) { return x.id === id; }); if (!p) return;
    document.getElementById("modalPlayerTitle").textContent = "Edit Player";
    document.getElementById("playerFormId").value = id;
    document.getElementById("pName").value = p.name; document.getElementById("pCategory").value = p.category; document.getElementById("pBasePrice").value = p.basePrice; document.getElementById("pNationality").value = p.nationality || ""; setMarquee(!!p.marquee);
    // nationality flag preview removed
    document.getElementById("pBatHand").value = p.batHand || "";
    document.getElementById("pBowlHand").value = p.bowlHand || "";
    document.getElementById("pBowlType").value = p.bowlType || "";
    document.getElementById("pOverall").value = p.overall || "";
    document.getElementById("pBatStyle").value = p.batStyle || "";
    document.getElementById("pBowlStyle").value = p.bowlStyle || "";
    document.getElementById("pPlayerStatus").value = p.playerStatus || "";
    const prev = document.getElementById("pImagePreview"); if (p.image) { prev.src = p.image; prev.classList.remove("hidden"); } else prev.classList.add("hidden");
    document.getElementById("playerFormError").classList.add("hidden"); openModal("modalPlayer");
}
function savePlayer() {
    // guarantee array before manipulating
    if (!Array.isArray(players)) {
        console.warn("players variable was not an array, resetting");
        players = [];
    }

    const id = document.getElementById("playerFormId").value;
    const name = document.getElementById("pName").value.trim();
    const cat = document.getElementById("pCategory").value;
    const bp = parseInt(document.getElementById("pBasePrice").value);
    const nat = document.getElementById("pNationality").value.trim();
    const marq = document.getElementById("pMarquee").value === "true";
    const batHand = document.getElementById("pBatHand").value;
    const bowlHand = document.getElementById("pBowlHand").value;
    const bowlType = document.getElementById("pBowlType").value;
    const overall = parseInt(document.getElementById("pOverall").value) || 0;
    const batStyle = document.getElementById("pBatStyle").value;
    const bowlStyle = document.getElementById("pBowlStyle").value;
    const playerStatus = document.getElementById("pPlayerStatus").value;
    const form = "";
    const errEl = document.getElementById("playerFormError");
    if (!name || !cat || !bp || !playerStatus) { errEl.textContent = "Fill all required fields."; errEl.classList.remove("hidden"); return; }
    const dup = players.find(function (p) { return p.name.toLowerCase() === name.toLowerCase() && p.id !== id; });
    if (dup) { errEl.textContent = "Player name already exists."; errEl.classList.remove("hidden"); return; }
    const fi = document.getElementById("pImage");
    function doSave(imgData) {
        if (id) {
            const idx = players.findIndex(function (p) { return p.id === id; });
            if (idx >= 0) players[idx] = Object.assign({}, players[idx], {
                name: name, category: cat, basePrice: bp, nationality: nat, marquee: marq,
                form: form, batHand: batHand, bowlHand: bowlHand, bowlType: bowlType, overall: overall, batStyle: batStyle, bowlStyle: bowlStyle, playerStatus: playerStatus,
                image: imgData || players[idx].image
            });
            toast("Player updated!", "success");
        }
        else {
            players.push({
                id: uid(), name: name, category: cat, basePrice: bp, nationality: nat,
                marquee: marq, form: form, batHand: batHand, bowlHand: bowlHand, bowlType: bowlType, overall: overall, batStyle: batStyle, bowlStyle: bowlStyle, playerStatus: playerStatus,
                image: imgData || "", sold: false
            });
            toast("Player added!", "success", null, true);
        }
        persist(); closeModal("modalPlayer"); renderPlayers();
    }
    if (fi.files[0]) { const r = new FileReader(); r.onload = function (e) { doSave(e.target.result); }; r.readAsDataURL(fi.files[0]); } else doSave("");
}
function deletePlayer(id) { showConfirm("Delete Player", "Remove this player?", function () { players = players.filter(function (p) { return p.id !== id; }); persist(); renderPlayers(); toast("Deleted.", "warning", null, true); }); }
function bulkDelete() {
    const ids = Array.from(document.querySelectorAll(".pc-checkbox:checked")).map(function (c) { return c.dataset.id; });
    if (!ids.length) return;
    showConfirm("Bulk Delete", "Delete " + ids.length + " player(s)?", function () { players = players.filter(function (p) { return !ids.includes(p.id); }); persist(); renderPlayers(); toast(ids.length + " deleted.", "warning", null, true); document.getElementById("btnBulkDelete").classList.add("hidden"); });
}
let importBuffer = [];
function openImport() { openModal("modalImport"); document.getElementById("importPreview").classList.add("hidden"); document.getElementById("importError").classList.add("hidden"); document.getElementById("btnConfirmImport").classList.add("hidden"); importBuffer = []; }
function parseCSV(text) {
    const lines = text.trim().split("\n");
    const headers = lines[0].split(",").map(function (h) { return h.trim().toLowerCase(); });
    return lines.slice(1).map(function (l) { const cols = l.split(",").map(function (c) { return c.trim().replace(/"/g, ""); }); const obj = {}; headers.forEach(function (h, i) { obj[h] = cols[i] || ""; }); return obj; });
}

function parsePriceToLakhs(raw) {
    if (raw == null) return 0;
    const txt = String(raw).trim().toLowerCase();
    if (!txt) return 0;

    // Keep digits and decimal point for numeric conversion.
    const num = parseFloat(txt.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(num)) return 0;

    if (/(cr|crore)/.test(txt)) return Math.round(num * 100);
    if (/(l|lac|lakh)/.test(txt)) return Math.round(num);
    if (/(k|thousand)/.test(txt)) return Math.round(num / 100);

    // If amount looks like full rupees (>= 1 crore), convert to lakhs.
    if (num >= 10000000) return Math.round(num / 100000);

    // Default legacy behavior: plain numeric values are assumed to be in lakhs.
    return Math.round(num);
}

function processImportRows(rows) {
    importBuffer = [];
    rows.forEach(function (r) {
        const name = r.name || r.playername || r["player name"] || "";
        const cat = r.role || r.category || r.type || "";
        const bp = parsePriceToLakhs(r.baseprice || r["base price"] || r.price || 0);
        const nat = r.country || r.nationality || "Indian";
        const marq = r.marquee === "1" || r.marquee === "true" || r.marquee === "yes" || r.marquee?.toString().toLowerCase() === "true" || r.marquee?.toString().toLowerCase() === "yes";

        const statusVal = r.playerstatus || r["player status"] || r.status || "Capped";
        const overall = parseInt(r.overall || r.overallrating || r["overall rating"] || r.rating || r.ovr || 0) || "";

        const batHand = r.battinghand || r["batting hand"] || r.bathand || r["bat hand"] || "";
        const bowlHand = r.bowlingarm || r["bowling arm"] || r.bowlarm || r.bowlhand || r["bowl hand"] || "";
        const bowlType = r.bowlingtype || r["bowling type"] || r.bowltype || r["bowl type"] || "";

        const batStyle = r.battingarchetype || r["batting archetype"] || r.batstyle || r["bat style"] || "";
        const bowlStyle = r.bowlingarchetype || r["bowling archetype"] || r.bowlstyle || r["bowl style"] || "";

        const cats = ["Batsman", "Bowler", "All-Rounder", "Wicketkeeper"];
        const catM = cats.find(function (c) { return c.toLowerCase() === cat.toLowerCase(); }) || "";
        const dup = players.some(function (p) { return p.name.toLowerCase() === name.toLowerCase(); });

        importBuffer.push({
            name: name, category: catM, basePrice: bp, nationality: nat, marquee: marq,
            playerStatus: statusVal, overall: overall,
            batHand: batHand, bowlHand: bowlHand, bowlType: bowlType,
            batStyle: batStyle, bowlStyle: bowlStyle,
            status: !name ? "No name" : !catM ? "Bad role" : bp < 1 ? "No price" : dup ? "Dup" : "OK"
        });
    });
    document.getElementById("importCount").textContent = importBuffer.length;
    document.getElementById("importTableBody").innerHTML = importBuffer.map(function (r) {
        return "<tr><td>" + r.name + "</td><td>" + r.category + "</td><td>" + (r.basePrice ? fmtPrice(r.basePrice) : "--") + "</td><td>" + r.nationality + "</td><td>" + r.playerStatus + "</td><td>" + r.overall + "</td><td>" + r.batHand + "</td><td>" + r.bowlHand + "</td><td>" + r.bowlType + "</td><td>" + r.batStyle + "</td><td>" + r.bowlStyle + "</td><td>" + (r.marquee ? "Yes" : "No") + "</td><td>" + r.status + "</td></tr>";
    }).join("");
    document.getElementById("importPreview").classList.remove("hidden");
    document.getElementById("btnConfirmImport").classList.remove("hidden");
    const bad = importBuffer.filter(function (r) { return r.status !== "OK"; }).length;
    if (bad) { const e = document.getElementById("importError"); e.textContent = bad + " row(s) will be skipped."; e.classList.remove("hidden"); }
}
function confirmImport() {
    // ensure players is valid before we start pushing
    if (!Array.isArray(players)) {
        console.warn("players variable corrupted, resetting to []");
        players = [];
    }

    const good = importBuffer.filter(function (r) { return r.status === "OK"; });
    good.forEach(function (r) {
        const importedImage = getCategoryDefaultLogo(r.category) || "";
        players.push({
            id: uid(),
            name: r.name,
            category: r.category,
            basePrice: r.basePrice,
            nationality: r.nationality,
            marquee: r.marquee,
            playerStatus: r.playerStatus,
            overall: r.overall,
            batHand: r.batHand,
            bowlHand: r.bowlHand,
            bowlType: r.bowlType,
            batStyle: r.batStyle,
            bowlStyle: r.bowlStyle,
            image: importedImage,
            sold: false
        });
    });
    importBuffer = [];
    persist(); closeModal("modalImport"); renderPlayers(); toast("Imported " + good.length + " players.", "success", null, true);
}
function renderTeams() {
    const grid = document.getElementById("teamsGrid"), empty = document.getElementById("teamsEmpty");
    if (!grid || !empty) return;
    if (!teams.length) {
        grid.innerHTML = "";
        empty.classList.remove("hidden");
        return;
    }
    empty.classList.add("hidden");
    const isAdmin = currentUser.role === "admin";
    grid.innerHTML = teams.map(function (t) {
        const spent = t.initialPurse - t.purse;
        const pct = Math.max(0, Math.min(100, (t.purse / t.initialPurse) * 100));
        const pClass = pct > 50 ? "purse-high" : pct > 25 ? "purse-med" : "purse-low";
        const squad = players.filter(function (p) { return p.soldTo === t.id; }).length;
        const isBidder = auctionState.currentBidTeam === t.id;
        var tc = t.color || "#ff6a00";
        let h = "<div class=\"team-card" + (isBidder ? " highest-bidder" : "") + "\" id=\"tc-" + t.id + "\">";
        h += "<div class=\"tc-color-stripe\" style=\"background:" + tc + "\"></div>";
        h += "<div class=\"tc-header\">" + (t.logo ? "<img class=\"tc-logo\" src=\"" + t.logo + "\" alt=\"" + t.name + "\" />" : "<div class=\"tc-logo-placeholder\" style=\"background:" + tc + "\">" + t.name.charAt(0) + "</div>");
        h += "<div><div class=\"tc-name\">" + t.name + "</div><div class=\"tc-code\">" + (t.code || "") + "</div></div></div>";
        h += "<div class=\"tc-body\"><div class=\"tc-stats\">";
        h += "<div class=\"tc-stat\"><div class=\"tc-stat-val\">" + fmtPrice(t.purse) + "</div><div class=\"tc-stat-label\">Purse</div></div>";
        h += "<div class=\"tc-stat\"><div class=\"tc-stat-val\">" + squad + "/" + (t.maxSquad || MAX_SQUAD) + "</div><div class=\"tc-stat-label\">Squad</div></div>";
        h += "<div class=\"tc-stat\"><div class=\"tc-stat-val\">" + fmtPrice(spent) + "</div><div class=\"tc-stat-label\">Spent</div></div>";
        h += "<div class=\"tc-stat\"><div class=\"tc-stat-val\">" + pct.toFixed(0) + "%</div><div class=\"tc-stat-label\">Left %</div></div>";
        h += "</div><div class=\"tc-purse-bar-wrap\"><div class=\"tc-purse-bar " + pClass + "\" style=\"width:" + pct + "%\"></div></div>";
        h += "<div class=\"tc-actions\"><button class=\"btn btn-secondary btn-sm\" onclick=\"viewSquad('" + t.id + "')\">Squad</button>";
        h += isAdmin ? "<button class=\"btn btn-warning btn-sm\" onclick=\"editTeam('" + t.id + "')\">Edit</button><button class=\"btn btn-danger btn-sm\" onclick=\"deleteTeam('" + t.id + "')\">Del</button>" : "";
        h += "</div></div></div>";
        return h;
    }).join("");
}
function openAddTeam() { document.getElementById("modalTeamTitle").textContent = "Create Team"; document.getElementById("teamFormId").value = ""; document.getElementById("teamForm").reset(); document.getElementById("tMaxSquad").value = 25; document.getElementById("tLogoPreview").classList.add("hidden"); document.getElementById("teamFormError").classList.add("hidden"); openModal("modalTeam"); }
function editTeam(id) {
    const t = teams.find(function (x) { return x.id === id; }); if (!t) return;
    document.getElementById("modalTeamTitle").textContent = "Edit Team"; document.getElementById("teamFormId").value = id;
    document.getElementById("tName").value = t.name; document.getElementById("tCode").value = t.code || ""; document.getElementById("tUsername").value = t.username; document.getElementById("tPassword").value = t.password; document.getElementById("tPurse").value = t.initialPurse / 100; document.getElementById("tMaxSquad").value = t.maxSquad || 25;
    if (t.color) document.getElementById("tColor").value = t.color;
    const prev = document.getElementById("tLogoPreview"); if (t.logo) { prev.src = t.logo; prev.classList.remove("hidden"); } else prev.classList.add("hidden");
    document.getElementById("teamFormError").classList.add("hidden"); openModal("modalTeam");
}
function saveTeam() {
    // defense in depth: make sure `teams` is an array before we mutate it
    if (!Array.isArray(teams)) {
        console.warn("teams variable was corrupted, resetting to []");
        teams = [];
    }

    const id = document.getElementById("teamFormId").value;
    const name = document.getElementById("tName").value.trim(); const code = document.getElementById("tCode").value.trim().toUpperCase(); const username = document.getElementById("tUsername").value.trim().toLowerCase(); const password = document.getElementById("tPassword").value; const purseC = parseFloat(document.getElementById("tPurse").value); const maxSquad = parseInt(document.getElementById("tMaxSquad").value) || MAX_SQUAD;
    const color = document.getElementById("tColor").value || "#ff6a00";
    const errEl = document.getElementById("teamFormError");
    if (!name || !username || !password || !purseC) { errEl.textContent = "Fill all required fields."; errEl.classList.remove("hidden"); return; }
    if (teams.find(function (t) { return t.name.toLowerCase() === name.toLowerCase() && t.id !== id; })) { errEl.textContent = "Team name exists."; errEl.classList.remove("hidden"); return; }
    if (teams.find(function (t) { return t.username === username && t.id !== id; })) { errEl.textContent = "Username taken."; errEl.classList.remove("hidden"); return; }
    const pL = Math.round(purseC * 100);
    function doSave(logo) {
        if (id) { const idx = teams.findIndex(function (t) { return t.id === id; }); if (idx >= 0) teams[idx] = Object.assign({}, teams[idx], { name: name, code: code, username: username, password: password, maxSquad: maxSquad, color: color, logo: logo || teams[idx].logo }); toast("Team updated!", "success", null, true); }
        else { teams.push({ id: uid(), name: name, code: code, username: username, password: password, purse: pL, initialPurse: pL, maxSquad: maxSquad, color: color, logo: logo || "" }); toast("Team created!", "success", null, true); }
        persist(); closeModal("modalTeam"); renderTeams();
    }
    const f = document.getElementById("tLogo").files[0];
    if (f) { const r = new FileReader(); r.onload = function (e) { doSave(e.target.result); }; r.readAsDataURL(f); } else doSave("");
}
function deleteTeam(id) { showConfirm("Delete Team", "Delete this team?", function () { players = players.map(function (p) { return p.soldTo === id ? Object.assign({}, p, { sold: false, soldTo: null, soldPrice: 0 }) : p; }); teams = teams.filter(function (t) { return t.id !== id; }); persist(); renderTeams(); renderPlayers(); toast("Team deleted.", "warning", null, true); }); }
function viewSquad(id) {
    const t = teams.find(function (x) { return x.id === id; }); if (!t) return;
    const squad = players.filter(function (p) { return p.soldTo === id; });
    document.getElementById("squadModalTitle").textContent = t.name + " Squad";
    document.getElementById("squadInfoBar").innerHTML = "<div class=\"squad-stat\"><div class=\"squad-stat-val\">" + squad.length + "</div><div class=\"squad-stat-label\">Players</div></div><div class=\"squad-stat\"><div class=\"squad-stat-val\">" + fmtPrice(t.initialPurse - t.purse) + "</div><div class=\"squad-stat-label\">Spent</div></div><div class=\"squad-stat\"><div class=\"squad-stat-val\">" + fmtPrice(t.purse) + "</div><div class=\"squad-stat-label\">Left</div></div>";
    document.getElementById("squadGrid").innerHTML = squad.length ? squad.map(function (p) { var img = getEffectivePlayerImage(p); var fallback = getCategoryDefaultLogo(p.category); var imgTag = img ? "<img class=\"sp-img\" src=\"" + img + "\" alt=\"" + p.name + "\"" + (fallback ? " onerror=\"this.onerror=null;this.src='" + fallback + "'\"" : "") + " />" : "<div class=\"sp-img\" style=\"display:flex;align-items:center;justify-content:center;background:var(--bg3);font-weight:700;color:var(--text3)\">" + p.name.charAt(0) + "</div>"; return "<div class=\"squad-player\">" + imgTag + "<div class=\"sp-name\">" + p.name + "</div><div class=\"sp-price\">" + fmtPrice(p.soldPrice) + "</div></div>"; }).join("") : "<p style=\"color:var(--text2);text-align:center\">No players yet.</p>";
    openModal("modalSquad");
}
function renderPurseTable() {
    const empty = document.getElementById("purseEmpty");
    if (!teams.length) { document.getElementById("purseTable").classList.add("hidden"); empty.classList.remove("hidden"); return; }
    document.getElementById("purseTable").classList.remove("hidden"); empty.classList.add("hidden");
    document.getElementById("purseTableBody").innerHTML = teams.slice().sort(function (a, b) { return (b.initialPurse - b.purse) - (a.initialPurse - a.purse); }).map(function (t, i) {
        const spent = t.initialPurse - t.purse, pct = Math.max(0, Math.min(100, (t.purse / t.initialPurse) * 100)), pc = pct > 50 ? "purse-high" : pct > 25 ? "purse-med" : "purse-low", squad = players.filter(function (p) { return p.soldTo === t.id; }).length;
        return "<tr><td>" + (i + 1) + "</td><td><strong>" + t.name + "</strong>" + (t.code ? " (" + t.code + ")" : "") + "</td><td>" + fmtPrice(t.initialPurse) + "</td><td style=\"color:var(--danger)\">" + fmtPrice(spent) + "</td><td style=\"color:var(--success);font-weight:700\">" + fmtPrice(t.purse) + "</td><td>" + squad + "</td><td><div class=\"purse-bar-wrap\"><div class=\"purse-bar-fill " + pc + "\" style=\"width:" + pct + "%\"></div></div> " + pct.toFixed(0) + "%</td></tr>";
    }).join("");
}

function renderHistory() {
    var logEl = document.getElementById("historyLog");
    var emptyEl = document.getElementById("historyEmpty");
    if (!logEl || !emptyEl) return;

    if (!auctionHistory || !auctionHistory.length) {
        logEl.innerHTML = "";
        emptyEl.classList.remove("hidden");
        return;
    }

    emptyEl.classList.add("hidden");

    // Keep original index so bid-history modal maps to the right entry.
    var rows = auctionHistory.map(function (h, i) { return { h: h, idx: i }; }).reverse();

    var isAdmin = !!(currentUser && currentUser.role === "admin");

    logEl.innerHTML = rows.map(function (row, pos) {
        var h = row.h;
        var isSold = h.status === "sold";

        var resolvedTeamName = "—";
        if (isSold) {
            if (h.teamName && String(h.teamName).trim()) {
                resolvedTeamName = h.teamName;
            } else if (h.teamId) {
                resolvedTeamName = teamName(h.teamId);
            } else if (h.playerId) {
                var p = players.find(function (x) { return x.id === h.playerId; });
                if (p && p.soldTo) resolvedTeamName = teamName(p.soldTo);
            }
            if (!resolvedTeamName || resolvedTeamName === "---") resolvedTeamName = "Unknown Team";
        }

        var priceText = isSold ? fmtPrice(h.price || 0) : "—";
        var catText = displayCategory(h.category || "");
        var badgeCls = isSold ? "sold" : "unsold";
        var badgeText = isSold ? "Sold" : "Unsold";
        var undoBtn = (isAdmin && isSold)
            ? '<button class="btn btn-warning btn-sm hi-undo-btn" onclick="undoHistorySale(' + row.idx + ')">Undo</button>'
            : "";
        var bidBtn = (h.bidHistory && h.bidHistory.length)
            ? '<button class="btn btn-secondary btn-sm hi-bids-btn" onclick="openBidHistory(' + row.idx + ')">Bids</button>'
            : "";

        return "<div class=\"history-item\">" +
            "<div class=\"hi-num\">#" + (auctionHistory.length - pos) + "</div>" +
            "<div><div class=\"hi-player\">" + (h.playerName || "Unknown Player") + "</div><div class=\"hi-category\">" + (catText || "—") + "</div></div>" +
            "<div class=\"hi-team\">" + (isSold ? ("→ " + resolvedTeamName) : "No buyer") + "</div>" +
            "<div class=\"hi-price\">" + priceText + "</div>" +
            "<span class=\"hi-badge " + badgeCls + "\">" + badgeText + "</span>" +
            undoBtn +
            bidBtn +
            "</div>";
    }).join("");
}

function renderAnalytics() {
    const sold = auctionHistory.filter(function (h) { return h.status === "sold"; }), unsold = auctionHistory.filter(function (h) { return h.status === "unsold"; });
    const totalSpent = sold.reduce(function (s, h) { return s + h.price; }, 0), avg = sold.length ? Math.round(totalSpent / sold.length) : 0;
    const expensive = sold.reduce(function (b, h) { return h.price > b.price ? h : b; }, { price: -1, playerName: "--", teamName: "--" });
    const tc = {}; sold.forEach(function (h) { tc[h.teamId] = (tc[h.teamId] || 0) + 1; });
    const mTid = Object.keys(tc).sort(function (a, b) { return tc[b] - tc[a]; })[0];
    const mTeam = teams.find(function (t) { return t.id === mTid; });
    document.getElementById("acMostExpensiveVal").textContent = expensive.playerName;
    document.getElementById("acMostExpensiveSub").textContent = expensive.price > 0 ? fmtPrice(expensive.price) + " - " + expensive.teamName : "--";
    document.getElementById("acMostPlayersVal").textContent = mTeam ? mTeam.name : "--";
    document.getElementById("acMostPlayersSub").textContent = mTid ? tc[mTid] + " players" : "--";
    document.getElementById("acTotalMoneyVal").textContent = fmtPrice(totalSpent);
    document.getElementById("acAvgPriceVal").textContent = fmtPrice(avg);
    document.getElementById("acSoldCountVal").textContent = sold.length;
    document.getElementById("acSoldCountSub").textContent = "of " + players.length + " total";
    document.getElementById("acUnsoldCountVal").textContent = unsold.length;
    // Pie chart colors - vibrant and distinct palette
    const pieColors = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A", "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E2", "#F8B739", "#52B788"];
    const teamsWithSpending = teams.map(function (t) {
        var sp = t.initialPurse - t.purse;
        var squad = players.filter(function (p) { return p.soldTo === t.id; }).length;
        return { team: t, spent: sp, squad: squad };
    }).filter(function (item) { return item.spent > 0; }).sort(function (a, b) { return b.spent - a.spent; });

    const totalSpending = teamsWithSpending.reduce(function (sum, item) { return sum + item.spent; }, 0);

    if (teamsWithSpending.length === 0) {
        document.getElementById("teamSpendingChart").innerHTML = "<p style='text-align:center;color:var(--text2);padding:40px;'>No spending data yet.</p>";
    } else {
        // Build pie chart SVG
        var svgPaths = "";
        var currentAngle = -90;
        teamsWithSpending.forEach(function (item, i) {
            var percent = (item.spent / totalSpending) * 100;
            var angle = (percent / 100) * 360;
            var endAngle = currentAngle + angle;
            var largeArc = angle > 180 ? 1 : 0;
            var x1 = 160 + 140 * Math.cos(currentAngle * Math.PI / 180);
            var y1 = 160 + 140 * Math.sin(currentAngle * Math.PI / 180);
            var x2 = 160 + 140 * Math.cos(endAngle * Math.PI / 180);
            var y2 = 160 + 140 * Math.sin(endAngle * Math.PI / 180);
            svgPaths += "<path class='spend-pie-slice' d='M 160 160 L " + x1 + " " + y1 + " A 140 140 0 " + largeArc + " 1 " + x2 + " " + y2 + " Z' fill='" + pieColors[i % pieColors.length] + "'></path>";
            currentAngle = endAngle;
        });

        // Build legend
        var legend = teamsWithSpending.map(function (item, i) {
            var percent = ((item.spent / totalSpending) * 100).toFixed(1);
            return "<div class='spend-legend-item'>" +
                "<div class='spend-legend-color' style='background:" + pieColors[i % pieColors.length] + "'></div>" +
                "<div class='spend-legend-info'>" +
                "<div class='spend-legend-team'>" + item.team.name + "</div>" +
                "<div class='spend-legend-details'>" + item.squad + " players bought</div>" +
                "</div>" +
                "<div class='spend-legend-amount'>" +
                "<div class='spend-legend-value'>" + fmtPrice(item.spent) + "</div>" +
                "<div class='spend-legend-percent'>" + percent + "%</div>" +
                "</div>" +
                "</div>";
        }).join("");

        document.getElementById("teamSpendingChart").innerHTML =
            "<div class='spend-pie-container'><svg class='spend-pie-svg' viewBox='0 0 320 320'>" + svgPaths + "</svg></div>" +
            "<div class='spend-legend'>" + legend + "</div>";
    }
    const cats = ["Batsman", "Bowler", "All-Rounder", "Wicketkeeper"], colors = ["var(--info)", "var(--success)", "#a78bfa", "var(--warning)"];
    document.getElementById("categoryChart").innerHTML = cats.map(function (c, i) { return "<div class=\"cat-stat-card\"><div class=\"cat-stat-num\" style=\"color:" + colors[i] + "\">" + sold.filter(function (h) { return h.category === c; }).length + "</div><div class=\"cat-stat-name\">" + c + "</div></div>"; }).join("");
    // Feature 4: Bargain of the Day
    var bargainEl = document.getElementById("bargainCard");
    if (!bargainEl) {
        bargainEl = document.createElement("div");
        bargainEl.id = "bargainCard";
        bargainEl.className = "analytics-card bargain-highlight";
        var catChart = document.getElementById("categoryChart");
        if (catChart && catChart.parentNode) catChart.parentNode.insertBefore(bargainEl, catChart.nextSibling);
    }
    if (sold.length) {
        var bargain = sold.slice().filter(function (h) { return h.price && h.price > 0; }).sort(function (a, b) { return (a.price / Math.max(1, a.basePrice || a.price)) - (b.price / Math.max(1, b.basePrice || b.price)); })[0];
        if (!bargain) bargain = sold[0];
        bargainEl.innerHTML = "<div class=\"ac-label\">🏅 Best Buy of the Day</div><div class=\"ac-value\" style=\"font-size:1.4rem;margin:6px 0\">" + bargain.playerName + "</div><div class=\"ac-sub\"><span class=\"bargain-badge\">💰 BARGAIN</span> sold for " + fmtPrice(bargain.price) + " to " + bargain.teamName + "</div>";
        bargainEl.style.display = "";
    } else { bargainEl.style.display = "none"; }
    // Feature 6: Speed Stats
    var ss = getSpeedStats();
    var speedEl = document.getElementById("speedStatsRow");
    if (!speedEl) {
        speedEl = document.createElement("div");
        speedEl.id = "speedStatsRow";
        speedEl.className = "speed-stats-row";
        var analyticsSection = document.getElementById("sectionAnalytics");
        if (analyticsSection) analyticsSection.appendChild(speedEl);
    }
    speedEl.innerHTML = "<div class=\"speed-stat-card\"><div class=\"speed-stat-val\">" + ss.ppm + "</div><div class=\"speed-stat-label\">Players / min</div></div>" +
        "<div class=\"speed-stat-card\"><div class=\"speed-stat-val\">" + (ss.avgTime !== "--" ? ss.avgTime + "s" : "--") + "</div><div class=\"speed-stat-label\">Avg sell time</div></div>" +
        "<div class=\"speed-stat-card\"><div class=\"speed-stat-val\">" + (ss.elapsed || "--") + "m</div><div class=\"speed-stat-label\">Elapsed time</div></div>";
}
function renderAdminPanel() {
    document.getElementById("timerDuration").value = settings.timerDuration;
    document.getElementById("timerExtension").value = settings.extension;
    document.getElementById("timerThreshold").value = settings.threshold;
    document.getElementById("siStatus").textContent = auctionState.status.toUpperCase();
    document.getElementById("siPlayer").textContent = auctionState.currentIndex >= 0 ? (function () { var p = players.find(function (p) { return p.id === auctionState.queue[auctionState.currentIndex]; }); return p ? p.name : "--"; })() : "--";
    document.getElementById("siDone").textContent = auctionState.currentIndex >= 0 ? auctionState.currentIndex : 0;
    document.getElementById("siTotal").textContent = auctionState.queue.length;
    document.getElementById("siTeams").textContent = teams.length;
}
function updateStatusBadge(s) { const b = document.getElementById("auctionStatusBadge"); const l = { idle: "IDLE", live: "LIVE", paused: "PAUSED", ended: "ENDED" }; b.textContent = " " + (l[s] || s); b.className = "auction-status-badge" + (s === "live" ? " live" : s === "paused" ? " paused" : s === "ended" ? " ended" : s === "idle" ? " idle" : ""); const ledTimer = document.getElementById("navbarLedTimer"); if (ledTimer) { if (s === "live" || s === "paused") { ledTimer.classList.add("active"); } else { ledTimer.classList.remove("active"); } } }
function toggleDarkMode() { const html = document.documentElement, isDark = html.getAttribute("data-theme") === "dark"; html.setAttribute("data-theme", isDark ? "light" : "dark"); document.getElementById("darkToggle").textContent = isDark ? "☀" : "🌙"; localStorage.setItem("ipl_theme", isDark ? "light" : "dark"); }
function exportJSON() { const a = document.createElement("a"); a.href = "data:application/json," + encodeURIComponent(JSON.stringify({ players: players, teams: teams, auctionHistory: auctionHistory, exportedAt: new Date().toISOString() }, null, 2)); a.download = "ipl_auction_results.json"; a.click(); }
function exportCSV() { const rows = [["Player", "Category", "Status", "Team", "Price"]].concat(auctionHistory.map(function (h) { return [h.playerName, h.category, h.status, h.teamName || "", h.price || 0]; })); const a = document.createElement("a"); a.href = "data:text/csv," + encodeURIComponent(rows.map(function (r) { return r.join(","); }).join("\n")); a.download = "ipl_auction.csv"; a.click(); }
function openRevertSingle(pid) { showConfirm("Revert Player", "Mark as unsold and refund team?", function () { revertPlayer(pid); }); }

function queuePlayerAfterCurrent(pid) {
    if (!auctionState.queue) auctionState.queue = [];
    var insertAt = Math.max(auctionState.currentIndex + 1, 0);

    // De-duplicate future occurrences so the player reappears only once.
    auctionState.queue = auctionState.queue.filter(function (qItem, idx) {
        if (idx <= auctionState.currentIndex) return true;
        var qid = (typeof qItem === "object" && qItem !== null) ? qItem.id : qItem;
        return qid !== pid;
    });

    if (insertAt > auctionState.queue.length) insertAt = auctionState.queue.length;
    auctionState.queue.splice(insertAt, 0, pid);
}

function undoSaleLocal(pid, historyIndex) {
    var p = players.find(function (x) { return x.id === pid; });
    if (!p || !p.sold) return false;

    var t = teams.find(function (x) { return x.id === p.soldTo; });
    if (t) t.purse += (p.soldPrice || 0);

    p.sold = false;
    p.isUnsold = false;
    p.soldTo = null;
    p.soldPrice = 0;

    if (typeof historyIndex === "number" && historyIndex >= 0 && historyIndex < auctionHistory.length && auctionHistory[historyIndex] && auctionHistory[historyIndex].playerId === pid) {
        auctionHistory.splice(historyIndex, 1);
    } else {
        for (var i = auctionHistory.length - 1; i >= 0; i--) {
            if (auctionHistory[i].playerId === pid && auctionHistory[i].status === "sold") {
                auctionHistory.splice(i, 1);
                break;
            }
        }
    }

    queuePlayerAfterCurrent(pid);
    persist();
    renderPlayers();
    renderTeams();
    renderPurseTable();
    renderHistory();
    updatePlayerStats();
    updateQueue();
    return true;
}

function undoHistorySale(historyIndex) {
    if (!currentUser || currentUser.role !== "admin") {
        toast("Only admin can undo sold entries.", "error");
        return;
    }

    var h = auctionHistory[historyIndex];
    if (!h || h.status !== "sold" || !h.playerId) {
        toast("Only sold entries can be undone.", "warning");
        return;
    }

    showConfirm("Undo Sold Player", "This will refund the team and queue the player right after the current player.", function () {
        if (socket) {
            socket.emit("player:undo_sale", { playerId: h.playerId, historyIndex: historyIndex });
            toast("Undo requested. Player will re-enter the auction queue.", "warning");
            return;
        }

        if (undoSaleLocal(h.playerId, historyIndex)) {
            toast("Sale undone. Player queued after current player.", "warning");
        } else {
            toast("Unable to undo this sale.", "error");
        }
    });
}

function revertPlayer(pid) {
    if (socket) {
        socket.emit("player:revert", pid);
        return;
    }
    const p = players.find(function (x) { return x.id === pid; });
    if (!p) return;

    // Reset based on previous state
    if (p.sold) {
        const t = teams.find(function (x) { return x.id === p.soldTo; });
        if (t) t.purse += p.soldPrice;
    }

    p.sold = false;
    p.isUnsold = false;
    p.soldTo = null;
    p.soldPrice = 0;

    auctionHistory = auctionHistory.filter(function (h) { return h.playerId !== pid; });
    persist(); renderPlayers(); renderTeams(); renderPurseTable(); renderHistory(); toast("Player reverted.", "warning", null, true);
}
function loadDemoData() {
    showConfirm("Load Demo Data", "Replace all data with demo data?", function () {
        if (socket) {
            socket.emit("demo:load");
            return;
        }
        var dp = [
            { name: "Virat Kohli", category: "Batsman", basePrice: 200, marquee: true, nationality: "Indian", bat: 98, bowl: 15, field: 92, form: "hot" },
            { name: "Rohit Sharma", category: "Batsman", basePrice: 200, marquee: true, nationality: "Indian", bat: 96, bowl: 20, field: 85, form: "hot" },
            { name: "MS Dhoni", category: "Wicketkeeper", basePrice: 200, marquee: true, nationality: "Indian", bat: 85, bowl: 5, field: 99, form: "wildcard" },
            { name: "Jasprit Bumrah", category: "Bowler", basePrice: 200, marquee: true, nationality: "Indian", bat: 10, bowl: 99, field: 80, form: "hot" },
            { name: "Hardik Pandya", category: "All-Rounder", basePrice: 200, marquee: true, nationality: "Indian", bat: 88, bowl: 85, field: 90, form: "hot" },
            { name: "KL Rahul", category: "Batsman", basePrice: 150, marquee: false, nationality: "Indian", bat: 90, bowl: 5, field: 88 },
            { name: "Shubman Gill", category: "Batsman", basePrice: 100, marquee: false, nationality: "Indian", bat: 92, bowl: 5, field: 85 },
            { name: "Ravindra Jadeja", category: "All-Rounder", basePrice: 175, marquee: false, nationality: "Indian", bat: 82, bowl: 92, field: 99, form: "hot" },
            { name: "Mohammed Shami", category: "Bowler", basePrice: 125, marquee: false, nationality: "Indian", bat: 15, bowl: 94, field: 75 },
            { name: "Yuzvendra Chahal", category: "Bowler", basePrice: 100, marquee: false, nationality: "Indian", bat: 5, bowl: 90, field: 70, form: "wildcard" },
            { name: "Sanju Samson", category: "Wicketkeeper", basePrice: 100, marquee: false, nationality: "Indian", bat: 88, bowl: 0, field: 92 },
            { name: "Rishabh Pant", category: "Wicketkeeper", basePrice: 150, marquee: false, nationality: "Indian", bat: 94, bowl: 0, field: 88, form: "hot" },
            { name: "Pat Cummins", category: "All-Rounder", basePrice: 200, marquee: true, nationality: "Australian", bat: 75, bowl: 96, field: 85 },
            { name: "Jos Buttler", category: "Batsman", basePrice: 150, marquee: false, nationality: "English", bat: 95, bowl: 0, field: 82 },
            { name: "Rashid Khan", category: "Bowler", basePrice: 200, marquee: true, nationality: "Afghan", bat: 65, bowl: 98, field: 95, form: "hot" }
        ];
        var dt = [
            { name: "Chennai Super Kings", code: "CSK", username: "csk", password: "csk123", purse: 10000, initialPurse: 10000, maxSquad: 25, logo: "" },
            { name: "Mumbai Indians", code: "MI", username: "mi", password: "mi123", purse: 10000, initialPurse: 10000, maxSquad: 25, logo: "" },
            { name: "Royal Challengers", code: "RCB", username: "rcb", password: "rcb123", purse: 10000, initialPurse: 10000, maxSquad: 25, logo: "" },
            { name: "Kolkata Knight Riders", code: "KKR", username: "kkr", password: "kkr123", purse: 10000, initialPurse: 10000, maxSquad: 25, logo: "" }
        ];
        players = dp.map(function (p) { return Object.assign({}, p, { id: uid(), image: "", sold: false }); });
        teams = dt.map(function (t) { return Object.assign({}, t, { id: uid() }); });
        auctionHistory = [];
        auctionState = { status: "idle", queue: [], currentIndex: -1, currentBid: 0, currentBidTeam: null, timerSecs: 30, timerRemaining: 30, bids: [], undoStack: [] };
        clearInterval(timerInterval);
        persist(); renderAll(); toast("Demo data loaded!", "success", null, true);
    });
}
function fullReset() {
    showConfirm("Full Reset", "Delete ALL global data and forcefully log out everyone?", function () {
        if (socket) {
            socket.emit("admin:full_reset");
        } else {
            players = []; teams = []; auctionHistory = []; auctionState = { status: "idle", queue: [], currentIndex: -1, currentBid: 0, currentBidTeam: null, timerSecs: 30, timerRemaining: 30, bids: [], undoStack: [] }; clearInterval(timerInterval); persist(); renderAll(); updateStatusBadge("idle"); toast("Reset complete.", "warning", null, true);
        }
    });
}
function resetAuction() {
    showConfirm("Reset Auction", "Are you sure you want to completely reset the live auction? (This keeps player/team data but clears the active auction)", function () {
        if (socket) {
            socket.emit("admin:reset_auction");
        } else {
            auctionState = { status: "idle", queue: [], currentIndex: -1, currentBid: 0, currentBidTeam: null, timerSecs: 30, timerRemaining: 30, bids: [], undoStack: [] };
            clearInterval(timerInterval); persist(); renderAll(); updateStatusBadge("idle"); showAuctionButtons("idle");
            document.getElementById("auctionStage").classList.add("hidden");
            document.getElementById("emptyAuction").classList.remove("hidden");
            toast("Auction reset.", "warning");
        }
    });
}
function renderAll() {
    try {
        renderPlayers();
        renderTeams();
        renderPurseTable();
        renderHistory();
        renderAnalytics();
        renderAdminPanel();
        updateAuctionUI();
        updateNewsTicker();
    } catch (err) {
        console.warn("RenderAll suppressed a crash:", err);
    }
}
function buildQueue(pool) {
    var available = players.filter(function (p) { return !p.sold && !p.isUnsold; });
    pool = pool || "all";
    if (pool === "Uncapped") {
        return available.filter(function (p) { return p.playerStatus === "Uncapped"; }).map(function (p) { return p.id; });
    } else if (pool !== "all") {
        return available.filter(function (p) { return p.category === pool && p.playerStatus !== "Uncapped"; }).map(function (p) { return p.id; });
    }

    // "All" pool logic: Marquees -> Capped Batsmen -> Capped Bowlers -> Capped AllRounders -> Capped Wicketkeepers -> ALL Uncapped
    var cappedAvailable = available.filter(function (p) { return p.playerStatus !== "Uncapped"; });
    var uncappedAvailable = available.filter(function (p) { return p.playerStatus === "Uncapped"; });

    var marquee = cappedAvailable.filter(function (p) { return p.marquee; }).map(function (p) { return p.id; });
    var cats = ["Batsman", "Bowler", "All-Rounder", "Wicketkeeper"];
    var rest = [];
    cats.forEach(function (cat) {
        cappedAvailable.filter(function (p) { return !p.marquee && p.category === cat; }).forEach(function (p) { rest.push(p.id); });
    });
    var missing = cappedAvailable.filter(function (p) { return !p.marquee && !cats.includes(p.category); }).map(function (p) { return p.id; });

    var uncappedIds = uncappedAvailable.map(function (p) { return p.id; });

    return marquee.concat(rest).concat(missing).concat(uncappedIds);
}
function startAuction() {
    if (!currentUser || currentUser.role !== "admin") return;
    if (!players.length) { toast("No players added.", "error"); return; }
    if (!teams.length) { toast("No teams created.", "error"); return; }
    var unsold = players.filter(function (p) { return !p.sold; });
    if (!unsold.length) { toast("All players already sold.", "warning"); return; }
    showLobby();
}
function showLobby() {
    document.getElementById("lobbyTeamsGrid").innerHTML = teams.map(function (t) {
        var tc = t.color || "#ff6a00";
        return "<div class=\"lobby-team-card\" style=\"border-top:3px solid " + tc + "\">"
            + (t.logo ? "<img src=\"" + t.logo + "\" style=\"width:40px;height:40px;border-radius:8px;margin-bottom:8px;object-fit:cover\">" : "<div style=\"width:40px;height:40px;border-radius:8px;background:" + tc + ";display:grid;place-items:center;font-family:Bebas Neue,sans-serif;font-size:1.1rem;color:#fff;margin:0 auto 8px\">" + t.name.charAt(0) + "</div>")
            + "<div class=\"lobby-tc-name\">" + t.name + "</div>"
            + "<div class=\"lobby-tc-purse\">\u20b9" + (t.purse / 100) + "Cr</div></div>";
    }).join("");
    // Reset mode selection UI each time lobby opens
    var cardAi = document.getElementById("lobbyCardAi");
    var cardManual = document.getElementById("lobbyCardManual");
    var poolWrap = document.getElementById("lobbyManualPoolWrap");
    var startBtn = document.getElementById("btnLobbyStart");
    if (cardAi) { cardAi.style.borderColor = "rgba(255,255,255,0.1)"; cardAi.style.background = "rgba(255,255,255,0.03)"; }
    if (cardManual) { cardManual.style.borderColor = "rgba(255,255,255,0.1)"; cardManual.style.background = "rgba(255,255,255,0.03)"; }
    if (poolWrap) poolWrap.style.display = "none";
    if (startBtn) { startBtn.disabled = true; startBtn.style.opacity = ".4"; startBtn.style.cursor = "not-allowed"; startBtn.textContent = "Select a mode above"; }
    window._lobbyMode = null;
    openModal("modalLobby");
}
function selectLobbyMode(mode) {
    window._lobbyMode = mode;
    var cardAi = document.getElementById("lobbyCardAi");
    var cardManual = document.getElementById("lobbyCardManual");
    var poolWrap = document.getElementById("lobbyManualPoolWrap");
    var startBtn = document.getElementById("btnLobbyStart");
    if (cardAi) { cardAi.style.borderColor = "rgba(255,255,255,0.1)"; cardAi.style.background = "rgba(255,255,255,0.03)"; }
    if (cardManual) { cardManual.style.borderColor = "rgba(255,255,255,0.1)"; cardManual.style.background = "rgba(255,255,255,0.03)"; }
    if (mode === "ai") {
        if (cardAi) { cardAi.style.borderColor = "#22c55e"; cardAi.style.background = "rgba(34,197,94,0.08)"; }
        if (poolWrap) poolWrap.style.display = "none";
        if (startBtn) { startBtn.disabled = false; startBtn.style.opacity = "1"; startBtn.style.cursor = ""; startBtn.textContent = "\ud83e\udd16 Start AI Mode"; }
    } else {
        if (cardManual) { cardManual.style.borderColor = "#3b82f6"; cardManual.style.background = "rgba(59,130,246,0.08)"; }
        if (poolWrap) poolWrap.style.display = "block";
        if (startBtn) { startBtn.disabled = false; startBtn.style.opacity = "1"; startBtn.style.cursor = ""; startBtn.textContent = "\ud83c\udfcf Start Manual Auction"; }
    }
}
function startUnsoldRound() {
    var unsoldIds = players.filter(function (p) { return !p.sold && !p.isUnsold; }).map(function (p) { return p.id; });
    if (!unsoldIds.length) { toast("No unauctioned players left.", "warning"); return; }

    // Instead of local state change, signal the server to start an unsold round
    if (socket) {
        socket.emit("auction:start_unsold", { queue: unsoldIds });
    } else {
        // Fallback for offline mode
        auctionState.queue = unsoldIds;
        auctionState.currentIndex = -1;
        auctionState.status = "live";
        nextPlayer();
    }
}
function doStartAuction() {
    closeModal("modalLobby");
    var mode = window._lobbyMode || "manual";

    if (mode === "ai") {
        aiModeActive = true;
        aiPool = "autonomous";
        _aiStopRequested = false;
        if (typeof _updateAiModeUI === "function") _updateAiModeUI();
        var aiQueue = buildAiQueue("autonomous");
        if (!aiQueue.length) { toast("No eligible players for AI mode!", "error"); aiModeActive = false; return; }
        if (socket) {
            socket.emit("auction:start_autonomous", { queue: aiQueue });
        } else {
            auctionState.queue = aiQueue; auctionState.currentIndex = -1; auctionState.status = "live";
            updateStatusBadge("live"); showAuctionButtons("live"); persist(); nextPlayer();
        }
        // toast removed here to prevent double-toast for admin (handled by auction:started listener)
    } else {
        aiModeActive = false;
        _aiStopRequested = true;
        if (typeof _updateAiModeUI === "function") _updateAiModeUI();
        var poolEl = document.getElementById("lobbyPoolSelect");
        var pool = poolEl ? poolEl.value : "all";
        if (socket) {
            socket.emit("auction:start", { pool: pool });
        } else {
            auctionStartTime = Date.now();
            auctionState.queue = buildQueue(pool); auctionState.currentIndex = -1; auctionState.status = "live";
            updateStatusBadge("live"); showAuctionButtons("live"); persist(); nextPlayer();
        }
        // toast removed here to prevent double-toast for admin (handled by auction:started listener)
    }

    navTo("auction");
    _priorityNews.push({ text: "\ud83d\ude80  GCL AUCTION 2026: BATTLE FOR GLORY BEGINS!  \u2022  Ready Purses!", type: "alert" });
    if (teams.length > 0) {
        _priorityNews.push({ text: "\ud83c\udfdf\ufe0f  PARTICIPATING TEAMS: " + teams.map(function (t) { return t.name; }).join(" | "), type: "info" });
    }
    updateNewsTicker();
}
function openSwitchPool() {
    if (!currentUser || currentUser.role !== "admin") return;
    openModal("modalSwitchPool");
}
function confirmSwitchPool() {
    var sel = document.getElementById("switchPoolSelect");
    var pool = sel ? sel.value : "all";
    closeModal("modalSwitchPool");
    if (socket) {
        socket.emit("auction:switch_pool", { pool: pool });
    } else {
        auctionState.queue = buildQueue(pool);
        auctionState.currentIndex = -1;
        nextPlayer();
    }
    toast("\ud83d\udd00 Switching to pool: " + pool, "info", 3000, true);
}
function nextPlayer() {
    if (socket) {
        // If we are already awaiting_next, trigger next normal player
        // Otherwise this might be a manual next skip (not used much but supported)
        socket.emit("auction:next");
    } else {
        // Offline Fallback
        auctionState.currentIndex++;
        if (auctionState.currentIndex >= auctionState.queue.length) { endAuction(); return; }

        var qItem = auctionState.queue[auctionState.currentIndex];
        var pid = (typeof qItem === 'object' && qItem !== null) ? qItem.id : qItem;
        var p = players.find(function (x) { return x.id === pid; });

        if (!p || p.sold || p.isUnsold) { nextPlayer(); return; }
        auctionState.currentBid = p.basePrice; auctionState.currentBidTeam = null; auctionState.bids = [];
        auctionState.timerRemaining = settings.timerDuration;
        renderCurrentPlayer(p); startTimer();
    }
}
function renderCurrentPlayer(p) {
    hideGoingOverlay();
    document.getElementById("emptyAuction").classList.add("hidden");
    var stage = document.getElementById("auctionStage"); stage.classList.remove("hidden");

    var infoDiv = document.getElementById("playerSpotlight").querySelector(".player-auction-info");
    var ratingsDiv = document.getElementById("auctionRatings");

    // Special format for All-Rounder and Custom on auction stage
    if (p.category === "All-Rounder" || p.category === "Custom") {
        infoDiv.classList.add("allrounder-format");
        ratingsDiv.style.display = "none"; // Hide separate ratings div

        // Name with glow and letter spacing
        var nameEl = document.getElementById("auctionPlayerName");
        nameEl.textContent = p.name;
        nameEl.classList.add("name-glow");
        nameEl.style.letterSpacing = "4px";
        nameEl.style.textShadow = "0 0 10px rgba(0,255,255,0.6), 0 0 20px rgba(0,255,255,0.3)";

        // Show nationality as text below the player name (no flag badge)
        var infoCenterEl = document.querySelector(".player-info-center");
        if (infoCenterEl) infoCenterEl.style.position = "relative";
        document.getElementById("auctionCountry").textContent = p.nationality || "";
        document.getElementById("auctionCountry").classList.remove("country-new");

        // Category and Base
        document.getElementById("catBadgeEl").textContent = displayCategory(p.category);
        document.getElementById("auctionBasePrice").textContent = fmtPrice(p.basePrice);

        // Custom details row with batting on left, rating center, bowling on right
        var detailsRow = document.getElementById("playerDetailsRow");
        detailsRow.innerHTML = ''; // Clear first

        // Left side - BAT
        var leftDiv = document.createElement('div');
        leftDiv.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;flex:1 1 0%;text-align:center;min-height:100px';
        leftDiv.innerHTML = '<span style="font-size:0.6rem;color:var(--text3);font-weight:600;letter-spacing:1px">BAT</span>';
        if (p.batHand === "Right Handed" || p.batHand === "Left Handed") {
            leftDiv.innerHTML += '<span class="batting-hand" style="margin:0">' + (p.batHand === "Right Handed" ? "RHB" : "LHB") + '</span>';
        }
        if (p.batStyle) {
            leftDiv.innerHTML += '<span class="batting-archetype" style="text-shadow:0 0 8px rgba(0,255,255,0.5);margin:0">' + p.batStyle.toUpperCase() + '</span>';
        }
        detailsRow.appendChild(leftDiv);

        // Center - Rating (Circular display)
        var centerDiv = document.createElement('div');
        centerDiv.style.cssText = 'display:flex;align-items:center;justify-content:center;flex:1 1 0%;min-height:100px';
        var rStyle = getRatingStyleObj(p.overall);
        var ratingDisplay = '<div style="width:80px;height:80px;border-radius:50%;border:3px solid rgba(' + rStyle.glow + ',0.6);box-shadow:0 0 30px rgba(' + rStyle.glow + ',0.5), inset 0 0 20px rgba(' + rStyle.glow + ',0.2);display:flex;flex-direction:column;align-items:center;justify-content:center;margin:0 auto;background-color:rgba(' + rStyle.glow + ',0.05)">';
        ratingDisplay += '<div style="font-size:1.8rem;font-weight:800;color:' + rStyle.color + ';text-shadow:0 0 20px rgba(' + rStyle.glow + ',0.8)">' + (p.overall || '—') + '</div>';
        ratingDisplay += '<div style="font-size:0.5rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px">Overall</div>';
        ratingDisplay += '</div>';
        centerDiv.innerHTML = ratingDisplay;
        detailsRow.appendChild(centerDiv);

        // Right side - BWL
        var rightDiv = document.createElement('div');
        rightDiv.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;flex:1 1 0%;text-align:center;min-height:100px';
        rightDiv.innerHTML = '<span style="font-size:0.6rem;color:var(--text3);font-weight:600;letter-spacing:1px">BWL</span>';

        // Show bowlType, fallback to bowlHand
        var bType = p.bowlType || (p.bowlHand === "Right Arm" ? "RFM" : p.bowlHand === "Left Arm" ? "LFM" : "");
        if (bType) {
            rightDiv.innerHTML += '<span style="font-size:0.7rem;color:var(--text3)">' + bType + '</span>';
        }

        if (p.bowlStyle) {
            rightDiv.innerHTML += '<span class="bowling-archetype" style="text-shadow:0 0 8px rgba(255,165,0,0.5)">' + p.bowlStyle.toUpperCase() + '</span>';
        }
        detailsRow.appendChild(rightDiv);

        detailsRow.style.display = "flex";
        detailsRow.style.justifyContent = "center";
        detailsRow.style.alignItems = "stretch";
        detailsRow.style.flexWrap = "nowrap";
        detailsRow.style.gap = "20px";

    } else {
        infoDiv.classList.remove("allrounder-format");
        ratingsDiv.style.display = "block"; // Show separate ratings div

        // Normal format with glow and letter spacing
        var nameEl = document.getElementById("auctionPlayerName");
        nameEl.textContent = p.name;
        nameEl.classList.remove("name-glow");
        nameEl.style.letterSpacing = "4px";
        nameEl.style.textShadow = "0 0 10px rgba(0,255,255,0.6), 0 0 20px rgba(0,255,255,0.3)";
        document.getElementById("auctionCountry").textContent = p.nationality || "";
        document.getElementById("auctionCountry").classList.remove("country-new");
        document.getElementById("catBadgeEl").textContent = displayCategory(p.category);
        document.getElementById("auctionBasePrice").textContent = fmtPrice(p.basePrice);

        // Reset details row to original
        var detailsRow = document.getElementById("playerDetailsRow");
        var batHand = "";
        // Show batHand for Batsman, Wicketkeeper, All-Rounder, Custom AND Bowler
        if (p.category === "Batsman" || p.category === "Wicketkeeper" || p.category === "All-Rounder" || p.category === "Custom" || p.category === "Bowler") {
            if (p.batHand === "Right Handed") batHand = "RHB";
            else if (p.batHand === "Left Handed") batHand = "LHB";
        }
        var bowlHand = "";
        // Show bowlHand for Bowler, All-Rounder, Custom
        if (p.category === "Bowler" || p.category === "All-Rounder" || p.category === "Custom") {
            bowlHand = p.bowlType || p.bowlHand || "";
        }
        var battingArch = "";
        if (p.category === "Batsman" || p.category === "Wicketkeeper" || p.category === "All-Rounder" || p.category === "Custom") {
            if (p.batStyle) battingArch = p.batStyle.toUpperCase();
        }
        var bowlingArch = "";
        if (p.category === "Bowler" || p.category === "All-Rounder" || p.category === "Custom") {
            if (p.bowlStyle) bowlingArch = p.bowlStyle.toUpperCase();
        }

        detailsRow.innerHTML =
            (batHand ? '<span class="batting-hand" id="battingHandDisplay">' + batHand + '</span>' : '<span class="batting-hand hidden" id="battingHandDisplay"></span>') +
            (bowlHand ? '<span class="bowling-hand" id="bowlingHandDisplay" style="font-size:0.7rem;color:var(--text2);font-weight:600">' + bowlHand + '</span>' : '<span class="bowling-hand hidden" id="bowlingHandDisplay"></span>') +
            (battingArch ? '<span class="batting-archetype" id="battingArchetypeDisplay">' + battingArch + '</span>' : '<span class="batting-archetype hidden" id="battingArchetypeDisplay"></span>') +
            (bowlingArch ? '<span class="bowling-archetype" id="bowlingArchetypeDisplay">' + bowlingArch + '</span>' : '<span class="bowling-archetype hidden" id="bowlingArchetypeDisplay"></span>');
        detailsRow.style.display = "flex";
        detailsRow.style.justifyContent = "center";
        detailsRow.style.alignItems = "center";
        detailsRow.style.gap = "10px";
        detailsRow.style.border = "none";
        detailsRow.style.margin = "0 0 12px 0";
        detailsRow.style.padding = "0";
    }

    var img = document.getElementById("auctionPlayerImg");
    var imgSrc = getEffectivePlayerImage(p) || DEFAULT_PLAYER_SILHOUETTE;
    var finalImgSrc = imgSrc;
    if (imgSrc && !imgSrc.startsWith("data:")) {
        finalImgSrc = imgSrc + (imgSrc.includes('?') ? '&' : '?') + 't=' + Date.now();
    }
    img.onerror = null;
    var stageFallback = getCategoryDefaultLogo(p.category);
    if (stageFallback) {
        img.onerror = function () { this.onerror = null; this.src = stageFallback; };
    }
    img.src = finalImgSrc;
    img.style.opacity = stageFallback ? "0.3" : "1";
    img.style.transition = "opacity .25s ease";
    var mBadge = document.getElementById("marqueeBadge");
    if (p.marquee) { mBadge.classList.remove("hidden"); stage.classList.add("spotlight-anim"); }
    else { mBadge.classList.add("hidden"); stage.classList.remove("spotlight-anim"); }
    // Form badge
    var fbEl = document.getElementById("auctionFormBadge");
    if (fbEl) fbEl.classList.add("hidden");

    // Overall rating - for non All-Rounder with circle glow
    if (p.category !== "All-Rounder" && p.category !== "Custom") {
        var ratEl = document.getElementById("ratBat");
        var rStyle = getRatingStyleObj(p.overall);
        ratEl.textContent = p.overall || "—";
        ratEl.style.display = "inline-flex";
        ratEl.style.alignItems = "center";
        ratEl.style.justifyContent = "center";
        ratEl.style.width = "80px";
        ratEl.style.height = "80px";
        ratEl.style.borderRadius = "50%";
        ratEl.style.border = "3px solid rgba(" + rStyle.glow + ",0.6)";
        ratEl.style.fontSize = "2rem";
        ratEl.style.fontWeight = "800";
        ratEl.style.color = rStyle.color;
        ratEl.style.textShadow = "0 0 20px rgba(" + rStyle.glow + ",0.8)";
        ratEl.style.boxShadow = "0 0 30px rgba(" + rStyle.glow + ",0.5), inset 0 0 20px rgba(" + rStyle.glow + ",0.2)";
        ratEl.style.backgroundColor = "rgba(" + rStyle.glow + ",0.05)";
    }

    // Watchlist alert for team user
    var wlAlert = document.getElementById("watchlistAlert");
    if (currentUser && currentUser.role === "team" && getWatchlist().has(p.id)) { wlAlert.classList.remove("hidden"); setTimeout(function () { wlAlert.classList.add("hidden"); }, 3000); }
    else wlAlert.classList.add("hidden");
    document.getElementById("soldBanner").classList.add("hidden");
    document.getElementById("unsoldBanner").classList.add("hidden");
    var npb = document.getElementById("nextPlayerBanner"); if (npb) npb.classList.add("hidden");
    updateBidUI();
    updateQueue();
    checkPurseWarning();
    // Update Next Player UI dynamically resolving queue item object wrapper
    var nextQItem = auctionState.queue[auctionState.currentIndex + 1];
    var nextPid = (typeof nextQItem === 'object' && nextQItem !== null) ? nextQItem.id : nextQItem;
    var npB = nextPid ? players.find(x => x.id === nextPid) : null;
    var nextPreview = document.getElementById("nextPlayerPreview");
    if (npB && nextPreview) {
        nextPreview.querySelector(".small-label").textContent = (npB.isReAuction) ? "NEXT (UNSOLD CAT):" : "NEXT:";
        nextPreview.querySelector(".small-label").style.color = (npB.isReAuction) ? "var(--warning)" : "var(--text3)";
        document.getElementById("nextPlayerName").textContent = npB.name;
    }

    var bidderListEl = document.getElementById("bidderList");
    if (bidderListEl) {
        bidderListEl.style.pointerEvents = "auto";
        bidderListEl.style.opacity = "1";
    }
    document.getElementById("livePlayerName").textContent = p.name;
    document.getElementById("livePlayerCat").textContent = p.category;
    document.getElementById("liveBasePrice").textContent = fmtPrice(p.basePrice);
    document.getElementById("livePlayerImg").src = img.src;
    document.getElementById("livePlayerImg").style.opacity = stageFallback ? "0.3" : "1";
    var liveRatBatEl = document.getElementById("liveRatBat");
    var lrStyle = getRatingStyleObj(p.overall);
    liveRatBatEl.textContent = p.overall || "—";
    liveRatBatEl.style.color = lrStyle.color;
    liveRatBatEl.style.textShadow = "0 0 10px rgba(" + lrStyle.glow + ", 0.8)";
    if (p.marquee) document.getElementById("liveMarqueeBadge").classList.remove("hidden");
    else document.getElementById("liveMarqueeBadge").classList.add("hidden");

    // NEW AI POOL ANNOUNCEMENT LOGIC (Intercepting render)
    if (aiModeActive && aiPool === "autonomous" && socket) {
        var currentQItem = auctionState.queue[auctionState.currentIndex];
        var currentCategoryCode = (typeof currentQItem === 'object' && currentQItem !== null) ? currentQItem.aiPoolName : p.category;

        // Count how many of this SAME `aiPoolName` are left sequentially in the queue ahead
        var playersLeftInCurrentPool = 0;
        var nextValidPool = "Unsold Players (Final Phase)";

        for (var idx = auctionState.currentIndex; idx < auctionState.queue.length; idx++) {
            var qItem = auctionState.queue[idx];
            var qCat = (typeof qItem === 'object' && qItem !== null) ? qItem.aiPoolName : "";
            if (qCat === currentCategoryCode) {
                playersLeftInCurrentPool++;
            } else {
                nextValidPool = qCat;
                break;
            }
        }

        // Trigger cinematic announcement exactly when 10 players remain in the active pool string block
        if (playersLeftInCurrentPool === 10) {
            triggerAiAnnouncement(currentCategoryCode, nextValidPool);
        }
    }

    document.querySelectorAll(".player-card").forEach(function (el) { el.classList.remove("current"); });
    var el = document.getElementById("pc-" + p.id); if (el) el.classList.add("current");
    // Feature 7: Spotlight flip animation
    var spotlight = document.getElementById("playerSpotlight");
    spotlight.classList.remove("spotlight-flip");
    spotlight.offsetHeight; // reflow
    spotlight.classList.add("spotlight-flip");
    rivalryShownFor = null; // reset per player

    // FIX: Unconditionally assert the live state directly to the DOM when rendering a player!
    if (auctionState.status === "live" || auctionState.status === "awaiting_next") {
        if (typeof updateStatusBadge === "function") updateStatusBadge(auctionState.status);
        if (typeof showAuctionButtons === "function") showAuctionButtons(auctionState.status);
    }
}
function startTimer() {
    if (socket) return; // If connected to server, let the server's master timer drive the countdown
    clearInterval(timerInterval);
    timerInterval = setInterval(tickTimer, 1000);
    renderTimer(auctionState.timerRemaining, settings.timerDuration);
}
function tickTimer() {
    if (auctionState.status !== "live") return;
    if (!currentUser || currentUser.role !== "admin") return; // STOP non-admins from running the interval

    // Sync bids placed by team users in other tabs
    var saved = load(AUCTION_KEY, null);
    if (saved && saved.currentBid > auctionState.currentBid) {
        auctionState.currentBid = saved.currentBid;
        auctionState.currentBidTeam = saved.currentBidTeam;
        auctionState.bids = saved.bids;
        auctionState.timerRemaining = saved.timerRemaining;
        updateBidUI();
    }
    auctionState.timerRemaining--;

    renderTimer(auctionState.timerRemaining, settings.timerDuration);
    save(AUCTION_KEY, auctionState);
    if (auctionState.timerRemaining <= 0) { clearInterval(timerInterval); resolvePlayer(); }
}
function renderTimer(secs, total) {
    var s = Math.max(0, secs);

    var timerEl = document.getElementById("timerCount");
    var timerLabel = document.querySelector(".timer-label");

    // Show number in timer (or empty when 0)
    timerEl.textContent = s === 0 ? "" : s;
    timerEl.classList.remove("going-once", "going-twice", "last-call");

    // Show SEC label only when timer is showing number
    if (timerLabel) {
        timerLabel.style.visibility = s === 0 ? "hidden" : "visible";
    }

    document.getElementById("liveTimer").textContent = s === 0 ? "" : s;
    
    // Update navbar LED timer
    var ledTimerDisplay = document.getElementById("ledTimerDisplay");
    var navbarLedTimer = document.getElementById("navbarLedTimer");
    if (ledTimerDisplay) {
        ledTimerDisplay.textContent = s < 10 ? "0" + s : s;
    }
    // Hide LED timer when countdown ends (but not if paused)
    if (navbarLedTimer && s === 0 && auctionState.status !== "paused") {
        navbarLedTimer.classList.remove("active");
    }
    var circ = 2 * Math.PI * 50, pct = s / Math.max(1, total);

    var ring = document.getElementById("ringProgress");
    ring.style.strokeDashoffset = circ * (1 - pct);
    var urgent = s <= settings.threshold && s > 0;
    ring.classList.toggle("urgent", urgent);
    timerEl.style.color = "";

    // Show Going Once / Twice / Last Call in separate indicator
    if (auctionState.status === "live") {
        if (s <= 6 && s > 0) {
            showGoingOverlay("LAST CALL!", "final");
            playBeep(1200, 100);
        } else if (s <= 12 && s > 6) {
            showGoingOverlay("GOING TWICE...", "twice");
            playBeep(880, 150);
        } else if (s <= 18 && s > 12) {
            showGoingOverlay("GOING ONCE...", "once");
            playBeep(660, 200);
        } else {
            hideGoingOverlay();
        }
    } else {
        hideGoingOverlay();
    }
}
function showGoingOverlay(text, stage) {
    // Single compact pill for everyone (admin, bidders, spectators) — no full-screen overlay
    var miniEl = document.getElementById("miniGoingIndicator");
    var miniT = document.getElementById("miniGoingText");
    if (miniEl && miniT) {
        miniT.textContent = text;
        miniEl.classList.remove("hidden", "once", "twice", "final");
        if (stage) miniEl.classList.add(stage);
        if (miniT.dataset.lastText !== text) {
            miniEl.style.animation = "none"; miniEl.offsetHeight; miniEl.style.animation = "";
            miniT.dataset.lastText = text;
        }
    }
}
function hideGoingOverlay() {
    var el = document.getElementById("goingOverlay");
    if (el) { el.classList.add("hidden"); el.classList.remove("once", "twice", "final"); }
    var miniEl = document.getElementById("miniGoingIndicator");
    if (miniEl) {
        miniEl.classList.add("hidden");
        miniEl.classList.remove("once", "twice", "final");
    }
}

function showCinematicStatus(title, playerName, teamName, price) {
    var strip = document.getElementById("statusStripBelowPhoto");
    var stripTitle = document.getElementById("statusStripTitle");
    var stripSub = document.getElementById("statusStripSub");
    if (!strip || !stripTitle || !stripSub) return;

    stripTitle.textContent = title;
    var isSold = (title === "SOLD!" && (teamName || (price != null && price !== undefined)));
    if (isSold) {
        stripSub.textContent = (playerName || "Player") + " → " + (teamName || "Team") + " for " + fmtPrice(price != null ? price : 0);
        strip.className = "status-strip-below-photo status-strip-visible status-strip-sold";
    } else {
        stripSub.textContent = (playerName || "Player") + " — No bidders";
        strip.className = "status-strip-below-photo status-strip-visible status-strip-unsold";
    }
    strip.classList.remove("hidden");

    setTimeout(function () {
        strip.classList.remove("status-strip-visible");
        setTimeout(function () { strip.classList.add("hidden"); }, 400);
    }, 5000);
}

function showStampOnSpotlight(type) {
    var soldB = document.getElementById("soldBanner");
    var unsoldB = document.getElementById("unsoldBanner");

    if (type === "sold" && soldB) {
        if (unsoldB) unsoldB.classList.add("hidden");
        soldB.classList.remove("hidden");
        soldB.classList.add("stamp-hit");
        setTimeout(function () { soldB.classList.remove("stamp-hit"); }, 800);
        setTimeout(function () { soldB.classList.add("hidden"); }, 2300);
    } else if (type === "unsold" && unsoldB) {
        if (soldB) soldB.classList.add("hidden");
        unsoldB.classList.remove("hidden");
        unsoldB.classList.add("stamp-hit");
        setTimeout(function () { unsoldB.classList.remove("stamp-hit"); }, 800);
        setTimeout(function () { unsoldB.classList.add("hidden"); }, 2300);
    }
}

function playSoldSound() {
    if (!masterVolume || masterVolume <= 0) return;
    playSound("https://www.soundjay.com/human/applause-01.mp3");
    setTimeout(function () {
        if (masterVolume <= 0) return;
        playBeep(523, 80); setTimeout(function () { playBeep(659, 80); }, 90);
        setTimeout(function () { playBeep(784, 120); }, 180);
        setTimeout(function () { playBeep(1047, 200); }, 300);
    }, 100);
}

function playUnsoldSound() {
    if (!masterVolume || masterVolume <= 0) return;
    playSound("https://actions.google.com/sounds/v1/human_voices/human_crowd_aww.ogg");
    setTimeout(function () {
        if (masterVolume <= 0) return;
        playBeep(400, 250); setTimeout(function () { playBeep(330, 300); }, 260);
        setTimeout(function () { playBeep(260, 350); }, 570);
    }, 100);
}
function launchConfetti() {
    var canvas = document.getElementById("confettiCanvas");
    if (!canvas) return;
    canvas.classList.remove("hidden");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    var ctx = canvas.getContext("2d");
    var colors = ["#ff6a00", "#ffd700", "#00d4a8", "#ff4757", "#4ecdc4", "#a569dc", "#ffffff", "#ffeb3b", "#e040fb", "#00bcd4"];
    var pieces = [];
    for (var i = 0; i < 220; i++) {
        pieces.push({
            x: Math.random() * canvas.width,
            y: -30 - Math.random() * 250,
            w: 6 + Math.random() * 10,
            h: 4 + Math.random() * 6,
            color: colors[Math.floor(Math.random() * colors.length)],
            v: 4 + Math.random() * 6,
            vx: -2.5 + Math.random() * 5,
            rot: Math.random() * 360,
            rotV: -4 + Math.random() * 8,
            gravity: 0.08 + Math.random() * 0.06
        });
    }
    var start = Date.now();
    var dur = 3200;
    function frame() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        pieces.forEach(function (p) {
            p.v += p.gravity;
            p.y += p.v;
            p.x += p.vx;
            p.rot += p.rotV;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot * Math.PI / 180);
            var g = ctx.createLinearGradient(-p.w / 2, -p.h / 2, p.w / 2, p.h / 2);
            g.addColorStop(0, p.color);
            g.addColorStop(0.5, p.color);
            g.addColorStop(1, "rgba(255,255,255,0.4)");
            ctx.fillStyle = g;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = "rgba(255,255,255,0.6)";
            ctx.lineWidth = 0.5;
            ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        });
        if (Date.now() - start < dur) requestAnimationFrame(frame);
        else {
            canvas.classList.add("hidden");
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }
    requestAnimationFrame(frame);
}
// Feature 3: Live Bid Flash notification
var bidFlashTimeout = null;
function showBidFlash(teamName, amount) {
    var old = document.getElementById("bidFlashEl"); if (old) old.remove();
    var el = document.createElement("div"); el.id = "bidFlashEl"; el.className = "bid-flash";
    el.innerHTML = "<div><div class=\"bid-flash-label\">NEW BID</div><div class=\"bid-flash-team\">" + teamName + "</div></div><div class=\"bid-flash-amount\">" + amount + "</div>";
    document.body.appendChild(el);
    clearTimeout(bidFlashTimeout);
    bidFlashTimeout = setTimeout(function () { if (el.parentNode) el.remove(); }, 2200);
}
// Feature 12: Purse Risk Warning
function checkPurseWarning() {
    // Purse warning feature removed for bidders — no-op kept for compatibility with existing calls.
    return;
}

// Feature 5: Rivalry Tracker
var rivalryShownFor = null;
function checkRivalry(bids) {
    if (bids.length < 6) return;
    var last6 = bids.slice(-6);
    var t1 = last6[0].teamId, t2 = last6[1].teamId;
    if (!t1 || !t2 || t1 === t2) return;
    var isRivalry = last6.every(function (b, i) { return i % 2 === 0 ? b.teamId === t1 : b.teamId === t2; });
    var key = [t1, t2].sort().join("_");
    if (isRivalry && rivalryShownFor !== key) {
        rivalryShownFor = key;
        var n1 = teamName(t1), n2 = teamName(t2);
        var el = document.createElement("div"); el.className = "rivalry-toast";
        el.innerHTML = '<span class="rivalry-emoji">💀</span>' +
            '<div class="rivalry-content">' +
            '<div class="rivalry-title">HEATED RIVALRY!</div>' +
            '<div class="rivalry-sub">' + n1 + ' VS ' + n2 + '</div>' +
            '</div>';
        document.body.appendChild(el);
        setTimeout(function () { if (el.parentNode) el.remove(); }, 3000);
        playBeep(220, 150); setTimeout(function () { playBeep(280, 150); }, 160);
    }
}
// Feature 6: Speed Stats helper
var auctionStartTime = null;
function getSpeedStats() {
    var sold = auctionHistory.filter(function (h) { return h.status === "sold"; });
    var elapsed = auctionStartTime ? Math.max(1, Math.floor((Date.now() - auctionStartTime) / 60000)) : 0;
    var ppm = elapsed > 0 ? (auctionHistory.length / elapsed).toFixed(1) : "--";
    var times = auctionHistory.filter(function (h) { return h.duration; }).map(function (h) { return h.duration; });
    var avgTime = times.length ? Math.round(times.reduce(function (a, b) { return a + b; }, 0) / times.length) : "--";
    var fastest = auctionHistory.filter(function (h) { return h.status === "sold" && h.duration; }).sort(function (a, b) { return a.duration - b.duration; })[0];
    return { ppm: ppm, elapsed: elapsed, avgTime: avgTime, fastest: fastest };
}

function quickSellPlayer() {
    if (!currentUser || currentUser.role !== "admin" || auctionState.status !== "live") return;
    if (socket) { socket.emit("admin:forcesell"); return; }
}

function quickSkipPlayer() {
    if (!currentUser || currentUser.role !== "admin" || auctionState.status !== "live") return;
    if (socket) { socket.emit("admin:forceskip"); return; }
}

function pauseAuction() {
    if (!currentUser || currentUser.role !== "admin") return;
    if (auctionState.status !== "live" && auctionState.status !== "awaiting_next") return;
    if (socket) { socket.emit("auction:pause"); return; }

    auctionState.status = "paused"; clearInterval(timerInterval); persist(); updateStatusBadge("paused"); showAuctionButtons("paused"); restoreAuction(); toast("Paused.", "warning");
}
function resumeAuction() {
    if (!currentUser || currentUser.role !== "admin" || auctionState.status !== "paused") return;
    if (socket) { socket.emit("auction:resume"); return; }

    auctionState.status = "live"; persist(); updateStatusBadge("live"); showAuctionButtons("live"); startTimer(); restoreAuction(); toast("Resumed.", "success");
}
function showAuctionButtons(status) {
    // Reset all to hidden safely
    ["btnStartAuction", "btnPauseAuction", "btnResumeAuction", "btnEndAuctionManual", "quickActions", "btnSwitchPool"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add("hidden");
    });

    if (!currentUser || currentUser.role !== "admin") return;

    // During AI Intro or Pool Transition, show basic controls for Admin
    if (status === "ai_intro" || status === "pool_transition" || status === "manual_intro" || status === "pool_transition_manual") {
        safeGet("btnPauseAuction").classList.remove("hidden");
        safeGet("btnEndAuctionManual").classList.remove("hidden");
        return;
    }

    if (status === "idle" || status === "ended") {
        const startBtn = safeGet("btnStartAuction");
        startBtn.classList.remove("hidden");
        startBtn.textContent = "▶ Start Auction";
    }
    if (status === "live" || status === "awaiting_next") {
        safeGet("btnPauseAuction").classList.remove("hidden");
        safeGet("btnEndAuctionManual").classList.remove("hidden");
        if (status === "live") {
            safeGet("quickActions").classList.remove("hidden");
        }
        // Show Switch Pool only in manual mode
        const switchBtn = document.getElementById("btnSwitchPool");
        if (!aiModeActive && switchBtn) switchBtn.classList.remove("hidden");
    }
    if (status === "paused") {
        const resumeBtn = safeGet("btnResumeAuction");
        resumeBtn.classList.remove("hidden");
        if (aiModeActive) {
            resumeBtn.textContent = "\u25b6 Resume AI";
        } else {
            resumeBtn.textContent = "\u25b6 Resume";
        }
        safeGet("btnEndAuctionManual").classList.remove("hidden");
        const switchBtn = document.getElementById("btnSwitchPool");
        if (!aiModeActive && switchBtn) switchBtn.classList.remove("hidden");
    }
}
function placeBid() {
    if (auctionState.status !== "live") { toast("Auction not live.", "warning"); return; }
    if (currentUser.role !== "team") return;
    var tid = currentUser.teamId;
    var t = teams.find(function (x) { return x.id == tid || x.username === currentUser.username; }); if (!t) { toast("Team error", "error"); return; }
    var squad = players.filter(function (p) { return p.soldTo === tid; }).length;
    var max = t.maxSquad || MAX_SQUAD;
    if (squad >= max) { toast("Squad is full!", "error"); return; }

    var currentAmt = parseFloat(auctionState.currentBid) || 0;
    var inc = parseFloat(bidIncrement(currentAmt)) || 0;
    var newBid = currentAmt + inc;

    var pPurse = parseFloat(t.purse) || 0;
    if (pPurse < newBid) { toast("Insufficient purse!", "error"); return; }
    if (auctionState.currentBidTeam === tid && auctionState.bids.length > 0) { toast("You are already highest bidder!", "warning"); return; }

    // Emit bid to server for real-time broadcast
    if (socket) {
        socket.emit("bid:place", { teamId: tid });
        playBeep(880, 100); // Immediate feedback
    } else {
        toast("Connection error. Try refreshing.", "error");
    }
}
function updateBidUI() {
    var b = auctionState.currentBid, inc = bidIncrement(b);
    safeSetText("currentBidAmount", fmtPrice(b));
    safeSetText("nextIncrement", "+" + fmtPrice(inc));
    safeSetText("nextBidAmount", fmtPrice(b + inc));
    var bidTeamName = auctionState.currentBidTeam ? teamName(auctionState.currentBidTeam) : "No bids yet";
    safeSetText("currentBidTeam", bidTeamName);
    safeSetText("liveBidAmount", fmtPrice(b));
    safeSetText("liveBidTeam", bidTeamName);
    var bl = document.getElementById("bidderList");
    var bids = auctionState.bids.slice().reverse().slice(0, 8);
    if (bl) {
        bl.innerHTML = bids.length ? bids.map(function (bd, i) {
            var cls = "bidder-item" + (i === 0 ? " leading" : "") + (i === 0 ? " new-bid" : "");
            return "<div class=\"" + cls + "\"><span class=\"bidder-team-name\">" + bd.teamName + "</span><span class=\"bidder-amount\">" + fmtPrice(bd.amount) + "</span></div>";
        }).join("") : "<p class=\"empty-text\">No bids yet</p>";
    }
    document.querySelectorAll(".team-card").forEach(function (el) { el.classList.remove("highest-bidder"); });
    if (auctionState.currentBidTeam) { var tc = document.getElementById("tc-" + auctionState.currentBidTeam); if (tc) tc.classList.add("highest-bidder"); }


    if (currentUser && currentUser.role === "team") {
        // Use loose equality == to handle string/number type mismatch for teamId
        var t = teams.find(function (x) { return x.id == currentUser.teamId || x.username === currentUser.username; });
        var bid = document.getElementById("btnPlaceBid");
        var msg = document.getElementById("bidDisabledMsg");
        if (!bid || !msg) return;

        var sq = players.filter(function (p) { return p.soldTo == currentUser.teamId; }).length;
        var maxSq = t ? (t.maxSquad || MAX_SQUAD) : MAX_SQUAD;
        var pPurse = t ? parseFloat(t.purse) || 0 : 0;
        var nextBidAmt = parseFloat(b) + parseFloat(bidIncrement(b));

        var isLive = (auctionState.status === "live");
        var canBid = isLive && t && pPurse >= nextBidAmt && sq < maxSq;

        bid.disabled = !canBid;
        msg.classList.toggle("hidden", canBid);

        if (!canBid) {
            if (!isLive) {
                if (auctionState.status === "paused") msg.textContent = "Auction is paused";
                else if (auctionState.status === "pool_transition" || auctionState.status === "pool_transition_manual") msg.textContent = "New pool starting...";
                else msg.textContent = "Auction not live";
            }
            else if (!t || pPurse < nextBidAmt) msg.textContent = "Insufficient purse";
            else msg.textContent = "Squad is full";
        }
    }
}
function updateQueue() {
    var total = auctionState.queue.length, current = auctionState.currentIndex + 1;
    document.getElementById("queueCurrent").textContent = current;
    document.getElementById("queueTotal").textContent = total;
    document.getElementById("queueBar").style.width = Math.round((current / Math.max(1, total)) * 100) + "%";

    var nextQItem = auctionState.queue[auctionState.currentIndex + 1];
    var nextPid = (typeof nextQItem === 'object' && nextQItem !== null) ? nextQItem.id : nextQItem;
    var np = nextPid ? players.find(function (p) { return p.id === nextPid; }) : null;
    document.getElementById("nextPlayerName").textContent = np ? np.name : "--";
}
function highlightTeam(tid) { document.querySelectorAll(".team-card").forEach(function (el) { el.classList.remove("highest-bidder"); }); var tc = document.getElementById("tc-" + tid); if (tc) tc.classList.add("highest-bidder"); }
function resolvePlayer() {
    // Always read the very latest state from localStorage before resolving
    var latest = load(AUCTION_KEY, null);
    if (latest) {
        auctionState.currentBid = latest.currentBid;
        auctionState.currentBidTeam = latest.currentBidTeam;
        auctionState.bids = latest.bids;
    }
    // Handle both plain id and {id, aiPoolName} object queue items
    var qItem = auctionState.queue[auctionState.currentIndex];
    var pid = (typeof qItem === 'object' && qItem !== null) ? qItem.id : qItem;
    var p = players.find(function (x) { return x.id === pid; });
    // DEDUPLICATION GUARD: Exit if player already handled
    if (!p || p.sold || p.isUnsold) { nextPlayer(); return; }

    if (auctionState.currentBidTeam) sellPlayer(p, auctionState.currentBidTeam, auctionState.currentBid);
    else markUnsold(p);
}

window.quickSellPlayer = function () {
    if (!currentUser || currentUser.role !== "admin") return;
    if (!auctionState.currentBidTeam) {
        toast("Cannot Quick Sell: No bids placed yet!", "error");
        return;
    }
    // Delegate entirely to the server — it will emit player:sold and advance the queue
    if (socket) {
        socket.emit("admin:forcesell");
    } else {
        clearInterval(timerInterval);
        resolvePlayer();
    }
};

window.quickSkipPlayer = function () {
    if (!currentUser || currentUser.role !== "admin") return;
    // Delegate entirely to the server — it will emit player:unsold and advance the queue
    if (socket) {
        socket.emit("admin:forceskip");
    } else {
        clearInterval(timerInterval);
        var pid = auctionState.queue[auctionState.currentIndex];
        var p = players.find(function (x) { return x.id === pid; });
        if (p) markUnsold(p);
    }
};
function sellPlayer(p, teamId, price) {
    if (!p || p.sold || p.isUnsold) return; // Prevention guard
    try {
        var t = teams.find(function (x) { return x.id === teamId; }); if (!t) return;
        t.purse -= price; p.sold = true; p.isUnsold = false; p.soldTo = teamId; p.soldPrice = price;
        auctionHistory.push({ playerId: p.id, playerName: p.name, category: p.category, teamId: teamId, teamName: t.name, price: price, status: "sold", ts: Date.now(), bidHistory: auctionState.bids.slice() });
        persist(); hideGoingOverlay();
        showStampOnSpotlight("sold");
        launchConfetti();
        playSoldSound();
        if (socket && currentUser && currentUser.role === "admin") socket.emit("admin:uisold");
        toast(p.name + " SOLD to " + t.name + " for " + fmtPrice(price) + "!", "success", 4000);
        renderTeams(); renderPurseTable(); renderHistory(); updatePlayerStats();


        // FEATURE 22: DEEP STRATEGIC ANALYSIS
        setTimeout(function () {
            checkStrategicMilestones(teamId, p);
        }, 1500); // Small delay after banter/confetti

    } catch (err) { console.error("sellPlayer logic failed", err); }

    // FORCE SYNC BEFORE ADVANCING SO SERVER DOES NOT LOOP
    if (socket && currentUser && currentUser.role === "admin") {
        socket.emit("players:save", players);
        socket.emit("teams:save", teams);
    }

    aiModeNext();
    sequenceNextPlayerAnnouncement();
}

function sequenceNextPlayerAnnouncement() {
    var nextIdx = auctionState.currentIndex + 1;
    var nextPid = null;
    while (nextIdx < auctionState.queue.length) {
        var p = players.find(function (x) { return x.id === auctionState.queue[nextIdx]; });
        if (p && !p.sold) { nextPid = p.id; break; }
        nextIdx++;
    }

    setTimeout(function () {
        document.getElementById("soldBanner").classList.add("hidden");
        document.getElementById("unsoldBanner").classList.add("hidden");
        if (nextPid) {
            var np = players.find(function (x) { return x.id === nextPid; });
            var npBanner = document.getElementById("nextPlayerBanner");
            var npName = document.getElementById("npBannerName");
            if (npBanner && npName) {
                npName.textContent = np.name;
                npBanner.classList.remove("hidden");
                playBeep(440, 200);
                if (socket && currentUser && currentUser.role === "admin") socket.emit("admin:nextplayer", np.name);
                setTimeout(function () { npBanner.classList.add("hidden"); nextPlayer(); }, 3000);
            } else { nextPlayer(); }
        } else { nextPlayer(); }
    }, 2000);
}
function markUnsold(p) {
    if (!p || p.sold || p.isUnsold) return; // Prevention guard
    try {
        p.sold = false;
        p.isUnsold = true;
        auctionHistory.push({ playerId: p.id, playerName: p.name, category: p.category, teamId: null, teamName: null, price: 0, status: "unsold", ts: Date.now() });
        persist();
        showStampOnSpotlight("unsold");
        playUnsoldSound();
        if (socket && currentUser && currentUser.role === "admin") socket.emit("admin:uiunsold");
        toast(p.name + " went UNSOLD.", "warning", 3000);
        renderHistory(); updatePlayerStats();

        // Feature: Live Unsold List update
        var unsoldCount = players.filter(function (px) { return !px.sold; }).length;
        var ur = document.getElementById("unsoldRound");
        if (unsoldCount > 0 && ur) {
            ur.classList.remove("hidden");
            var ul = document.getElementById("unsoldList");
            if (ul) ul.innerHTML = players.filter(function (px) { return !px.sold; }).map(function (px) { return "<span class=\"unsold-chip\">" + px.name + "</span>"; }).join("");
        }
    } catch (err) { console.error("markUnsold failed", err); }

    // FORCE SYNC BEFORE ADVANCING SO SERVER DOES NOT LOOP
    if (socket && currentUser && currentUser.role === "admin") {
        socket.emit("players:save", players);
    }

    aiModeNext();
    sequenceNextPlayerAnnouncement();
}
function endAuction(isRemote) {
    // if this call originated from a server broadcast allow all users;
    // otherwise only admin may trigger locally
    if (!isRemote && (!currentUser || currentUser.role !== "admin")) return;
    clearInterval(timerInterval);
    auctionState.status = "ended";
    persist();
    hideGoingOverlay();
    updateStatusBadge("ended");
    showAuctionButtons("ended"); // This will show START button for admin
    document.getElementById("auctionStage").classList.add("hidden");
    var ea = document.getElementById("emptyAuction");
    ea.classList.remove("hidden");

    // ENHANCED SUMMARY DASHBOARD
    var breakdown = generateAuctionBreakdown();
    ea.innerHTML = breakdown;

    toast("Auction ended!", "success", 5000);
    var unsoldCount = players.filter(function (p) { return !p.sold; }).length;
    if (unsoldCount > 0 && currentUser.role === "admin") {
        var ur = document.getElementById("unsoldRound");
        if (ur) ur.classList.remove("hidden");
        var ul = document.getElementById("unsoldList");
        if (ul) ul.innerHTML = players.filter(function (p) { return !p.sold; }).map(function (p) { return "<span class=\"unsold-chip\">" + p.name + "</span>"; }).join("");
    }

    // Ensure nav and controls are accessible for admin
    if (currentUser && currentUser.role === "admin") {
        document.getElementById("navLinks").classList.remove("disabled");
        document.getElementById("mainApp").classList.remove("disabled");
        var allButtons = document.querySelectorAll("button");
        allButtons.forEach(function (btn) { btn.disabled = false; });
    }

    // Show squad cards after short delay
    if (teams.length > 0) {
        setTimeout(function () {
            currentSquadCardIndex = 0;
            showSquadCard(teams[0].id);
        }, 1500);
    }
}
var currentSquadCardIndex = 0;
function showSquadCard(teamId) {
    var t = teams.find(function (x) { return x.id === teamId; }); if (!t) return;
    var squad = players.filter(function (p) { return p.soldTo === teamId; });
    var tc = t.color || "#ff6a00";
    document.getElementById("scModalTitle").textContent = t.name + " — Squad Card (" + fmtPrice(t.purse) + ")";
    var inner = "<div class=\"sc-header\" style=\"background:linear-gradient(135deg," + tc + "33,transparent)\">";
    inner += (t.logo ? "<img src=\"" + t.logo + "\" style=\"width:56px;height:56px;border-radius:12px;margin-bottom:12px\">" : "");
    inner += "<div class=\"sc-team-name\" style=\"color:" + tc + "\">" + t.name + "</div>";
    inner += "<div class=\"sc-meta\">" + squad.length + " Players &nbsp;|&nbsp; Spent: " + fmtPrice(t.initialPurse - t.purse) + " &nbsp;|&nbsp; Left: " + fmtPrice(t.purse) + "</div></div>";
    inner += "<div class=\"sc-players\">" + (squad.length ? squad.map(function (p) {
        var cardImg = getEffectivePlayerImage(p);
        var fallback = getCategoryDefaultLogo(p.category);
        var cardImgTag = cardImg ? "<img src=\"" + cardImg + "\" style=\"width:44px;height:44px;border-radius:50%;object-fit:cover;display:block;margin:0 auto 6px\"" + (fallback ? " onerror=\"this.onerror=null;this.src='" + fallback + "'\"" : "") + ">" : "";
        return "<div class=\"sc-player\">" + cardImgTag + "<div class=\"sc-player-name\">" + p.name + "</div><div class=\"sc-player-cat cat-badge cat-" + p.category + "\" style=\"font-size:.55rem;margin-bottom:3px\">" + displayCategory(p.category) + "</div><div class=\"sc-player-price\">" + fmtPrice(p.soldPrice) + "</div></div>";
    }).join("") : "<p style=\"color:var(--text2);text-align:center;padding:20px\">No players bought.</p>") + "</div>";
    document.getElementById("squadCardInner").innerHTML = inner;
    currentSquadCardIndex = teams.findIndex(function (x) { return x.id === teamId; });
    var nextBtn = document.getElementById("btnNextSquadCard");
    nextBtn.style.display = currentSquadCardIndex < teams.length - 1 ? "" : "none";
    openModal("modalSquadCard");
}
function openBidHistory(idx) {
    var h = auctionHistory[idx]; if (!h) return;
    document.getElementById("bhPlayerName").textContent = h.playerName;
    var bids = h.bidHistory || [];
    if (!bids.length) { document.getElementById("bidHistoryList").innerHTML = "<p style='color:var(--text2);text-align:center;padding:20px'>No bids were placed.</p>"; }
    else {
        document.getElementById("bidHistoryList").innerHTML = bids.map(function (b, i) {
            var isWinner = h.status === "sold" && i === bids.length - 1;
            return "<div class=\"bh-item" + (isWinner ? " bh-winner\"" : "\"") + "><span class=\"bh-pos\">" + (i + 1) + "</span><span class=\"bh-team\">" + (isWinner ? "🏆 " : "") + b.teamName + "</span><span class=\"bh-amount\">" + fmtPrice(b.amount) + "</span></div>";
        }).join("");
    }
    openModal("modalBidHistory");
}
function sellPlayerImmediate(p, teamId, price) {
    if (!p || p.sold || p.isUnsold) return;
    clearInterval(timerInterval);
    var t = teams.find(function (x) { return x.id === teamId; }); if (!t) return;
    t.purse -= price; p.sold = true; p.isUnsold = false; p.soldTo = teamId; p.soldPrice = price;
    auctionHistory.push({ playerId: p.id, playerName: p.name, category: p.category, teamId: teamId, teamName: t.name, price: price, status: "sold", ts: Date.now(), bidHistory: auctionState.bids.slice() });
    persist(); hideGoingOverlay();
    showStampOnSpotlight("sold");
    launchConfetti();
    playSoldSound();
    if (socket && currentUser && currentUser.role === "admin") socket.emit("admin:uisold");
    toast(p.name + " SOLD to " + t.name + " for " + fmtPrice(price) + "!", "success", 4000);
    renderTeams(); renderPurseTable(); renderHistory(); updatePlayerStats();
    nextPlayer();
}
function markUnsoldImmediate(p) {
    if (!p || p.sold || p.isUnsold) return;
    clearInterval(timerInterval);
    p.sold = false;
    p.isUnsold = true;
    auctionHistory.push({ playerId: p.id, playerName: p.name, category: p.category, teamId: null, teamName: null, price: 0, status: "unsold", ts: Date.now() });
    persist();
    showStampOnSpotlight("unsold");
    playUnsoldSound();
    if (socket && currentUser && currentUser.role === "admin") socket.emit("admin:uiunsold");
    toast(p.name + " went UNSOLD.", "warning", 3000);
    renderHistory(); updatePlayerStats();
    nextPlayer();
}
function restoreAuction() {
    // If server already sent us authoritative state, don't override it locally
    if (_serverStateReceived) return;
    var s = auctionState.status; updateStatusBadge(s); showAuctionButtons(s);
    if ((s === "live" || s === "paused") && auctionState.currentIndex >= 0) {
        var pid = auctionState.queue[auctionState.currentIndex];
        var p = players.find(function (x) { return x.id === pid; });
        if (p && !p.sold) {
            renderCurrentPlayer(p); updateBidUI(); updateQueue();
            // Never start the admin timer locally on refresh — server controls that
            renderTimer(auctionState.timerRemaining, settings.timerDuration);
        }
        // REMOVED: nextPlayer() call here was corrupting server queue on admin refresh
    }
}
function undoLast() {
    var last = auctionHistory.slice().reverse().find(function (h) { return h.status === "sold"; });
    if (!last) { toast("Nothing to undo.", "info"); return; }
    revertPlayer(last.playerId); toast("Last sale reverted.", "warning");
}
function updateAuctionUI() { updateStatusBadge(auctionState.status); showAuctionButtons(auctionState.status); updateBidUI(); }
function saveSettings() {
    settings.timerDuration = parseInt(document.getElementById("timerDuration").value) || 30;
    settings.extension = parseInt(document.getElementById("timerExtension").value) || 10;
    settings.threshold = parseInt(document.getElementById("timerThreshold").value) || 5;
    save(SETTINGS_KEY, settings); toast("Settings saved!", "success", null, true);
}
function changeAdminPassword() {
    var cur = document.getElementById("currentAdminPass").value;
    var newP = document.getElementById("newAdminPass").value;
    var msg = document.getElementById("changePassMsg");
    if (cur !== localStorage.getItem(ADMIN_PASS_KEY)) { msg.textContent = "Current password incorrect."; msg.className = "form-msg error"; return; }
    if (newP.length < 4) { msg.textContent = "Password too short."; msg.className = "form-msg error"; return; }
    localStorage.setItem(ADMIN_PASS_KEY, newP); msg.textContent = "Password changed!"; msg.className = "form-msg success";
    document.getElementById("currentAdminPass").value = ""; document.getElementById("newAdminPass").value = "";
}

// === EVENT LISTENERS ===
document.addEventListener("DOMContentLoaded", function () {
    loadAll();
    var savedTheme = localStorage.getItem("ipl_theme") || "dark";
    document.documentElement.setAttribute("data-theme", savedTheme);
    const darkToggle = document.getElementById("darkToggle");
    if (darkToggle) darkToggle.textContent = savedTheme === "dark" ? "🌙" : "☀";

    initAuth();
    ensureNewsTickerClock();

    // Volume Slider Init
    var volSld = document.getElementById("volumeSlider");
    var volIcon = document.getElementById("volIcon");
    var _prevVolume = masterVolume > 0 ? masterVolume : 0.5; // remember last non-zero for unmute

    function updateVolIcon(vol) {
        if (!volIcon) return;
        if (vol <= 0) volIcon.textContent = "🔇";
        else if (vol < 0.4) volIcon.textContent = "🔈";
        else volIcon.textContent = "🔊";
    }

    if (volSld) {
        function clampVolume(v) {
            var n = parseFloat(v);
            if (!isFinite(n)) n = 0;
            if (n < 0) n = 0;
            if (n > 1) n = 1;
            // Snap near-zero slider values to exact mute for consistent UI.
            if (n <= 0.1) n = 0;
            return Math.round(n * 10) / 10;
        }

        function updateSliderVisual(vol) {
            var max = parseFloat(volSld.max || "1") || 1;
            var percentage = Math.max(0, Math.min(100, (vol / max) * 100));
            var isMuted = percentage <= 0.01;
            volSld.classList.toggle("muted", isMuted);
            if (percentage <= 0.01) {
                // Explicitly clear inline fill style so muted CSS always wins.
                volSld.style.background = '';
            } else {
                volSld.style.background = 'linear-gradient(90deg, rgba(255, 193, 7, 0.8) 0%, rgba(255, 177, 66, 0.7) ' + percentage + '%, rgba(255, 255, 255, 0.15) ' + percentage + '%, rgba(255, 255, 255, 0.15) 100%)';
            }
        }

        function setVolume(vol) {
            masterVolume = clampVolume(vol);
            if (masterVolume > 0) _prevVolume = masterVolume;
            localStorage.setItem("ipl_volume", String(masterVolume));
            volSld.value = String(masterVolume);
            updateSliderVisual(masterVolume);
            updateVolIcon(masterVolume);
        }

        // Initialize visuals on load to match saved volume.
        setVolume(masterVolume);

        volSld.addEventListener("input", function () {
            setVolume(this.value);
        });
    }

    // Click on speaker icon to toggle mute / unmute
    if (volIcon) {
        volIcon.addEventListener("click", function () {
            var nextVol = masterVolume > 0 ? 0 : (_prevVolume > 0 ? _prevVolume : 0.5);
            if (volSld) {
                // Keep visual + state update path identical to slider drag.
                volSld.value = String(nextVol);
                volSld.dispatchEvent(new Event("input", { bubbles: true }));
            } else {
                masterVolume = nextVol;
                localStorage.setItem("ipl_volume", String(masterVolume));
                updateVolIcon(masterVolume);
            }
        });
    }

    // Trigger sync request if no data (helps incognito tabs fetch from active admin tab)
    if (_bc && teams.length === 0) {
        setTimeout(function () {
            console.log("No data found, requesting sync from other tabs...");
            _bc.postMessage({ type: "SYNC_REQUEST" });
        }, 1000);
    }

    // LOGIN
    document.querySelectorAll(".role-tab").forEach(function (btn) {
        btn.addEventListener("click", function () {
            document.querySelectorAll(".role-tab").forEach(function (t) { t.classList.remove("active"); });
            btn.classList.add("active");
            var role = btn.dataset.role;
            safeGet("adminLoginForm").classList.toggle("active", role === "admin");
            safeGet("teamLoginForm").classList.toggle("active", role === "team");
            safeGet("spectatorLoginForm").classList.toggle("active", role === "spectator");
        });
    });

    const adminLogin = document.getElementById("adminLoginForm");
    if (adminLogin) {
        adminLogin.addEventListener("submit", function (e) {
            e.preventDefault();
            var u = document.getElementById("adminUser").value.trim();
            var p = document.getElementById("adminPass").value;
            var errEl = document.getElementById("adminLoginError");
            if (u === localStorage.getItem(ADMIN_USER_KEY) && p === localStorage.getItem(ADMIN_PASS_KEY)) {
                currentUser = { role: "admin", name: "Admin", username: "admin" };
                saveSession(currentUser); if (errEl) errEl.classList.add("hidden"); showApp();
            } else if (errEl) errEl.classList.remove("hidden");
        });
    }

    const teamLogin = document.getElementById("teamLoginForm");
    if (teamLogin) {
        teamLogin.addEventListener("submit", function (e) {
            e.preventDefault();
            var u = document.getElementById("teamUser").value.trim().toLowerCase();
            var p = document.getElementById("teamPass").value;
            var errEl = document.getElementById("teamLoginError");
            var t = teams.find(function (t) { return t.username === u && t.password === p; });
            if (t) {
                currentUser = { role: "team", teamId: t.id, name: t.name, username: t.username };
                saveSession(currentUser); if (errEl) errEl.classList.add("hidden"); showApp();
            } else if (errEl) errEl.classList.remove("hidden");
        });
    }

    const spectatorLogin = document.getElementById("spectatorLoginForm");
    if (spectatorLogin) {
        spectatorLogin.addEventListener("submit", function (e) {
            e.preventDefault();
            currentUser = { role: "spectator", name: "Guest Spectator", username: "spectator" };
            saveSession(currentUser);
            showApp();
        });
    }

    document.querySelectorAll(".toggle-pass").forEach(function (btn) {
        btn.addEventListener("click", function () {
            var inp = document.getElementById(btn.dataset.target);
            if (inp) {
                inp.type = inp.type === "password" ? "text" : "password";
                btn.textContent = inp.type === "password" ? "Show" : "Hide";
            }
        });
    });

    // LOGOUT
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", doLogout);
    }

    // NAV
    document.querySelectorAll(".nav-link").forEach(function (lnk) {
        lnk.addEventListener("click", function (e) { e.preventDefault(); navTo(lnk.dataset.section); });
    });

    const hamburger = document.getElementById("hamburger");
    if (hamburger) {
        hamburger.addEventListener("click", function () {
            safeGet("navLinks").classList.toggle("open");
            hamburger.classList.toggle("open");
        });
    }

    safeBind("darkToggle", "click", toggleDarkMode);

    // AUCTION


    safeBind("btnStartAuction", "click", startAuction);
    safeBind("btnLobbyStart", "click", doStartAuction);
    safeBind("btnStartUnsoldRound", "click", startUnsoldRound);
    safeBind("btnNextSquadCard", "click", function () {
        var next = teams[currentSquadCardIndex + 1];
        if (next) showSquadCard(next.id);
    });
    safeBind("btnPauseAuction", "click", pauseAuction);
    safeBind("btnResumeAuction", "click", resumeAuction);
    safeBind("btnEndAuctionManual", "click", function () {
        showConfirm("End Auction", "Are you sure you want to end the auction and see final results?", function () {
            if (socket && socket.connected) socket.emit("auction:end");
            endAuction();
        });
    });
    // btnResetAuction logic handled by resetAuction() standalone function
    safeBind("btnPlaceBid", "click", placeBid);
});
// Quick Sell and Skip features removed
// Live Display feature removed
// PLAYERS
safeBind("btnAddPlayer", "click", openAddPlayer);
safeBind("btnSavePlayer", "click", savePlayer);
safeBind("btnImportPlayers", "click", openImport);
safeBind("btnConfirmImport", "click", confirmImport);
safeBind("btnBulkDelete", "click", bulkDelete);
safeBind("playerSearch", "input", function () { renderPlayers(); });
safeBind("playerCatFilter", "change", function () { renderPlayers(); });
safeBind("playerStatusFilter", "change", function () { renderPlayers(); });
safeBind("pImage", "change", function (e) { var f = e.target.files[0]; if (!f) return; var r = new FileReader(); r.onload = function (ev) { var p = document.getElementById("pImagePreview"); p.src = ev.target.result; p.classList.remove("hidden"); }; r.readAsDataURL(f); });

// IMPORT
safeBind("btnBrowseImport", "click", function () { document.getElementById("importFile").click(); });
safeBind("importFile", "change", function (e) {
    var f = e.target.files[0]; if (!f) return;
    var loading = document.getElementById("playerLoading"); loading.classList.remove("hidden");
    if (f.name.endsWith(".csv")) { var r = new FileReader(); r.onload = function (ev) { loading.classList.add("hidden"); processImportRows(parseCSV(ev.target.result)); }; r.readAsText(f); }
    else if (f.name.match(/\.xlsx?$/i)) { var r = new FileReader(); r.onload = function (ev) { loading.classList.add("hidden"); try { var wb = XLSX.read(ev.target.result, { type: "binary" }); var ws = wb.Sheets[wb.SheetNames[0]]; var rows = XLSX.utils.sheet_to_json(ws, { defval: "" }); processImportRows(rows.map(function (row) { var lc = {}; Object.keys(row).forEach(function (k) { lc[k.toLowerCase().replace(/\s/g, "")] = String(row[k]); }); return lc; })); } catch (err) { var e = document.getElementById("importError"); e.textContent = "Failed to parse Excel."; e.classList.remove("hidden"); } }; r.readAsBinaryString(f); }
});
var dz = document.getElementById("importDropZone");
if (dz) {
    dz.addEventListener("dragover", function (e) { e.preventDefault(); dz.classList.add("drag-over"); });
    dz.addEventListener("dragleave", function () { dz.classList.remove("drag-over"); });
    dz.addEventListener("drop", function (e) { e.preventDefault(); dz.classList.remove("drag-over"); var f = e.dataTransfer.files[0]; if (!f) return; document.getElementById("importFile").dispatchEvent(new Event("change")); });
}

// TEAMS
safeBind("btnAddTeam", "click", openAddTeam);
safeBind("btnSaveTeam", "click", saveTeam);
safeBind("tLogo", "change", function (e) { var f = e.target.files[0]; if (!f) return; var r = new FileReader(); r.onload = function (ev) { var p = document.getElementById("tLogoPreview"); p.src = ev.target.result; p.classList.remove("hidden"); }; r.readAsDataURL(f); });

// EXPORT
var btnJSON = document.getElementById("btnExportJSON"); if (btnJSON) btnJSON.addEventListener("click", exportJSON);
var btnCSV = document.getElementById("btnExportCSV"); if (btnCSV) btnCSV.addEventListener("click", exportCSV);
var btnRes = document.getElementById("btnExportResults"); if (btnRes) btnRes.addEventListener("click", exportJSON);

// ADMIN
var btnSaveSettings = document.getElementById("btnSaveSettings"); if (btnSaveSettings) btnSaveSettings.addEventListener("click", saveSettings);
var btnLoadDemo = document.getElementById("btnLoadDemo"); if (btnLoadDemo) btnLoadDemo.addEventListener("click", loadDemoData);
var btnUndoAction = document.getElementById("btnUndoAction"); if (btnUndoAction) btnUndoAction.addEventListener("click", undoLast);
var btnFullReset = document.getElementById("btnFullReset"); if (btnFullReset) btnFullReset.addEventListener("click", fullReset);
var btnChangePass = document.getElementById("btnChangePass"); if (btnChangePass) btnChangePass.addEventListener("click", changeAdminPassword);
var btnStartUnsold = document.getElementById("btnStartUnsoldRound"); if (btnStartUnsold) btnStartUnsold.addEventListener("click", startUnsoldRound);

// QUICK SELL
var btnConfirmQuickSell = document.getElementById("btnConfirmQuickSell");
if (btnConfirmQuickSell) btnConfirmQuickSell.addEventListener("click", confirmQuickSell);
var btnConfirmRevert = document.getElementById("btnConfirmRevert");
if (btnConfirmRevert) btnConfirmRevert.addEventListener("click", function () { var pid = document.getElementById("revertPlayerSelect").value; if (pid) { revertPlayer(pid); closeModal("modalRevert"); } });

// CONFIRM DIALOG
var btnConfirmYes = document.getElementById("btnConfirmYes");
if (btnConfirmYes) btnConfirmYes.addEventListener("click", function () { if (pendingConfirm) { var cb = pendingConfirm; pendingConfirm = null; cb(); } closeModal("modalConfirm"); });
var btnConfirmNo = document.getElementById("btnConfirmNo");
if (btnConfirmNo) btnConfirmNo.addEventListener("click", function () { pendingConfirm = null; closeModal("modalConfirm"); });

// ALERT DIALOG
var btnAlertOk = document.getElementById("btnAlertOk");
if (btnAlertOk) btnAlertOk.addEventListener("click", function () { closeModal("modalAlert"); });

// MODAL CLOSE - handle close button and data-modal buttons
document.addEventListener("click", function (e) {
    var btn = e.target.closest(".modal-close");
    if (btn && !btn.classList.contains('no-close')) {
        var m = btn.dataset.modal;
        if (m) {
            e.stopPropagation();
            closeModal(m);
        }
    }
});

// Handle data-modal as shortcut to close modal (like Cancel buttons)
document.addEventListener("click", function (e) {
    var btn = e.target.closest('[data-modal]');
    if (btn && !btn.classList.contains('modal-close') && (!btn.id || (!btn.id.startsWith('btnSave') && !btn.id.startsWith('btnConfirm')))) {
        var m = btn.dataset.modal;
        if (m) {
            e.stopPropagation();
            closeModal(m);
        }
    }
});

// Only close overlay when clicking directly on the background
document.addEventListener("click", function (e) {
    if (e.target.classList && e.target.classList.contains("modal-overlay") && !e.target.classList.contains("hidden")) {
        closeModal(e.target.id);
    }
});

// Backup confirm dialog buttons
document.addEventListener("click", function (e) {
    if (e.target.closest("#btnConfirmYes")) {
        if (pendingConfirm) { var cb = pendingConfirm; pendingConfirm = null; cb(); }
        var el = document.getElementById("modalConfirm");
        if (el) { el.classList.remove("active"); el.classList.add("hidden"); }
    }
    if (e.target.closest("#btnConfirmNo")) {
        pendingConfirm = null;
        var el = document.getElementById("modalConfirm");
        if (el) { el.classList.remove("active"); el.classList.add("hidden"); }
    }
});

// Backup modal close button handlers
document.addEventListener("click", function (e) {
    var btn = e.target.closest(".modal-close");
    if (btn && !btn.classList.contains('no-close')) {
        var m = btn.dataset.modal;
        if (m && typeof closeModal === "function") {
            e.stopPropagation();
            closeModal(m);
        }
    }
});

// Backup data-modal button handlers (Cancel buttons, etc)
document.addEventListener("click", function (e) {
    var btn = e.target.closest('[data-modal]');
    if (btn && !btn.classList.contains('modal-close') && (!btn.id || (!btn.id.startsWith('btnSave') && !btn.id.startsWith('btnConfirm')))) {
        var m = btn.dataset.modal;
        if (m && typeof closeModal === "function") {
            e.stopPropagation();
            closeModal(m);
        }
    }
});

// Backup modal overlay click handler
document.addEventListener("click", function (e) {
    if (e.target.classList && e.target.classList.contains("modal-overlay") && !e.target.classList.contains("hidden")) {
        if (typeof closeModal === "function") {
            closeModal(e.target.id);
        }
    }
});

// Modal handlers consolidated above

// Backup navigation handler - ensure nav links work even if DOMContentLoaded has issues
document.addEventListener("click", function (e) {
    var lnk = e.target.closest(".nav-link");
    if (lnk && lnk.dataset.section) {
        e.preventDefault();
        var section = lnk.dataset.section;
        var isSpectator = currentUser && currentUser.role === "spectator";
        if (isSpectator && section !== "auction") {
            if (section === "admin") {
                console.log("Access Denied: Spectators cannot access Admin Panel.");
            }
            return;
        }
        document.querySelectorAll(".section").forEach(function (s) { s.classList.remove("active"); s.classList.add("hidden"); });
        document.querySelectorAll(".nav-link").forEach(function (l) { l.classList.remove("active"); });
        var sec = document.getElementById("section" + section.charAt(0).toUpperCase() + section.slice(1));
        if (sec) { sec.classList.remove("hidden"); sec.classList.add("active"); }
        var navLnk = document.querySelector("[data-section=\"" + section + "\"]");
        if (navLnk) navLnk.classList.add("active");
        document.getElementById("navLinks").classList.remove("open");
        document.getElementById("hamburger").classList.remove("open");
        if (section === "analytics") { if (typeof renderAnalytics === "function") renderAnalytics(); }
        if (section === "purse") { if (typeof renderPurseTable === "function") renderPurseTable(); }
        if (section === "history") { if (typeof renderHistory === "function") renderHistory(); }
        if (section === "teams") { if (typeof renderTeams === "function") renderTeams(); }
        if (section === "admin") { if (typeof renderAdminPanel === "function") renderAdminPanel(); }
    }
});

// Backup logout handler in case navbar is re-rendered or initial binding is skipped.
document.addEventListener("click", function (e) {
    var btn = e.target.closest("#logoutBtn, .btn-logout");
    if (!btn) return;
    e.preventDefault();
    doLogout();
});

// Backup login role handler so Team/Spectator tabs always work.
function switchLoginRole(role) {
    var valid = (role === "admin" || role === "team" || role === "spectator") ? role : "admin";
    document.querySelectorAll(".role-tab").forEach(function (t) {
        t.classList.toggle("active", t.dataset.role === valid);
    });
    var adminForm = document.getElementById("adminLoginForm");
    var teamForm = document.getElementById("teamLoginForm");
    var spectatorForm = document.getElementById("spectatorLoginForm");
    if (adminForm) adminForm.classList.toggle("active", valid === "admin");
    if (teamForm) teamForm.classList.toggle("active", valid === "team");
    if (spectatorForm) spectatorForm.classList.toggle("active", valid === "spectator");
}

document.addEventListener("click", function (e) {
    var roleBtn = e.target.closest(".role-tab");
    if (!roleBtn) return;
    e.preventDefault();
    switchLoginRole(roleBtn.dataset.role);
});

// Backup login submit handlers to avoid lockout if main binding path is interrupted.
document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form || !form.id) return;

    if (form.id === "adminLoginForm") {
        e.preventDefault();
        var u = (document.getElementById("adminUser") || {}).value;
        var p = (document.getElementById("adminPass") || {}).value;
        var errEl = document.getElementById("adminLoginError");
        if ((u || "").trim() === localStorage.getItem(ADMIN_USER_KEY) && (p || "") === localStorage.getItem(ADMIN_PASS_KEY)) {
            currentUser = { role: "admin", name: "Admin", username: "admin" };
            saveSession(currentUser);
            if (errEl) errEl.classList.add("hidden");
            showApp();
        } else if (errEl) {
            errEl.classList.remove("hidden");
        }
        return;
    }

    if (form.id === "teamLoginForm") {
        e.preventDefault();
        var teamU = ((document.getElementById("teamUser") || {}).value || "").trim().toLowerCase();
        var teamP = (document.getElementById("teamPass") || {}).value || "";
        var teamErr = document.getElementById("teamLoginError");
        var t = teams.find(function (x) { return x.username === teamU && x.password === teamP; });
        if (t) {
            currentUser = { role: "team", teamId: t.id, name: t.name, username: t.username };
            saveSession(currentUser);
            if (teamErr) teamErr.classList.add("hidden");
            showApp();
        } else if (teamErr) {
            teamErr.classList.remove("hidden");
        }
        return;
    }

    if (form.id === "spectatorLoginForm") {
        e.preventDefault();
        currentUser = { role: "spectator", name: "Guest Spectator", username: "spectator" };
        saveSession(currentUser);
        showApp();
    }
}, true);

// Backup button handlers for admin functions (in case DOMContentLoaded fails)
document.addEventListener("click", function (e) {
    if (e.target.id === "btnAddPlayer") { if (typeof openAddPlayer === "function") openAddPlayer(); }
    if (e.target.id === "btnSavePlayer") { if (typeof savePlayer === "function") savePlayer(); }
    if (e.target.id === "btnImportPlayers") { if (typeof openImport === "function") openImport(); }
    if (e.target.id === "btnSaveTeam") { if (typeof saveTeam === "function") saveTeam(); }
    if (e.target.id === "btnConfirmImport") { if (typeof confirmImport === "function") confirmImport(); }
    if (e.target.id === "btnStartAuction") { if (typeof startAuction === "function") startAuction(); }
    if (e.target.id === "btnLobbyStart") { if (typeof doStartAuction === "function") doStartAuction(); }
    if (e.target.id === "btnPauseAuction") { if (typeof pauseAuction === "function") pauseAuction(); }
    if (e.target.id === "btnResumeAuction") { if (typeof resumeAuction === "function") resumeAuction(); }
});

// Cross-tab sync: keep all tabs in sync via localStorage storage events
window.addEventListener("storage", function (e) {
    if (!currentUser) return;

    if (e.key === AUCTION_KEY) {
        var savedState = load(AUCTION_KEY, null); // Renamed 'saved' to 'savedState' for clarity
        if (!savedState) return;

        if (currentUser.role === "team") {
            // Team tab: sync timer and bid info from admin tab
            // New logic: Check if we are in AI Intro Sequence before showing live auction logic
            if (savedState.status === "ai_intro" || savedState.status === "manual_intro") {
                navTo("auction");
                // Overlay will be handled by the specific `auction:ai_intro_tick` events
                // Hide normal auction buttons for now
                showAuctionButtons("hidden");
                return;
            }

            // If auction is live, proceed with normal sync
            if (savedState.status === "live") {
                navTo("auction");
            }
            var wasLive = auctionState.status === "live";
            auctionState = savedState;
            renderTimer(auctionState.timerRemaining, settings.timerDuration);
            updateBidUI();
            updateStatusBadge(auctionState.status);
            if (savedState.auctionState.status === "live" || savedState.auctionState.status === "paused" || savedState.auctionState.status === "awaiting_next") {
                document.getElementById("auctionStage").classList.remove("hidden");
                // if there is a queue item, render it
                if (savedState.auctionState.currentIndex >= 0 && savedState.auctionState.currentIndex < savedState.auctionState.queue.length) {
                    var pid = savedState.auctionState.queue[savedState.auctionState.currentIndex];
                    var p = players.find(function (x) { return x.id === pid; });
                    if (p && !p.sold) renderCurrentPlayer(p);
                }
            } else if (savedState.auctionState.status === "ai_intro" || savedState.auctionState.status === "manual_intro") {
                // Keep background clear for overlay
                document.getElementById("auctionStage").classList.add("hidden");
            }
            if (auctionState.status === "ended") {
                document.getElementById("auctionStage").classList.add("hidden");
                document.getElementById("emptyAuction").classList.remove("hidden");
            }
        }

        if (currentUser.role === "admin") {
            // Admin tab: pick up bids placed in team tabs (higher bid = new bid)
            if (saved.currentBid > auctionState.currentBid) {
                auctionState.currentBid = saved.currentBid;
                auctionState.currentBidTeam = saved.currentBidTeam;
                auctionState.bids = saved.bids;
                auctionState.timerRemaining = saved.timerRemaining;
                updateBidUI();
            }
        }
    }

    if (e.key === PLAYERS_KEY) {
        players = load(PLAYERS_KEY, []);
        updatePlayerStats();
    }
    if (e.key === TEAMS_KEY) {
        teams = load(TEAMS_KEY, []);
        renderTeams();
    }
    if (e.key === HISTORY_KEY) {
        auctionHistory = load(HISTORY_KEY, []);
        renderHistory();
    }
});

// ============================================================
//  BROADCASTCHANNEL — Instant Real-time Cross-Tab Sync
// ============================================================
if (_bc) {
    _bc.onmessage = function (event) {
        // Handle Sync Request from new tabs
        if (event.data && event.data.type === "SYNC_REQUEST") {
            // Any tab that HAS data should respond to help the new tab login
            if (teams.length > 0) {
                console.log("Sync requested by new tab, broadcasting current state...");
                persist();
            }
            return;
        }

        _updateSyncDot("receiving");
        _applyRemoteState(event.data);
    };
    _bc.onmessageerror = function () { _updateSyncDot("offline"); };
}

// Polling fallback: re-read localStorage every 2.5s (handles multi-window on same machine without BC/Socket)
setInterval(function () {
    if (!currentUser) return;
    if (socket) return; // If Socket.io is active, NEVER overwrite live state with stale LocalStorage!
    var latestAuction = load(AUCTION_KEY, null);
    if (!latestAuction) return;
    // If admin is driving this tab, don't overwrite state
    if (currentUser.role === "admin") {
        // Still refresh teams/history for display
        var latestTeams = load(TEAMS_KEY, teams);
        var latestHistory = load(HISTORY_KEY, auctionHistory);
        if (JSON.stringify(latestTeams) !== JSON.stringify(teams)) { teams = latestTeams; renderTeams(); renderPurseTable(); }
        if (JSON.stringify(latestHistory) !== JSON.stringify(auctionHistory)) { auctionHistory = latestHistory; renderHistory(); renderAnalytics(); }
    } else {
        // Team users: apply any delta from admin
        var payload = {
            ts: Date.now(),
            players: load(PLAYERS_KEY, players),
            teams: load(TEAMS_KEY, teams),
            history: load(HISTORY_KEY, auctionHistory),
            auction: latestAuction
        };
        _applyRemoteState(payload);
    }
    _updateSyncDot("live");
}, 2500);

// ============================================================
//  AI AUCTION MODE ENGINE
// ============================================================
var _aiStopRequested = false;

/**
 * Build a queue for the AI based on pool selection.
 * pool: "all" | "Marquee" | "Batsman" | "Bowler" | "All-Rounder" | "Wicketkeeper"
 */
function buildAiQueue(pool) {
    if (pool === "autonomous") {
        // Master Autopilot Queue Array
        var masterQueue = [];
        var unsold = players.filter(function (p) { return !p.sold; });

        // Define all participating categories (Excluding 'all' or 'autonomous' naturally)
        var allPools = ["Marquee", "Batsman", "Bowler", "All-Rounder", "Wicketkeeper", "Uncapped"];

        // Randomize the order of categories using Fisher-Yates shuffle
        for (var i = allPools.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var temp = allPools[i];
            allPools[i] = allPools[j];
            allPools[j] = temp;
        }

        allPools.forEach(function (cat) {
            var catPlayers = [];
            if (cat === "Uncapped") {
                catPlayers = unsold.filter(function (p) { return p.playerStatus === "Uncapped"; }).map(function (p) { return p.id; });
            } else if (cat === "Marquee") {
                catPlayers = unsold.filter(function (p) { return p.marquee && p.playerStatus !== "Uncapped"; }).map(function (p) { return p.id; });
            } else {
                catPlayers = unsold.filter(function (p) { return p.category === cat && !p.marquee && p.playerStatus !== "Uncapped"; }).map(function (p) { return p.id; });
            }

            // Shuffle players inside this category
            for (var k = catPlayers.length - 1; k > 0; k--) {
                var l = Math.floor(Math.random() * (k + 1));
                var tempP = catPlayers[k];
                catPlayers[k] = catPlayers[l];
                catPlayers[l] = tempP;
            }

            // Append to master queue with the category identifier attached
            catPlayers.forEach(function (pid) {
                masterQueue.push({ id: pid, aiPoolName: cat });
            });
        });

        // Debug log
        console.log("Master Autonomous Queue Generated", masterQueue);
        return masterQueue;
    }

    // Default legacy behavior (still needed for individual pool runs)
    var unsoldLegacy = players.filter(function (p) { return !p.sold; });
    if (pool === "all") return buildQueue("all"); // leverages the updated logic that handles Uncapped correctly
    if (pool === "Uncapped") return unsoldLegacy.filter(function (p) { return p.playerStatus === "Uncapped"; }).map(function (p) { return p.id; });
    if (pool === "Marquee") return unsoldLegacy.filter(function (p) { return p.marquee && p.playerStatus !== "Uncapped"; }).map(function (p) { return p.id; });
    return unsoldLegacy.filter(function (p) { return p.category === pool && !p.marquee && p.playerStatus !== "Uncapped"; }).map(function (p) { return p.id; });
}

function toggleAiMode() {
    if (aiModeActive) {
        // Turn OFF: deactivate AI mode, keep auction running in manual mode
        aiModeActive = false;
        _aiStopRequested = true;
        _updateAiModeUI();
        toast("AI Mode deactivated. You are in Manual mode.", "warning", 3000, true);

        // Force UI to reflect the current live server state properly (do NOT re-request state:full
        // since that would re-trigger aiModeActive = true from the queue object detection)
        var st = auctionState.status || "live";
        if (typeof updateStatusBadge === "function") updateStatusBadge(st);
        if (typeof showAuctionButtons === "function") showAuctionButtons(st);
    } else {
        // Turn ON — pick pool first
        var pool = document.getElementById("aiPoolSelect") ? document.getElementById("aiPoolSelect").value : "all";
        aiPool = pool || "all";
        var poolPlayers = buildAiQueue(aiPool);
        if (!poolPlayers.length) { toast("No eligible unsold players in selected pool!", "error"); return; }
        aiModeActive = true;
        _aiStopRequested = false;
        _updateAiModeUI();
        toast("\u{1F916} AI Mode ON \u2014 Pool: " + (aiPool === "all" ? "All Players" : aiPool) + " (" + poolPlayers.length + " players)", "success", 4000, true);
        playBeep(660, 200); playBeep(880, 200);
        startAiMode();
    }
}

function _updateAiModeUI() {
    var btn = document.getElementById("btnAiMode");
    var poolWrap = document.getElementById("aiPoolWrap");
    var badge = document.getElementById("aiModeBadge");
    var isAdmin = currentUser && currentUser.role === "admin";
    if (btn) {
        btn.textContent = aiModeActive ? "🤖 AI: ON" : "🤖 AI Mode";
        btn.classList.toggle("btn-ai-active", aiModeActive);
        btn.classList.toggle("btn-secondary", !aiModeActive);
        btn.classList.toggle("hidden", !isAdmin);
    }
    // Show pool selector only when AI is OFF and auction has NOT started yet (idle)
    // Once auction is live, hide the pool selector regardless of AI state
    var auctionIsRunning = auctionState && (auctionState.status === "live" || auctionState.status === "paused" || auctionState.status === "awaiting_next" || auctionState.status === "ai_intro" || auctionState.status === "manual_intro");
    var showPool = isAdmin && !aiModeActive && !auctionIsRunning;
    if (poolWrap) poolWrap.classList.toggle("hidden", !showPool);
    if (badge) { badge.classList.toggle("hidden", !aiModeActive); }
}

function startAiMode() {
    if (!aiModeActive) return;
    if (!players.length || !teams.length) { toast("Load players and teams first.", "error"); aiModeActive = false; _updateAiModeUI(); return; }

    // RESUME LOGIC: If already live, don't reset index or queue!
    if (auctionState.status === "live" && auctionState.queue.length > 0) {
        toast("🤖 AI Mode: Taking over current auction...", "info", 2000, true);
        persist();
        navTo("auction");
        // If we were at the very beginning (just clicked Start), kick-start it
        if (auctionState.currentIndex === -1) nextPlayer();
        return;
    }

    // FRESH START: Build pool queue and inject into auctionState
    var pool = buildAiQueue(aiPool);
    if (!pool.length) { _aiPoolComplete(); return; }

    // If autonomous master queue, emit special full autonomous start event, otherwise normal offline start
    if (aiPool === "autonomous") {
        if (socket) {
            socket.emit('auction:start_autonomous', { queue: pool });
            navTo("auction");
            // Server will broadcast `auction:started` with status `ai_intro` which will set button states
            return;
        }
        auctionState.queue = pool;
    } else {
        auctionState.queue = pool;
    }

    auctionState.currentIndex = -1;
    auctionState.status = "live";
    auctionStartTime = Date.now();
    updateStatusBadge("live");
    showAuctionButtons("live");
    persist();
    // Navigate user to auction tab
    navTo("auction");
    nextPlayer();
}

/** Function to trigger the Cinematic Announcement screen overlay */
function triggerAiAnnouncement(currentCategory, nextCategory) {
    if (!aiModeActive || aiPool !== "autonomous") return;
    var overlay = document.getElementById("aiPoolAnnouncement");
    if (!overlay) return;

    document.getElementById("aiPoolTitle").textContent = "10 PLAYERS REMAINING IN " + currentCategory.toUpperCase();
    document.getElementById("aiPoolSub").textContent = "Next Up: " + nextCategory.toUpperCase();

    // Play suspenseful sound
    playBeep(200, 400); setTimeout(function () { playBeep(250, 400); }, 500); setTimeout(function () { playBeep(300, 1000); }, 1000);

    overlay.classList.remove("hidden");

    // Intermission lasts exactly 10 seconds, stopping auto-bidding / timer from advancing
    if (socket) socket.emit("auction:pause");

    setTimeout(function () {
        overlay.classList.add("hidden");
        // Resume auction automatically after cinematic intermission
        if (socket) socket.emit("auction:resume");
    }, 10000);
}

/** Called automatically after each player is sold/unsold when AI mode is active */
function aiModeNext() {
    if (!aiModeActive || _aiStopRequested) return;
    // Check if pool still has unsold players
    var remaining = auctionState.queue.slice(auctionState.currentIndex + 1).filter(function (qItem) {
        var pid = (typeof qItem === 'object' && qItem !== null) ? qItem.id : qItem;
        var p = players.find(function (x) { return x.id === pid; });
        return p && !p.sold;
    });
    if (!remaining.length) {
        if (aiPool === "autonomous") {
            // Master Auto-Unsold Transition
            toast("🏁 Master Queue Concluded! Preparing Unsold Auto-Run...", "warning", 5000, true);
            setTimeout(function () {
                startUnsoldRound(); // Will recycle unsold IDs to the server seamlessly
            }, 6000);
            return;
        }
        _aiPoolComplete();
        return;
    }
    // nextPlayer will be called by the existing sellPlayer/markUnsold timeout
    // We just leave AI mode active, nextPlayer() fires at the end of sell/unsold delay
}

function _aiPoolComplete() {
    aiModeActive = false;
    _aiStopRequested = true;
    _updateAiModeUI();
    var poolLabel = aiPool === "all" ? "All Players" : aiPool;
    toast("🏁 AI Mode: " + poolLabel + " pool complete! Switching to Manual mode.", "success", 6000);
    playBeep(880, 300); playBeep(660, 300); playBeep(440, 500);
    var poolWrap = document.getElementById("aiPoolWrap");
    if (poolWrap) poolWrap.classList.remove("hidden");
    showConfirm("Pool Complete!",
        "\"" + poolLabel + "\" pool auction is done! Select a new pool and enable AI Mode to continue, or run manually.",
        function () { /* just close */ }
    );
}


// ============================================================
//  AUCTION REPORT GENERATOR — Feature 4 Enhanced
// ============================================================
function generateAuctionReport() {
    var sold = auctionHistory.filter(function (h) { return h.status === "sold"; });
    var unsold = auctionHistory.filter(function (h) { return h.status === "unsold"; });
    var totalSpent = sold.reduce(function (s, h) { return s + h.price; }, 0);
    var avg = sold.length ? Math.round(totalSpent / sold.length) : 0;

    // Most expensive player
    var mostExp = sold.length ? sold.reduce(function (a, b) { return b.price > a.price ? b : a; }) : null;
    // Cheapest sold player  
    var cheapest = sold.length ? sold.reduce(function (a, b) { return b.price < a.price ? b : a; }) : null;
    // Player with most bids
    var mostBidded = auctionHistory.filter(function (h) { return h.bidHistory && h.bidHistory.length; }).sort(function (a, b) { return (b.bidHistory || []).length - (a.bidHistory || []).length; })[0];

    // Team stats
    var teamStats = {};
    sold.forEach(function (h) {
        if (!teamStats[h.teamId]) teamStats[h.teamId] = { name: h.teamName, spent: 0, count: 0 };
        teamStats[h.teamId].spent += h.price;
        teamStats[h.teamId].count++;
    });
    var teamArr = [];
    for (var tid in teamStats) { teamArr.push(teamStats[tid]); }
    teamArr.sort(function (a, b) { return b.spent - a.spent; });
    var rankLabels = ["gold", "silver", "bronze"];

    // Hero stats
    var heroHTML = "<div class=\"report-hero-grid\">" +
        "<div class=\"report-hero-stat\"><div class=\"rhs-val\">" + sold.length + "</div><div class=\"rhs-label\">Players Sold</div></div>" +
        "<div class=\"report-hero-stat\"><div class=\"rhs-val\">" + unsold.length + "</div><div class=\"rhs-label\">Unsold</div></div>" +
        "<div class=\"report-hero-stat\"><div class=\"rhs-val\">" + fmtPrice(totalSpent) + "</div><div class=\"rhs-label\">Total Spent</div></div>" +
        "<div class=\"report-hero-stat\"><div class=\"rhs-val\">" + fmtPrice(avg) + "</div><div class=\"rhs-label\">Avg Price</div></div>" +
        "</div>";

    // Team ranking
    var teamRowsHTML = teamArr.map(function (t, i) {
        var teamObj = teams.find(function (x) { return x.name === t.name; });
        var purseLeft = teamObj ? fmtPrice(teamObj.purse) : "--";
        var rankCls = rankLabels[i] || "";
        return "<div class=\"report-team-row\">" +
            "<div class=\"rtr-rank " + rankCls + "\">" + (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "#" + (i + 1)) + "</div>" +
            "<div><div class=\"rtr-name\">" + t.name + "</div><div class=\"rtr-code\">" + (teamObj && teamObj.code ? teamObj.code : "") + "</div></div>" +
            "<div class=\"rtr-stat players\">" + t.count + " players</div>" +
            "<div class=\"rtr-stat spent\">" + fmtPrice(t.spent) + " spent</div>" +
            "<div class=\"rtr-stat purse\">" + purseLeft + " left</div>" +
            "</div>";
    }).join("");

    // Records
    var top3 = sold.slice().sort(function (a, b) { return b.price - a.price; }).slice(0, 3);
    var top3HTML = top3.length ? "<div class=\"report-section\"><div class=\"report-section-header\"><div class=\"report-section-icon\">👑</div><div class=\"report-section-title\">Top 3 Transactions</div></div><div class=\"report-record-grid\">" +
        top3.map(function (h, i) {
            var icon = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
            return "<div class=\"report-record-card\"><div class=\"rrc-rank\">" + icon + "</div><div class=\"rrc-label\">Top Buy #" + (i + 1) + "</div><div class=\"rrc-name\">" + h.playerName + "</div><div class=\"rrc-detail\">" + fmtPrice(h.price) + " — " + h.teamName + "</div></div>";
        }).join("") + "</div></div>" : "";

    var teamMarqueesHTML = "<div class=\"report-section\"><div class=\"report-section-header\"><div class=\"report-section-icon\">⭐</div><div class=\"report-section-title\">Team Star Signings</div></div><div class=\"analysis-grid\">" +
        teamArr.map(function (t) {
            var fullTeam = teams.find(function (x) { return x.name === t.name; });
            var teamSold = sold.filter(function (h) { return h.teamId === fullTeam.id; });
            var star = teamSold.reduce(function (a, b) { return b.price > a.price ? b : a; }, { playerName: "--", price: 0 });
            return "<div class=\"analysis-card\" style=\"border-left: 4px solid " + (fullTeam ? fullTeam.color : "#ff6a00") + "\">" +
                "<div class=\"ac-team\">" + t.name + "</div>" +
                "<div class=\"ac-tag\">MARQUEE: " + star.playerName + "</div>" +
                "<div class=\"ac-meta\">Bought for " + fmtPrice(star.price) + "</div>" +
                "</div>";
        }).join("") + "</div></div>";

    var recordsHTML = "<div class=\"report-record-grid\">" +
        (mostExp ? "<div class=\"report-record-card\"><div class=\"rrc-icon\">💎</div><div class=\"rrc-label\">Most Expensive</div><div class=\"rrc-name\">" + mostExp.playerName + "</div><div class=\"rrc-detail\">" + fmtPrice(mostExp.price) + " — " + mostExp.teamName + "</div></div>" : "") +
        (cheapest && cheapest !== mostExp ? "<div class=\"report-record-card\"><div class=\"rrc-icon\">💰</div><div class=\"rrc-label\">Best Bargain</div><div class=\"rrc-name\">" + cheapest.playerName + "</div><div class=\"rrc-detail\">" + fmtPrice(cheapest.price) + " — " + cheapest.teamName + "</div></div>" : "") +
        (mostBidded ? "<div class=\"report-record-card\"><div class=\"rrc-icon\">🔥</div><div class=\"rrc-label\">Most Contested</div><div class=\"rrc-name\">" + mostBidded.playerName + "</div><div class=\"rrc-detail\">" + (mostBidded.bidHistory || []).length + " bids placed</div></div>" : "") +
        (teamArr[0] ? "<div class=\"report-record-card\"><div class=\"rrc-icon\">💸</div><div class=\"rrc-label\">Biggest Spender</div><div class=\"rrc-name\">" + teamArr[0].name + "</div><div class=\"rrc-detail\">" + fmtPrice(teamArr[0].spent) + " total</div></div>" : "") +
        (teamArr.reduce(function (a, b) { return b.count > a.count ? b : a; }, { count: 0, name: "--" }).name !== "--" ? (function () { var mp = teamArr.reduce(function (a, b) { return b.count > a.count ? b : a; }); return "<div class=\"report-record-card\"><div class=\"rrc-icon\">🏆</div><div class=\"rrc-label\">Most Players</div><div class=\"rrc-name\">" + mp.name + "</div><div class=\"rrc-detail\">" + mp.count + " players bought</div></div>"; })() : "") +
        "</div>";

    // Sold players chips
    var soldChips = sold.map(function (h) {
        return "<div class=\"report-sold-chip\"><span class=\"chip-name\">" + h.playerName + "</span><span class=\"chip-team\">→ " + h.teamName + "</span><span class=\"chip-price\">" + fmtPrice(h.price) + "</span></div>";
    }).join("");

    // Unsold chips
    var unsoldChips = unsold.length ? unsold.map(function (h) {
        return "<span class=\"report-unsold-chip\">❌ " + h.playerName + "</span>";
    }).join("") : "<span style='color:var(--text2);font-size:.85rem'>All players were sold! 🎉</span>";

    // Build full report
    var html = heroHTML;

    if (top3HTML) html += top3HTML;
    if (teamMarqueesHTML) html += teamMarqueesHTML;

    if (teamArr.length) {
        html += "<div class=\"report-section\"><div class=\"report-section-header\"><div class=\"report-section-icon\">🏆</div><div class=\"report-section-title\">Team Rankings — by Money Spent</div></div><div class=\"report-section-body\">" + teamRowsHTML + "</div></div>";
    }
    if (mostExp || mostBidded) {
        html += "<div class=\"report-section\"><div class=\"report-section-header\"><div class=\"report-section-icon\">📊</div><div class=\"report-section-title\">Auction Records</div></div><div class=\"report-section-body\">" + recordsHTML + "</div></div>";
    }
    html += "<div class=\"report-section\"><div class=\"report-section-header\"><div class=\"report-section-icon\">✅</div><div class=\"report-section-title\">Sold Players (" + sold.length + ")</div></div><div class=\"report-section-body\"><div class=\"report-player-chips\">" + (soldChips || "<span style='color:var(--text2)'>No players sold yet.</span>") + "</div></div></div>";
    html += "<div class=\"report-section\"><div class=\"report-section-header\"><div class=\"report-section-icon\">❌</div><div class=\"report-section-title\">Unsold Players (" + unsold.length + ")</div></div><div class=\"report-section-body\"><div class=\"report-player-chips\">" + unsoldChips + "</div></div></div>";

    // Set timestamp
    var now = new Date();
    document.getElementById("reportTimestamp").textContent = now.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) + " • " + now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    document.getElementById("reportBody").innerHTML = html;
    openModal("modalAuctionReport");
    // Also refresh the news ticker
}
function generateAuctionBreakdown() {
    var soldCount = players.filter(function (p) { return p.sold; }).length;
    var totalSpentValue = teams.reduce(function (s, t) { return s + (t.initialPurse - t.purse); }, 0);
    var mostExp = auctionHistory.filter(function (h) { return h.status === "sold"; }).sort(function (a, b) { return b.price - a.price; })[0];

    var html = '<div class="end-dashboard anim-pop">' +
        '<div class="empty-icon">🏆</div>' +
        '<h2 class="end-title">Auction Complete</h2>' +
        '<p class="end-thanks" style="margin-top:8px;color:var(--text2);font-size:0.9rem">Thank you for participating!</p>' +
        '<div class="end-stats">' +
        '<div class="end-stat-box"><strong>' + soldCount + '</strong><span>Players Sold</span></div>' +
        '<div class="end-stat-box"><strong>' + fmtPrice(totalSpentValue) + '</strong><span>Total Spent</span></div>' +
        '</div>' +
        '<div class="end-analysis">' +
        '<h4>Strategic Breakdown</h4>' +
        '<div class="analysis-grid">';

    teams.forEach(function (t) {
        var squad = players.filter(function (p) { return p.soldTo === t.id; });
        var spent = t.initialPurse - t.purse;
        var avg = squad.length ? Math.round(spent / squad.length) : 0;
        var marquees = squad.filter(function (p) { return p.marquee; }).length;

        var tag = "Balanced";
        var flavor = "Kafi steady aur focused squad banayi hai.";

        if (marquees >= 3) { tag = "Star Collectors"; flavor = "Bade players par daao lagaya! Marquee heavyweight squad."; }
        else if (spent < t.initialPurse * 0.5 && squad.length > 8) { tag = "Value Seekers"; flavor = "Dimag se khele! Saste mein bhot ache players uthaye."; }
        else if (spent > t.initialPurse * 0.85) { tag = "Big Spenders"; flavor = "Aggressive bidding! Paisa pani ki tarah bahaya talent ke liye."; }
        else if (squad.length > (MAX_SQUAD * 0.8)) { tag = "Depth Specialists"; flavor = "Sabse lambi bench! Har department mein options lock kiye."; }
        else if (avg > 500) { tag = "Quality over Quantity"; flavor = "Kam players lekin sab top-tier! Premium squad strategy."; }

        html += '<div class="analysis-card" style="border-left: 4px solid ' + (t.color || '#ff6a00') + '">' +
            '<div class="ac-team">' + t.name.toUpperCase() + '</div>' +
            '<div class="ac-tag">' + tag.toUpperCase() + '</div>' +
            '<p>' + flavor + '</p>' +
            '<div class="ac-meta">Bought ' + squad.length + ' players • Avg: ' + fmtPrice(avg) + '</div>' +
            '</div>';
    });

    html += '</div></div>';

    if (mostExp) {
        html += '<div class="end-highlight">🔥 <strong>MARQUEE MOMENT:</strong> ' + mostExp.playerName + ' commanded the highest price of ' + fmtPrice(mostExp.price) + ' to ' + mostExp.teamName + '!</div>';
    }


    var downloadBtnHtml = '';
    if (currentUser && currentUser.role === "admin") {
        downloadBtnHtml = '<button class="btn btn-success" onclick="downloadAllSquadsTxt()" style="margin-left:8px;">📥 Download All Squads</button>';
    } else if (currentUser && currentUser.role === "team") {
        downloadBtnHtml = '<button class="btn btn-success" onclick="downloadSquadTxt(\'' + currentUser.teamId + '\')" style="margin-left:8px;">📥 Download My Squad</button>';
    }


    var downloadBtnHtml = '';
    if (currentUser && currentUser.role === "admin") {
        downloadBtnHtml = '<button class="btn btn-success" onclick="downloadAllSquadsTxt()" style="margin-left:8px;">📥 Download All Squads</button>';
    } else if (currentUser && currentUser.role === "team") {
        downloadBtnHtml = '<button class="btn btn-success" onclick="downloadSquadTxt(\'' + currentUser.teamId + '\')" style="margin-left:8px;">📥 Download My Squad</button>';
    }

    html += '<div class="end-actions">' +
        '<button class="btn btn-info" onclick="currentSquadCardIndex=0; showSquadCard(teams[0].id)">📇 View Squad Cards</button>' +
        downloadBtnHtml +
        '<p style="margin-top:15px; font-size:0.85rem; color:var(--text2)">Full analytics available in the Analytics tab.</p>' +
        '</div></div>';




    return html;
}

// ============================================================
// FEATURE 22: DEEP STRATEGIC ANALYSIS OVERLAY
// ============================================================
var triggeredMilestones = {}; // Track to avoid repeats: {teamId_milestone: true}

function checkStrategicMilestones(teamId, lastPlayer) {
    var t = teams.find(function (x) { return x.id === teamId; });
    if (!t) return;
    var squad = players.filter(function (p) { return p.soldTo === teamId; });

    var cats = {
        "Batsman": squad.filter(function (p) { return p.category === "Batsman"; }),
        "Bowler": squad.filter(function (p) { return p.category === "Bowler"; }),
        "All-Rounder": squad.filter(function (p) { return p.category === "All-Rounder"; }),
        "Wicketkeeper": squad.filter(function (p) { return p.category === "Wicketkeeper"; })
    };

    // Sub-segmentation (Spin vs Pace)
    var spinners = cats["Bowler"].filter(function (p) {
        var n = p.name.toLowerCase();
        return n.includes("bishnoi") || n.includes("kuldeep") || n.includes("chahal") || n.includes("rashid") || n.includes("ashwin") || n.includes("spinner") || n.includes("spin");
    });
    var pacers = cats["Bowler"].filter(function (p) { return spinners.indexOf(p) === -1; });

    let milestone = null;
    let title = "";
    let desc = "";
    let relevantPlayers = [];

    if (spinners.length >= 3 && !triggeredMilestones[teamId + "_spin3"]) {
        milestone = "spin3";
        title = "SPIN FORTRESS";
        desc = "This team is building a lethal spin department! " + spinners.map(function (p) { return p.name; }).join(", ") + " will be a nightmare for any batting lineup on a dusty pitch.";
        relevantPlayers = spinners;
    } else if (pacers.length >= 3 && !triggeredMilestones[teamId + "_pace3"]) {
        milestone = "pace3";
        title = "PACE BATTERY";
        desc = "Raw pace alert! With " + pacers.map(function (p) { return p.name; }).join(", ") + ", this bowling attack looks set to rattle some stumps and destroy top orders.";
        relevantPlayers = pacers;
    } else if (cats['Batsman'].length >= 4 && !triggeredMilestones[teamId + "_bat4"]) {
        milestone = "bat4";
        title = "BATTING POWERHOUSE";
        desc = "Talk about depth! They've secured " + cats["Batsman"].map(function (p) { return p.name; }).join(", ") + ". This middle order is looking absolutely stacked for the season.";
        relevantPlayers = cats['Batsman'];
    } else if (cats['All-Rounder'].length >= 3 && !triggeredMilestones[teamId + "_ar3"]) {
        milestone = "ar3";
        title = "VERSATILE UNIT";
        desc = "The Swiss Army knife strategy! " + cats["All-Rounder"].map(function (p) { return p.name; }).join(", ") + " provide incredible balance and flexibility to this squad.";
        relevantPlayers = cats['All-Rounder'];
    }

    if (milestone) {
        triggeredMilestones[teamId + "_" + milestone] = true;
        showStrategyOverlay(title, desc, t.color || '#ff6a00', t.name, relevantPlayers);
        if (socket && currentUser && currentUser.role === "admin") {
            socket.emit("admin:strategy", { title: title, desc: desc, teamColor: t.color || '#ff6a00', teamName: t.name, relevantPlayers: relevantPlayers });
        }
    }
}

function showStrategyOverlay(title, desc, teamColor, teamName, relevantPlayers) {
    var overlay = document.getElementById("strategyOverlay");
    if (!overlay) return;
    var box = overlay.querySelector(".strategy-box");

    document.getElementById("strategyTitle").textContent = title;
    document.getElementById("strategyDesc").textContent = desc;
    document.getElementById("strategyTeamLine").textContent = "STRATEGIC MOVE BY " + teamName.toUpperCase();

    // Inject player chips
    var container = document.getElementById("strategyPlayers");
    container.innerHTML = relevantPlayers.map(function (p) {
        var chipImg = getEffectivePlayerImage(p);
        var fallback = getCategoryDefaultLogo(p.category);
        var imgPart = chipImg ? "<img src=\"" + chipImg + "\" class=\"strat-p-img\"" + (fallback ? " onerror=\"this.onerror=null;this.src='" + fallback + "'\"" : "") + ">" : "<div class=\"strat-p-img\" style=\"background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;font-size:10px;width:24px;height:24px;border-radius:50%\">" + p.name[0] + "</div>";
        return "<div class=\"strat-player-chip\">" + imgPart + "<span class=\"strat-p-name\">" + p.name + "</span></div>";
    }).join("");

    // Apply team color
    box.style.setProperty("--theme-color", teamColor);
    box.style.borderColor = teamColor + "44";

    overlay.classList.remove("hidden");
    overlay.classList.remove("fadeOut");

    // Auto-close after 6 seconds
    setTimeout(closeStrategyOverlay, 6500);
}

function closeStrategyOverlay() {
    var overlay = document.getElementById("strategyOverlay");
    if (!overlay) return;
    overlay.classList.add("fadeOut");
    setTimeout(function () {
        overlay.classList.add("hidden");
        overlay.classList.remove("fadeOut");
    }, 500);
}

// ============================================================
// PHASE 14: SQUAD EXPORTS & POOL PRICING
// ============================================================

function showMySquad() {
    if (!currentUser || currentUser.role !== "team") return;
    var teamId = currentUser.teamId;
    var team = teams.find(function (t) { return t.id === teamId; });
    if (!team) return;

    var myPlayers = players.filter(function (p) { return p.soldTo === teamId; });
    var title = document.getElementById("mySquadTitle");
    if (title) title.textContent = "📋 Squad: " + team.name + " (" + fmtPrice(team.purse) + ")";

    var content = document.getElementById("mySquadContent");
    if (!content) return;

    if (myPlayers.length === 0) {
        content.innerHTML = '<div class="empty-state" style="padding:40px;text-align:center;color:var(--text2)">No players bought yet. Start bidding!</div>';
    } else {
        var categories = ["Batsman", "Bowler", "All-Rounder", "Wicketkeeper"];
        var html = '<div class="squad-view-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:15px;margin-top:20px">';
        categories.forEach(function (cat) {
            var catPlayers = myPlayers.filter(function (p) { return p.category === cat; });
            if (catPlayers.length > 0) {
                html += "<div class=\"squad-cat-box\" style=\"background:var(--bg3);border-radius:12px;padding:15px;border-left:4px solid var(--accent)\"><div class=\"squad-cat-header\" style=\"font-weight:700;color:var(--accent);margin-bottom:10px;font-size:0.9rem\">" + cat.toUpperCase() + " (" + catPlayers.length + ")</div><div class=\"squad-cat-items\">" + catPlayers.map(function (p) {
                    return "<div class=\"squad-player-item\" style=\"display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:0.9rem\"><span class=\"p-name\">" + p.name + "</span><span class=\"p-price\" style=\"color:var(--gold);font-weight:600\">" + fmtPrice(p.soldPrice || p.price || p.basePrice) + "</span></div>";
                }).join("") + "</div></div>";
            }
        });
        html += "</div>";
        content.innerHTML = html;
    }

    var btnDownload = document.getElementById("btnDownloadMySquad");
    if (btnDownload) {
        btnDownload.onclick = function () { downloadSquadTxt(teamId); };
    }

    openModal("modalMySquad");
}

function downloadSquadTxt(teamId) {
    var team = teams.find(function (t) { return t.id === teamId; });
    if (!team) return;
    var myPlayers = players.filter(function (p) { return p.soldTo === teamId; });

    let text = `========================================\n`;
    text += `   GCL AUCTION 2025 - SQUAD REPORT    \n`;
    text += `========================================\n\n`;
    text += `TEAM: ${team.name.toUpperCase()}\n`;
    text += `PURSE REMAINING: ${fmtPrice(team.purse)}\n`;
    text += `PLAYERS BOUGHT: ${myPlayers.length}\n\n`;

    const categories = ["Batsman", "Bowler", "All-Rounder", "Wicketkeeper"];
    categories.forEach(function (cat) {
        var catPlayers = myPlayers.filter(function (p) { return p.category === cat; });
        if (catPlayers.length > 0) {
            text += "--- " + cat.toUpperCase() + " ---\n";
            catPlayers.forEach(function (p) {
                const pPrice = fmtPrice(p.soldPrice || p.price || p.basePrice);
                text += `${p.name.padEnd(25)} | ${pPrice}\n`;
            });
            text += `\n`;
        }
    });

    text += `Generated on: ${new Date().toLocaleString()}\n`;
    text += `========================================\n`;

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${team.name.replace(/\s+/g, "_")}_Squad.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast("Your squad report has been downloaded!", "success");
}

function downloadAllSquadsTxt() {
    var text = "========================================\n";
    text += "   GCL AUCTION 2025 - ALL SQUADS      \n";
    text += "========================================\n\n";

    teams.forEach(function (team) {
        var teamPlayers = players.filter(function (p) { return p.soldTo === team.id; });
        text += "\n----------------------------------------\n";
        text += "TEAM: " + team.name.toUpperCase() + "\n";
        text += "PURSE REMAINING: " + fmtPrice(team.purse) + "\n";
        text += "PLAYERS: " + teamPlayers.length + "\n";
        text += "----------------------------------------\n";

        var categories = ["Batsman", "Bowler", "All-Rounder", "Wicketkeeper"];
        categories.forEach(function (cat) {
            var catPlayers = teamPlayers.filter(function (p) { return p.category === cat; });
            if (catPlayers.length > 0) {
                text += "[" + cat.toUpperCase() + "]\n";
                catPlayers.forEach(function (p) {
                    var pPrice = fmtPrice(p.soldPrice || p.price || p.basePrice);
                    text += "- " + p.name.padEnd(20) + " | " + pPrice + "\n";
                });
                text += "\n";
            }
        });
    });

    text += `\n\nGenerated on: ${new Date().toLocaleString()}\n`;
    text += `Thank you for participating!`;

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `GCL_AUCTION_2025_FULL_REPORT.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast("Full squad report downloaded!", "success");
}

function openPoolPriceConfig() {
    openModal("modalPoolPrice");
}

function applyPoolPrices() {
    var prices = {
        "Batsman": parseInt(document.getElementById("poolPriceBatsman").value) || 0,
        "Bowler": parseInt(document.getElementById("poolPriceBowler").value) || 0,
        "All-Rounder": parseInt(document.getElementById("poolPriceAllRounder").value) || 0,
        "Wicketkeeper": parseInt(document.getElementById("poolPriceWicketkeeper").value) || 0,
        "Marquee": parseInt(document.getElementById("poolPriceMarquee").value) || 0
    };

    var updatedCount = 0;
    players.forEach(function (p) {
        if (!p.sold) {
            if (p.marquee && prices["Marquee"] > 0) {
                p.basePrice = prices["Marquee"];
                updatedCount++;
            } else if (prices[p.category] > 0) {
                p.basePrice = prices[p.category];
                updatedCount++;
            }
        }
    });

    persist();
    renderPlayers();
    closeModal("modalPoolPrice");
    toast("Successfully updated base prices for " + updatedCount + " players!", "success", null, true);
    if (window.BroadcastChannel) {
        new BroadcastChannel("ipl_auction").postMessage({ type: "SYNC_STATE" });
    }
}

// Bind buttons
// Bind buttons
setTimeout(function () {
    const btn = document.getElementById("btnApplyPoolPrices");
    if (btn) btn.onclick = applyPoolPrices;
}, 1000);

// ============================================================
//  SESSION MANAGEMENT — Client Side
// ============================================================

function openSaveSessionModal() {
    if (!currentUser || currentUser.role !== "admin") return;
    var msg = document.getElementById("saveSessionMsg");
    if (msg) { msg.textContent = ""; msg.className = "form-msg"; }
    var lbl = document.getElementById("saveSessionLabel");
    if (lbl) lbl.value = "";
    openModal("modalSaveSession");
    setTimeout(function () { if (lbl) lbl.focus(); }, 300);
}

function confirmSaveSession() {
    var lbl = document.getElementById("saveSessionLabel");
    var msg = document.getElementById("saveSessionMsg");
    var label = lbl ? lbl.value.trim() : "";
    if (!label) { label = "Session-" + new Date().toLocaleDateString("en-IN"); }

    var btn = document.getElementById("btnConfirmSaveSession");
    if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }

    fetch("/api/session/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                if (msg) { msg.textContent = "✅ Session saved: " + data.filename; msg.className = "form-msg success"; }
                toast("Session \"" + data.label + "\" saved successfully!", "success", 4000, true);
                setTimeout(function () { closeModal("modalSaveSession"); }, 1500);
            } else {
                if (msg) { msg.textContent = "❌ Error: " + data.error; msg.className = "form-msg error"; }
            }
        })
        .catch(function () {
            if (msg) { msg.textContent = "❌ Network error. Try again."; msg.className = "form-msg error"; }
        })
        .finally(function () {
            if (btn) { btn.disabled = false; btn.textContent = "💾 Save"; }
        });
}

function loadSessionList() {
    if (!currentUser || currentUser.role !== "admin") return;
    var container = document.getElementById("sessionListContainer");
    var body = document.getElementById("sessionListBody");
    if (container) container.classList.remove("hidden");
    if (body) body.innerHTML = "<p style='color:var(--text2);text-align:center;padding:20px;font-size:.85rem'>Loading...</p>";

    fetch("/api/session/list")
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (!data.success || !data.sessions.length) {
                if (body) body.innerHTML = "<p style='color:var(--text2);text-align:center;padding:20px;font-size:.85rem'>No saved sessions yet. Save your first session above!</p>";
                return;
            }
            var html = data.sessions.map(function (s) {
                var dt = s.savedAt ? new Date(s.savedAt).toLocaleString("en-IN") : "Unknown time";
                var fn = encodeURIComponent(s.filename);
                var lb = (s.label || s.filename).replace(/"/g, "'");
                return "<div class='session-row'>" +
                    "<div class='session-row-info'>" +
                    "<div class='session-row-label'>" + (s.label || s.filename) + "</div>" +
                    "<div class='session-row-date'>" + dt + "</div>" +
                    "</div>" +
                    "<div style='display:flex;gap:6px;align-items:center;flex-shrink:0'>" +
                    "<button class='btn btn-success btn-sm' onclick='loadAuctionSession(decodeURIComponent(\"" + fn + "\"),\"" + lb + "\")'>&#9654; Load</button>" +
                    "<button class='btn btn-danger btn-sm' onclick='deleteSession(decodeURIComponent(\"" + fn + "\"),\"" + lb + "\")'>&#128465;</button>" +
                    "</div>" +
                    "</div>";
            }).join("");
            if (body) body.innerHTML = html;
        })
        .catch(function () {
            if (body) body.innerHTML = "<p style='color:var(--danger);text-align:center;padding:20px'>Failed to fetch sessions.</p>";
        });
}

function loadAuctionSession(filename, label) {
    if (!confirm("Load \"" + label + "\"?\n\nThis will replace the live state for ALL users.\nClick OK to confirm.")) return;
    fetch("/api/session/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: filename })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                toast("\u2705 Session \"" + data.label + "\" loaded! State restored.", "success", 5000, true);
            } else {
                toast("\u274c Load failed: " + data.error, "error", 5000);
            }
        })
        .catch(function () { toast("\u274c Network error during load.", "error"); });
}

function deleteSession(filename, label) {
    if (!confirm("Delete \"" + label + "\"? This cannot be undone.")) return;
    fetch("/api/session/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: filename })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                toast("\ud83d\uddd1 Session \"" + label + "\" deleted.", "warning", 3000, true);
                loadSessionList();
            } else {
                toast("\u274c Delete failed: " + data.error, "error");
            }
        })
        .catch(function () { toast("\u274c Network error during delete.", "error"); });
}

function restoreAutosave() {
    showConfirm(
        "Restore Auto-Save",
        "Restore the last auto-saved auction state? This will replace the current live state for ALL connected users.",
        function () {
            if (socket) socket.emit("session:load_autosave");
        }
    );
}

function deleteAutosave() {
    if (!confirm("Delete the unsaved auto-save session? This cannot be undone.")) return;
    fetch("/api/session/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: "_autosave.json" })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                toast("\ud83d\uddd1 Auto-save deleted.", "warning", 3000, true);
                var banner = document.getElementById("autosaveBanner");
                if (banner) banner.classList.add("hidden");
            } else {
                toast("\u274c Delete failed: " + data.error, "error");
            }
        })
        .catch(function () { toast("\u274c Network error during delete.", "error"); });
}



// Check for autosave when admin loads the admin panel
var _sessionAutosaveChecked = false;
function checkAutosaveOnAdminPanel() {
    if (_sessionAutosaveChecked) return;
    if (currentUser && currentUser.role === "admin" && socket) {
        socket.emit("session:check_autosave");
        _sessionAutosaveChecked = true;
    }
}

// Hook into the existing renderAdminPanel or navTo("admin") flow
var _origNavTo = window.navTo;
if (typeof navTo === "function") {
    // Wrap navTo to check autosave when admin opens admin panel
    var __origNavTo = navTo;
    window.navTo = function (section) {
        __origNavTo(section);
        if (section === "admin") checkAutosaveOnAdminPanel();
    };
}