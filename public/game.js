window.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    window.gameState = {};
    let myPersistentPlayerId = sessionStorage.getItem('sevenOfHeartsPlayerId');
    let myPersistentPlayerName = sessionStorage.getItem('sevenOfHeartsPlayerName');
    let previousGameState = null; // For move announcement diff
    let moveAnnouncementTimeout = null; // Timer for move announcement
    let rainInterval = null; // Timer for rain animation

    const SUIT_MAP = { 'Hearts': 'hearts', 'Diamonds': 'diamonds', 'Clubs': 'clubs', 'Spades': 'spades' };
    const RANK_MAP = {
        'A': 'ace', 'K': 'king', 'Q': 'queen', 'J': 'jack',
        '10': '10', '9': '9', '8': '8', '7': '7', '6': '6',
        '5': '5', '4': '4', '3': '3', '2': '2'
    };
    const RANK_ORDER = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };
    const ALL_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const SUITS_ORDER = { 'Hearts': 1, 'Diamonds': 2, 'Clubs': 3, 'Spades': 4 };

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
        document.getElementById('show-players-btn').addEventListener('click', () => {
            playersModal.classList.remove('hidden');
        });
        document.getElementById('show-players-btn-mobile').addEventListener('click', () => {
            playersModal.classList.remove('hidden');
        });
        document.getElementById('players-modal-close').addEventListener('click', () => {
            playersModal.classList.add('hidden');
        });
        document.getElementById('players-modal-ok-btn').addEventListener('click', () => {
            playersModal.classList.add('hidden');
        });

        // --- Game Log Modal ---
        const logModal = document.getElementById('game-log-modal');
        document.getElementById('show-logs-btn').addEventListener('click', () => {
            renderLogModal(window.gameState.logHistory || []);
            logModal.classList.remove('hidden');
        });
         document.getElementById('show-logs-btn-mobile').addEventListener('click', () => {
            renderLogModal(window.gameState.logHistory || []);
            logModal.classList.remove('hidden');
        });
        document.getElementById('game-log-modal-close').addEventListener('click', () => {
            logModal.classList.add('hidden');
        });
        document.getElementById('game-log-modal-ok-btn').addEventListener('click', () => {
            logModal.classList.add('hidden');
        });

        // --- Other Modals ---
        document.getElementById('in-game-end-btn').addEventListener('click', () => {
            document.getElementById('confirm-end-game-modal').classList.remove('hidden');
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

        // --- Pass Button Listeners ---
        document.getElementById('pass-btn').addEventListener('click', () => {
            socket.emit('passTurn');
        });
        document.getElementById('pass-btn-mobile').addEventListener('click', () => {
            socket.emit('passTurn');
        });

        // --- Round Over Listeners ---
        document.getElementById('round-over-ok-btn').addEventListener('click', () => {
            document.getElementById('round-over-modal').classList.add('hidden');
            document.getElementById('waiting-for-host-modal').classList.remove('hidden');
        });
        document.getElementById('start-next-round-btn').addEventListener('click', () => {
            socket.emit('requestNextRound');
            document.getElementById('round-over-modal').classList.add('hidden');
        });
        document.getElementById('start-next-round-fallback-btn').addEventListener('click', () => {
            socket.emit('requestNextRound');
        });
        document.getElementById('round-over-end-game-btn').addEventListener('click', () => {
            document.getElementById('round-over-modal').classList.add('hidden');
            document.getElementById('confirm-end-game-modal').classList.remove('hidden');
        });
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
            const cardEl = e.target.closest('.card-img');
            if (cardEl && cardEl.classList.contains('playable-card')) {
                const me = window.gameState.players.find(p => p.playerId === myPersistentPlayerId);
                if (!me) return; // Safeguard
                const cardData = me.hand.find(c => c.id === cardEl.dataset.id);
                if (cardData) {
                    socket.emit('playCard', cardData);
                }
            }
        });

        // --- Mobile Toggle Button Logic ---
        const dashboardBtn = document.getElementById('show-dashboard-btn');
        const tableBtn = document.getElementById('show-table-btn');
        const gameBoard = document.getElementById('game-board');

        if (dashboardBtn && tableBtn && gameBoard) {
            dashboardBtn.addEventListener('click', () => {
                gameBoard.classList.remove('table-view');
                dashboardBtn.classList.add('active');
                tableBtn.classList.remove('active');
            });

            tableBtn.addEventListener('click', () => {
                gameBoard.classList.add('table-view');
                dashboardBtn.classList.remove('active');
                tableBtn.classList.add('active');
            });
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
        myPersistentPlayerId = null;
        myPersistentPlayerName = null;
        showWarning('Join Failed', message);
    });

    socket.on('kicked', () => {
        sessionStorage.removeItem('sevenOfHeartsPlayerId');
        sessionStorage.removeItem('sevenOfHeartsPlayerName');
        location.reload();
    });

    socket.on('forceDisconnect', () => {
        sessionStorage.removeItem('sevenOfHeartsPlayerId');
        sessionStorage.removeItem('sevenOfHeartsPlayerName');
        myPersistentPlayerId = null;
        myPersistentPlayerName = null;
        location.reload();
    });

    socket.on('lobbyUpdate', (players) => {
        document.getElementById('game-board').style.display = 'none';
        document.getElementById('join-screen').style.display = 'none';
        document.getElementById('lobby-screen').style.display = 'block';

        document.getElementById('game-over-modal').classList.add('hidden');

        renderLobby(players);
    });

    socket.on('gameStarted', () => {
        document.getElementById('lobby-screen').style.display = 'none';
        document.getElementById('game-board').style.display = 'flex';
    });

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


    socket.on('roundOver', (data) => {
        showWinnerAnnouncement(data.winnerName + " wins the Round!", null, 5000, () => {
            renderRoundOverModal(data);
        });
    });

    socket.on('gameOverAnnouncement', ({ winnerNames }) => {
        document.getElementById('round-over-modal').classList.add('hidden');
        document.getElementById('waiting-for-host-modal').classList.add('hidden');

        let winnerText = "";
        if (winnerNames.length === 1) {
            winnerText = winnerNames[0] + " wins the Game!";
        } else if (winnerNames.length > 1) {
            winnerText = "Joint Winners: " + winnerNames.join(', ') + "!";
        } else {
             winnerText = "Game Over!";
        }
        const subtext = "You will be taken to the lobby shortly...";
        showWinnerAnnouncement(winnerText, subtext, 12000, null);
    });

    socket.on('gameEnded', ({ logHistory }) => {
        hideWinnerAnnouncement();
        renderGameOver(logHistory);
        isInitialGameRender = true;
    });


    socket.on('youWereMarkedAFK', () => {
        document.getElementById('afk-notification-modal').classList.remove('hidden');
    });

    socket.on('warning', (data) => {
        if (typeof data === 'object' && data.title) {
            showWarning(data.title, data.message);
        } else {
            showWarning('Alert', data);
        }
    });

    function renderLobby(players) {
        const playerList = document.getElementById('player-list');
        const me = players.find(p => p.playerId === myPersistentPlayerId);

        if (!me) {
            document.getElementById('join-screen').style.display = 'block';
            document.getElementById('lobby-screen').style.display = 'none';
            sessionStorage.removeItem('sevenOfHeartsPlayerId');
            myPersistentPlayerId = null;
            return;
        }

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

    function showWarning(title, text) {
        document.getElementById('warning-modal-title').textContent = title;
        document.getElementById('warning-modal-text').textContent = text;
        document.getElementById('warning-modal').classList.remove('hidden');
    }

    function renderGameOver(logHistory) {
        document.getElementById('game-over-title').textContent = 'Game Over!';
        document.getElementById('game-over-winner-text').textContent = 'The game has concluded.';

        const scoreboardContent = document.getElementById('scoreboard-content').innerHTML;
        document.getElementById('game-over-scoreboard').innerHTML = scoreboardContent;

        document.getElementById('game-over-modal').classList.remove('hidden');
    }

    function renderRoundOverModal(data) {
        const { scoreboard, winnerName, roundNumber, finalHands, hostId } = data;
        const me = window.gameState.players.find(p => p.playerId === myPersistentPlayerId);

        document.getElementById('round-over-title').textContent = `Round ${roundNumber} Complete!`;
        document.getElementById('round-over-winner-text').textContent = `🎉 ${winnerName} won the round! 🎉`;

        renderRoundScoreboardTable(scoreboard);
        renderFinalHands(finalHands, scoreboard);

        if (me && hostId === me.playerId) {
            document.getElementById('start-next-round-btn').style.display = 'block';
            document.getElementById('round-over-end-game-btn').style.display = 'block';
            document.getElementById('round-over-ok-btn').style.display = 'none';
        } else {
            document.getElementById('start-next-round-btn').style.display = 'none';
            document.getElementById('round-over-end-game-btn').style.display = 'none';
            document.getElementById('round-over-ok-btn').style.display = 'block';
        }
        document.getElementById('round-over-modal').classList.remove('hidden');
    }


    function renderRoundScoreboardTable(scoreboardData) {
        const container = document.getElementById('round-over-scoreboard');
        let table = '<table>';
        table += '<tr><th>Player</th><th class="score-col">Round Score</th><th class="score-col">Total Score</th></tr>';

        scoreboardData.forEach(player => {
            table += `<tr>
                <td>${player.name}</td>
                <td class="score-col">${player.roundScore}</td>
                <td class="score-col">${player.cumulativeScore}</td>
            </tr>`;
        });

        table += '</table>';
        container.innerHTML = table;
    }

    function renderFinalHands(finalHands, scoreboardData) {
        const container = document.getElementById('round-over-hands');
        container.innerHTML = '';
        const numDecks = window.gameState?.settings?.deckCount || 1;
        const isFungible = window.gameState?.settings?.gameMode === 'fungible';

        if (!finalHands || !scoreboardData) return;

        scoreboardData.forEach(scoreEntry => {
            const player = window.gameState.players.find(p => p.name === scoreEntry.name.replace(' [Bot]',''));
            if (!player) return;

            const hand = finalHands[player.playerId];
            const handDiv = document.createElement('div');
            handDiv.className = 'player-hand-display';

            const nameEl = document.createElement('div');
            nameEl.className = 'player-hand-name';
            nameEl.textContent = scoreEntry.name + ':';
            handDiv.appendChild(nameEl);

            const cardsContainer = document.createElement('div');
            cardsContainer.className = 'player-hand-cards';
            if (hand && hand.length > 0) {
                 const sortedHand = hand.sort((a, b) => {
                    if (SUITS_ORDER[a.suit] !== SUITS_ORDER[b.suit]) return SUITS_ORDER[a.suit] - SUITS_ORDER[b.suit];
                    return RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
                });
                sortedHand.forEach(card => {
                    cardsContainer.appendChild(createSmallCardImage(card, numDecks, isFungible));
                });
            } else {
                cardsContainer.textContent = '(Empty)';
            }
            handDiv.appendChild(cardsContainer);
            container.appendChild(handDiv);
        });
    }

    function createSmallCardImage(card, numDecks, isFungible) {
         const img = document.createElement('img');
        img.className = 'final-card-img';
        const suit = SUIT_MAP[card.suit];
        const rank = RANK_MAP[card.rank];
        img.src = `/assets/cards/${suit}_${rank}.svg`;
        img.alt = `${card.rank} of ${card.suit}`;

        const deckIndex = card.id.split('-')[2];
        if (numDecks == 2 && !isFungible && deckIndex === '1') {
            img.classList.add('deck-1-tint');
        }
        return img;
    }

    function renderScoreboard(players) {

        const scoreboard = document.getElementById('scoreboard-content');
        if (!players || players.length === 0) {
             scoreboard.innerHTML = '<p>No players in game.</p>';
             return;
        }

        let table = '<table>';
        table += '<tr><th>Player</th><th class="score-col">Total Score</th></tr>';

        const sortedPlayers = [...players].sort((a, b) => (a.score || 0) - (b.score || 0));

        sortedPlayers.forEach(player => {
            table += `<tr>
                <td>${player.name} ${player.isHost ? '👑' : ''} ${player.isBot ? '[Bot]' : ''}</td>
                <td class="score-col">${player.score || 0}</td>
            </tr>`;
        });

        table += '</table>';
        scoreboard.innerHTML = table;
    }

    function renderMyInfo(me) {
        document.getElementById('my-name').textContent = `${me.name} (You) ${me.isHost ? '👑' : ''}`;
        document.getElementById('my-score').textContent = me.score || 0;
        document.getElementById('my-card-count').textContent = me.hand ? me.hand.length : 0;
    }

    function renderMyHand(me, gs) {
        const handContainer = document.getElementById('my-hand-container');
        handContainer.innerHTML = '';

        if (!me || !me.hand) return;

        const sortedHand = me.hand.sort((a, b) => {
            if (SUITS_ORDER[a.suit] !== SUITS_ORDER[b.suit]) {
                return SUITS_ORDER[a.suit] - SUITS_ORDER[b.suit];
            }
            return RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
        });

        const validMoves = getValidMoves(me.hand, gs);
        const validMoveIds = new Set(validMoves.map(card => card.id));
        const numDecks = gs.settings.deckCount;
        const isFungible = gs.settings.gameMode === 'fungible';

        sortedHand.forEach(card => {
            const cardEl = createCardImageElement(card, numDecks, isFungible);
            if (validMoveIds.has(card.id) && me.playerId === gs.currentPlayerId && !gs.isPaused) {
                cardEl.classList.add('playable-card');
            }
            handContainer.appendChild(cardEl);
        });
    }

    function renderMyActions(me, gs) {
        const passBtn = document.getElementById('pass-btn');
        const passBtnMobile = document.getElementById('pass-btn-mobile');
        const endBtn = document.getElementById('in-game-end-btn');
        const fallbackBtn = document.getElementById('start-next-round-fallback-btn');

        if (me.playerId === gs.currentPlayerId && !gs.isPaused) {
            const validMoves = getValidMoves(me.hand, gs);
            const canPass = validMoves.length === 0;

            passBtn.style.display = 'block';
            passBtn.disabled = !canPass;

            passBtnMobile.style.display = 'block';
            passBtnMobile.disabled = !canPass;

        } else {
            passBtn.style.display = 'none';
            passBtnMobile.style.display = 'none';
        }

        endBtn.style.display = me.isHost ? 'block' : 'none';
        fallbackBtn.style.display = (me.isHost && gs.isBetweenRounds) ? 'block' : 'none';
    }


    function renderOtherPlayers(players, me, currentPlayerId, dealerId) {
        const tableBody = document.getElementById('players-modal-table-body');
        const actionHeader = document.getElementById('host-action-col-header');
        tableBody.innerHTML = '';

        let showActionColumn = false;

        players.filter(p => p.playerId !== me.playerId).forEach(player => {
            const row = document.createElement('tr');

            if (player.playerId === currentPlayerId) {
                row.classList.add('active-player-row');
            }


            let status = '';
            if (player.isBot) {
                status = '<span class="other-player-status bot">[Bot]</span>';
            } else if (player.status === 'Disconnected') {
                status = '<span class="other-player-status reconnecting">Offline</span>';
            }
            const dealerIcon = (player.playerId === dealerId) ? ' (D)' : '';

            const playerCell = document.createElement('td');
            playerCell.innerHTML = `${player.name} ${player.isHost ? '👑' : ''} ${dealerIcon} ${status}`;


            const cardsCell = document.createElement('td');
            cardsCell.className = 'col-cards';
            cardsCell.textContent = player.hand ? player.hand.length : 0;


            const scoreCell = document.createElement('td');
            scoreCell.className = 'col-score';
            scoreCell.textContent = player.score || 0;


            const actionCell = document.createElement('td');
            actionCell.className = 'col-action';
            if (me.isHost && player.status === 'Active' && !player.isBot) {
                actionCell.innerHTML = `<button class="afk-btn danger-btn" data-player-id="${player.playerId}">AFK?</button>`;
                showActionColumn = true;
            }

            row.appendChild(playerCell);
            row.appendChild(cardsCell);
            row.appendChild(scoreCell);
            row.appendChild(actionCell);
            tableBody.appendChild(row);
        });


        if (actionHeader) {
            actionHeader.style.display = showActionColumn ? '' : 'none';
        }

        document.querySelectorAll('#players-modal .col-action').forEach(cell => {
            cell.style.display = showActionColumn ? '' : 'none';
        });
    }

    function renderGameStatusBanner(gs, me) {
        const banner = document.getElementById('game-status-banner');
        const bannerMobile = document.getElementById('dashboard-status-banner');

        if (gs.isPaused) {
            updatePauseBanner(gs);
            return;
        }
        if (pauseCountdownInterval) clearInterval(pauseCountdownInterval);
        if (pauseCountdownIntervalMobile) clearInterval(pauseCountdownIntervalMobile);

        const currentPlayer = gs.players.find(p => p.playerId === gs.currentPlayerId);
        if (!currentPlayer) {
            banner.textContent = "Waiting for game to start...";
            bannerMobile.textContent = "Waiting for game to start...";
            return;
        }

        const latestLog = gs.logHistory[0] || "Game Started.";
        const roundText = `(Round ${gs.currentRound || 1})`;

        let bannerText = "";
        if (currentPlayer.playerId === me.playerId) {
            bannerText = `YOUR TURN. ${roundText} (${latestLog})`;
        } else {
            const name = currentPlayer.isBot ? `[Bot] ${currentPlayer.name}` : currentPlayer.name;
            bannerText = `Waiting for ${name}... ${roundText} (${latestLog})`;
        }

        banner.textContent = bannerText;
        bannerMobile.textContent = bannerText;
    }

    function updatePauseBanner(gs) {
        const banner = document.getElementById('game-status-banner');
        const bannerMobile = document.getElementById('dashboard-status-banner');

        if (pauseCountdownInterval) clearInterval(pauseCountdownInterval);
        if (pauseCountdownIntervalMobile) clearInterval(pauseCountdownIntervalMobile);

        const updateBanners = () => {
            const remaining = Math.max(0, Math.round((gs.pauseEndTime - Date.now()) / 1000));
            const bannerText = `⏳ Game Paused. Waiting for ${gs.pausedForPlayerNames.join(', ')}... (${remaining}s) ⏳`;

            banner.innerHTML = bannerText;
            bannerMobile.innerHTML = bannerText;

            if (remaining === 0) {
                clearInterval(pauseCountdownInterval);
                clearInterval(pauseCountdownIntervalMobile);
            }
        };
        updateBanners();
        pauseCountdownInterval = setInterval(updateBanners, 1000);
        pauseCountdownIntervalMobile = setInterval(updateBanners, 1000);
    }

    function renderLogModal(logHistory) {
        const content = document.getElementById('game-log-modal-content');
        if (!logHistory || logHistory.length === 0) {
            content.innerHTML = "<div>No log entries yet.</div>";
            return;
        }
        content.innerHTML = logHistory.map(entry => `<div>${entry}</div>`).join('');
    }


    function createCardImageElement(card, numDecks, isFungible) {
        const img = document.createElement('img');
        img.className = 'card-img';
        const suit = SUIT_MAP[card.suit];
        const rank = RANK_MAP[card.rank];
        img.src = `/assets/cards/${suit}_${rank}.svg`;
        img.alt = `${card.rank} of ${card.suit}`;
        img.dataset.id = card.id;
        img.dataset.suit = card.suit;
        img.dataset.rank = card.rank;


        const deckIndex = card.id.split('-')[2];
        if (numDecks == 2 && !isFungible && deckIndex === '1') {
            img.classList.add('deck-1-tint');
        }

        return img;
    }


    function createRiverCardImageElement(suit, rank, deckIndex, numDecks, isFungible) {
        const img = document.createElement('img');
        img.className = 'river-card';
        const suitName = SUIT_MAP[suit];
        const rankName = RANK_MAP[rank];
        img.src = `/assets/cards/${suitName}_${rankName}.svg`;
        img.alt = `${rank} of ${suit}`;


        if (numDecks == 2 && !isFungible && deckIndex === '1') {
            img.classList.add('deck-1-tint');
        }

        return img;
    }

    function createRiverPlaceholder(rank) {
        const el = document.createElement('div');
        el.className = 'river-card-placeholder';
        el.textContent = rank;
        return el;
    }


    function createEmptyPlaceholder() {
        const el = document.createElement('div');
        el.className = 'river-empty-placeholder';
        return el;
    }


    function renderRiver(boardState, settings) {
        const riverContainer = document.getElementById('river-container');
        riverContainer.innerHTML = '';
        const gameMode = settings.gameMode;
        const numDecks = settings.deckCount;
        
        if (gameMode === 'fungible') {
            renderFungibleRiver(boardState, numDecks);
        } else {
            renderStrictRiver(boardState, numDecks);
        }
    }

    function renderFungibleRiver(boardState, numDecks) {
        const riverContainer = document.getElementById('river-container');
        const isMobile = window.innerWidth <= 850;
        const isFungible = true;

        for (const suitName of SUITS) {
            const suitLayout = boardState[suitName];
            
            riverContainer.appendChild(
                createRiverRow(suitLayout ? suitLayout.row1 : null, suitName, '0', numDecks, isFungible, isMobile)
            );

            riverContainer.appendChild(
                createRiverRow(suitLayout ? suitLayout.row2 : null, suitName, '1', numDecks, isFungible, isMobile)
            );
        }
    }

    function renderStrictRiver(boardState, numDecks) {
        const riverContainer = document.getElementById('river-container');
        const isMobile = window.innerWidth <= 850;
        const isFungible = false;

        let suitsToRender = [];
        if (numDecks == 2) {
            suitsToRender = [
                'Hearts-0', 'Diamonds-0', 'Clubs-0', 'Spades-0',
                'Hearts-1', 'Diamonds-1', 'Clubs-1', 'Spades-1'
            ];
        } else {
            suitsToRender = ['Hearts-0', 'Diamonds-0', 'Clubs-0', 'Spades-0'];
        }

        suitsToRender.forEach(suitKey => {
            const layout = boardState[suitKey];
            const [suitName, deckIndex] = suitKey.split('-');
            riverContainer.appendChild(
                createRiverRow(layout, suitName, deckIndex, numDecks, isFungible, isMobile)
            );
        });
    }

    // *** MODIFIED: Corrected Placeholder Logic ***
    function createRiverRow(layout, suitName, deckIndex, numDecks, isFungible, isMobile) {
        const row = document.createElement('div');
        row.className = 'river-row';

        // Add Desktop Label (Logic remains the same)
        if (!isMobile) {
            const labelEl = document.createElement('div');
            labelEl.className = 'river-row-label';
            if (numDecks == 2) {
                const deckLabel = parseInt(deckIndex) + 1;
                labelEl.textContent = `${suitName} (Deck ${deckLabel})`;
            } else {
                labelEl.textContent = suitName;
            }
            row.appendChild(labelEl);
        }

        if (!layout) {
             // --- Placeholder Logic ---
             if (isMobile) {
                 // Mobile: Single placeholder div with text
                const placeholder = document.createElement('div');
                placeholder.className = 'river-placeholder';
                const label = (numDecks == 2) ? `${suitName} (Deck ${parseInt(deckIndex) + 1})` : suitName;
                placeholder.textContent = label;
                row.appendChild(placeholder); // Use appendChild
             } else {
                 // Desktop: Grid of 13 placeholders
                ALL_RANKS.forEach((rank, i) => {
                    if (i === 6) { // 7
                        row.appendChild(createRiverPlaceholder('7'));
                    } else {
                        row.appendChild(createEmptyPlaceholder());
                    }
                });
             }
        } else {
            // --- Card Rendering Logic (Remains the same) ---
            const lowRankVal = layout.low;
            const highRankVal = layout.high;

            if (isMobile) {
                if (lowRankVal > 1) {
                    const prevRank = ALL_RANKS[lowRankVal - 2];
                    row.appendChild(createRiverPlaceholder(prevRank));
                }

                for (let r = lowRankVal; r <= highRankVal; r++) {
                    const rankStr = ALL_RANKS[r-1];
                    if (rankStr) {
                        const cardEl = createRiverCardImageElement(suitName, rankStr, deckIndex, numDecks, isFungible);
                        if (r > lowRankVal) {
                            cardEl.classList.add('bunched');
                        }
                        row.appendChild(cardEl);
                    }
                }

                if (highRankVal < 13) {
                    const nextRank = ALL_RANKS[highRankVal];
                    row.appendChild(createRiverPlaceholder(nextRank));
                }
            } else {
                ALL_RANKS.forEach((rankStr, i) => {
                    const rankVal = i + 1;
                    if (rankVal >= lowRankVal && rankVal <= highRankVal) {
                        row.appendChild(createRiverCardImageElement(suitName, rankStr, deckIndex, numDecks, isFungible));
                    } else if (rankVal === lowRankVal - 1 || rankVal === highRankVal + 1) {
                        row.appendChild(createRiverPlaceholder(rankStr));
                    } else {
                        row.appendChild(createEmptyPlaceholder());
                    }
                });
            }
        }
        return row; // Always return the created row element
    }


    // *** Client-side logic for fungible move validation ***
    function checkValidMoveFungible(card, boardState, hand, isFirstMove) {
        if (isFirstMove) {
            return card.id === '7-Hearts-c1';
        }
        
        const suitLayout = boardState[card.suit];
        const cardRankVal = RANK_ORDER[card.rank];

        if (card.rank === '7') {
            if (!suitLayout) return true;
            if (suitLayout.row1 && !suitLayout.row2) return true;
            return false;
        }

        if (suitLayout) {
            if (suitLayout.row1) {
                if (cardRankVal === suitLayout.row1.high + 1) return true;
                if (cardRankVal === suitLayout.row1.low - 1) return true;
            }
            if (suitLayout.row2) {
                if (cardRankVal === suitLayout.row2.high + 1) return true;
                if (cardRankVal === suitLayout.row2.low - 1) return true;
            }
        }
        return false;
    }

    // *** Client-side logic for strict move validation ***
    function checkValidMoveStrict(card, boardState, hand, isFirstMove) {
        if (isFirstMove) {
            return card.id === '7-Hearts-0';
        }

        const deckIndex = card.id.split('-')[2];
        const suitKey = `${card.suit}-${deckIndex}`;

        if (card.rank === '7') {
            return !boardState[suitKey];
        }

        const suitLayout = boardState[suitKey];
        if (suitLayout) {
            const cardRankVal = RANK_ORDER[card.rank];
            if (cardRankVal === suitLayout.high + 1) return true;
            if (cardRankVal === suitLayout.low - 1) return true;
        }
        return false;
    }

    // *** This function now correctly calls the helpers ***
    function getValidMoves(hand, gs) {
        if (!hand) return [];
        
        const boardState = gs.boardState;
        const isFirstMove = gs.isFirstMove;
        
        if (gs.settings.gameMode === 'fungible') {
            // --- Fungible Logic ---
            if (isFirstMove) {
                const startCard = hand.find(c => c.id === '7-Hearts-c1');
                return startCard ? [startCard] : [];
            }
            
            const validMoves = [];
            for (const card of hand) {
                if (checkValidMoveFungible(card, boardState, hand, false)) {
                    validMoves.push(card);
                }
            }
            return validMoves;

        } else {
            // --- Strict (Original) Logic ---
            if (isFirstMove) {
                const startCard = hand.find(c => c.id === '7-Hearts-0');
                return startCard ? [startCard] : [];
            }

            const validMoves = [];
            for (const card of hand) {
                if (checkValidMoveStrict(card, boardState, hand, false)) {
                    validMoves.push(card);
                }
            }
            return validMoves;
        }
    }

    function handleMoveAnnouncement(currentState, prevState) {
        if (!prevState || !currentState || !currentState.logHistory || currentState.logHistory.length === 0) {
            return;
        }

        const latestLog = currentState.logHistory[0];
        const previousLog = prevState.logHistory[0];

        if (latestLog === previousLog || latestLog.includes('Starting') || latestLog.includes('won') || latestLog.includes('Game initialized')) {
             return;
        }

        let message = "";
        const nextPlayer = currentState.players.find(p => p.playerId === currentState.currentPlayerId);
        const nextPlayerName = nextPlayer ? (nextPlayer.isBot ? `[Bot] ${nextPlayer.name}` : nextPlayer.name) : "Unknown";

        const playedMatch = latestLog.match(/^(.+?) played the (.+ of .+)\./);
        const passedMatch = latestLog.match(/^(.+?) passed\./);

        if (playedMatch) {
            const playerName = playedMatch[1];
            const cardName = playedMatch[2];
            message = `${playerName} played ${cardName}; Next turn: ${nextPlayerName}`;
        } else if (passedMatch) {
            const playerName = passedMatch[1];
             message = `${playerName} skipped; Next turn: ${nextPlayerName}`;
        } else {
            message = latestLog + ` | Next: ${nextPlayerName}`;
        }

        showMoveAnnouncement(message);
    }

    function showMoveAnnouncement(message) {
        const banner = document.getElementById('move-announcement-banner');
        if (!banner) return;

        banner.textContent = message;
        banner.classList.add('visible');

        if (moveAnnouncementTimeout) {
            clearTimeout(moveAnnouncementTimeout);
        }

        moveAnnouncementTimeout = setTimeout(() => {
            banner.classList.remove('visible');
            moveAnnouncementTimeout = null;
        }, 3000);
    }

    function showWinnerAnnouncement(mainText, subText, duration, callback) {
        const overlay = document.getElementById('winner-announcement-overlay');
        const textElement = document.getElementById('winner-announcement-text');
        const subtextElement = document.getElementById('winner-announcement-subtext');

        if (!overlay || !textElement || !subtextElement) return;

        textElement.textContent = mainText;
        subtextElement.textContent = subText || '';
        overlay.classList.remove('hidden');
        startRainAnimation();

        setTimeout(() => {
            hideWinnerAnnouncement();
            if (callback) {
                callback();
            }
        }, duration);
    }

    function hideWinnerAnnouncement() {
         const overlay = document.getElementById('winner-announcement-overlay');
         if (overlay) overlay.classList.add('hidden');
         stopRainAnimation();
    }

    function startRainAnimation() {
        const container = document.getElementById('winner-animation-container');
        if (!container || rainInterval) return;

        const elements = ['⭐', '🌸', '✨', '🎉', '🌟'];

        rainInterval = setInterval(() => {
            const rainElement = document.createElement('div');
            rainElement.classList.add('rain-element');
            rainElement.textContent = elements[Math.floor(Math.random() * elements.length)];
            rainElement.style.left = Math.random() * 100 + 'vw';
            rainElement.style.animationDuration = (Math.random() * 2 + 3) + 's';
            rainElement.style.fontSize = (Math.random() * 1 + 1) + 'em';

            container.appendChild(rainElement);

            setTimeout(() => {
                rainElement.remove();
            }, 5000);

        }, 100);
    }

    function stopRainAnimation() {
        const container = document.getElementById('winner-animation-container');
        if (rainInterval) {
            clearInterval(rainInterval);
            rainInterval = null;
        }
        if (container) {
            container.innerHTML = '';
        }
    }

    function setupSwipeNavigation() {
        const container = document.getElementById('mobile-scroll-container');
        if (!container) return;

        let touchStartX = 0;
        let touchStartY = 0;
        let touchEndX = 0;
        let touchEndY = 0;

        container.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
        }, { passive: true });

        container.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            touchEndY = e.changedTouches[0].screenY;
            handleSwipeGesture();
        }, { passive: true });

        function handleSwipeGesture() {
            const deltaX = touchEndX - touchStartX;
            const deltaY = touchEndY - touchStartY;

            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
                if (deltaX < 0) {
                    document.getElementById('show-table-btn').click();
                } else {
                    document.getElementById('show-dashboard-btn').click();
                }
            }
        }
    }

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
                pos2 = pos4 - e.clientY;
                pos3 = e.touches[0].clientX;
                pos4 = e.touches[0].clientY;
                if (!modalContent.style.transform || modalContent.style.transform === 'translate(-50%, -50%)') {
                     modalContent.style.left = '50%';
                     modalContent.style.top = '50%';
                     modalContent.style.transform = `translate(calc(-50% + ${modalContent.offsetLeft - pos1}px), calc(-50% + ${modalContent.offsetTop - 2}px))`;
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

    document.querySelectorAll('.modal').forEach(makeDraggable);
});