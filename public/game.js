window.addEventListener('DOMContentLoaded', () => {

// --- ADD LOG AT VERY START ---
    console.log("DEBUG: DOMContentLoaded event fired. Script starting.");
    // --- END ---






    // --- DEBUG LOG REMOVED ---
    // console.log("DOM Loaded. Initializing script...");
    const socket = io();
    // --- DEBUG LOG REMOVED ---
    // console.log("Socket object created.");

    window.gameState = {};
    let myPersistentPlayerId = sessionStorage.getItem('sevenOfHeartsPlayerId');
    let myPersistentPlayerName = sessionStorage.getItem('sevenOfHeartsPlayerName');
    // --- DEBUG LOG REMOVED ---
    // console.log("Initial persistent ID:", myPersistentPlayerId, "Name:", myPersistentPlayerName);

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
        // --- DEBUG LOG REMOVED ---
        // console.log("Socket connected successfully!");
        myPersistentPlayerId = sessionStorage.getItem('sevenOfHeartsPlayerId');
        myPersistentPlayerName = sessionStorage.getItem('sevenOfHeartsPlayerName');
        if (myPersistentPlayerId) {
            // --- DEBUG LOG REMOVED ---
            // console.log("Persistent ID found. Attempting auto-rejoin...");
            socket.emit('joinGame', { playerName: myPersistentPlayerName, playerId: myPersistentPlayerId });
        } else {
             // --- DEBUG LOG REMOVED ---
             // console.log("No persistent ID found. Waiting for manual join.");
        }
    });

    // --- Using the robust version from debugging ---
   function setupJoinScreenListeners() {
        const joinButton = document.getElementById('join-game-btn');
        const playerNameInput = document.getElementById('player-name-input');
        if (joinButton && playerNameInput) {
            joinButton.addEventListener('click', () => {
                // --- ADD LOG INSIDE CLICK HANDLER ---
                console.log("DEBUG: Join Game button was definitely clicked!");
                // --- END ---

                const playerName = playerNameInput.value;
                if (playerName.trim()) {
                    sessionStorage.setItem('sevenOfHeartsPlayerName', playerName);
                    console.log("DEBUG: Attempting to emit joinGame. Socket connected:", socket.connected); // Keep previous log too
                    socket.emit('joinGame', { playerName: playerName, playerId: myPersistentPlayerId });
                } else {
                     showWarning('Missing Name', 'Please enter your name to join.');
                }
            });
            console.log("DEBUG: Join button listener attached."); // Keep previous log too
        } else {
            console.error("CRITICAL: Could not find join button or player name input during initial setup!");
        }
    }

    setupJoinScreenListeners(); // Call the setup function
    setupLobbyEventListeners();
    setupModalAndButtonListeners(); // Call setup for modals *after* DOM is loaded
    setupDynamicEventListeners();


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

    // --- BUG FIX: Added existence checks for modal buttons ---
    function setupModalAndButtonListeners() {
        const logModal = document.getElementById('game-log-modal');
        const showLogsBtn = document.getElementById('show-logs-btn');
        const logModalClose = document.getElementById('game-log-modal-close'); // Get button elements
        const logModalOk = document.getElementById('game-log-modal-ok-btn'); // Get button elements

        if (showLogsBtn && logModal) {
            showLogsBtn.addEventListener('click', () => {
                renderLogModal(window.gameState?.logHistory); // Use optional chaining
                logModal.classList.remove('hidden');
            });
        }
        // Add listeners only if buttons exist
        if (logModalClose && logModal) {
            logModalClose.addEventListener('click', () => logModal.classList.add('hidden'));
        }
        if (logModalOk && logModal) {
            logModalOk.addEventListener('click', () => logModal.classList.add('hidden'));
        }

        // --- Add checks for ALL other modal buttons ---
        const scoreboardClose = document.getElementById('scoreboard-modal-close');
        if (scoreboardClose) scoreboardClose.addEventListener('click', () => document.getElementById('scoreboard-modal')?.classList.add('hidden'));

        const confirmEndYes = document.getElementById('confirm-end-yes-btn');
        if (confirmEndYes) confirmEndYes.addEventListener('click', () => { socket.emit('endSession'); document.getElementById('confirm-end-game-modal')?.classList.add('hidden'); });
        const confirmEndNo = document.getElementById('confirm-end-no-btn');
        if (confirmEndNo) confirmEndNo.addEventListener('click', () => document.getElementById('confirm-end-game-modal')?.classList.add('hidden'));

        const imBackBtn = document.getElementById('im-back-btn');
        if (imBackBtn) imBackBtn.addEventListener('click', () => { socket.emit('playerIsBack'); document.getElementById('afk-notification-modal')?.classList.add('hidden'); });

        const confirmResetYes = document.getElementById('confirm-reset-yes-btn');
        if (confirmResetYes) confirmResetYes.addEventListener('click', () => { socket.emit('hardReset'); document.getElementById('confirm-hard-reset-modal')?.classList.add('hidden'); });
        const confirmResetNo = document.getElementById('confirm-reset-no-btn');
        if (confirmResetNo) confirmResetNo.addEventListener('click', () => document.getElementById('confirm-hard-reset-modal')?.classList.add('hidden'));

        const warningOk = document.getElementById('warning-modal-ok-btn');
        if (warningOk) warningOk.addEventListener('click', () => document.getElementById('warning-modal')?.classList.add('hidden'));

        const returnToLobby = document.getElementById('return-to-lobby-btn');
        if (returnToLobby) returnToLobby.addEventListener('click', () => { document.getElementById('game-over-modal')?.classList.add('hidden'); document.getElementById('game-board').style.display = 'none'; document.getElementById('lobby-screen').style.display = 'block'; isInitialGameRender = true; });

        const passBtn = document.getElementById('pass-btn');
        if(passBtn) passBtn.addEventListener('click', () => socket.emit('passTurn'));
    }
    // --- END BUG FIX ---


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
                // Ensure 'me' and 'me.hand' exist before proceeding
                if (me && me.hand) {
                    const cardData = me.hand.find(c => c.id === cardImg.dataset.id);
                    if (cardData) socket.emit('playCard', cardData);
                } else {
                    console.error("Could not find player data or hand when clicking card.");
                }
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
        // --- DEBUG LOG REMOVED ---
        // console.log("Received 'joinSuccess' with Player ID:", playerId);
        myPersistentPlayerId = playerId;
        sessionStorage.setItem('sevenOfHeartsPlayerId', playerId);
        if (!window.gameState) {
            // --- DEBUG LOG REMOVED ---
            // console.log("Switching view to Lobby Screen.");
            document.getElementById('join-screen').style.display = 'none';
            document.getElementById('lobby-screen').style.display = 'block';
        } else {
             // --- DEBUG LOG REMOVED ---
             // console.log("Join success received, but gameState exists...");
        }
    });

    socket.on('joinFailed', (message) => { /* ... unchanged ... */ });
    socket.on('kicked', () => { /* ... unchanged ... */ });
    socket.on('forceDisconnect', () => { /* ... unchanged ... */ });
    socket.on('lobbyUpdate', (players) => { /* ... unchanged ... */ });
    socket.on('gameStarted', () => { /* ... unchanged ... */ });

    socket.on('updateGameState', (gs) => {
        // --- DEBUG LOG REMOVED ---
        // console.log('Received GameState:', gs);
        window.gameState = gs;

        // --- DEBUG LOG REMOVED ---
        // console.log("Switching view to Game Board (from updateGameState).");
        document.getElementById('join-screen').style.display = 'none';
        document.getElementById('lobby-screen').style.display = 'none';
        document.getElementById('game-board').style.display = 'flex';

        const me = gs.players.find(p => p.playerId === myPersistentPlayerId);
        if (!me) {
            console.error("My player data not found in received gameState!");
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
             // --- DEBUG LOG REMOVED ---
             // console.log("Performing initial game render adjustments.");
            const mobileScroll = document.getElementById('mobile-scroll-container');
            if (window.innerWidth <= 850 && mobileScroll) {
                 // --- DEBUG LOG REMOVED ---
                 // console.log("Scrolling mobile view to start.");
                mobileScroll.scrollTo({ left: 0, behavior: 'auto' });
            }
            isInitialGameRender = false;
        }
    });

    socket.on('gameEnded', ({ logHistory }) => { /* ... unchanged ... */ });
    socket.on('youWereMarkedAFK', () => { /* ... unchanged ... */ });
    socket.on('warning', (data) => { /* ... unchanged ... */ });

    function renderLobby(players) { /* ... unchanged ... */ }
    function showWarning(title, text) { /* ... unchanged ... */ }
    function renderGameOver(logHistory) { /* ... unchanged ... */ }
    function renderScoreboard(players) { /* ... unchanged ... */ }
    function renderMyInfo(me) { /* ... unchanged ... */ }
    function renderMyHand(me, gs, gameMode) { /* ... unchanged ... */ }
    function renderMyActions(me, gs, gameMode) { /* ... unchanged ... */ }
    function renderOtherPlayers(players, me, currentPlayerId) { /* ... unchanged ... */ }
    function renderGameStatusBanner(gs, me) { /* ... unchanged ... */ }
    function updatePauseBanner(gs) { /* ... unchanged ... */ }

    // --- BUG FIX: Made renderLogModal more robust ---
    function renderLogModal(logHistory) {
        const content = document.getElementById('game-log-modal-content');
        if(!content) {
             console.error("Could not find log modal content area!");
             return;
        }
        // Check if logHistory is valid and an array
        if (!logHistory || !Array.isArray(logHistory) || logHistory.length === 0) {
            content.innerHTML = "<div>No log entries yet.</div>";
        } else {
            // Use try-catch just in case map/join fails unexpectedly
            try {
                 content.innerHTML = logHistory.map(entry => `<div>${entry}</div>`).join('');
            } catch (error) {
                console.error("Error rendering log modal content:", error);
                content.innerHTML = "<div>Error displaying logs.</div>";
            }
        }
    }
    // --- END BUG FIX ---

    function createCardImageElement(card, gameMode) { /* ... unchanged ... */ }
    function createRiverCardImageElement(suit, rank) { /* ... unchanged ... */ }
    function createRiverPlaceholder(rank) { /* ... unchanged ... */ }
    function renderRiver(boardState, gameMode) { /* ... unchanged ... */ }
    function getValidMoves(hand, boardState, isFirstMove, gameMode) { /* ... unchanged ... */ }
    function makeDraggable(modal) { /* ... unchanged ... */ }

    document.querySelectorAll('.modal').forEach(modal => {
        if(modal) makeDraggable(modal);
    });

    // --- DEBUG LOG REMOVED ---
    // console.log("Script initialization complete. Waiting for socket connection...");
console.log("DEBUG: End of initial script execution within DOMContentLoaded."); // Add log at the end
});