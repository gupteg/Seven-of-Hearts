window.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Loaded. Initializing script..."); // Log: Script start
    const socket = io();
    console.log("Socket object created."); // Log: Socket initialized

    window.gameState = {};
    let myPersistentPlayerId = sessionStorage.getItem('sevenOfHeartsPlayerId');
    let myPersistentPlayerName = sessionStorage.getItem('sevenOfHeartsPlayerName');
    console.log("Initial persistent ID:", myPersistentPlayerId, "Name:", myPersistentPlayerName); // Log: Initial session data

    // Card Naming Maps for SVGs
    const SUIT_MAP = { 'Hearts': 'hearts', 'Diamonds': 'diamonds', 'Clubs': 'clubs', 'Spades': 'spades' };
    const RANK_MAP = {
        'A': 'ace', 'K': 'king', 'Q': 'queen', 'J': 'jack',
        '10': '10', '9': '9', '8': '8', '7': '7', '6': '6',
        '5': '5', '4': '4', '3': '3', '2': '2'
    };
    const RANK_ORDER = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };
    const SUITS_ORDER = { 'Hearts': 1, 'Diamonds': 2, 'Clubs': 3, 'Spades': 4 };

    let isInitialGameRender = true;
    let pauseCountdownInterval;
    let lobbyReturnInterval;

    socket.on('connect', () => {
        // --- DEBUG LOG ADDED ---
        console.log("Socket connected successfully!");
        // --- END DEBUG LOG ---
        myPersistentPlayerId = sessionStorage.getItem('sevenOfHeartsPlayerId');
        myPersistentPlayerName = sessionStorage.getItem('sevenOfHeartsPlayerName');
        if (myPersistentPlayerId) {
            // --- DEBUG LOG ADDED ---
            console.log("Persistent ID found. Attempting auto-rejoin with ID:", myPersistentPlayerId, "Name:", myPersistentPlayerName);
            // --- END DEBUG LOG ---
            socket.emit('joinGame', { playerName: myPersistentPlayerName, playerId: myPersistentPlayerId });
        } else {
             // --- DEBUG LOG ADDED ---
             console.log("No persistent ID found. Waiting for manual join.");
             // --- END DEBUG LOG ---
        }
    });

    // --- DEBUG LOGS ADDED to setupJoinScreenListeners ---
    function setupJoinScreenListeners() {
        console.log("Setting up join screen listeners..."); // Log: Function called
        const joinButton = document.getElementById('join-game-btn');
        const playerNameInput = document.getElementById('player-name-input');

        if (!joinButton) {
            console.error("CRITICAL: Join Game button ('join-game-btn') not found in the DOM!"); // Log: Button missing
            return;
        }
        if (!playerNameInput) {
             console.error("CRITICAL: Player name input ('player-name-input') not found in the DOM!"); // Log: Input missing
             return;
        }
         console.log("Join button and name input found."); // Log: Elements found

        joinButton.addEventListener('click', () => {
            console.log("Join Game button clicked!"); // Log: Click detected
            const playerName = playerNameInput.value;
            console.log("Player name entered:", playerName); // Log: Name value read

            if (playerName.trim()) {
                console.log("Name is valid. Emitting 'joinGame' event..."); // Log: Attempting emit
                sessionStorage.setItem('sevenOfHeartsPlayerName', playerName);
                // Refresh persistent ID just in case (though unlikely on initial join)
                myPersistentPlayerId = sessionStorage.getItem('sevenOfHeartsPlayerId');
                socket.emit('joinGame', { playerName: playerName, playerId: myPersistentPlayerId });
                 console.log("'joinGame' event emitted."); // Log: Emit finished
            } else {
                 console.log("Name is empty or only whitespace. Showing warning."); // Log: Name invalid
                 showWarning('Missing Name', 'Please enter your name to join.');
            }
        });
         console.log("Join Game button click listener attached."); // Log: Listener attached
    }
    // --- END DEBUG LOGS ---

    setupJoinScreenListeners(); // Call the setup function
    setupLobbyEventListeners();
    setupModalAndButtonListeners();
    setupDynamicEventListeners();

    // Rest of the functions (setupLobby, setupModals, setupDynamic, socket handlers, renderers, etc.)
    // remain unchanged from the previous version...

    function setupLobbyEventListeners() {
        const readyBtn = document.getElementById('ready-btn');
        if (readyBtn) readyBtn.addEventListener('click', () => socket.emit('setPlayerReady', true));
        
        const startBtn = document.getElementById('start-game-btn');
        if (startBtn) startBtn.addEventListener('click', () => {
            const hostPassword = document.getElementById('host-password-input').value;
            const gameMode = document.querySelector('input[name="game-mode"]:checked').value;
            const winCondition = document.querySelector('input[name="win-condition"]:checked').value;
            socket.emit('startGame', { hostPassword, settings: { gameMode, winCondition } });
        });
        
        const endSessionBtn = document.getElementById('end-session-btn');
        if (endSessionBtn) endSessionBtn.addEventListener('click', () => document.getElementById('confirm-end-game-modal').classList.remove('hidden'));
        
        const hardResetBtn = document.getElementById('hard-reset-btn');
        if (hardResetBtn) hardResetBtn.addEventListener('click', () => document.getElementById('confirm-hard-reset-modal').classList.remove('hidden'));
    }

    function setupModalAndButtonListeners() {
        const logModal = document.getElementById('game-log-modal');
        const showLogsBtn = document.getElementById('show-logs-btn');
        if (showLogsBtn) showLogsBtn.addEventListener('click', () => {
            renderLogModal(window.gameState.logHistory || []);
            logModal.classList.remove('hidden');
        });
        const logModalClose = document.getElementById('game-log-modal-close');
        if (logModalClose) logModalClose.addEventListener('click', () => logModal.classList.add('hidden'));
        const logModalOk = document.getElementById('game-log-modal-ok-btn');
        if (logModalOk) logModalOk.addEventListener('click', () => logModal.classList.add('hidden'));

        // Other modal listeners... (ensure elements exist before adding listener)
        const scoreboardClose = document.getElementById('scoreboard-modal-close');
        if (scoreboardClose) scoreboardClose.addEventListener('click', () => document.getElementById('scoreboard-modal').classList.add('hidden'));

        const confirmEndYes = document.getElementById('confirm-end-yes-btn');
        if (confirmEndYes) confirmEndYes.addEventListener('click', () => { socket.emit('endSession'); document.getElementById('confirm-end-game-modal').classList.add('hidden'); });
        const confirmEndNo = document.getElementById('confirm-end-no-btn');
        if (confirmEndNo) confirmEndNo.addEventListener('click', () => document.getElementById('confirm-end-game-modal').classList.add('hidden'));

        const imBackBtn = document.getElementById('im-back-btn');
        if (imBackBtn) imBackBtn.addEventListener('click', () => { socket.emit('playerIsBack'); document.getElementById('afk-notification-modal').classList.add('hidden'); });

        const confirmResetYes = document.getElementById('confirm-reset-yes-btn');
        if (confirmResetYes) confirmResetYes.addEventListener('click', () => { socket.emit('hardReset'); document.getElementById('confirm-hard-reset-modal').classList.add('hidden'); });
        const confirmResetNo = document.getElementById('confirm-reset-no-btn');
        if (confirmResetNo) confirmResetNo.addEventListener('click', () => document.getElementById('confirm-hard-reset-modal').classList.add('hidden'));

        const warningOk = document.getElementById('warning-modal-ok-btn');
        if (warningOk) warningOk.addEventListener('click', () => document.getElementById('warning-modal').classList.add('hidden'));

        const returnToLobby = document.getElementById('return-to-lobby-btn');
        if (returnToLobby) returnToLobby.addEventListener('click', () => { document.getElementById('game-over-modal').classList.add('hidden'); document.getElementById('game-board').style.display = 'none'; document.getElementById('lobby-screen').style.display = 'block'; isInitialGameRender = true; });

        const passBtn = document.getElementById('pass-btn');
        if(passBtn) passBtn.addEventListener('click', () => socket.emit('passTurn'));
    }

    function setupDynamicEventListeners() {
        const playerListEl = document.getElementById('player-list');
        if (playerListEl) playerListEl.addEventListener('click', (e) => {
            if (e.target.classList.contains('kick-btn')) { const playerIdToKick = e.target.dataset.playerId; socket.emit('kickPlayer', playerIdToKick); }
        });

        const otherPlayersEl = document.getElementById('other-players-container');
        if(otherPlayersEl) otherPlayersEl.addEventListener('click', (e) => {
             const afkBtn = e.target.closest('.afk-btn'); if (afkBtn) { const playerIdToMark = afkBtn.dataset.playerId; socket.emit('markPlayerAFK', playerIdToMark); }
        });

        const myHandEl = document.getElementById('my-hand-container');
        if(myHandEl) myHandEl.addEventListener('click', (e) => {
            const cardWrapper = e.target.closest('.card-wrapper');
            if (cardWrapper && cardWrapper.classList.contains('playable-card')) {
                const cardImg = cardWrapper.querySelector('.card-img');
                if (!cardImg) return;
                const me = window.gameState.players.find(p => p.playerId === myPersistentPlayerId);
                const cardData = me.hand.find(c => c.id === cardImg.dataset.id);
                if (cardData) socket.emit('playCard', cardData);
            }
        });

        const scrollContainer = document.getElementById('mobile-scroll-container');
        const pageIndicator = document.getElementById('page-indicator');
        if (scrollContainer && pageIndicator) {
            scrollContainer.addEventListener('scroll', () => {
                const pageWidth = scrollContainer.offsetWidth;
                const currentPage = Math.round(scrollContainer.scrollLeft / pageWidth);
                pageIndicator.innerHTML = '';
                for (let i = 0; i < 2; i++) {
                    const dot = document.createElement('div'); dot.className = 'dot'; if (i === currentPage) dot.classList.add('active'); pageIndicator.appendChild(dot);
                }
            });
        }
    }

    socket.on('joinSuccess', (playerId) => {
        console.log("Received 'joinSuccess' with Player ID:", playerId); // Log: Join success received
        myPersistentPlayerId = playerId;
        sessionStorage.setItem('sevenOfHeartsPlayerId', playerId);
        // Only switch to lobby if we are NOT already in a game (window.gameState might be set by reconnect)
        if (!window.gameState) {
             console.log("Switching view to Lobby Screen."); // Log: Switching view
            document.getElementById('join-screen').style.display = 'none';
            document.getElementById('lobby-screen').style.display = 'block';
        } else {
            console.log("Join success received, but gameState exists (likely reconnect). Waiting for updateGameState."); // Log: Reconnect scenario
        }
    });

    socket.on('joinFailed', (message) => {
        console.error("Received 'joinFailed':", message); // Log: Join failed
        sessionStorage.removeItem('sevenOfHeartsPlayerId');
        sessionStorage.removeItem('sevenOfHeartsPlayerName');
        myPersistentPlayerId = null;
        myPersistentPlayerName = null;
        showWarning('Join Failed', message);
    });

    socket.on('kicked', () => {
        console.log("Received 'kicked' event. Reloading."); // Log: Kicked
        sessionStorage.removeItem('sevenOfHeartsPlayerId');
        sessionStorage.removeItem('sevenOfHeartsPlayerName');
        location.reload();
    });

    socket.on('forceDisconnect', () => {
        console.log("Received 'forceDisconnect' event. Reloading."); // Log: Force disconnect
        sessionStorage.removeItem('sevenOfHeartsPlayerId');
        sessionStorage.removeItem('sevenOfHeartsPlayerName');
        myPersistentPlayerId = null;
        myPersistentPlayerName = null;
        location.reload();
    });

    socket.on('lobbyUpdate', (players) => {
        console.log("Received 'lobbyUpdate'. Switching view to Lobby Screen."); // Log: Lobby update
        document.getElementById('game-board').style.display = 'none';
        document.getElementById('join-screen').style.display = 'none';
        document.getElementById('lobby-screen').style.display = 'block';
        renderLobby(players);
    });

    socket.on('gameStarted', () => {
        console.log("Received 'gameStarted'. Switching view to Game Board."); // Log: Game started
        document.getElementById('lobby-screen').style.display = 'none';
        document.getElementById('game-board').style.display = 'flex';
        isInitialGameRender = true; // Reset initial render flag
    });

    socket.on('updateGameState', (gs) => {
        console.log('Received GameState:', gs);
        window.gameState = gs;

        // Ensure correct screen is shown (important for reconnect)
        console.log("Switching view to Game Board (from updateGameState)."); // Log: Game state update
        document.getElementById('join-screen').style.display = 'none';
        document.getElementById('lobby-screen').style.display = 'none';
        document.getElementById('game-board').style.display = 'flex';

        const me = gs.players.find(p => p.playerId === myPersistentPlayerId);
        if (!me) {
            console.error("My player data not found in received gameState!"); // Log: Error if self not found
            return;
        }

        const gameMode = gs.settings.gameMode;
        renderMyInfo(me);
        renderMyHand(me, gs, gameMode);
        renderMyActions(me, gs, gameMode);
        renderOtherPlayers(gs.players, me, gs.currentPlayerId);
        renderGameStatusBanner(gs, me);
        renderRiver(gs.boardState, gameMode);

        if (isInitialGameRender) {
             console.log("Performing initial game render adjustments."); // Log: Initial render logic
            const mobileScroll = document.getElementById('mobile-scroll-container');
            if (window.innerWidth <= 850 && mobileScroll) {
                console.log("Scrolling mobile view to start."); // Log: Mobile scroll
                mobileScroll.scrollTo({ left: 0, behavior: 'auto' });
            }
            isInitialGameRender = false;
        }
    });

    socket.on('gameEnded', ({ logHistory }) => {
        console.log("Received 'gameEnded'."); // Log: Game ended
        renderGameOver(logHistory);
        if (lobbyReturnInterval) clearInterval(lobbyReturnInterval);
        lobbyReturnInterval = setInterval(() => {
             document.getElementById('game-over-modal').classList.add('hidden');
             // Don't switch screen here, wait for lobbyUpdate
             isInitialGameRender = true; // Reset for next game
             clearInterval(lobbyReturnInterval);
        }, 10000);
    });

    socket.on('youWereMarkedAFK', () => {
        console.log("Received 'youWereMarkedAFK'."); // Log: Marked AFK
        document.getElementById('afk-notification-modal').classList.remove('hidden');
    });

    socket.on('warning', (data) => {
        console.warn("Received 'warning':", data); // Log: Warning received
        if (typeof data === 'object' && data.title) {
            showWarning(data.title, data.message);
        } else {
            showWarning('Alert', data);
        }
    });

    // --- RENDER FUNCTIONS ---
    // (renderLobby, showWarning, renderGameOver, renderScoreboard, renderMyInfo,
    //  renderMyHand, renderMyActions, renderOtherPlayers, renderGameStatusBanner,
    //  updatePauseBanner, renderLogModal, createCardImageElement,
    //  createRiverCardImageElement, createRiverPlaceholder, renderRiver,
    //  getValidMoves, makeDraggable)
    // --- These functions remain unchanged from the previous version ---
    // --- But ensure they exist and are correctly defined ---

    function renderLobby(players) {
        const playerList = document.getElementById('player-list');
        const me = players.find(p => p.playerId === myPersistentPlayerId);
        if (!me) {
            console.warn("LobbyUpdate: My player data not found. Returning to join screen.");
            document.getElementById('join-screen').style.display = 'block';
            document.getElementById('lobby-screen').style.display = 'none';
            sessionStorage.removeItem('sevenOfHeartsPlayerId');
            myPersistentPlayerId = null; return;
        }
        playerList.innerHTML = '';
        players.forEach(p => { /* ... populate list ... */
            const li = document.createElement('li');
            let status = '';
            if (p.isHost) { status = '👑';
            } else if (!p.active) { status = '<span class="player-status-badge reconnecting">(Offline)</span>';
            } else if (p.isReady) { status = '<span style="color: green;">✅ Ready</span>';
            } else { status = '<span style="color: #b00;">❌ Not Ready</span>'; }
            li.innerHTML = `<span>${p.name} ${status}</span> ${(me && me.isHost && p.playerId !== me.playerId) ? `<button class="kick-btn danger-btn" data-player-id="${p.playerId}">Kick</button>` : ''}`;
            playerList.appendChild(li);
        });
        const playerActions = document.getElementById('player-lobby-actions');
        const hostActions = document.getElementById('host-lobby-actions');
        const hostMsg = document.getElementById('host-message');
        if (me && me.isHost) {
            if(playerActions) playerActions.style.display = 'none';
            if(hostActions) hostActions.style.display = 'block'; // Should be block or flex? Check CSS
            if(hostMsg) hostMsg.style.display = 'none';
            const startBtn = document.getElementById('start-game-btn');
            if (startBtn) {
                const allOthersReady = players.filter(p => p.playerId !== me.playerId).every(p => p.isReady || !p.active);
                startBtn.disabled = !allOthersReady;
            }
        } else {
            if(playerActions) playerActions.style.display = 'block';
            if(hostActions) hostActions.style.display = 'none';
            if(hostMsg) hostMsg.style.display = 'block';
            const readyBtn = document.getElementById('ready-btn');
            if (me && readyBtn) {
                readyBtn.disabled = me.isReady;
                readyBtn.textContent = me.isReady ? 'Ready!' : 'Ready';
                readyBtn.classList.toggle('confirm-btn', me.isReady);
            }
        }
    }
    function showWarning(title, text) {
        const titleEl = document.getElementById('warning-modal-title');
        const textEl = document.getElementById('warning-modal-text');
        const modalEl = document.getElementById('warning-modal');
        if(titleEl) titleEl.textContent = title;
        if(textEl) textEl.textContent = text;
        if(modalEl) modalEl.classList.remove('hidden');
    }
    function renderGameOver(logHistory) {
        const titleEl = document.getElementById('game-over-title');
        const winnerEl = document.getElementById('game-over-winner-text');
        const scoreEl = document.getElementById('game-over-scoreboard');
        const modalEl = document.getElementById('game-over-modal');
        const scoreboardContent = document.getElementById('scoreboard-content')?.innerHTML || 'Scoreboard not available.';

        if(titleEl) titleEl.textContent = 'Game Over!';
        if(winnerEl) winnerEl.textContent = 'The game has concluded.'; // Update with actual winner later
        if(scoreEl) scoreEl.innerHTML = scoreboardContent;
        if(modalEl) modalEl.classList.remove('hidden');
    }
    function renderScoreboard(players) {
        const scoreboard = document.getElementById('scoreboard-content');
        if (scoreboard) scoreboard.innerHTML = '<p>Scoring logic not yet implemented.</p>';
    }
    function renderMyInfo(me) {
        const nameEl = document.getElementById('my-name');
        const scoreEl = document.getElementById('my-score');
        if(nameEl) nameEl.textContent = `${me.name} (You) ${me.isHost ? '👑' : ''}`;
        if(scoreEl) scoreEl.textContent = me.score || 0;
    }
    function renderMyHand(me, gs, gameMode) {
        const handContainer = document.getElementById('my-hand-container');
        if(!handContainer) return;
        handContainer.innerHTML = '';
        if (!me || !me.hand) return;
        const sortedHand = me.hand.sort((a, b) => {
            if (SUITS_ORDER[a.suit] !== SUITS_ORDER[b.suit]) return SUITS_ORDER[a.suit] - SUITS_ORDER[b.suit];
            return RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
        });
        const validMoves = getValidMoves(me.hand, gs.boardState, gs.isFirstMove, gameMode);
        const validMoveIds = new Set(validMoves.map(card => card.id));
        sortedHand.forEach(card => {
            const cardEl = createCardImageElement(card, gameMode);
            if (validMoveIds.has(card.id) && me.playerId === gs.currentPlayerId) {
                cardEl.classList.add('playable-card');
            }
            handContainer.appendChild(cardEl);
        });
    }
    function renderMyActions(me, gs, gameMode) {
        const passBtn = document.getElementById('pass-btn');
        if(!passBtn) return;
        if (me.playerId === gs.currentPlayerId && !gs.isPaused) {
            passBtn.style.display = 'block';
            const validMoves = getValidMoves(me.hand, gs.boardState, gs.isFirstMove, gameMode);
            passBtn.disabled = validMoves.length > 0;
        } else {
            passBtn.style.display = 'none';
        }
    }
    function renderOtherPlayers(players, me, currentPlayerId) {
        const container = document.getElementById('other-players-container');
        if(!container) return;
        container.innerHTML = '';
        players.filter(p => p.playerId !== me.playerId).forEach(player => {
            const tile = document.createElement('div');
            tile.className = 'other-player-tile';
            if (player.playerId === currentPlayerId) tile.classList.add('active-player');
            let status = '';
            if (player.status === 'Disconnected') status = '<span class="other-player-status reconnecting">Offline</span>';
            let afkButton = '';
            if (me.isHost && player.status === 'Active') afkButton = `<button class="afk-btn danger-btn" data-player-id="${player.playerId}">AFK?</button>`;
            tile.innerHTML = `<div class="other-player-name">${player.name} ${player.isHost ? '👑' : ''} ${status}</div><div class="other-player-details"><div>Score: ${player.score || 0}</div><div>Cards: ${player.hand ? player.hand.length : 0}</div></div>${afkButton}`;
            container.appendChild(tile);
        });
    }
    function renderGameStatusBanner(gs, me) {
        const banner = document.getElementById('game-status-banner');
        if(!banner) return;
        if (gs.isPaused) { updatePauseBanner(gs); return; }
        if (pauseCountdownInterval) clearInterval(pauseCountdownInterval);
        const currentPlayer = gs.players.find(p => p.playerId === gs.currentPlayerId);
        if (!currentPlayer) { banner.textContent = "Waiting for game to start..."; return; }
        const latestLog = gs.logHistory[0] || "Game Started.";
        if (currentPlayer.playerId === me.playerId) {
            banner.textContent = `YOUR TURN. (${latestLog})`;
            if (gs.isFirstMove && !me.hand.find(c => c.id === '7-Hearts-0')) showWarning("Your Turn", "You do not have the 7 of Hearts. You must pass.");
            else if (gs.isFirstMove) showWarning("Your Turn", "You must play the 7 of Hearts to begin.");
        } else { banner.textContent = `Waiting for ${currentPlayer.name}... (${latestLog})`; }
    }
    function updatePauseBanner(gs) {
        const banner = document.getElementById('game-status-banner');
        if(!banner) return;
        if (pauseCountdownInterval) clearInterval(pauseCountdownInterval);
        const updateBanner = () => {
            const remaining = Math.max(0, Math.round((gs.pauseEndTime - Date.now()) / 1000));
            banner.innerHTML = `⏳ Game Paused. Waiting for ${gs.pausedForPlayerNames.join(', ')}... (${remaining}s) ⏳`;
            if (remaining === 0) clearInterval(pauseCountdownInterval);
        }; updateBanner(); pauseCountdownInterval = setInterval(updateBanner, 1000);
    }
    function renderLogModal(logHistory) {
        const content = document.getElementById('game-log-modal-content');
        if(!content) return;
        if (!logHistory || logHistory.length === 0) content.innerHTML = "<div>No log entries yet.</div>";
        else content.innerHTML = logHistory.map(entry => `<div>${entry}</div>`).join('');
    }
    function createCardImageElement(card, gameMode) {
        const wrapper = document.createElement('div'); wrapper.className = 'card-wrapper';
        const img = document.createElement('img'); img.className = 'card-img';
        const suit = SUIT_MAP[card.suit]; const rank = RANK_MAP[card.rank];
        img.src = `/assets/cards/${suit}_${rank}.svg`; img.alt = `${card.rank} of ${card.suit}`;
        img.dataset.id = card.id; img.dataset.suit = card.suit; img.dataset.rank = card.rank;
        wrapper.appendChild(img);
        if (gameMode === 'two-deck-strict') {
            const deckIndex = card.id.split('-')[2]; const indicator = document.createElement('span');
            indicator.className = 'deck-indicator'; indicator.textContent = parseInt(deckIndex) + 1;
            wrapper.appendChild(indicator);
        } return wrapper;
    }
    function createRiverCardImageElement(suit, rank) {
        const img = document.createElement('img'); img.className = 'river-card';
        const suitName = SUIT_MAP[suit]; const rankName = RANK_MAP[rank];
        img.src = `/assets/cards/${suitName}_${rankName}.svg`; img.alt = `${rank} of ${suit}`;
        return img;
    }
    function createRiverPlaceholder(rank) {
        const el = document.createElement('div'); el.className = 'river-card-placeholder'; el.textContent = rank; return el;
    }
    function renderRiver(boardState, gameMode) {
        const riverContainer = document.getElementById('river-container');
        if(!riverContainer) return; riverContainer.innerHTML = '';
        const allRanks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        let suitsToRender = []; let numDecks = 1;
        if (gameMode === 'one-deck') suitsToRender = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
        else { numDecks = 2; suitsToRender = ['Hearts-0', 'Diamonds-0', 'Clubs-0', 'Spades-0', 'Hearts-1', 'Diamonds-1', 'Clubs-1', 'Spades-1']; }
        suitsToRender.forEach(suitKey => {
            const layout = boardState[suitKey]; const row = document.createElement('div'); row.className = 'river-row';
            let suitName, deckIndexStr;
            if (gameMode === 'one-deck') suitName = suitKey;
            else [suitName, deckIndexStr] = suitKey.split('-');
            if (!layout) { const label = (numDecks === 2) ? `${suitName} (Deck ${parseInt(deckIndexStr) + 1})` : suitName; row.innerHTML = `<div class="river-placeholder">${label}</div>`; }
            else { const lowRankVal = layout.low; const highRankVal = layout.high;
                if (lowRankVal === 7 && highRankVal === 7) { row.appendChild(createRiverPlaceholder('6')); row.appendChild(createRiverCardImageElement(suitName, '7')); row.appendChild(createRiverPlaceholder('8')); }
                else { if (lowRankVal > 1) { const prevRank = allRanks[lowRankVal - 2]; row.appendChild(createRiverPlaceholder(prevRank)); }
                    for (let r = lowRankVal; r <= highRankVal; r++) { const rankStr = allRanks[r-1]; if (rankStr) row.appendChild(createRiverCardImageElement(suitName, rankStr)); }
                    if (highRankVal < 13) { const nextRank = allRanks[highRankVal]; row.appendChild(createRiverPlaceholder(nextRank)); }
                }
            } riverContainer.appendChild(row);
        });
    }
    function getValidMoves(hand, boardState, isFirstMove, gameMode) {
        const validMoves = []; if (!hand) return [];
        if (isFirstMove) { const sevenOfHearts0 = hand.find(c => c.id === '7-Hearts-0'); return sevenOfHearts0 ? [sevenOfHearts0] : []; }
        for (const card of hand) { const cardRankVal = RANK_ORDER[card.rank];
            if (gameMode === 'one-deck') { const layout = boardState[card.suit]; if (card.rank === '7') { if (!layout) validMoves.push(card); } else if (layout) { if (cardRankVal === layout.low - 1 || cardRankVal === layout.high + 1) validMoves.push(card); } }
            else if (gameMode === 'two-deck-strict') { const deckIndex = card.id.split('-')[2]; const suitKey = `${card.suit}-${deckIndex}`; const layout = boardState[suitKey]; if (card.rank === '7') { if (!layout) validMoves.push(card); } else if (layout) { if (cardRankVal === layout.low - 1 || cardRankVal === layout.high + 1) validMoves.push(card); } }
            else { const suit = card.suit; const layout0 = boardState[`${suit}-0`]; const layout1 = boardState[`${suit}-1`]; if (card.rank === '7') { const deckIndex = card.id.split('-')[2]; const suitKey = `${suit}-${deckIndex}`; if (!boardState[suitKey]) validMoves.push(card); } else { if (layout0 && (cardRankVal === layout0.low - 1 || cardRankVal === layout0.high + 1)) { validMoves.push(card); continue; } if (layout1 && (cardRankVal === layout1.low - 1 || cardRankVal === layout1.high + 1)) { validMoves.push(card); } } }
        } return validMoves;
    }
    function makeDraggable(modal) {
        const modalContent = modal.querySelector('.modal-content');
        const header = modal.querySelector('.modal-header');
        if (!header || !modalContent) return; // Added check for modalContent
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        const dragMouseDown = (e) => { e.preventDefault(); pos3 = e.clientX; pos4 = e.clientY; document.onmouseup = closeDragElement; document.onmousemove = elementDrag; };
        const dragTouchStart = (e) => { if (e.touches.length === 1) { pos3 = e.touches[0].clientX; pos4 = e.touches[0].clientY; document.ontouchend = closeTouchDragElement; document.ontouchmove = elementTouchDrag; } };
        const elementDrag = (e) => { e.preventDefault(); pos1 = pos3 - e.clientX; pos2 = pos4 - e.clientY; pos3 = e.clientX; pos4 = e.clientY; if (!modalContent.style.transform || modalContent.style.transform === 'translate(-50%, -50%)') { modalContent.style.left = '50%'; modalContent.style.top = '50%'; modalContent.style.transform = `translate(calc(-50% + ${modalContent.offsetLeft - pos1}px), calc(-50% + ${modalContent.offsetTop - pos2}px))`; } else { modalContent.style.top = (modalContent.offsetTop - pos2) + "px"; modalContent.style.left = (modalContent.offsetLeft - pos1) + "px"; } };
        const elementTouchDrag = (e) => { if (e.touches.length === 1) { e.preventDefault(); pos1 = pos3 - e.touches[0].clientX; pos2 = pos4 - e.touches[0].clientY; pos3 = e.touches[0].clientX; pos4 = e.touches[0].clientY; if (!modalContent.style.transform || modalContent.style.transform === 'translate(-50%, -50%)') { modalContent.style.left = '50%'; modalContent.style.top = '50%'; modalContent.style.transform = `translate(calc(-50% + ${modalContent.offsetLeft - pos1}px), calc(-50% + ${modalContent.offsetTop - pos2}px))`; } else { modalContent.style.top = (modalContent.offsetTop - pos2) + "px"; modalContent.style.left = (modalContent.offsetLeft - pos1) + "px"; } } };
        const closeDragElement = () => { document.onmouseup = null; document.onmousemove = null; };
        const closeTouchDragElement = () => { document.ontouchend = null; document.ontouchmove = null; };
        header.addEventListener('mousedown', dragMouseDown);
        header.addEventListener('touchstart', dragTouchStart, { passive: false });
    }

    // Ensure modals exist before trying to make them draggable
    document.querySelectorAll('.modal').forEach(modal => {
        if(modal) makeDraggable(modal);
    });

    console.log("Script initialization complete. Waiting for socket connection..."); // Log: End of initial script run
});