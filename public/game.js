window.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    window.gameState = {};
    let myPersistentPlayerId = sessionStorage.getItem('sevenOfHeartsPlayerId');
    let myPersistentPlayerName = sessionStorage.getItem('sevenOfHeartsPlayerName');
    
    // --- NEW: Card Naming Maps for SVGs ---
    const SUIT_MAP = { 'Hearts': 'hearts', 'Diamonds': 'diamonds', 'Clubs': 'clubs', 'Spades': 'spades' };
    const RANK_MAP = {
        'A': 'ace', 'K': 'king', 'Q': 'queen', 'J': 'jack',
        '10': '10', '9': '9', '8': '8', '7': '7', '6': '6',
        '5': '5', '4': '4', '3': '3', '2': '2'
    };
    const RANK_ORDER = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };
    const SUITS_ORDER = { 'Hearts': 1, 'Diamonds': 2, 'Clubs': 3, 'Spades': 4 };
    // --- END: Card Naming Maps ---
    
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

    function setupJoinScreenListeners() {
        document.getElementById('join-game-btn').addEventListener('click', () => {
            const playerName = document.getElementById('player-name-input').value;
            if (playerName.trim()) {
                sessionStorage.setItem('sevenOfHeartsPlayerName', playerName);
                socket.emit('joinGame', { playerName: playerName, playerId: myPersistentPlayerId });
            }
        });
    }

    function setupLobbyEventListeners() {
        // ... (This function remains unchanged from your previous file) ...
        document.getElementById('ready-btn').addEventListener('click', () => {
            socket.emit('setPlayerReady', true);
        });
        document.getElementById('start-game-btn').addEventListener('click', () => {
            const hostPassword = document.getElementById('host-password-input').value;
            const deckCount = document.querySelector('input[name="deck-count"]:checked').value;
            const winCondition = document.querySelector('input[name="win-condition"]:checked').value;
            socket.emit('startGame', { 
                hostPassword,
                settings: { deckCount: parseInt(deckCount, 10), winCondition: winCondition }
            });
        });
        document.getElementById('end-session-btn').addEventListener('click', () => {
            document.getElementById('confirm-end-game-modal').classList.remove('hidden');
        });
        document.getElementById('hard-reset-btn').addEventListener('click', () => {
            document.getElementById('confirm-hard-reset-modal').classList.remove('hidden');
        });
    }

    function setupModalAndButtonListeners() {
        // --- NEW: Game Log Modal ---
        const logModal = document.getElementById('game-log-modal');
        document.getElementById('show-logs-btn').addEventListener('click', () => {
            renderLogModal(window.gameState.logHistory || []);
            logModal.classList.remove('hidden');
        });
        document.getElementById('game-log-modal-close').addEventListener('click', () => {
            logModal.classList.add('hidden');
        });
        document.getElementById('game-log-modal-ok-btn').addEventListener('click', () => {
            logModal.classList.add('hidden');
        });

        // --- RETAINED: Other Modals ---
        document.getElementById('scoreboard-btn')?.addEventListener('click', () => { // Optional chaining in case it's removed
            document.getElementById('scoreboard-modal').classList.remove('hidden');
        });
        document.getElementById('scoreboard-modal-close').addEventListener('click', () => {
            document.getElementById('scoreboard-modal').classList.add('hidden');
        });
        document.getElementById('confirm-end-yes-btn').addEventListener('click', () => {
            socket.emit('endSession');
            document.getElementById('confirm-end-game-modal').classList.add('hidden');
        });
        document.getElementById('confirm-end-no-btn').addEventListener('click', () => {
            document.getElementById('confirm-end-game-modal').classList.add('hidden');
        });
        document.getElementById('im-back-btn').addEventListener('click', () => {
            socket.emit('playerIsBack');
            document.getElementById('afk-notification-modal').classList.add('hidden');
        });
        document.getElementById('confirm-reset-yes-btn').addEventListener('click', () => {
            socket.emit('hardReset');
            document.getElementById('confirm-hard-reset-modal').classList.add('hidden');
        });
        document.getElementById('confirm-reset-no-btn').addEventListener('click', () => {
            document.getElementById('confirm-hard-reset-modal').classList.add('hidden');
        });
        document.getElementById('warning-modal-ok-btn').addEventListener('click', () => {
            document.getElementById('warning-modal').classList.add('hidden');
        });
        document.getElementById('return-to-lobby-btn').addEventListener('click', () => {
            document.getElementById('game-over-modal').classList.add('hidden');
            document.getElementById('game-board').style.display = 'none';
            document.getElementById('lobby-screen').style.display = 'block';
            isInitialGameRender = true;
        });

        // Pass Button
        document.getElementById('pass-btn').addEventListener('click', () => {
            socket.emit('passTurn');
        });
    }

    function setupDynamicEventListeners() {
        // Lobby Kick
        document.getElementById('player-list').addEventListener('click', (e) => {
            if (e.target.classList.contains('kick-btn')) {
                const playerIdToKick = e.target.dataset.playerId;
                socket.emit('kickPlayer', playerIdToKick);
            }
        });
        
        // --- NEW: Listener for the new Other Players container ---
        document.getElementById('other-players-container').addEventListener('click', (e) => {
             const afkBtn = e.target.closest('.afk-btn');
             if (afkBtn) {
                const playerIdToMark = afkBtn.dataset.playerId;
                socket.emit('markPlayerAFK', playerIdToMark);
            }
        });
        
        // Card click listener (now looks for .card-img)
        document.getElementById('my-hand-container').addEventListener('click', (e) => {
            const cardEl = e.target.closest('.card-img');
            if (cardEl && cardEl.classList.contains('playable-card')) {
                // Find the card object from the element's dataset-id
                const me = window.gameState.players.find(p => p.playerId === myPersistentPlayerId);
                const cardData = me.hand.find(c => c.id === cardEl.dataset.id);
                if (cardData) {
                    socket.emit('playCard', cardData);
                }
            }
        });
        
        // --- NEW: Mobile Swipe Listener (from Judgment) ---
        const scrollContainer = document.getElementById('mobile-scroll-container');
        const pageIndicator = document.getElementById('page-indicator');
        if (scrollContainer && pageIndicator) {
            scrollContainer.addEventListener('scroll', () => {
                const pageWidth = scrollContainer.offsetWidth;
                // We only have 2 pages (0 and 1)
                const currentPage = Math.round(scrollContainer.scrollLeft / pageWidth);
                pageIndicator.innerHTML = ''; // Clear dots
                for (let i = 0; i < 2; i++) {
                    const dot = document.createElement('div');
                    dot.className = 'dot';
                    if (i === currentPage) dot.classList.add('active');
                    pageIndicator.appendChild(dot);
                }
            });
        }
    }

    // --- RETAINED: Core Client-Side Handlers ---
    socket.on('joinSuccess', (playerId) => {
        myPersistentPlayerId = playerId;
        sessionStorage.setItem('sevenOfHeartsPlayerId', playerId);
        document.getElementById('join-screen').style.display = 'none';
        document.getElementById('lobby-screen').style.display = 'block';
    });

    socket.on('joinFailed', (message) => {
        sessionStorage.removeItem('sevenOfHeartsPlayerId');
        sessionStorage.removeItem('sevenOfHeartsPlayerName');
        myPersistentPlayerId = null;
        myPersistentPlayerName = null;
        showWarning('Join Failed', message);
    });
    
    socket.on('kicked', () => {
        sessionStorage.removeItem('sevenOfHeartsPlayerId');
        sessionStorage.removeItem('sevenOfHeartsPlayerName');
        location.reload();
    });

    socket.on('lobbyUpdate', (players) => {
        renderLobby(players);
    });

    socket.on('gameStarted', () => {
        document.getElementById('lobby-screen').style.display = 'none';
        document.getElementById('game-board').style.display = 'flex'; // Use flex
    });
    
    // --- UPDATED: Main GameState Handler ---
    socket.on('updateGameState', (gs) => {
        console.log('Received GameState:', gs);
        window.gameState = gs; // Store for debugging
        
        const me = gs.players.find(p => p.playerId === myPersistentPlayerId);
        if (!me) return; // Not in this game

        // --- NEW: Call all new render functions ---
        renderMyInfo(me);
        renderMyHand(me, gs);
        renderMyActions(me, gs);
        renderOtherPlayers(gs.players, me, gs.currentPlayerId);
        renderGameStatusBanner(gs, me);
        renderRiver(gs.boardState, gs.settings.deckCount);
        // --- END: New calls ---

        if (isInitialGameRender) {
            // Default to Page 1 (Dashboard) on mobile
            const mobileScroll = document.getElementById('mobile-scroll-container');
            if (window.innerWidth <= 850 && mobileScroll) {
                mobileScroll.scrollTo({ left: 0, behavior: 'auto' });
            }
            isInitialGameRender = false;
        }
    });
    
    socket.on('gameEnded', ({ logHistory }) => {
        // ... (This function remains unchanged) ...
        renderGameOver(logHistory);
        if (lobbyReturnInterval) clearInterval(lobbyReturnInterval);
        lobbyReturnInterval = setInterval(() => {
             document.getElementById('game-over-modal').classList.add('hidden');
             document.getElementById('game-board').style.display = 'none';
             document.getElementById('lobby-screen').style.display = 'block';
             isInitialGameRender = true;
             clearInterval(lobbyReturnInterval);
        }, 10000);
    });

    socket.on('hardReset', () => {
        sessionStorage.clear();
        location.reload();
    });
    
    socket.on('youWereMarkedAFK', () => {
        document.getElementById('afk-notification-modal').classList.remove('hidden');
    });

    // --- REFINED: Warning Handler ---
    // This now handles both public warnings and private modal-worthy warnings
    socket.on('warning', (data) => {
        // If server sends an object like { title: "X", message: "Y" }
        if (typeof data === 'object' && data.title) {
            showWarning(data.title, data.message);
        } else {
            // Otherwise, show a generic alert
            showWarning('Alert', data);
        }
    });


    // --- RETAINED: Lobby Rendering Function (Unchanged) ---
    function renderLobby(players) {
        // ... (This function remains unchanged from your previous file) ...
        const playerList = document.getElementById('player-list');
        const me = players.find(p => p.playerId === myPersistentPlayerId);
        if (!me) { playerList.innerHTML = '<p>Joining...</p>'; return; }
        playerList.innerHTML = '';
        players.forEach(p => {
            const li = document.createElement('li');
            let status = '';
            if (p.isHost) { status = '👑';
            } else if (!p.active) { status = '<span class="player-status-badge reconnecting">(Offline)</span>';
            } else if (p.isReady) { status = '<span style="color: green;">✅ Ready</span>';
            } else { status = '<span style="color: #b00;">❌ Not Ready</span>'; }
            li.innerHTML = `<span>${p.name} ${status}</span> ${(me && me.isHost && p.playerId !== me.playerId) ? `<button class="kick-btn danger-btn" data-player-id="${p.playerId}">Kick</button>` : ''}`;
            playerList.appendChild(li);
        });
        if (me && me.isHost) {
            document.getElementById('player-lobby-actions').style.display = 'none';
            document.getElementById('host-lobby-actions').style.display = 'block';
            document.getElementById('host-message').style.display = 'none';
            const allOthersReady = players.filter(p => p.playerId !== me.playerId).every(p => p.isReady || !p.active);
            document.getElementById('start-game-btn').disabled = !allOthersReady;
        } else {
            document.getElementById('player-lobby-actions').style.display = 'block';
            document.getElementById('host-lobby-actions').style.display = 'none';
            document.getElementById('host-message').style.display = 'block';
            if (me) {
                const readyBtn = document.getElementById('ready-btn');
                readyBtn.disabled = me.isReady;
                readyBtn.textContent = me.isReady ? 'Ready!' : 'Ready';
                readyBtn.classList.toggle('confirm-btn', me.isReady);
            }
        }
    }

    // --- RETAINED: Utility Functions (from Judgment) ---
    function showWarning(title, text) {
        document.getElementById('warning-modal-title').textContent = title;
        document.getElementById('warning-modal-text').textContent = text;
        document.getElementById('warning-modal').classList.remove('hidden');
    }
    
    function renderGameOver(logHistory) {
        // ... (This function remains unchanged) ...
        document.getElementById('game-over-title').textContent = 'Game Over!';
        document.getElementById('game-over-winner-text').textContent = 'The game has concluded.';
        const scoreboardContent = document.getElementById('scoreboard-content').innerHTML;
        document.getElementById('game-over-scoreboard').innerHTML = scoreboardContent;
        document.getElementById('game-over-modal').classList.remove('hidden');
    }

    function renderScoreboard(players) {
        // TODO: This needs to be completely rewritten for Seven of Hearts scoring
        const scoreboard = document.getElementById('scoreboard-content');
        scoreboard.innerHTML = '<p>Scoring logic not yet implemented.</p>';
    }

    // --- NEW: Game Board Render Functions (Dashboard) ---
    
    function renderMyInfo(me) {
        document.getElementById('my-name').textContent = `${me.name} (You) ${me.isHost ? '👑' : ''}`;
        document.getElementById('my-score').textContent = me.score || 0; // TODO: Use real score
    }

    function renderMyHand(me, gs) {
        const handContainer = document.getElementById('my-hand-container');
        handContainer.innerHTML = '';
        
        if (!me || !me.hand) return;

        // Sort the hand
        const sortedHand = me.hand.sort((a, b) => {
            if (SUITS_ORDER[a.suit] !== SUITS_ORDER[b.suit]) {
                return SUITS_ORDER[a.suit] - SUITS_ORDER[b.suit];
            }
            return RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
        });
        
        // Get valid moves
        const validMoves = getValidMoves(me.hand, gs.boardState, gs.isFirstMove);
        const validMoveIds = new Set(validMoves.map(card => card.id));

        sortedHand.forEach(card => {
            const cardEl = createCardImageElement(card);
            if (validMoveIds.has(card.id) && me.playerId === gs.currentPlayerId) {
                cardEl.classList.add('playable-card');
            }
            handContainer.appendChild(cardEl);
        });
    }

    function renderMyActions(me, gs) {
        const passBtn = document.getElementById('pass-btn');
        if (me.playerId === gs.currentPlayerId && !gs.isPaused) {
            passBtn.style.display = 'block';
            const validMoves = getValidMoves(me.hand, gs.boardState, gs.isFirstMove);
            passBtn.disabled = validMoves.length > 0;
        } else {
            passBtn.style.display = 'none';
        }
        // TODO: Add host-specific buttons
    }

    function renderOtherPlayers(players, me, currentPlayerId) {
        const container = document.getElementById('other-players-container');
        container.innerHTML = '';
        
        players.filter(p => p.playerId !== me.playerId).forEach(player => {
            const tile = document.createElement('div');
            tile.className = 'other-player-tile';
            if (player.playerId === currentPlayerId) {
                tile.classList.add('active-player');
            }

            let status = '';
            if (player.status === 'Disconnected') {
                status = '<span class="other-player-status reconnecting">Offline</span>';
            }

            let afkButton = '';
            if (me.isHost && player.status === 'Active') {
                afkButton = `<button class="afk-btn danger-btn" data-player-id="${player.playerId}">AFK?</button>`;
            }

            tile.innerHTML = `
                <div class="other-player-name">${player.name} ${player.isHost ? '👑' : ''} ${status}</div>
                <div class="other-player-details">
                    <div>Score: ${player.score || 0}</div>
                    <div>Cards: ${player.hand ? player.hand.length : 0}</div>
                </div>
                ${afkButton}
            `;
            container.appendChild(tile);
        });
    }

    // --- NEW: Game Board Render Functions (Table) ---

    function renderGameStatusBanner(gs, me) {
        const banner = document.getElementById('game-status-banner');
        if (gs.isPaused) {
            // This is complex, so it gets its own function
            updatePauseBanner(gs);
            return;
        }
        if (pauseCountdownInterval) clearInterval(pauseCountdownInterval);

        const currentPlayer = gs.players.find(p => p.playerId === gs.currentPlayerId);
        if (!currentPlayer) {
            banner.textContent = "Waiting for game to start...";
            return;
        }

        const latestLog = gs.logHistory[gs.logHistory.length - 1] || "Game Started.";
        
        if (currentPlayer.playerId === me.playerId) {
            banner.textContent = `YOUR TURN. (${latestLog})`;
            // Special private warning for 7 of Hearts
            if (gs.isFirstMove && !me.hand.find(c => c.rank === '7' && c.suit === 'Hearts')) {
                 showWarning("Your Turn", "You do not have the 7 of Hearts. You must pass.");
            } else if (gs.isFirstMove) {
                 showWarning("Your Turn", "You must play the 7 of Hearts to begin.");
            }
        } else {
            banner.textContent = `Waiting for ${currentPlayer.name}... (${latestLog})`;
        }
    }
    
    function updatePauseBanner(gs) {
        const banner = document.getElementById('game-status-banner');
        if (pauseCountdownInterval) clearInterval(pauseCountdownInterval);
        
        const updateBanner = () => {
            const remaining = Math.max(0, Math.round((gs.pauseEndTime - Date.now()) / 1000));
            banner.innerHTML = `⏳ Game Paused. Waiting for ${gs.pausedForPlayerNames.join(', ')}... (${remaining}s) ⏳`;
            if (remaining === 0) clearInterval(pauseCountdownInterval);
        };
        updateBanner();
        pauseCountdownInterval = setInterval(updateBanner, 1000);
    }
    
    function renderLogModal(logHistory) {
        const content = document.getElementById('game-log-modal-content');
        if (!logHistory || logHistory.length === 0) {
            content.innerHTML = "<div>No log entries yet.</div>";
            return;
        }
        content.innerHTML = logHistory.slice().reverse().map(entry => `<div>${entry}</div>`).join('');
    }

    /**
     * Creates an <img> element for a card in the player's hand.
     */
    function createCardImageElement(card) {
        const img = document.createElement('img');
        img.className = 'card-img';
        const suit = SUIT_MAP[card.suit];
        const rank = RANK_MAP[card.rank];
        img.src = `/public/assets/cards/${suit}_${rank}.svg`;
        img.alt = `${card.rank} of ${card.suit}`;
        img.dataset.id = card.id; // Crucial for click/highlight logic
        img.dataset.suit = card.suit;
        img.dataset.rank = card.rank;
        return img;
    }

    /**
     * Creates a smaller <img> element for the river.
     */
    function createRiverCardImageElement(suit, rank) {
        const img = document.createElement('img');
        img.className = 'river-card';
        const suitName = SUIT_MAP[suit];
        const rankName = RANK_MAP[rank];
        img.src = `/public/assets/cards/${suitName}_${rankName}.svg`;
        img.alt = `${rank} of ${suit}`;
        return img;
    }
    
    // --- NEW: "Smart River" Rendering Logic ---
    function renderRiver(boardState, numDecks) {
        const riverContainer = document.getElementById('river-container');
        riverContainer.innerHTML = '';
        
        // Define all suits for 1 or 2 decks
        const suitsToRender = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
        if (numDecks === 2) {
             suitsToRender.push('Hearts', 'Diamonds', 'Clubs', 'Spades');
        }
        
        suitsToRender.forEach((suit, index) => {
            // TODO: In 2-deck, we need to get the state for 'Hearts-1', 'Hearts-2'
            // This requires a server-side change. For now, we assume 1 deck logic.
            const layout = boardState[suit]; 
            
            const row = document.createElement('div');
            row.className = 'river-row';
            
            if (!layout) {
                // Suit hasn't been started
                row.innerHTML = `<div class="river-placeholder">${suit}</div>`;
            } else {
                // "Smart River" logic
                const allRanks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
                const lowRankVal = RANK_ORDER[layout.lowRank] || 1; // e.g., 'A' -> 1
                const highRankVal = RANK_ORDER[layout.highRank] || 13; // e.g., 'K' -> 13

                // Get all cards played in this suit
                const playedRanks = [];
                for (let r = lowRankVal; r <= highRankVal; r++) {
                    // Find rank string (e.g., 1 -> 'A')
                    const rankStr = Object.keys(RANK_ORDER).find(key => RANK_ORDER[key] === r);
                    if (rankStr) {
                        playedRanks.push(rankStr);
                    }
                }

                // Render the cards
                playedRanks.forEach(rank => {
                    const cardImg = createRiverCardImageElement(suit, rank);
                    
                    // Show 7, low, and high cards visibly
                    if (rank === '7' || rank === layout.lowRank || rank === layout.highRank) {
                        cardImg.classList.add('visible');
                    }
                    row.appendChild(cardImg);
                });
            }
            riverContainer.appendChild(row);
        });

        // --- HACK/TODO: Fix server-side boardState ---
        // The *current* boardState is { hearts: { low: 6, high: 8 } }
        // This is not what we agreed on. It should be { hearts: { lowRank: '6', highRank: '8' } }
        // I will write a *temporary* adapter for the old boardState to make the UI work.
        // PLEASE UPDATE YOUR SERVER to send the new boardState format.
        
        riverContainer.innerHTML = ''; // Clear again
        const tempSuits = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
        const allRanks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

        tempSuits.forEach(suit => {
            const layout = boardState[suit.toLowerCase()]; // e.g., boardState.hearts
            const row = document.createElement('div');
            row.className = 'river-row';

            if (!layout || (layout.low === 7 && layout.high === 7)) {
                // Suit hasn't been started (or only placeholder 7 is there)
                 row.innerHTML = `<div class="river-placeholder">${suit}</div>`;
            } else {
                // Ranks are 1-based (A=1), allRanks is 0-based
                const lowRankIndex = layout.low - 1; // e.g., 6 becomes index 5 ('6')
                const highRankIndex = layout.high - 1; // e.g., 8 becomes index 7 ('8')

                for (let i = lowRankIndex; i <= highRankIndex; i++) {
                    const rank = allRanks[i];
                    const cardImg = createRiverCardImageElement(suit, rank);
                    if (rank === '7' || i === lowRankIndex || i === highRankIndex) {
                        cardImg.classList.add('visible');
                    }
                    row.appendChild(cardImg);
                }
            }
            riverContainer.appendChild(row);
        });
        // --- END HACK ---
    }


    // --- NEW: Client-side validation ---
    function getValidMoves(hand, boardState, isFirstMove) {
        const validMoves = [];
        if (!hand) return [];
        
        if (isFirstMove) {
            const sevenOfHearts = hand.find(c => c.rank === '7' && c.suit === 'Hearts');
            return sevenOfHearts ? [sevenOfHearts] : [];
        }

        for (const card of hand) {
            const suitKey = card.suit.toLowerCase();
            const layout = boardState[suitKey];
            const cardRankVal = RANK_ORDER[card.rank];

            // Rule 1: Can play a 7 if that suit hasn't been started
            if (card.rank === '7') {
                // layout.low === 7 means only the placeholder 7 is there
                if (!layout || layout.low === 7) { 
                    validMoves.push(card);
                }
                continue;
            }
            
            // Rule 2: Can build
            if (layout) {
                if (cardRankVal === layout.low - 1 || cardRankVal === layout.high + 1) {
                    validMoves.push(card);
                }
            }
        }
        return validMoves;
    }
    
    // --- RETAINED: Draggable Modal Utility (from Judgment) ---
    function makeDraggable(modal) {
        // ... (This function remains unchanged from your previous file) ...
        const modalContent = modal.querySelector('.modal-content');
        const header = modal.querySelector('.modal-header');
        if (!header) return;
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        const dragMouseDown = (e) => {
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        };
        const dragTouchStart = (e) => {
            if (e.touches.length === 1) {
                pos3 = e.touches[0].clientX;
                pos4 = e.touches[0].clientY;
                document.ontouchend = closeTouchDragElement;
                document.ontouchmove = elementTouchDrag;
            }
        };
        const elementDrag = (e) => {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            if (!modalContent.style.transform || modalContent.style.transform === 'translate(-50%, -50%)') {
                 modalContent.style.left = '50%';
                 modalContent.style.top = '50%';
                 modalContent.style.transform = `translate(calc(-50% + ${modalContent.offsetLeft - pos1}px), calc(-50% + ${modalContent.offsetTop - pos2}px))`;
            } else {
                modalContent.style.top = (modalContent.offsetTop - pos2) + "px";
                modalContent.style.left = (modalContent.offsetLeft - pos1) + "px";
            }
        };
        const elementTouchDrag = (e) => {
            if (e.touches.length === 1) {
                e.preventDefault();
                pos1 = pos3 - e.touches[0].clientX;
                pos2 = pos4 - e.touches[0].clientY;
                pos3 = e.touches[0].clientX;
                pos4 = e.touches[0].clientY;
                if (!modalContent.style.transform || modalContent.style.transform === 'translate(-50%, -50%)') {
                     modalContent.style.left = '50%';
                     modalContent.style.top = '50%';
                     modalContent.style.transform = `translate(calc(-50% + ${modalContent.offsetLeft - pos1}px), calc(-50% + ${modalContent.offsetTop - pos2}px))`;
                } else {
                    modalContent.style.top = (modalContent.offsetTop - pos2) + "px";
                    modalContent.style.left = (modalContent.offsetLeft - pos1) + "px";
                }
            }
        };
        const closeDragElement = () => { document.onmouseup = null; document.onmousemove = null; };
        const closeTouchDragElement = () => { document.ontouchend = null; document.ontouchmove = null; };
        header.addEventListener('mousedown', dragMouseDown);
        header.addEventListener('touchstart', dragTouchStart, { passive: false });
    }

    // Make all modals draggable
    document.querySelectorAll('.modal').forEach(makeDraggable);
});