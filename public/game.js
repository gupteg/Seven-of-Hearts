window.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    window.gameState = {};
    let myPersistentPlayerId = sessionStorage.getItem('sevenOfHeartsPlayerId');
    let myPersistentPlayerName = sessionStorage.getItem('sevenOfHeartsPlayerName');
    let previousGameState = null; // For move announcement diff
    let moveAnnouncementTimeout = null; // Timer for move announcement
    let rainInterval = null; // Timer for rain animation

    // --- Seven of Hearts Constants ---
    const SUIT_MAP = { 'Hearts': 'hearts', 'Diamonds': 'diamonds', 'Clubs': 'clubs', 'Spades': 'spades' };
    const RANK_MAP = {
        'A': 'ace', 'K': 'king', 'Q': 'queen', 'J': 'jack',
        '10': '10', '9': '9', '8': '8', '7': '7', '6': '6',
        '5': '5', '4': '4', '3': '3', '2': '2'
    };
    const RANK_ORDER = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };
    const ALL_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const SUITS_ORDER = { 'Hearts': 1, 'Diamonds': 2, 'Clubs': 3, 'Spades': 4 };
    const SUITS = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
    // --- END Constants ---


    let isInitialGameRender = true;
    let pauseCountdownInterval;
    let pauseCountdownIntervalMobile;

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
    setupSwipeNavigation();

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
            const deckCountSetting = document.querySelector('input[name="deck-count"]:checked').value;

            socket.emit('startGame', {
                hostPassword,
                settings: { deckCount: deckCountSetting, winCondition: "first_out" }
            });
        });

        document.getElementById('hard-reset-btn').addEventListener('click', () => {
            document.getElementById('confirm-hard-reset-modal').classList.remove('hidden');
        });
    }

    function setupModalAndButtonListeners() {
        // --- Player List Modal ---
        const playersModal = document.getElementById('players-modal');
        document.getElementById('show-players-btn').addEventListener('click', () => { playersModal.classList.remove('hidden'); });
        document.getElementById('show-players-btn-mobile').addEventListener('click', () => { playersModal.classList.remove('hidden'); });
        document.getElementById('players-modal-close').addEventListener('click', () => { playersModal.classList.add('hidden'); });
        document.getElementById('players-modal-ok-btn').addEventListener('click', () => { playersModal.classList.add('hidden'); });

        // --- Game Log Modal ---
        const logModal = document.getElementById('game-log-modal');
        document.getElementById('show-logs-btn').addEventListener('click', () => { renderLogModal(window.gameState.logHistory || []); logModal.classList.remove('hidden'); });
        document.getElementById('show-logs-btn-mobile').addEventListener('click', () => { renderLogModal(window.gameState.logHistory || []); logModal.classList.remove('hidden'); });
        document.getElementById('game-log-modal-close').addEventListener('click', () => { logModal.classList.add('hidden'); });
        document.getElementById('game-log-modal-ok-btn').addEventListener('click', () => { logModal.classList.add('hidden'); });

        // --- Other Modals ---
        document.getElementById('in-game-end-btn').addEventListener('click', () => { document.getElementById('confirm-end-game-modal').classList.remove('hidden'); });
        document.getElementById('scoreboard-modal-close').addEventListener('click', () => { document.getElementById('scoreboard-modal').classList.add('hidden'); });
        document.getElementById('confirm-end-yes-btn').addEventListener('click', () => { socket.emit('endSession'); document.getElementById('confirm-end-game-modal').classList.add('hidden'); });
        document.getElementById('confirm-end-no-btn').addEventListener('click', () => { document.getElementById('confirm-end-game-modal').classList.add('hidden'); });
        document.getElementById('im-back-btn').addEventListener('click', () => { socket.emit('playerIsBack'); document.getElementById('afk-notification-modal').classList.add('hidden'); });
        document.getElementById('confirm-reset-yes-btn').addEventListener('click', () => { socket.emit('hardReset'); document.getElementById('confirm-hard-reset-modal').classList.add('hidden'); });
        document.getElementById('confirm-reset-no-btn').addEventListener('click', () => { document.getElementById('confirm-hard-reset-modal').classList.add('hidden'); });
        document.getElementById('warning-modal-ok-btn').addEventListener('click', () => { document.getElementById('warning-modal').classList.add('hidden'); });

        // --- Pass Buttons ---
        document.getElementById('pass-btn').addEventListener('click', () => { socket.emit('passTurn'); });
        document.getElementById('pass-btn-mobile').addEventListener('click', () => { socket.emit('passTurn'); });

        // --- Round Over ---
        document.getElementById('round-over-ok-btn').addEventListener('click', () => { document.getElementById('round-over-modal').classList.add('hidden'); document.getElementById('waiting-for-host-modal').classList.remove('hidden'); });
        document.getElementById('start-next-round-btn').addEventListener('click', () => { socket.emit('requestNextRound'); document.getElementById('round-over-modal').classList.add('hidden'); });
        document.getElementById('start-next-round-fallback-btn').addEventListener('click', () => { socket.emit('requestNextRound'); });
        document.getElementById('round-over-end-game-btn').addEventListener('click', () => { document.getElementById('round-over-modal').classList.add('hidden'); document.getElementById('confirm-end-game-modal').classList.remove('hidden'); });
    }

    function setupDynamicEventListeners() {
        document.getElementById('player-list').addEventListener('click', (e) => {
            if (e.target.classList.contains('kick-btn')) {
                const playerIdToKick = e.target.dataset.playerId;
                socket.emit('kickPlayer', playerIdToKick);
            }
        });

        document.getElementById('players-modal-table-body').addEventListener('click', (e) => {
             const afkBtn = e.target.closest('.afk-btn');
             if (afkBtn) {
                const playerIdToMark = afkBtn.dataset.playerId;
                socket.emit('markPlayerAFK', playerIdToMark);
            }
        });

        document.getElementById('my-hand-container').addEventListener('click', (e) => {
            // *** REVERTED: Target the img again ***
            const cardEl = e.target.closest('.card-img');
            if (cardEl && cardEl.classList.contains('playable-card')) {
                const me = window.gameState.players.find(p => p.playerId === myPersistentPlayerId);
                if (!me) return;
                // *** REVERTED: Get ID from img ***
                const cardData = me.hand.find(c => c.id === cardEl.dataset.id);
                if (cardData) {
                    socket.emit('playCard', cardData);
                }
            }
        });

        // Mobile Toggle Button Logic
        const dashboardBtn = document.getElementById('show-dashboard-btn');
        const tableBtn = document.getElementById('show-table-btn');
        const gameBoard = document.getElementById('game-board');
        if (dashboardBtn && tableBtn && gameBoard) {
            dashboardBtn.addEventListener('click', () => { gameBoard.classList.remove('table-view'); dashboardBtn.classList.add('active'); tableBtn.classList.remove('active'); });
            tableBtn.addEventListener('click', () => { gameBoard.classList.add('table-view'); dashboardBtn.classList.remove('active'); tableBtn.classList.add('active'); });
        }
    }

    socket.on('joinSuccess', (playerId) => {
        myPersistentPlayerId = playerId;
        sessionStorage.setItem('sevenOfHeartsPlayerId', playerId);
        if (!window.gameState) {
            document.getElementById('join-screen').style.display = 'none';
            document.getElementById('lobby-screen').style.display = 'block';
        }
    });

    socket.on('joinFailed', (message) => {
        sessionStorage.removeItem('sevenOfHeartsPlayerId');
        sessionStorage.removeItem('sevenOfHeartsPlayerName');
        myPersistentPlayerId = null; myPersistentPlayerName = null;
        showWarning('Join Failed', message);
    });

    socket.on('kicked', () => { sessionStorage.removeItem('sevenOfHeartsPlayerId'); sessionStorage.removeItem('sevenOfHeartsPlayerName'); location.reload(); });
    socket.on('forceDisconnect', () => { sessionStorage.removeItem('sevenOfHeartsPlayerId'); sessionStorage.removeItem('sevenOfHeartsPlayerName'); myPersistentPlayerId = null; myPersistentPlayerName = null; location.reload(); });

    socket.on('lobbyUpdate', (players) => {
        document.getElementById('game-board').style.display = 'none';
        document.getElementById('join-screen').style.display = 'none';
        document.getElementById('lobby-screen').style.display = 'block';
        document.getElementById('game-over-modal').classList.add('hidden');
        renderLobby(players);
    });

    socket.on('gameStarted', () => { document.getElementById('lobby-screen').style.display = 'none'; document.getElementById('game-board').style.display = 'flex'; });

    socket.on('updateGameState', (gs) => {
        document.getElementById('round-over-modal').classList.add('hidden');
        document.getElementById('waiting-for-host-modal').classList.add('hidden');
        console.log('Received GameState:', gs);
        handleMoveAnnouncement(gs, previousGameState);
        previousGameState = JSON.parse(JSON.stringify(gs));
        window.gameState = gs;
        document.getElementById('join-screen').style.display = 'none';
        document.getElementById('lobby-screen').style.display = 'none';
        document.getElementById('game-board').style.display = 'flex';
        const me = gs.players.find(p => p.playerId === myPersistentPlayerId);
        if (!me) return;
        renderMyInfo(me);
        renderMyHand(me, gs);
        renderMyActions(me, gs);
        renderOtherPlayers(gs.players, me, gs.currentPlayerId, gs.dealerId);
        renderGameStatusBanner(gs, me);
        renderRiver(gs.boardState, gs.settings);
        renderScoreboard(gs.players);
        if (isInitialGameRender) {
            if (window.innerWidth <= 850) {
                document.getElementById('game-board').classList.remove('table-view');
                document.getElementById('show-dashboard-btn').classList.add('active');
                document.getElementById('show-table-btn').classList.remove('active');
            }
            isInitialGameRender = false;
        }
    });

    socket.on('roundOver', (data) => { showWinnerAnnouncement(data.winnerName + " wins the Round!", null, 5000, () => { renderRoundOverModal(data); }); });
    socket.on('gameOverAnnouncement', ({ winnerNames }) => {
        document.getElementById('round-over-modal').classList.add('hidden');
        document.getElementById('waiting-for-host-modal').classList.add('hidden');
        let winnerText = winnerNames.length === 1 ? winnerNames[0] + " wins the Game!" : (winnerNames.length > 1 ? "Joint Winners: " + winnerNames.join(', ') + "!" : "Game Over!");
        showWinnerAnnouncement(winnerText, "You will be taken to the lobby shortly...", 12000, null);
    });
    socket.on('gameEnded', ({ logHistory }) => { hideWinnerAnnouncement(); renderGameOver(logHistory); isInitialGameRender = true; });
    socket.on('youWereMarkedAFK', () => { document.getElementById('afk-notification-modal').classList.remove('hidden'); });
    socket.on('warning', (data) => { showWarning(typeof data === 'object' && data.title ? data.title : 'Alert', typeof data === 'object' && data.message ? data.message : data); });

    function renderLobby(players) {
        const playerList = document.getElementById('player-list');
        const me = players.find(p => p.playerId === myPersistentPlayerId);
        if (!me) { document.getElementById('join-screen').style.display = 'block'; document.getElementById('lobby-screen').style.display = 'none'; sessionStorage.removeItem('sevenOfHeartsPlayerId'); myPersistentPlayerId = null; return; }
        playerList.innerHTML = '';
        players.forEach(p => {
            const li = document.createElement('li');
            let status = p.isHost ? '👑' : (!p.active ? '<span class="player-status-badge reconnecting">(Offline)</span>' : (p.isReady ? '<span style="color: green;">✅ Ready</span>' : '<span style="color: #b00;">❌ Not Ready</span>'));
            li.innerHTML = `<span>${p.name} ${status}</span> ${(me && me.isHost && p.playerId !== me.playerId) ? `<button class="kick-btn danger-btn" data-player-id="${p.playerId}">Kick</button>` : ''}`;
            playerList.appendChild(li);
        });
        if (me && me.isHost) { document.getElementById('player-lobby-actions').style.display = 'none'; document.getElementById('host-lobby-actions').style.display = 'block'; document.getElementById('host-message').style.display = 'none'; document.getElementById('start-game-btn').disabled = !players.filter(p => p.playerId !== me.playerId).every(p => p.isReady || !p.active); }
        else { document.getElementById('player-lobby-actions').style.display = 'block'; document.getElementById('host-lobby-actions').style.display = 'none'; document.getElementById('host-message').style.display = 'block'; if (me) { const readyBtn = document.getElementById('ready-btn'); readyBtn.disabled = me.isReady; readyBtn.textContent = me.isReady ? 'Ready!' : 'Ready'; readyBtn.classList.toggle('confirm-btn', me.isReady); } }
    }

    function showWarning(title, text) { document.getElementById('warning-modal-title').textContent = title; document.getElementById('warning-modal-text').textContent = text; document.getElementById('warning-modal').classList.remove('hidden'); }

    function renderGameOver(logHistory) {
        document.getElementById('game-over-title').textContent = 'Game Over!';
        document.getElementById('game-over-winner-text').textContent = 'The game has concluded.';
        document.getElementById('game-over-scoreboard').innerHTML = document.getElementById('scoreboard-content').innerHTML;
        document.getElementById('game-over-modal').classList.remove('hidden');
    }

    function renderRoundOverModal(data) {
        const { scoreboard, winnerName, roundNumber, finalHands, hostId } = data;
        const me = window.gameState.players.find(p => p.playerId === myPersistentPlayerId);
        document.getElementById('round-over-title').textContent = `Round ${roundNumber} Complete!`;
        document.getElementById('round-over-winner-text').textContent = `🎉 ${winnerName} won the round! 🎉`;
        renderRoundScoreboardTable(scoreboard);
        renderFinalHands(finalHands, scoreboard);
        document.getElementById('start-next-round-btn').style.display = me && hostId === me.playerId ? 'block' : 'none';
        document.getElementById('round-over-end-game-btn').style.display = me && hostId === me.playerId ? 'block' : 'none';
        document.getElementById('round-over-ok-btn').style.display = !(me && hostId === me.playerId) ? 'block' : 'none';
        document.getElementById('round-over-modal').classList.remove('hidden');
    }

    function renderRoundScoreboardTable(scoreboardData) {
        const container = document.getElementById('round-over-scoreboard');
        let table = '<table><tr><th>Player</th><th class="score-col">Round Score</th><th class="score-col">Total Score</th></tr>';
        scoreboardData.forEach(player => { table += `<tr><td>${player.name}</td><td class="score-col">${player.roundScore}</td><td class="score-col">${player.cumulativeScore}</td></tr>`; });
        container.innerHTML = table + '</table>';
    }

    function renderFinalHands(finalHands, scoreboardData) {
        const container = document.getElementById('round-over-hands'); container.innerHTML = '';
        const numDecks = window.gameState?.settings?.deckCount || 1; const isFungible = window.gameState?.settings?.gameMode === 'fungible';
        if (!finalHands || !scoreboardData) return;
        scoreboardData.forEach(scoreEntry => {
            const player = window.gameState.players.find(p => p.name === scoreEntry.name.replace(' [Bot]', '')); if (!player) return;
            const hand = finalHands[player.playerId]; const handDiv = document.createElement('div'); handDiv.className = 'player-hand-display';
            const nameEl = document.createElement('div'); nameEl.className = 'player-hand-name'; nameEl.textContent = scoreEntry.name + ':'; handDiv.appendChild(nameEl);
            const cardsContainer = document.createElement('div'); cardsContainer.className = 'player-hand-cards';
            if (hand && hand.length > 0) {
                hand.sort((a, b) => SUITS_ORDER[a.suit] !== SUITS_ORDER[b.suit] ? SUITS_ORDER[a.suit] - SUITS_ORDER[b.suit] : RANK_ORDER[a.rank] - RANK_ORDER[b.rank])
                    .forEach(card => cardsContainer.appendChild(createSmallCardImage(card, numDecks, isFungible)));
            } else { cardsContainer.textContent = '(Empty)'; }
            handDiv.appendChild(cardsContainer); container.appendChild(handDiv);
        });
    }

    function createSmallCardImage(card, numDecks, isFungible) {
        const img = document.createElement('img'); img.className = 'final-card-img';
        const suit = SUIT_MAP[card.suit]; const rank = RANK_MAP[card.rank];
        img.src = `/assets/cards/${suit}_${rank}.svg`; img.alt = `${card.rank} of ${card.suit}`;
        const deckIndex = card.id.split('-')[2];
        // *** Apply tint class directly to img ***
        if (numDecks == 2 && !isFungible && deckIndex === '1') {
            img.classList.add('deck-1-tint'); // Apply class to img
        }
        return img;
    }

    function renderScoreboard(players) {
        const scoreboard = document.getElementById('scoreboard-content'); if (!players || players.length === 0) { scoreboard.innerHTML = '<p>No players in game.</p>'; return; }
        let table = '<table><tr><th>Player</th><th class="score-col">Total Score</th></tr>';
        [...players].sort((a, b) => (a.score || 0) - (b.score || 0)).forEach(player => { table += `<tr><td>${player.name} ${player.isHost ? '👑' : ''} ${player.isBot ? '[Bot]' : ''}</td><td class="score-col">${player.score || 0}</td></tr>`; });
        scoreboard.innerHTML = table + '</table>';
    }

    function renderMyInfo(me) { document.getElementById('my-name').textContent = `${me.name} (You) ${me.isHost ? '👑' : ''}`; document.getElementById('my-score').textContent = me.score || 0; document.getElementById('my-card-count').textContent = me.hand ? me.hand.length : 0; }

    function renderMyHand(me, gs) {
        const handContainer = document.getElementById('my-hand-container'); handContainer.innerHTML = ''; if (!me || !me.hand) return;
        const sortedHand = me.hand.sort((a, b) => SUITS_ORDER[a.suit] !== SUITS_ORDER[b.suit] ? SUITS_ORDER[a.suit] - SUITS_ORDER[b.suit] : RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
        const validMoves = getValidMoves(me.hand, gs); const validMoveIds = new Set(validMoves.map(card => card.id));
        const numDecks = gs.settings.deckCount; const isFungible = gs.settings.gameMode === 'fungible';
        sortedHand.forEach(card => {
            const cardEl = createCardImageElement(card, numDecks, isFungible); // Get img
            if (validMoveIds.has(card.id) && me.playerId === gs.currentPlayerId && !gs.isPaused) { cardEl.classList.add('playable-card'); } // Apply to img
            handContainer.appendChild(cardEl); // Append img
        });
    }

    function renderMyActions(me, gs) {
        const passBtn = document.getElementById('pass-btn'); const passBtnMobile = document.getElementById('pass-btn-mobile');
        const endBtn = document.getElementById('in-game-end-btn'); const fallbackBtn = document.getElementById('start-next-round-fallback-btn');
        if (me.playerId === gs.currentPlayerId && !gs.isPaused) {
            const validMoves = getValidMoves(me.hand, gs); const canPass = validMoves.length === 0;
            passBtn.style.display = 'block'; passBtn.disabled = !canPass;
            passBtnMobile.style.display = 'block'; passBtnMobile.disabled = !canPass;
        } else { passBtn.style.display = 'none'; passBtnMobile.style.display = 'none'; }
        endBtn.style.display = me.isHost ? 'block' : 'none'; fallbackBtn.style.display = (me.isHost && gs.isBetweenRounds) ? 'block' : 'none';
    }

    function renderOtherPlayers(players, me, currentPlayerId, dealerId) {
        const tableBody = document.getElementById('players-modal-table-body'); const actionHeader = document.getElementById('host-action-col-header'); tableBody.innerHTML = ''; let showActionColumn = false;
        players.filter(p => p.playerId !== me.playerId).forEach(player => {
            const row = document.createElement('tr'); if (player.playerId === currentPlayerId) { row.classList.add('active-player-row'); }
            let status = player.isBot ? '<span class="other-player-status bot">[Bot]</span>' : (player.status === 'Disconnected' ? '<span class="other-player-status reconnecting">Offline</span>' : '');
            const dealerIcon = (player.playerId === dealerId) ? ' (D)' : '';
            const playerCell = document.createElement('td'); playerCell.innerHTML = `${player.name} ${player.isHost ? '👑' : ''} ${dealerIcon} ${status}`;
            const cardsCell = document.createElement('td'); cardsCell.className = 'col-cards'; cardsCell.textContent = player.hand ? player.hand.length : 0;
            const scoreCell = document.createElement('td'); scoreCell.className = 'col-score'; scoreCell.textContent = player.score || 0;
            const actionCell = document.createElement('td'); actionCell.className = 'col-action';
            if (me.isHost && player.status === 'Active' && !player.isBot) { actionCell.innerHTML = `<button class="afk-btn danger-btn" data-player-id="${player.playerId}">AFK?</button>`; showActionColumn = true; }
            row.appendChild(playerCell); row.appendChild(cardsCell); row.appendChild(scoreCell); row.appendChild(actionCell); tableBody.appendChild(row);
        });
        if (actionHeader) { actionHeader.style.display = showActionColumn ? '' : 'none'; }
        document.querySelectorAll('#players-modal .col-action').forEach(cell => { cell.style.display = showActionColumn ? '' : 'none'; });
    }

    function renderGameStatusBanner(gs, me) {
        const banner = document.getElementById('game-status-banner'); const bannerMobile = document.getElementById('dashboard-status-banner');
        if (gs.isPaused) { updatePauseBanner(gs); return; }
        if (pauseCountdownInterval) clearInterval(pauseCountdownInterval); if (pauseCountdownIntervalMobile) clearInterval(pauseCountdownIntervalMobile);
        const currentPlayer = gs.players.find(p => p.playerId === gs.currentPlayerId); if (!currentPlayer) { banner.textContent = "Waiting for game to start..."; bannerMobile.textContent = "Waiting for game to start..."; return; }
        const latestLog = gs.logHistory[0] || "Game Started."; const roundText = `(Round ${gs.currentRound || 1})`;
        let bannerText = currentPlayer.playerId === me.playerId ? `YOUR TURN. ${roundText} (${latestLog})` : `Waiting for ${currentPlayer.isBot ? `[Bot] ${currentPlayer.name}` : currentPlayer.name}... ${roundText} (${latestLog})`;
        banner.textContent = bannerText; bannerMobile.textContent = bannerText;
    }

    function updatePauseBanner(gs) {
        const banner = document.getElementById('game-status-banner'); const bannerMobile = document.getElementById('dashboard-status-banner');
        if (pauseCountdownInterval) clearInterval(pauseCountdownInterval); if (pauseCountdownIntervalMobile) clearInterval(pauseCountdownIntervalMobile);
        const updateBanners = () => {
            const remaining = Math.max(0, Math.round((gs.pauseEndTime - Date.now()) / 1000));
            const bannerText = `⏳ Game Paused. Waiting for ${gs.pausedForPlayerNames.join(', ')}... (${remaining}s) ⏳`;
            banner.innerHTML = bannerText; bannerMobile.innerHTML = bannerText;
            if (remaining === 0) { clearInterval(pauseCountdownInterval); clearInterval(pauseCountdownIntervalMobile); }
        }; updateBanners();
        pauseCountdownInterval = setInterval(updateBanners, 1000); pauseCountdownIntervalMobile = setInterval(updateBanners, 1000);
    }

    function renderLogModal(logHistory) {
        const content = document.getElementById('game-log-modal-content'); if (!logHistory || logHistory.length === 0) { content.innerHTML = "<div>No log entries yet.</div>"; return; }
        content.innerHTML = logHistory.map(entry => `<div>${entry}</div>`).join('');
    }

    // *** REVERTED: Create img element directly ***
    function createCardImageElement(card, numDecks, isFungible) {
        const img = document.createElement('img');
        img.className = 'card-img'; // Base class for hand cards
        const suit = SUIT_MAP[card.suit];
        const rank = RANK_MAP[card.rank];
        img.src = `/assets/cards/${suit}_${rank}.svg`;
        img.alt = `${card.rank} of ${card.suit}`;
        img.dataset.id = card.id; // Store ID on img
        img.dataset.suit = card.suit;
        img.dataset.rank = card.rank;

        // Apply tint class directly to img
        const deckIndex = card.id.split('-')[2];
        if (numDecks == 2 && !isFungible && deckIndex === '1') {
            img.classList.add('deck-1-tint');
        }

        return img; // Return the img element
    }

    // *** REVERTED: Create img element directly ***
    function createRiverCardImageElement(suit, rank, deckIndex, numDecks, isFungible) {
        const img = document.createElement('img');
        img.className = 'river-card'; // Base class for river cards
        const suitName = SUIT_MAP[suit];
        const rankName = RANK_MAP[rank];
        img.src = `/assets/cards/${suitName}_${rankName}.svg`;
        img.alt = `${rank} of ${suit}`;

        // Apply tint class directly to img
        if (numDecks == 2 && !isFungible && deckIndex === '1') {
            img.classList.add('deck-1-tint');
        }

        return img; // Return the img element
    }


    function createRiverPlaceholder(rank) { const el = document.createElement('div'); el.className = 'river-card-placeholder'; el.textContent = rank; return el; }
    function createEmptyPlaceholder() { const el = document.createElement('div'); el.className = 'river-empty-placeholder'; return el; }

    function renderRiver(boardState, settings) {
        const riverContainer = document.getElementById('river-container'); riverContainer.innerHTML = '';
        const gameMode = settings.gameMode; const numDecks = settings.deckCount;
        if (!riverContainer) { console.error("River container not found!"); return; }
        try {
            if (gameMode === 'fungible') { renderFungibleRiver(boardState, numDecks); }
            else { renderStrictRiver(boardState, numDecks); }
        } catch (error) { console.error("Error rendering river:", error); riverContainer.innerHTML = '<p style="color: red;">Error rendering game table. Please check console.</p>'; }
    }

    function renderFungibleRiver(boardState, numDecks) {
        const riverContainer = document.getElementById('river-container'); const isMobile = window.innerWidth <= 850; const isFungible = true;
        SUITS.forEach(suitName => {
            const suitLayout = boardState[suitName];
            const row1Element = createRiverRow(suitLayout ? suitLayout.row1 : null, suitName, '0', numDecks, isFungible, isMobile); if (row1Element) riverContainer.appendChild(row1Element); else console.error("Failed to create row 1 for", suitName);
            const row2Element = createRiverRow(suitLayout ? suitLayout.row2 : null, suitName, '1', numDecks, isFungible, isMobile); if (row2Element) riverContainer.appendChild(row2Element); else console.error("Failed to create row 2 for", suitName);
        });
    }

    function renderStrictRiver(boardState, numDecks) {
        const riverContainer = document.getElementById('river-container'); const isMobile = window.innerWidth <= 850; const isFungible = false;
        let suitsToRender = numDecks == 2 ? ['Hearts-0', 'Diamonds-0', 'Clubs-0', 'Spades-0', 'Hearts-1', 'Diamonds-1', 'Clubs-1', 'Spades-1'] : ['Hearts-0', 'Diamonds-0', 'Clubs-0', 'Spades-0'];
        suitsToRender.forEach(suitKey => {
            const layout = boardState[suitKey]; const [suitName, deckIndex] = suitKey.split('-');
            const rowElement = createRiverRow(layout, suitName, deckIndex, numDecks, isFungible, isMobile); if (rowElement) riverContainer.appendChild(rowElement); else console.error("Failed to create strict row for", suitKey);
        });
    }

    function createRiverRow(layout, suitName, deckIndex, numDecks, isFungible, isMobile) {
        try {
            const row = document.createElement('div'); row.className = 'river-row';
            if (!isMobile) { const labelEl = document.createElement('div'); labelEl.className = 'river-row-label'; labelEl.textContent = numDecks == 2 ? `${suitName} (Deck ${parseInt(deckIndex) + 1})` : suitName; row.appendChild(labelEl); }
            if (!layout) {
                if (isMobile) { const placeholder = document.createElement('div'); placeholder.className = 'river-placeholder'; placeholder.textContent = numDecks == 2 ? `${suitName} (Deck ${parseInt(deckIndex) + 1})` : suitName; row.appendChild(placeholder); }
                else { ALL_RANKS.forEach((rank, i) => row.appendChild(i === 6 ? createRiverPlaceholder('7') : createEmptyPlaceholder())); }
            } else {
                const lowRankVal = layout.low; const highRankVal = layout.high;
                if (isMobile) {
                    if (lowRankVal > 1) row.appendChild(createRiverPlaceholder(ALL_RANKS[lowRankVal - 2]));
                    for (let r = lowRankVal; r <= highRankVal; r++) { const rankStr = ALL_RANKS[r - 1]; if (rankStr) { const cardEl = createRiverCardImageElement(suitName, rankStr, deckIndex, numDecks, isFungible); if (r > lowRankVal) cardEl.classList.add('bunched'); row.appendChild(cardEl); } }
                    if (highRankVal < 13) row.appendChild(createRiverPlaceholder(ALL_RANKS[highRankVal]));
                } else {
                    ALL_RANKS.forEach((rankStr, i) => { const rankVal = i + 1; if (rankVal >= lowRankVal && rankVal <= highRankVal) { row.appendChild(createRiverCardImageElement(suitName, rankStr, deckIndex, numDecks, isFungible)); } else if (rankVal === lowRankVal - 1 || rankVal === highRankVal + 1) { row.appendChild(createRiverPlaceholder(rankStr)); } else { row.appendChild(createEmptyPlaceholder()); } });
                }
            } return row;
        } catch (error) { console.error("Error creating river row:", { layout, suitName, deckIndex, error }); return null; }
    }

    function checkValidMoveFungible(card, boardState, hand, isFirstMove) { /* ... (logic unchanged) ... */ }
    function checkValidMoveStrict(card, boardState, hand, isFirstMove) { /* ... (logic unchanged) ... */ }
    function getValidMoves(hand, gs) { /* ... (logic unchanged) ... */ }
    function handleMoveAnnouncement(currentState, prevState) { /* ... (logic unchanged) ... */ }
    function showMoveAnnouncement(message) { /* ... (logic unchanged) ... */ }
    function showWinnerAnnouncement(mainText, subText, duration, callback) { /* ... (logic unchanged) ... */ }
    function hideWinnerAnnouncement() { /* ... (logic unchanged) ... */ }
    function startRainAnimation() { /* ... (logic unchanged) ... */ }
    function stopRainAnimation() { /* ... (logic unchanged) ... */ }
    function setupSwipeNavigation() { /* ... (logic unchanged) ... */ }
    function makeDraggable(modal) { /* ... (logic unchanged - keep the working version) ... */
        const modalContent = modal.querySelector('.modal-content');
        const header = modal.querySelector('.modal-header');
        if (!header || !modalContent) return;
        let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;
        const parsePixels = (value) => { if (value === 'auto' || !value) return 0; const parsed = parseInt(value, 10); return isNaN(parsed) ? 0 : parsed; };
        const dragMouseDown = (e) => { if (e.button !== 0) return; e.preventDefault(); startX = e.clientX; startY = e.clientY; const rect = modalContent.getBoundingClientRect(); initialLeft = rect.left; initialTop = rect.top; if (window.getComputedStyle(modalContent).position !== 'absolute' && window.getComputedStyle(modalContent).position !== 'fixed') { modalContent.style.position = 'relative'; } modalContent.style.transform = 'none'; modalContent.style.left = initialLeft + 'px'; modalContent.style.top = initialTop + 'px'; document.addEventListener('mousemove', elementDrag); document.addEventListener('mouseup', closeDragElement); };
        const dragTouchStart = (e) => { if (e.touches.length === 1) { const touch = e.touches[0]; startX = touch.clientX; startY = touch.clientY; const rect = modalContent.getBoundingClientRect(); initialLeft = rect.left; initialTop = rect.top; if (window.getComputedStyle(modalContent).position !== 'absolute' && window.getComputedStyle(modalContent).position !== 'fixed') { modalContent.style.position = 'relative'; } modalContent.style.transform = 'none'; modalContent.style.left = initialLeft + 'px'; modalContent.style.top = initialTop + 'px'; document.addEventListener('touchmove', elementTouchDrag, { passive: false }); document.addEventListener('touchend', closeTouchDragElement); } };
        const elementDrag = (e) => { e.preventDefault(); const deltaX = e.clientX - startX; const deltaY = e.clientY - startY; modalContent.style.left = (initialLeft + deltaX) + "px"; modalContent.style.top = (initialTop + deltaY) + "px"; };
        const elementTouchDrag = (e) => { if (e.touches.length === 1) { e.preventDefault(); const touch = e.touches[0]; const deltaX = touch.clientX - startX; const deltaY = touch.clientY - startY; modalContent.style.left = (initialLeft + deltaX) + "px"; modalContent.style.top = (initialTop + deltaY) + "px"; } };
        const closeDragElement = () => { document.removeEventListener('mousemove', elementDrag); document.removeEventListener('mouseup', closeDragElement); };
        const closeTouchDragElement = () => { document.removeEventListener('touchmove', elementTouchDrag); document.removeEventListener('touchend', closeTouchDragElement); };
        header.addEventListener('mousedown', dragMouseDown); header.addEventListener('touchstart', dragTouchStart, { passive: true });
    }

    document.querySelectorAll('.modal').forEach(makeDraggable);
});