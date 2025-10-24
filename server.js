const http = require('http');
const express = require('express');
const path = require('path');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

let players = [];
let gameState = null;
const reconnectTimers = {};
const DISCONNECT_GRACE_PERIOD = 60000;
let gameOverCleanupTimer = null;

const SUITS = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RANK_ORDER = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };

function addLog(message) {
    if (!gameState) return;
    gameState.logHistory.unshift(message); 
    if (gameState.logHistory.length > 50) gameState.logHistory.pop();
}

function createDeck(deckCount) {
    let decks = [];
    for (let i = 0; i < deckCount; i++) {
        for (const suit of SUITS) {
            for (const rank of RANKS) {
                decks.push({ suit, rank, id: `${rank}-${suit}-${i}` });
            }
        }
    }
    return decks;
}

function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function getNextPlayerId(currentPlayerId) {
    const activePlayers = gameState.players.filter(p => p.status === 'Active');
    if (activePlayers.length === 0) return null;
    const currentIndex = activePlayers.findIndex(p => p.playerId === currentPlayerId);
    if (currentIndex === -1) return activePlayers[0].playerId;
    const nextIndex = (currentIndex + 1) % activePlayers.length;
    return activePlayers[nextIndex].playerId;
}

// --- GAME MODE LOGIC: Updated Check Valid Move ---
function checkValidMove(card, boardState, hand, isFirstMove, gameMode) {
    if (isFirstMove) {
        // First move must be 7-Hearts-0 regardless of mode
        return card.id === '7-Hearts-0'; 
    }

    const cardRankVal = RANK_ORDER[card.rank];

    // --- One Deck Logic ---
    if (gameMode === 'one-deck') {
        const layout = boardState[card.suit]; // Key is just 'Hearts', 'Spades' etc.
        if (card.rank === '7') return !layout;
        if (layout) return cardRankVal === layout.low - 1 || cardRankVal === layout.high + 1;
        return false;
    }

    // --- Two Deck Logic (Common parts) ---
    const deckIndex = card.id.split('-')[2];
    const strictSuitKey = `${card.suit}-${deckIndex}`; // e.g., 'Hearts-0'

    // --- Two Deck (Strict) Logic ---
    if (gameMode === 'two-deck-strict') {
        const layout = boardState[strictSuitKey];
        if (card.rank === '7') return !layout;
        if (layout) return cardRankVal === layout.low - 1 || cardRankVal === layout.high + 1;
        return false;
    }

    // --- Two Deck (Fungible) Logic ---
    if (gameMode === 'two-deck-fungible') {
        const layout0 = boardState[`${card.suit}-0`];
        const layout1 = boardState[`${card.suit}-1`];

        if (card.rank === '7') {
            // Can play a 7 if *its specific row* is not started
            return !boardState[strictSuitKey]; 
        }

        // Check if playable on row 0
        if (layout0 && (cardRankVal === layout0.low - 1 || cardRankVal === layout0.high + 1)) {
            return true;
        }
        // Check if playable on row 1
        if (layout1 && (cardRankVal === layout1.low - 1 || cardRankVal === layout1.high + 1)) {
            return true;
        }
        return false;
    }

    return false; // Should not reach here
}

// --- GAME MODE LOGIC: Updated Check Hand for Valid Moves ---
function checkHandForValidMoves(hand, boardState, isFirstMove, gameMode) {
    if (isFirstMove) {
        return hand.some(card => card.id === '7-Hearts-0');
    }
    for (const card of hand) {
        // Pass the gameMode to checkValidMove
        if (checkValidMove(card, boardState, hand, false, gameMode)) {
            return true;
        }
    }
    return false;
}

function initializeGame(readyPlayers, settings) {
    addLog('Initializing new game of Seven of Hearts...');
    
    const gamePlayers = readyPlayers.map(p => ({
        playerId: p.playerId, name: p.name, socketId: p.socketId, isHost: p.isHost,
        status: 'Active', hand: [], score: 0,
    }));

    // --- GAME MODE LOGIC: Determine deck count ---
    const deckCount = settings.gameMode === 'one-deck' ? 1 : 2;
    let deck = createDeck(deckCount);
    deck = shuffleDeck(deck);

    let playerIndex = 0;
    while (deck.length > 0) {
        gamePlayers[playerIndex].hand.push(deck.pop());
        playerIndex = (playerIndex + 1) % gamePlayers.length;
    }

    let firstPlayerId = null;
    let firstPlayerName = null;
    for (const player of gamePlayers) {
        // Starting card is always 7-Hearts-0
        if (player.hand.some(card => card.id === '7-Hearts-0')) {
            firstPlayerId = player.playerId;
            firstPlayerName = player.name;
            break;
        }
    }
    if (!firstPlayerId) {
        firstPlayerId = gamePlayers[0].playerId;
        firstPlayerName = gamePlayers[0].name;
    }

    gameState = {
        players: gamePlayers,
        boardState: {}, // Structure depends on mode, handled during play
        currentPlayerId: firstPlayerId,
        logHistory: ['Game initialized.'],
        settings: settings, // Includes gameMode
        isPaused: false,
        pausedForPlayerNames: [],
        pauseEndTime: null,
        isFirstMove: true,
    };

    addLog(`Game started. Mode: ${settings.gameMode}.`);
    addLog(`Win Condition: ${settings.winCondition === 'first_out' ? 'First Player Out' : 'Play to 100 Points'}.`);
    addLog(`Waiting for ${firstPlayerName} to play the 7 of Hearts.`);
    
    io.emit('gameStarted');
    io.emit('updateGameState', gameState);
}

function handlePlayerRemoval(playerId) {
    if (!gameState) return;
    const playerToRemove = gameState.players.find(p => p.playerId === playerId);
    if (playerToRemove && playerToRemove.status !== 'Removed') {
        playerToRemove.status = 'Removed';
        addLog(`Player ${playerToRemove.name} was removed after 60 seconds.`);
        delete reconnectTimers[playerId];

        const activePlayers = gameState.players.filter(p => p.status === 'Active');
        if (activePlayers.length < 2) {
            addLog('Not enough players. Ending game.');
            endSession(true);
            return;
        } 
        if (playerToRemove.isHost) {
            const newHost = activePlayers[0];
            if (newHost) {
                newHost.isHost = true;
                addLog(`${newHost.name} is the new host.`);
            }
        }
        if (gameState.currentPlayerId === playerId) {
            gameState.currentPlayerId = getNextPlayerId(playerId);
        }
        const stillDisconnected = gameState.players.some(p => p.status === 'Disconnected');
        if (!stillDisconnected) {
            gameState.isPaused = false;
            gameState.pausedForPlayerNames = [];
            gameState.pauseEndTime = null;
            addLog("All players reconnected or removed. Game resumed.");
        } else {
             gameState.pausedForPlayerNames = gameState.players
                .filter(p => p.status === 'Disconnected')
                .map(p => p.name);
        }
        io.emit('updateGameState', gameState);
    }
}

function endSession(wasGameAborted = false) {
    if (wasGameAborted && gameState) {
        addLog('The game session has ended.');
        io.emit('gameEnded', { logHistory: gameState.logHistory });
        players = gameState.players
            .filter(p => p.status !== 'Removed')
            .map(p => ({
                playerId: p.playerId, socketId: p.socketId, name: p.name,
                isHost: p.isHost, isReady: p.isHost, active: true
            }));
        io.emit('lobbyUpdate', players);
    } else if (gameState) {
        addLog('The game session has ended.');
        io.emit('gameEnded', { logHistory: gameState.logHistory });
        io.emit('lobbyUpdate', players);
    } else {
         const host = players.find(p => p.isHost);
         if (host) {
             players.forEach(p => {
                if (p.socketId !== host.socketId) io.to(p.socketId).emit('forceDisconnect');
             });
             players = [host];
             io.emit('lobbyUpdate', players);
         }
    }
    gameState = null;
    Object.keys(reconnectTimers).forEach(key => clearTimeout(reconnectTimers[key]));
    if (gameOverCleanupTimer) clearTimeout(gameOverCleanupTimer);
}

function hardReset(hostSocket) {
    players.forEach(p => {
        if (p.socketId !== hostSocket.id) io.to(p.socketId).emit('forceDisconnect');
    });
    gameState = null;
    Object.keys(reconnectTimers).forEach(key => { clearTimeout(reconnectTimers[key]); delete reconnectTimers[key]; });
    if (gameOverCleanupTimer) { clearTimeout(gameOverCleanupTimer); gameOverCleanupTimer = null; }
    const host = players.find(p => p.socketId === hostSocket.id);
    if (host) { host.isReady = true; host.active = true; players = [host]; } 
    else { players = []; }
    io.emit('lobbyUpdate', players);
}

io.on('connection', (socket) => {
    socket.on('joinGame', ({ playerName, playerId }) => {
        if (gameState) {
            // Reconnection Logic... (remains the same)
             let playerToRejoin = null;
            if (playerId) playerToRejoin = gameState.players.find(p => p.playerId === playerId && p.status === 'Disconnected');
            if (!playerToRejoin && playerName) playerToRejoin = gameState.players.find(p => p.name.toLowerCase() === playerName.toLowerCase() && p.status === 'Disconnected');
            if (playerToRejoin) {
                playerToRejoin.status = 'Active'; playerToRejoin.socketId = socket.id;
                clearTimeout(reconnectTimers[playerToRejoin.playerId]); delete reconnectTimers[playerToRejoin.playerId];
                addLog(`Player ${playerToRejoin.name} has reconnected!`);
                const stillDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
                if (stillDisconnected.length === 0) {
                    gameState.isPaused = false; gameState.pausedForPlayerNames = []; gameState.pauseEndTime = null; addLog('All players reconnected. Game resumed.');
                } else { gameState.pausedForPlayerNames = stillDisconnected.map(p => p.name); }
                socket.emit('joinSuccess', playerToRejoin.playerId); io.emit('updateGameState', gameState);
            } else { socket.emit('joinFailed', 'Game in progress and you are not a disconnected player.'); }
        } else {
            // Lobby Logic... (remains the same)
            let existingPlayer = null; if (playerId) existingPlayer = players.find(p => p.playerId === playerId);
            if (existingPlayer) { existingPlayer.socketId = socket.id; existingPlayer.name = playerName; existingPlayer.active = true; } 
            else { const newPlayer = { playerId: `${socket.id}-${Date.now()}`, name: playerName, socketId: socket.id, isHost: players.length === 0, isReady: false, active: true }; if (newPlayer.isHost) newPlayer.isReady = true; players.push(newPlayer); socket.emit('joinSuccess', newPlayer.playerId); }
            io.emit('lobbyUpdate', players);
        }
    });

    socket.on('setPlayerReady', (isReady) => {
        const player = players.find(p => p.socketId === socket.id);
        if (player) { player.isReady = isReady; io.emit('lobbyUpdate', players); }
    });

    socket.on('kickPlayer', (playerIdToKick) => {
        const requester = players.find(p => p.socketId === socket.id);
        if (requester && requester.isHost) {
            const playerToKick = players.find(p => p.playerId === playerIdToKick);
            if (playerToKick) { io.to(playerToKick.socketId).emit('forceDisconnect'); players = players.filter(p => p.playerId !== playerIdToKick); io.emit('lobbyUpdate', players); }
        }
    });

    // --- GAME MODE LOGIC: Start Game receives gameMode ---
    socket.on('startGame', ({ hostPassword, settings }) => {
        const requester = players.find(p => p.socketId === socket.id);
        if (!requester || !requester.isHost) return;
        if (process.env.HOST_PASSWORD && hostPassword !== process.env.HOST_PASSWORD) {
            return socket.emit('warning', 'Invalid Host Password.');
        }
        const readyPlayers = players.filter(p => p.isReady && p.active);
        if (readyPlayers.length < 3) { 
            return socket.emit('warning', 'You need at least 3 ready players to start.');
        }
        // Pass the full settings object which includes gameMode
        initializeGame(readyPlayers, settings); 
    });
    
    // --- GAME MODE LOGIC: Handle Play Card ---
    socket.on('playCard', (card) => {
        if (!gameState || gameState.isPaused) return;
        const player = gameState.players.find(p => p.socketId === socket.id);
        
        if (player && player.playerId === gameState.currentPlayerId) {
            
            const cardInHandIndex = player.hand.findIndex(c => c.id === card.id);
            if (cardInHandIndex === -1) {
                return socket.emit('warning', { title: 'Error', message: 'Card not in hand.' });
            }
            
            const cardToPlay = player.hand[cardInHandIndex];
            const gameMode = gameState.settings.gameMode;

            // Pass gameMode to validation
            const isValid = checkValidMove(cardToPlay, gameState.boardState, player.hand, gameState.isFirstMove, gameMode);

            if (isValid) {
                player.hand.splice(cardInHandIndex, 1);
                
                const cardRankVal = RANK_ORDER[cardToPlay.rank];
                let suitKeyToUpdate = null;

                if (gameMode === 'one-deck') {
                    suitKeyToUpdate = cardToPlay.suit;
                } 
                else if (gameMode === 'two-deck-strict') {
                    const deckIndex = cardToPlay.id.split('-')[2];
                    suitKeyToUpdate = `${cardToPlay.suit}-${deckIndex}`;
                } 
                else { // two-deck-fungible
                    const suit = cardToPlay.suit;
                    const key0 = `${suit}-0`;
                    const key1 = `${suit}-1`;
                    const layout0 = gameState.boardState[key0];
                    const layout1 = gameState.boardState[key1];

                    if (cardToPlay.rank === '7') {
                        // If it's a 7, it can only start its specific row
                        const deckIndex = cardToPlay.id.split('-')[2];
                         suitKeyToUpdate = `${suit}-${deckIndex}`;
                    } else {
                        // Check if playable on row 0 first
                        if (layout0 && (cardRankVal === layout0.low - 1 || cardRankVal === layout0.high + 1)) {
                            suitKeyToUpdate = key0;
                        } 
                        // Otherwise, check row 1
                        else if (layout1 && (cardRankVal === layout1.low - 1 || cardRankVal === layout1.high + 1)) {
                            suitKeyToUpdate = key1;
                        }
                    }
                }

                // Update the determined board state key
                if (suitKeyToUpdate) {
                    if (!gameState.boardState[suitKeyToUpdate]) {
                        gameState.boardState[suitKeyToUpdate] = { low: 7, high: 7 };
                    } else if (cardRankVal > 7) {
                        gameState.boardState[suitKeyToUpdate].high = cardRankVal;
                    } else if (cardRankVal < 7) {
                        gameState.boardState[suitKeyToUpdate].low = cardRankVal;
                    }
                }
                
                if (gameState.isFirstMove) gameState.isFirstMove = false;

                addLog(`${player.name} played the ${cardToPlay.rank} of ${cardToPlay.suit}.`);

                if (player.hand.length === 0) {
                    addLog(`🎉 ${player.name} has won the round! 🎉`);
                    endSession(true); return;
                }

                gameState.currentPlayerId = getNextPlayerId(player.playerId);
                io.emit('updateGameState', gameState);
                
            } else {
                socket.emit('warning', { title: 'Invalid Move', message: 'That is not a valid move.' });
            }
        }
    });

    // --- GAME MODE LOGIC: Handle Pass Turn ---
    socket.on('passTurn', () => {
        if (!gameState || gameState.isPaused) return;
        const player = gameState.players.find(p => p.socketId === socket.id);
        
        if (player && player.playerId === gameState.currentPlayerId) {
            // Pass gameMode to validation
            const hasValidMove = checkHandForValidMoves(player.hand, gameState.boardState, gameState.isFirstMove, gameState.settings.gameMode);
            
            if (hasValidMove) {
                socket.emit('warning', { title: 'Invalid Pass', message: 'You cannot pass, you have a valid move.' });
            } else {
                addLog(`${player.name} passed.`);
                gameState.currentPlayerId = getNextPlayerId(player.playerId);
                io.emit('updateGameState', gameState);
            }
        }
    });

    socket.on('markPlayerAFK', (playerIdToMark) => {
        // ... (remains the same) ...
        if (!gameState) return;
        const requester = gameState.players.find(p => p.socketId === socket.id);
        const playerToMark = gameState.players.find(p => p.playerId === playerIdToMark);
        if (requester && requester.isHost && playerToMark && playerToMark.status === 'Active') {
            playerToMark.status = 'Disconnected';
            addLog(`Host marked ${playerToMark.name} as AFK. The game is paused.`);
            gameState.isPaused = true;
            gameState.pausedForPlayerNames = gameState.players.filter(p => p.status === 'Disconnected').map(p => p.name);
            gameState.pauseEndTime = Date.now() + DISCONNECT_GRACE_PERIOD;
            if (reconnectTimers[playerToMark.playerId]) clearTimeout(reconnectTimers[playerToMark.playerId]);
            reconnectTimers[playerToMark.playerId] = setTimeout(() => { handlePlayerRemoval(playerToMark.playerId); }, DISCONNECT_GRACE_PERIOD);
            io.emit('updateGameState', gameState);
            const afkSocket = io.sockets.sockets.get(playerToMark.socketId);
            if (afkSocket) afkSocket.emit('youWereMarkedAFK');
        }
    });

    socket.on('playerIsBack', () => {
        // ... (remains the same) ...
         if (!gameState) return;
        const player = gameState.players.find(p => p.socketId === socket.id);
        if (player && player.status === 'Disconnected') {
            player.status = 'Active'; clearTimeout(reconnectTimers[player.playerId]); delete reconnectTimers[player.playerId];
            addLog(`Player ${player.name} is back!`);
            const stillDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
            if (stillDisconnected.length === 0) { gameState.isPaused = false; gameState.pausedForPlayerNames = []; gameState.pauseEndTime = null; addLog('All players back. Game resumed.'); } 
            else { gameState.pausedForPlayerNames = stillDisconnected.map(p => p.name); }
            io.emit('updateGameState', gameState);
        }
    });

    socket.on('endSession', () => {
        // ... (remains the same) ...
         let isHost = false; const playerInLobby = players.find(p => p.socketId === socket.id);
        if (playerInLobby && playerInLobby.isHost) isHost = true;
        else if (gameState) { const playerInGame = gameState.players.find(p => p.socketId === socket.id); if (playerInGame && playerInGame.isHost) isHost = true; }
        if (isHost) endSession(false);
    });

    socket.on('hardReset', () => {
        // ... (remains the same) ...
        const requester = players.find(p => p.socketId === socket.id); if (requester && requester.isHost) hardReset(socket);
    });

    socket.on('disconnect', () => {
        // ... (remains the same) ...
        if (gameState) {
            const playerInGame = gameState.players.find(p => p.socketId === socket.id && p.status === 'Active');
            if (playerInGame) {
                playerInGame.status = 'Disconnected'; addLog(`Player ${playerInGame.name} has disconnected. The game is paused.`);
                gameState.isPaused = true; gameState.pausedForPlayerNames = gameState.players.filter(p => p.status === 'Disconnected').map(p => p.name);
                gameState.pauseEndTime = Date.now() + DISCONNECT_GRACE_PERIOD;
                if (reconnectTimers[playerInGame.playerId]) clearTimeout(reconnectTimers[playerInGame.playerId]);
                reconnectTimers[playerInGame.playerId] = setTimeout(() => { handlePlayerRemoval(playerInGame.playerId); }, DISCONNECT_GRACE_PERIOD);
                io.emit('updateGameState', gameState);
            }
        } else {
            const disconnectedPlayer = players.find(p => p.socketId === socket.id);
            if (disconnectedPlayer) { disconnectedPlayer.active = false; io.emit('lobbyUpdate', players); }
        }
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));