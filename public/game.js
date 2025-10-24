window.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    window.gameState = {};
    let myPersistentPlayerId = sessionStorage.getItem('sevenOfHeartsPlayerId');
    let myPersistentPlayerName = sessionStorage.getItem('sevenOfHeartsPlayerName');
    
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
        myPersistentPlayerId = sessionStorage.getItem('sevenOfHeartsPlayerId');
        myPersistentPlayerName = sessionStorage.getItem('sevenOfHeartsPlayerName');
        if (myPersistentPlayerId) {
            socket.emit('joinGame', { playerName: myPersistentPlayerName, playerId: myPersistentPlayerId });
        }
    });
    
    setupJoinScreenListeners();
    setupLobbyEventListeners();
    setupModalAndButtonListeners();
    setupDynamicEventListeners();

    function setupJoinScreenListeners() { /* ... unchanged ... */ }
    function setupLobbyEventListeners() { 
        document.getElementById('ready-btn').addEventListener('click', () => socket.emit('setPlayerReady', true));
        
        // --- GAME MODE LOGIC: Send selected mode ---
        document.getElementById('start-game-btn').addEventListener('click', () => {
            const hostPassword = document.getElementById('host-password-input').value;
            const gameMode = document.querySelector('input[name="game-mode"]:checked').value;
            const winCondition = document.querySelector('input[name="win-condition"]:checked').value;
            socket.emit('startGame', { 
                hostPassword,
                settings: { gameMode, winCondition } // Send gameMode
            });
        });
        // --- END ---
        document.getElementById('end-session-btn').addEventListener('click', () => document.getElementById('confirm-end-game-modal').classList.remove('hidden'));
        document.getElementById('hard-reset-btn').addEventListener('click', () => document.getElementById('confirm-hard-reset-modal').classList.remove('hidden'));
    }
    function setupModalAndButtonListeners() { /* ... unchanged ... */ }
    function setupDynamicEventListeners() { 
        document.getElementById('player-list').addEventListener('click', (e) => { /* ... */ });
        document.getElementById('other-players-container').addEventListener('click', (e) => { /* ... */ });
        
        // --- GAME MODE LOGIC: Click listener targets wrapper ---
        document.getElementById('my-hand-container').addEventListener('click', (e) => {
            const cardWrapper = e.target.closest('.card-wrapper'); // Target the wrapper
            if (cardWrapper && cardWrapper.classList.contains('playable-card')) {
                const cardImg = cardWrapper.querySelector('.card-img'); // Get the img inside
                if (!cardImg) return;
                const me = window.gameState.players.find(p => p.playerId === myPersistentPlayerId);
                const cardData = me.hand.find(c => c.id === cardImg.dataset.id); // Find data using img's dataset
                if (cardData) {
                    socket.emit('playCard', cardData);
                }
            }
        });
        // --- END ---
        
        const scrollContainer = document.getElementById('mobile-scroll-container'); /* ... unchanged ... */
    }

    socket.on('joinSuccess', (playerId) => { /* ... unchanged ... */ });
    socket.on('joinFailed', (message) => { /* ... unchanged ... */ });
    socket.on('kicked', () => { /* ... unchanged ... */ });
    socket.on('forceDisconnect', () => { /* ... unchanged ... */ });
    socket.on('lobbyUpdate', (players) => { /* ... unchanged ... */ });
    socket.on('gameStarted', () => { /* ... unchanged ... */ });
    
    socket.on('updateGameState', (gs) => {
        console.log('Received GameState:', gs);
        window.gameState = gs;
        
        document.getElementById('join-screen').style.display = 'none';
        document.getElementById('lobby-screen').style.display = 'none';
        document.getElementById('game-board').style.display = 'flex';
        
        const me = gs.players.find(p => p.playerId === myPersistentPlayerId);
        if (!me) return;

        // --- GAME MODE LOGIC: Pass gameMode to renderers ---
        const gameMode = gs.settings.gameMode;
        renderMyInfo(me);
        renderMyHand(me, gs, gameMode); // Pass mode
        renderMyActions(me, gs, gameMode); // Pass mode
        renderOtherPlayers(gs.players, me, gs.currentPlayerId);
        renderGameStatusBanner(gs, me);
        renderRiver(gs.boardState, gameMode); // Pass mode instead of deckCount
        // --- END ---

        if (isInitialGameRender) { /* ... unchanged ... */ }
    });
    
    socket.on('gameEnded', ({ logHistory }) => { /* ... unchanged ... */ });
    socket.on('youWereMarkedAFK', () => { /* ... unchanged ... */ });
    socket.on('warning', (data) => { /* ... unchanged ... */ });

    function renderLobby(players) { /* ... unchanged ... */ }
    function showWarning(title, text) { /* ... unchanged ... */ }
    function renderGameOver(logHistory) { /* ... unchanged ... */ }
    function renderScoreboard(players) { /* ... unchanged ... */ }
    function renderMyInfo(me) { /* ... unchanged ... */ }

    // --- GAME MODE LOGIC: renderMyHand passes mode to createCard ---
    function renderMyHand(me, gs, gameMode) {
        const handContainer = document.getElementById('my-hand-container');
        handContainer.innerHTML = '';
        if (!me || !me.hand) return;
        const sortedHand = me.hand.sort((a, b) => { /* ... sort logic ... */ });
        
        // Pass gameMode to getValidMoves
        const validMoves = getValidMoves(me.hand, gs.boardState, gs.isFirstMove, gameMode); 
        const validMoveIds = new Set(validMoves.map(card => card.id));

        sortedHand.forEach(card => {
            // Pass gameMode to createCardImageElement
            const cardEl = createCardImageElement(card, gameMode); 
            if (validMoveIds.has(card.id) && me.playerId === gs.currentPlayerId) {
                cardEl.classList.add('playable-card'); // Add class to wrapper
            }
            handContainer.appendChild(cardEl);
        });
    }

    // --- GAME MODE LOGIC: renderMyActions passes mode ---
    function renderMyActions(me, gs, gameMode) {
        const passBtn = document.getElementById('pass-btn');
        if (me.playerId === gs.currentPlayerId && !gs.isPaused) {
            passBtn.style.display = 'block';
            // Pass gameMode to getValidMoves
            const validMoves = getValidMoves(me.hand, gs.boardState, gs.isFirstMove, gameMode); 
            passBtn.disabled = validMoves.length > 0;
        } else {
            passBtn.style.display = 'none';
        }
    }
    
    function renderOtherPlayers(players, me, currentPlayerId) { /* ... unchanged ... */ }
    function renderGameStatusBanner(gs, me) { 
         // --- GAME MODE LOGIC: First move check needs gameMode ---
        const banner = document.getElementById('game-status-banner');
        if (gs.isPaused) { updatePauseBanner(gs); return; }
        if (pauseCountdownInterval) clearInterval(pauseCountdownInterval);
        const currentPlayer = gs.players.find(p => p.playerId === gs.currentPlayerId);
        if (!currentPlayer) { banner.textContent = "Waiting for game to start..."; return; }
        const latestLog = gs.logHistory[0] || "Game Started.";
        if (currentPlayer.playerId === me.playerId) {
            banner.textContent = `YOUR TURN. (${latestLog})`;
            // First move check is always for 7-Hearts-0
            if (gs.isFirstMove && !me.hand.find(c => c.id === '7-Hearts-0')) {
                 showWarning("Your Turn", "You do not have the 7 of Hearts. You must pass.");
            } else if (gs.isFirstMove) {
                 showWarning("Your Turn", "You must play the 7 of Hearts to begin.");
            }
        } else { banner.textContent = `Waiting for ${currentPlayer.name}... (${latestLog})`; }
    }
    function updatePauseBanner(gs) { /* ... unchanged ... */ }
    function renderLogModal(logHistory) { /* ... unchanged ... */ }

    // --- GAME MODE LOGIC: Create Card Element adds wrapper and indicator ---
    function createCardImageElement(card, gameMode) {
        const wrapper = document.createElement('div');
        wrapper.className = 'card-wrapper';

        const img = document.createElement('img');
        img.className = 'card-img';
        const suit = SUIT_MAP[card.suit];
        const rank = RANK_MAP[card.rank];
        img.src = `/assets/cards/${suit}_${rank}.svg`;
        img.alt = `${card.rank} of ${card.suit}`;
        img.dataset.id = card.id; // ID still on the image for click handler
        img.dataset.suit = card.suit;
        img.dataset.rank = card.rank;
        
        wrapper.appendChild(img);

        // Add indicator only for strict 2-deck mode
        if (gameMode === 'two-deck-strict') {
            const deckIndex = card.id.split('-')[2];
            const indicator = document.createElement('span');
            indicator.className = 'deck-indicator';
            indicator.textContent = parseInt(deckIndex) + 1; // Show '1' or '2'
            wrapper.appendChild(indicator);
        }
        
        return wrapper; // Return the wrapper
    }

    function createRiverCardImageElement(suit, rank) { /* ... unchanged ... */ }
    function createRiverPlaceholder(rank) { /* ... unchanged ... */ }
    
    // --- GAME MODE LOGIC: Render River uses gameMode ---
    function renderRiver(boardState, gameMode) {
        const riverContainer = document.getElementById('river-container');
        riverContainer.innerHTML = '';
        
        const allRanks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        let suitsToRender = [];
        let numDecks = 1;

        if (gameMode === 'one-deck') {
            suitsToRender = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
        } else { // two-deck-fungible or two-deck-strict
            numDecks = 2;
            suitsToRender = [
                'Hearts-0', 'Diamonds-0', 'Clubs-0', 'Spades-0',
                'Hearts-1', 'Diamonds-1', 'Clubs-1', 'Spades-1'
            ];
        }

        suitsToRender.forEach(suitKey => {
            // For one-deck, suitKey is 'Hearts', for two-deck it's 'Hearts-0' etc.
            const layout = boardState[suitKey];
            const row = document.createElement('div');
            row.className = 'river-row';

            let suitName, deckIndexStr;
            if (gameMode === 'one-deck') {
                suitName = suitKey;
            } else {
                [suitName, deckIndexStr] = suitKey.split('-');
            }

            if (!layout) {
                 const label = (numDecks === 2) ? `${suitName} (Deck ${parseInt(deckIndexStr) + 1})` : suitName;
                 row.innerHTML = `<div class="river-placeholder">${label}</div>`;
            } else {
                const lowRankVal = layout.low; 
                const highRankVal = layout.high;

                if (lowRankVal === 7 && highRankVal === 7) {
                    row.appendChild(createRiverPlaceholder('6'));
                    row.appendChild(createRiverCardImageElement(suitName, '7'));
                    row.appendChild(createRiverPlaceholder('8'));
                } else {
                    if (lowRankVal > 1) { 
                        const prevRank = allRanks[lowRankVal - 2];
                        row.appendChild(createRiverPlaceholder(prevRank));
                    }
                    for (let r = lowRankVal; r <= highRankVal; r++) {
                        const rankStr = allRanks[r-1];
                        if (rankStr) row.appendChild(createRiverCardImageElement(suitName, rankStr));
                    }
                    if (highRankVal < 13) { 
                        const nextRank = allRanks[highRankVal];
                        row.appendChild(createRiverPlaceholder(nextRank));
                    }
                }
            }
            riverContainer.appendChild(row);
        });
    }


    // --- GAME MODE LOGIC: getValidMoves needs gameMode ---
    function getValidMoves(hand, boardState, isFirstMove, gameMode) {
        const validMoves = [];
        if (!hand) return [];
        
        if (isFirstMove) {
            const sevenOfHearts0 = hand.find(c => c.id === '7-Hearts-0');
            return sevenOfHearts0 ? [sevenOfHearts0] : [];
        }

        for (const card of hand) {
            const cardRankVal = RANK_ORDER[card.rank];

            // --- One Deck Logic ---
            if (gameMode === 'one-deck') {
                const layout = boardState[card.suit];
                if (card.rank === '7') { if (!layout) validMoves.push(card); } 
                else if (layout) { if (cardRankVal === layout.low - 1 || cardRankVal === layout.high + 1) validMoves.push(card); }
            } 
            // --- Two Deck (Strict) Logic ---
            else if (gameMode === 'two-deck-strict') {
                const deckIndex = card.id.split('-')[2];
                const suitKey = `${card.suit}-${deckIndex}`;
                const layout = boardState[suitKey];
                if (card.rank === '7') { if (!layout) validMoves.push(card); } 
                else if (layout) { if (cardRankVal === layout.low - 1 || cardRankVal === layout.high + 1) validMoves.push(card); }
            } 
            // --- Two Deck (Fungible) Logic ---
            else { // two-deck-fungible
                 const suit = card.suit;
                 const layout0 = boardState[`${suit}-0`];
                 const layout1 = boardState[`${suit}-1`];

                 if (card.rank === '7') {
                     const deckIndex = card.id.split('-')[2];
                     const suitKey = `${suit}-${deckIndex}`;
                     if (!boardState[suitKey]) validMoves.push(card); // Can only start its own row
                 } else {
                     // Check if playable on row 0
                     if (layout0 && (cardRankVal === layout0.low - 1 || cardRankVal === layout0.high + 1)) {
                         validMoves.push(card);
                         continue; // Add only once even if playable on both
                     }
                     // Check if playable on row 1
                     if (layout1 && (cardRankVal === layout1.low - 1 || cardRankVal === layout1.high + 1)) {
                         validMoves.push(card);
                     }
                 }
            }
        }
        return validMoves;
    }
    
    function makeDraggable(modal) { /* ... unchanged ... */ }

    document.querySelectorAll('.modal').forEach(makeDraggable);
});