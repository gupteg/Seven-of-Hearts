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

// --- NEW: Seven of Hearts Constants ---
const SUITS = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
// --- END: Seven of Hearts Constants ---

// Centralized function to add logs to gameState
function addLog(message) {
    if (!gameState) return;
    gameState.logHistory.push(message);
    io.emit('updateGameState', gameState);
}

// --- NEW: Seven of Hearts Game Logic (Stubs) ---
function initializeGame(readyPlayers, settings) {
    addLog('Initializing new game of Seven of Hearts...');
    
    const gamePlayers = readyPlayers.map(p => ({
        playerId: p.playerId,
        name: p.name,
        socketId: p.socketId,
        status: 'Active',
        hand: [],
        // TODO: Add score for multi-round games
    }));

    // TODO: Phase 2
    // 1. Create deck(s) based on settings.deckCount
    // 2. Shuffle and deal all cards to gamePlayers
    // 3. Find the player with the 7 of Hearts
    // 4. Set that player's playerId as the currentPlayerId

    // Placeholder: Give first player the 7 of Hearts for testing
    // gamePlayers[0].hand.push({ suit: 'Hearts', rank: '7' });

    const firstPlayerId = gamePlayers[0].playerId; // Placeholder
    const firstPlayerName = gamePlayers[0].name; // Placeholder

    gameState = {
        players: gamePlayers,
        boardState: {}, // Will hold the 'river' layouts
        currentPlayerId: firstPlayerId,
        logHistory: ['Game initialized.'],
        settings: settings,
        isPaused: false,
        pausedForPlayerNames: [],
        pauseEndTime: null,
        // ... other state
    };

    addLog(`Game started with ${settings.deckCount} deck(s).`);
    addLog(`Mode: ${settings.winCondition === 'first_out' ? 'First Player Out' : 'Play to 100 Points'}.`);
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

        // Check if game should end
        const activePlayers = gameState.players.filter(p => p.status === 'Active');
        if (activePlayers.length < 2) {
            addLog('Not enough players. Ending game.');
            endSession();
        } else {
            // Check for host transfer
            if (playerToRemove.isHost) {
                const newHost = activePlayers[0];
                if (newHost) {
                    newHost.isHost = true;
                    addLog(`${newHost.name} is the new host.`);
                }
            }
        }
        io.emit('updateGameState', gameState);
    }
}

function endSession() {
    if (!gameState) return;
    addLog('The game session has ended.');
    io.emit('gameEnded', { logHistory: gameState.logHistory });
    
    gameState = null;
    players = [];
    Object.keys(reconnectTimers).forEach(key => clearTimeout(reconnectTimers[key]));
    if (gameOverCleanupTimer) clearTimeout(gameOverCleanupTimer);
}

function hardReset() {
    io.emit('hardReset');
    gameState = null;
    players = [];
    Object.keys(reconnectTimers).forEach(key => clearTimeout(reconnectTimers[key]));
    if (gameOverCleanupTimer) clearTimeout(gameOverCleanupTimer);
}
// --- END: Seven of Hearts Game Logic ---


// --- RETAINED: Lobby & Player Management Logic ---
io.on('connection', (socket) => {
    socket.on('joinGame', ({ playerName, playerId }) => {
        if (gameState) {
            // --- Reconnection Logic ---
            let playerToRejoin = null;
            if (playerId) {
                playerToRejoin = gameState.players.find(p => p.playerId === playerId && p.status === 'Disconnected');
            }
            if (!playerToRejoin && playerName) {
                playerToRejoin = gameState.players.find(p => p.name.toLowerCase() === playerName.toLowerCase() && p.status === 'Disconnected');
            }

            if (playerToRejoin) {
                playerToRejoin.status = 'Active';
                playerToRejoin.socketId = socket.id;
                clearTimeout(reconnectTimers[playerToRejoin.playerId]);
                delete reconnectTimers[playerToRejoin.playerId];
                
                addLog(`Player ${playerToRejoin.name} has reconnected!`);
                
                const stillDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
                if (stillDisconnected.length === 0) {
                    gameState.isPaused = false;
                    gameState.pausedForPlayerNames = [];
                    gameState.pauseEndTime = null;
                    addLog('All players reconnected. Game resumed.');
                } else {
                    gameState.pausedForPlayerNames = stillDisconnected.map(p => p.name);
                }
                socket.emit('joinSuccess', playerToRejoin.playerId);
                io.emit('updateGameState', gameState);
            } else {
                socket.emit('joinFailed', 'Game in progress and you are not a disconnected player.');
            }
        } else {
            // --- Lobby Logic ---
            const newPlayer = {
                playerId: `${socket.id}-${Date.now()}`,
                name: playerName,
                socketId: socket.id,
                isHost: players.length === 0,
                isReady: false,
                active: true
            };
            players.push(newPlayer);
            socket.emit('joinSuccess', newPlayer.playerId);
            io.emit('lobbyUpdate', players);
        }
    });

    socket.on('setPlayerReady', () => {
        const player = players.find(p => p.socketId === socket.id);
        if (player) {
            player.isReady = !player.isReady;
            io.emit('lobbyUpdate', players);
        }
    });

    socket.on('kickPlayer', (playerIdToKick) => {
        const requester = players.find(p => p.socketId === socket.id);
        if (requester && requester.isHost) {
            players = players.filter(p => p.playerId !== playerIdToKick);
            io.emit('lobbyUpdate', players);
            const kickedSocket = io.sockets.sockets.get(players.find(p => p.playerId === playerIdToKick)?.socketId);
            if (kickedSocket) {
                kickedSocket.emit('kicked');
                kickedSocket.disconnect();
            }
        }
    });

    socket.on('startGame', ({ hostPassword, settings }) => {
        const requester = players.find(p => p.socketId === socket.id);
        if (!requester || !requester.isHost) return;

        if (process.env.HOST_PASSWORD && hostPassword !== process.env.HOST_PASSWORD) {
            socket.emit('warning', 'Invalid Host Password.');
            return;
        }

        const readyPlayers = players.filter(p => p.isReady && p.active);
        if (readyPlayers.length < 2) { // TODO: We can change this to 3 for a real game
            socket.emit('warning', 'You need at least 2 ready players to start.');
            return;
        }

        // Pass settings to new game initializer
        initializeGame(readyPlayers, settings);
    });
    
    // --- NEW: Seven of Hearts Game Event Stubs ---
    socket.on('playCard', (card) => {
        if (!gameState || gameState.isPaused) return;
        const player = gameState.players.find(p => p.socketId === socket.id);
        if (player && player.playerId === gameState.currentPlayerId) {
            addLog(`${player.name} played a card (LOGIC TBD)`);
            // TODO: Phase 2
            // 1. Check if card is in player's hand
            // 2. Validate move (is it a 7? does it build on river?)
            // 3. Update gameState.boardState
            // 4. Remove card from player.hand
            // 5. Check if player.hand.length === 0 (winner)
            // 6. If winner, end round/game.
            // 7. If no winner, set next player's turn (gameState.currentPlayerId)
            // 8. io.emit('updateGameState', gameState);
        }
    });

    socket.on('passTurn', () => {
        if (!gameState || gameState.isPaused) return;
        const player = gameState.players.find(p => p.socketId === socket.id);
        if (player && player.playerId === gameState.currentPlayerId) {
            addLog(`${player.name} passed (LOGIC TBD)`);
            // TODO: Phase 2
            // 1. Validate pass (check player's hand against boardState to ensure they have NO valid moves)
            // 2. If pass is valid, set next player's turn
            // 3. io.emit('updateGameState', gameState);
            // 4. If pass is invalid, emit warning to player.
        }
    });
    // --- END: Seven of Hearts Stubs ---

    socket.on('markPlayerAFK', (playerIdToMark) => {
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
            reconnectTimers[playerToMark.playerId] = setTimeout(() => {
                handlePlayerRemoval(playerToMark.playerId);
            }, DISCONNECT_GRACE_PERIOD);
            
            io.emit('updateGameState', gameState);
            const afkSocket = io.sockets.sockets.get(playerToMark.socketId);
            if (afkSocket) {
                afkSocket.emit('youWereMarkedAFK');
            }
        }
    });

    socket.on('playerIsBack', () => {
        if (!gameState) return;
        const player = gameState.players.find(p => p.socketId === socket.id);
        if (player && player.status === 'Disconnected') {
            player.status = 'Active';
            clearTimeout(reconnectTimers[player.playerId]);
            delete reconnectTimers[player.playerId];
            
            addLog(`Player ${player.name} is back!`);
            
            const stillDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
            if (stillDisconnected.length === 0) {
                gameState.isPaused = false;
                gameState.pausedForPlayerNames = [];
                gameState.pauseEndTime = null;
                addLog('All players back. Game resumed.');
            } else {
                gameState.pausedForPlayerNames = stillDisconnected.map(p => p.name);
            }
            io.emit('updateGameState', gameState);
        }
    });

    socket.on('endSession', () => {
        const requester = players.find(p => p.socketId === socket.id);
        if (requester && requester.isHost) {
            endSession();
        } else if (gameState) {
            const playerInGame = gameState.players.find(p => p.socketId === socket.id);
            if (playerInGame && playerInGame.isHost) {
                endSession();
            }
        }
    });

    socket.on('hardReset', () => {
         const requester = players.find(p => p.socketId === socket.id);
         if (requester && requester.isHost) {
            hardReset();
         }
    });

    socket.on('disconnect', () => {
        if (gameState) {
            const playerInGame = gameState.players.find(p => p.socketId === socket.id && p.status === 'Active');
            if (playerInGame) {
                playerInGame.status = 'Disconnected';
                addLog(`Player ${playerInGame.name} has disconnected. The game is paused.`);
                gameState.isPaused = true;
                gameState.pausedForPlayerNames = gameState.players.filter(p => p.status === 'Disconnected').map(p => p.name);
                gameState.pauseEndTime = Date.now() + DISCONNECT_GRACE_PERIOD;
                if (reconnectTimers[playerInGame.playerId]) clearTimeout(reconnectTimers[playerInGame.playerId]);
                reconnectTimers[playerInGame.playerId] = setTimeout(() => {
                    handlePlayerRemoval(playerInGame.playerId);
                }, DISCONNECT_GRACE_PERIOD);
                io.emit('updateGameState', gameState);
            }
        } else {
            const disconnectedPlayer = players.find(p => p.socketId === socket.id);
            if (disconnectedPlayer) {
                disconnectedPlayer.active = false;
                io.emit('lobbyUpdate', players);
            }
        }
    });
});
// --- END: Retained Logic ---

const PORT = process.env.PORT || 5000;

server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
