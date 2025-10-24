window.addEventListener('DOMContentLoaded', () => {
    // console.log("DEBUG: DOMContentLoaded event fired. Script starting.");
    const socket = io();

    window.gameState = {};
    let myPersistentPlayerId = sessionStorage.getItem('sevenOfHeartsPlayerId');
    let myPersistentPlayerName = sessionStorage.getItem('sevenOfHeartsPlayerName');

    // Card Naming Maps for SVGs...
    const SUIT_MAP = { /* ... */ };
    const RANK_MAP = { /* ... */ };
    const RANK_ORDER = { /* ... */ };
    const SUITS_ORDER = { /* ... */ };

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

    // Setup Functions (Use the robust version)
    function setupJoinScreenListeners() {
        const joinButton = document.getElementById('join-game-btn');
        const playerNameInput = document.getElementById('player-name-input');
        if (joinButton && playerNameInput) {
            joinButton.addEventListener('click', () => {
                console.log("DEBUG: Join Game button was definitely clicked!"); // Keep this log
                const playerName = playerNameInput.value;
                if (playerName.trim()) {
                    sessionStorage.setItem('sevenOfHeartsPlayerName', playerName);
                     console.log("DEBUG: Attempting to emit joinGame. Socket connected:", socket.connected); // Keep this log
                    socket.emit('joinGame', { playerName: playerName, playerId: myPersistentPlayerId });
                } else {
                     showWarning('Missing Name', 'Please enter your name to join.');
                }
            });
            // console.log("DEBUG: Join button listener attached.");
        } else {
            console.error("CRITICAL: Could not find join button or player name input during initial setup!");
        }
    }
    setupJoinScreenListeners();
    setupLobbyEventListeners();
    setupModalAndButtonListeners();
    setupDynamicEventListeners();

    // --- SOCKET EVENT HANDLERS ---

    // --- DEBUG LOG ADDED ---
    socket.on('joinSuccess', (playerId) => {
        console.log("DEBUG: Received 'joinSuccess' event. PlayerID:", playerId); // Log reception
        try { // Add try...catch to catch errors inside
            myPersistentPlayerId = playerId;
            sessionStorage.setItem('sevenOfHeartsPlayerId', playerId);
            if (!window.gameState) {
                console.log("DEBUG: joinSuccess - Switching view to Lobby Screen."); // Log action
                document.getElementById('join-screen').style.display = 'none';
                document.getElementById('lobby-screen').style.display = 'block';
            } else {
                 console.log("DEBUG: joinSuccess - Game state exists, likely reconnect."); // Log alternative path
            }
        } catch (error) {
            console.error("ERROR inside joinSuccess handler:", error); // Log any errors
        }
    });
    // --- END DEBUG LOG ---

    socket.on('joinFailed', (message) => {
         console.error("DEBUG: Received 'joinFailed' event:", message); // Log reception
        sessionStorage.removeItem('sevenOfHeartsPlayerId');
        sessionStorage.removeItem('sevenOfHeartsPlayerName');
        myPersistentPlayerId = null;
        myPersistentPlayerName = null;
        showWarning('Join Failed', message);
    });

    socket.on('kicked', () => { /* ... unchanged ... */ });
    socket.on('forceDisconnect', () => { /* ... unchanged ... */ });

    // --- DEBUG LOG ADDED ---
    socket.on('lobbyUpdate', (players) => {
        console.log("DEBUG: Received 'lobbyUpdate' event. Players:", players); // Log reception
        try { // Add try...catch to catch errors inside
            console.log("DEBUG: lobbyUpdate - Switching view to Lobby Screen."); // Log action
            document.getElementById('game-board').style.display = 'none';
            document.getElementById('join-screen').style.display = 'none';
            document.getElementById('lobby-screen').style.display = 'block';
            renderLobby(players);
             console.log("DEBUG: lobbyUpdate - renderLobby called."); // Log render call
        } catch (error) {
            console.error("ERROR inside lobbyUpdate handler:", error); // Log any errors
        }
    });
    // --- END DEBUG LOG ---


    socket.on('gameStarted', () => { /* ... unchanged ... */ });
    socket.on('updateGameState', (gs) => { /* ... unchanged ... */ });
    socket.on('gameEnded', ({ logHistory }) => { /* ... unchanged ... */ });
    socket.on('youWereMarkedAFK', () => { /* ... unchanged ... */ });
    socket.on('warning', (data) => { /* ... unchanged ... */ });

    // --- SETUP FUNCTIONS (lobby, modals, dynamic) ---
    // (Ensure these are defined correctly as in the previous working version)
     function setupLobbyEventListeners() { /* ... */ }
     function setupModalAndButtonListeners() { /* ... */ }
     function setupDynamicEventListeners() { /* ... */ }


    // --- RENDER FUNCTIONS ---
    // (renderLobby, showWarning, renderGameOver, renderScoreboard, renderMyInfo,
    //  renderMyHand, renderMyActions, renderOtherPlayers, renderGameStatusBanner,
    //  updatePauseBanner, renderLogModal, createCardImageElement,
    //  createRiverCardImageElement, createRiverPlaceholder, renderRiver,
    //  getValidMoves, makeDraggable)
    // --- These functions remain unchanged from the previous version ---
    // --- But ensure they exist and are correctly defined ---

    // Ensure renderLobby and showWarning are defined
    function renderLobby(players) {
         try { // Add try...catch here too
            const playerList = document.getElementById('player-list');
            const me = players.find(p => p.playerId === myPersistentPlayerId);
            if (!me) { /* ... handle not found ... */ return; }
            playerList.innerHTML = '';
            players.forEach(p => { /* ... populate list ... */ });
            const playerActions = document.getElementById('player-lobby-actions');
            const hostActions = document.getElementById('host-lobby-actions');
            const hostMsg = document.getElementById('host-message');
            if (me && me.isHost) { /* ... handle host view ... */ }
            else { /* ... handle player view ... */ }
         } catch(error) {
             console.error("ERROR inside renderLobby:", error);
         }
    }
    function showWarning(title, text) {
         try { // Add try...catch
            const titleEl = document.getElementById('warning-modal-title');
            const textEl = document.getElementById('warning-modal-text');
            const modalEl = document.getElementById('warning-modal');
            if(titleEl) titleEl.textContent = title;
            if(textEl) textEl.textContent = text;
            if(modalEl) modalEl.classList.remove('hidden');
         } catch(error) {
              console.error("ERROR inside showWarning:", error);
         }
    }

    // Define other render functions...
     function renderGameOver(logHistory) { /* ... */ }
     function renderScoreboard(players) { /* ... */ }
     function renderMyInfo(me) { /* ... */ }
     function renderMyHand(me, gs, gameMode) { /* ... */ }
     function renderMyActions(me, gs, gameMode) { /* ... */ }
     function renderOtherPlayers(players, me, currentPlayerId) { /* ... */ }
     function renderGameStatusBanner(gs, me) { /* ... */ }
     function updatePauseBanner(gs) { /* ... */ }
     function renderLogModal(logHistory) { /* ... */ }
     function createCardImageElement(card, gameMode) { /* ... */ }
     function createRiverCardImageElement(suit, rank) { /* ... */ }
     function createRiverPlaceholder(rank) { /* ... */ }
     function renderRiver(boardState, gameMode) { /* ... */ }
     function getValidMoves(hand, boardState, isFirstMove, gameMode) { /* ... */ }
     function makeDraggable(modal) { /* ... */ }


    document.querySelectorAll('.modal').forEach(modal => {
        if(modal) makeDraggable(modal);
    });

    // console.log("DEBUG: End of initial script execution within DOMContentLoaded.");
});