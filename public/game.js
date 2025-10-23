window.addEventListener('DOMContentLoaded', () => {
    // MODIFIED: Use relative path for socket connection
    const socket = io();

    window.gameState = {};
    // MODIFIED: Changed session storage keys
    let myPersistentPlayerId = sessionStorage.getItem('sevenOfHeartsPlayerId');
    let myPersistentPlayerName = sessionStorage.getItem('sevenOfHeartsPlayerName');
    
    let isInitialGameRender = true;
    let pauseCountdownInterval;
    let lobbyReturnInterval;
    
    // --- NEW: Client-side constants for sorting/logic ---
    const SUITS_ORDER = { 'Hearts': 1, 'Diamonds': 2, 'Clubs': 3, 'Spades': 4 };
    const RANK_ORDER = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };
    // --- END: Constants ---
    
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
        document.getElementById('ready-btn').addEventListener('click', () => {
            socket.emit('setPlayerReady', true);
        });

        document.getElementById('start-game-btn').addEventListener('click', () => {
            const hostPassword = document.getElementById('host-password-input').value;
            
            const deckCount = document.querySelector('input[name="deck-count"]:checked').value;
            const winCondition = document.querySelector('input[name="win-condition"]:checked').value;

            socket.emit('startGame', { 
                hostPassword,
                settings: {
                    deckCount: parseInt(deckCount, 10),
                    winCondition: winCondition
                }
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
        // RETAINED: All modal close/confirm/cancel buttons
        document.getElementById('scoreboard-btn').addEventListener('click', () => {
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

        // --- UPDATED: Pass Button listener is now active ---
        document.getElementById('pass-btn').addEventListener('click', () => {
            socket.emit('passTurn');
        });
        
        document.getElementById('game-log-ticker').addEventListener('click', () => {
            console.log('Open full log modal requested');
            showWarning('Alert', 'Full game log modal not yet implemented.');
        });
    }

    function setupDynamicEventListeners() {
        document.getElementById('player-list').addEventListener('click', (e) => {
            if (e.target.classList.contains('kick-btn')) {
                const playerIdToKick = e.target.dataset.playerId;
                socket.emit('kickPlayer', playerIdToKick);
            }
        });
        
        document.getElementById('game-board').addEventListener('click', (e) => {
             if (e.target.classList.contains('afk-btn')) {
                const playerIdToMark = e.target.dataset.playerId;
                socket.emit('markPlayerAFK', playerIdToMark);
            }
        });
        
        // --- UPDATED: Card click listener is now active ---
        document.getElementById('my-hand').addEventListener('click', (e) => {
            const cardEl = e.target.closest('.card');
            if (cardEl && cardEl.classList.contains('playable-card')) {
                const cardData = { 
                    suit: cardEl.dataset.suit, 
                    rank: cardEl.dataset.rank,
                    id: cardEl.dataset.id // Send unique ID
                };
                socket.emit('playCard', cardData);
            }
        });
        
        const scrollContainer = document.getElementById('mobile-scroll-container');
        const dots = document.querySelectorAll('.dot');
        if (scrollContainer && dots.length) {
            scrollContainer.addEventListener('scroll', () => {
                const pageWidth = scrollContainer.offsetWidth;
                const currentPage = Math.round(scrollContainer.scrollLeft / pageWidth);
                dots.forEach((dot, index) => {
                    dot.classList.toggle('active', index === currentPage);
                });
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
        document.getElementById('game-board').style.display = 'block';
    });
    
    socket.on('updateGameState', (gs) => {
        console.log('Received GameState:', gs);
        window.gameState = gs; // Store for debugging
        
        updateGameStatusBanner(gs);
        renderPlayerSlots(gs.players);
        
        // --- NEW: Call new render functions ---
        renderRiver(gs.boardState);
        renderGameLog(gs.logHistory);
        renderMyHand(gs.players);
        updatePlayerActions(gs);
        // --- END: New calls ---

        if (isInitialGameRender) {
            const mobileScroll = document.getElementById('mobile-scroll-container');
            if (window.innerWidth <= 850 && mobileScroll) {
                mobileScroll.scrollTo({ left: 0, behavior: 'auto' });
            }
            isInitialGameRender = false;
        }
    });
    
    socket.on('gameEnded', ({ logHistory }) => {
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

    socket.on('warning', (message) => {
        showWarning('Alert', message);
    });


    // --- RETAINED: Core Rendering Functions ---
    
    function renderLobby(players) {
        const playerList = document.getElementById('player-list');
        const me = players.find(p => p.playerId === myPersistentPlayerId);
        
        if (!me) { 
            playerList.innerHTML = '<p>Joining...</p>';
            return; 
        }
        
        playerList.innerHTML = '';
        players.forEach(p => {
            const li = document.createElement('li');
            
            let status = '';
            if (p.isHost) {
                status = '👑';
            } else if (!p.active) {
                status = '<span class="player-status-badge reconnecting">(Offline)</span>';
            } else if (p.isReady) {
                status = '<span style="color: green;">✅ Ready</span>';
            } else {
                status = '<span style="color: #b00;">❌ Not Ready</span>';
            }
            
            li.innerHTML = `
                <span>${p.name} ${status}</span>
                ${(me && me.isHost && p.playerId !== me.playerId) ? `<button class="kick-btn danger-btn" data-player-id="${p.playerId}">Kick</button>` : ''}
            `;
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

    function renderPlayerSlots(players) {
        const slotsContainers = {
            left: document.getElementById('player-slots-left'),
            top: document.getElementById('player-slots-top'),
            right: document.getElementById('player-slots-right'),
            bottom: document.getElementById('player-slots-bottom')
        };
        Object.values(slotsContainers).forEach(c => c.innerHTML = '');

        const me = players.find(p => p.playerId === myPersistentPlayerId);
        if (!me) return;
        
        const myIndex = players.findIndex(p => p.playerId === me.playerId);
        if (myIndex === -1) return; // Not in game yet
        
        const orderedPlayers = [...players.slice(myIndex), ...players.slice(0, myIndex)];
        
        const slotPositions = [
            slotsContainers.bottom, // Player 1 (You)
            slotsContainers.left,   // Player 2
            slotsContainers.left,   // Player 3
            slotsContainers.top,    // Player 4
            slotsContainers.top,    // Player 5
            slotsContainers.top,    // Player 6
            slotsContainers.right,  // Player 7
            slotsContainers.right   // Player 8
        ];

        orderedPlayers.forEach((p, index) => {
            if (p.status === 'Removed') return;
            
            const container = slotPositions[index];
            if (!container) return;
            
            const meInGame = window.gameState.players.find(p => p.playerId === myPersistentPlayerId);
            const isHostInGame = meInGame ? meInGame.isHost : false;

            const slot = createPlayerSlot(p, isHostInGame);
            container.appendChild(slot);
        });
    }
    
    function createPlayerSlot(player, isHost) {
        const slot = document.createElement('div');
        slot.className = `player-slot ${player.playerId === window.gameState.currentPlayerId ? 'active-player' : ''}`;
        slot.id = `slot-${player.playerId}`;

        let statusBadge = '';
        if (player.status === 'Disconnected') {
            statusBadge = '<span class="player-status-badge reconnecting">Reconnecting...</span>';
        }

        let afkButton = '';
        if (isHost && player.playerId !== myPersistentPlayerId && player.status === 'Active') {
            afkButton = `<button class="afk-btn danger-btn" data-player-id="${player.playerId}">AFK?</button>`;
        }
        
        const cardCount = player.hand ? player.hand.length : 0;
        
        slot.innerHTML = `
            <div class="player-name">${player.name} ${player.isHost ? '👑' : ''}</div>
            ${statusBadge}
            <div class="player-card-count">Cards: ${cardCount}</div>
            ${afkButton}
            `;
        return slot;
    }

    function updateGameStatusBanner(gs) {
        const banner = document.getElementById('game-status-banner');
        if (pauseCountdownInterval) clearInterval(pauseCountdownInterval);

        if (gs.isPaused) {
            const updateBanner = () => {
                const remaining = Math.max(0, Math.round((gs.pauseEndTime - Date.now()) / 1000));
                banner.innerHTML = `⏳ Game Paused. Waiting for ${gs.pausedForPlayerNames.join(', ')}... (${remaining}s) ⏳`;
                banner.style.display = 'block';
                if (remaining === 0) clearInterval(pauseCountdownInterval);
            };
            updateBanner();
            pauseCountdownInterval = setInterval(updateBanner, 1000);
        } else {
            banner.style.display = 'none';
        }
    }
    
    function renderGameOver(logHistory) {
        // TODO: Update this to show winner and final scores
        document.getElementById('game-over-title').textContent = 'Game Over!';
        document.getElementById('game-over-winner-text').textContent = 'The game has concluded.';
        
        const scoreboardContent = document.getElementById('scoreboard-content').innerHTML;
        document.getElementById('game-over-scoreboard').innerHTML = scoreboardContent;
        
        document.getElementById('game-over-modal').classList.remove('hidden');
    }

    function showWarning(title, text) {
        document.getElementById('warning-modal-title').textContent = title;
        document.getElementById('warning-modal-text').textContent = text;
        document.getElementById('warning-modal').classList.add('hidden');
    }
    
    function renderScoreboard(players) {
        // TODO: This needs to be completely rewritten for Seven of Hearts scoring
        const scoreboard = document.getElementById('scoreboard-content');
        scoreboard.innerHTML = '<p>Scoring logic not yet implemented.</p>';
    }

    // --- UPDATED: Real Seven of Hearts Render Functions ---
    
    function renderRiver(boardState) {
        const riverContainer = document.getElementById('river-container');
        riverContainer.innerHTML = ''; // Clear it
        
        const allSuits = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
        
        for (const suit of allSuits) {
            const layout = boardState[suit];
            const suitZone = document.createElement('div');
            suitZone.className = 'river-suit-zone';
            
            const riverLayout = document.createElement('div');
            riverLayout.className = 'river-layout';

            if (!layout) {
                // Suit hasn't been started
                riverLayout.innerHTML = `<div class="card-placeholder">${suit}</div>`;
            } else {
                // Render the overlapping stacks
                // Low stack (A-6)
                for (let r = layout.low; r < 7; r++) {
                    const rank = RANKS[r-1]; // RANK_ORDER is 1-based, RANKS is 0-based
                    riverLayout.appendChild(createMiniCard({ suit, rank }));
                }
                
                // The 7 (Anchor)
                const anchorCard = createMiniCard({ suit, rank: '7' });
                anchorCard.classList.add('anchor-7');
                riverLayout.appendChild(anchorCard);

                // High stack (8-K)
                for (let r = 8; r <= layout.high; r++) {
                    const rank = RANKS[r-1];
                    riverLayout.appendChild(createMiniCard({ suit, rank }));
                }
            }
            suitZone.appendChild(riverLayout);
            riverContainer.appendChild(suitZone);
        }
    }
    
    // Create a smaller card for the river
    function createMiniCard(card) {
        const cardEl = document.createElement('div');
        cardEl.className = 'card-mini';
        
        const suitSymbols = { 'Hearts': '♥', 'Spades': '♠', 'Diamonds': '♦', 'Clubs': '♣' };
        const color = (card.suit === 'Hearts' || card.suit === 'Diamonds') ? 'red' : 'black';
        
        cardEl.classList.add(color);
        cardEl.innerHTML = `
            <div class="card-mini-rank">${card.rank}</div>
            <div class="card-mini-suit">${suitSymbols[card.suit]}</div>
        `;
        return cardEl;
    }

    function renderGameLog(logHistory) {
        const logList = document.getElementById('game-log-list');
        if (!logList) return;
        logList.innerHTML = logHistory.slice(-5).reverse().map(entry => `<li>${entry}</li>`).join('');
    }
    
    function renderMyHand(players) {
        const me = players.find(p => p.playerId === myPersistentPlayerId);
        const handContainer = document.getElementById('my-hand');
        handContainer.innerHTML = '';
        
        if (!me || !me.hand) return;

        // --- UPDATED: Sort the hand ---
        const sortedHand = me.hand.sort((a, b) => {
            if (SUITS_ORDER[a.suit] !== SUITS_ORDER[b.suit]) {
                return SUITS_ORDER[a.suit] - SUITS_ORDER[b.suit];
            }
            return RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
        });
        
        sortedHand.forEach(card => {
            const cardEl = createCardElement(card);
            handContainer.appendChild(cardEl);
        });
    }
    
    function createCardElement(card) {
        const cardEl = document.createElement('div');
        cardEl.className = 'card';
        cardEl.dataset.suit = card.suit;
        cardEl.dataset.rank = card.rank;
        cardEl.dataset.id = card.id; // Unique ID
        
        const suitSymbols = { 'Hearts': '♥', 'Spades': '♠', 'Diamonds': '♦', 'Clubs': '♣' };
        const color = (card.suit === 'Hearts' || card.suit === 'Diamonds') ? 'red' : 'black';
        
        cardEl.classList.add(color);
        
        cardEl.innerHTML = `
            <div class="card-rank top">${card.rank}</div>
            <div class="card-suit">${suitSymbols[card.suit]}</div>
            <div class="card-rank bottom">${card.rank}</div>
        `;
        
        return cardEl;
    }

    // --- UPDATED: Real Action Logic ---
    function updatePlayerActions(gs) {
        const passBtn = document.getElementById('pass-btn');
        const me = gs.players.find(p => p.playerId === myPersistentPlayerId);

        if (me && me.playerId === gs.currentPlayerId && !gs.isPaused) {
            // It's my turn
            const validMoves = getValidMoves(me.hand, gs.boardState, gs.isFirstMove);
            
            // Show pass button
            passBtn.style.display = 'block';
            
            // Disable pass button if player HAS a valid move
            passBtn.disabled = validMoves.length > 0;
            
            // Highlight playable cards
            highlightPlayableCards(validMoves);

        } else {
            // Not my turn
            passBtn.style.display = 'none';
            highlightPlayableCards([]); // Clear highlights
        }
    }
    
    // --- NEW: Client-side validation ---
    function getValidMoves(hand, boardState, isFirstMove) {
        const validMoves = [];
        if (isFirstMove) {
            const sevenOfHearts = hand.find(c => c.rank === '7' && c.suit === 'Hearts');
            return sevenOfHearts ? [sevenOfHearts] : [];
        }

        for (const card of hand) {
            // Rule 1: Can always play a 7
            if (card.rank === '7') {
                validMoves.push(card);
                continue;
            }
            
            // Rule 2: Can build
            const suitLayout = boardState[card.suit];
            if (suitLayout) {
                const cardRankVal = RANK_ORDER[card.rank];
                if (cardRankVal === suitLayout.high + 1 || cardRankVal === suitLayout.low - 1) {
                    validMoves.push(card);
                }
            }
        }
        return validMoves;
    }

    function highlightPlayableCards(validMoves) {
        const handContainer = document.getElementById('my-hand');
        // Convert move list to a searchable set of IDs
        const validMoveIds = new Set(validMoves.map(card => card.id));

        // Remove highlight from all
        handContainer.querySelectorAll('.card').forEach(cardEl => {
            if (validMoveIds.has(cardEl.dataset.id)) {
                cardEl.classList.add('playable-card');
            } else {
                cardEl.classList.remove('playable-card');
            }
        });
    }
    
    // --- RETAINED: Draggable Modal Utility ---
    function makeDraggable(modal) {
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

        const closeDragElement = () => {
            document.onmouseup = null;
            document.onmousemove = null;
        };
        
        const closeTouchDragElement = () => {
            document.ontouchend = null;
            document.ontouchmove = null;
        };

        header.addEventListener('mousedown', dragMouseDown);
        header.addEventListener('touchstart', dragTouchStart, { passive: false });
    }

    makeDraggable(document.getElementById('scoreboard-modal'));
    makeDraggable(document.getElementById('confirm-end-game-modal'));
    makeDraggable(document.getElementById('afk-notification-modal'));
    makeDraggable(document.getElementById('confirm-hard-reset-modal'));
    makeDraggable(document.getElementById('warning-modal'));
    makeDraggable(document.getElementById('game-over-modal'));
});