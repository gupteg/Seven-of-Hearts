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

function createDeck(deckCount) { /* ... unchanged ... */ }
function shuffleDeck(deck) { /* ... unchanged ... */ }
function getNextPlayerId(currentPlayerId) { /* ... unchanged ... */ }
function checkValidMove(card, boardState, hand, isFirstMove, gameMode) { /* ... unchanged ... */ }
function checkHandForValidMoves(hand, boardState, isFirstMove, gameMode) { /* ... unchanged ... */ }
function initializeGame(readyPlayers, settings) { /* ... unchanged ... */ }
function handlePlayerRemoval(playerId) { /* ... unchanged ... */ }
function endSession(wasGameAborted = false) { /* ... unchanged ... */ }
function hardReset(hostSocket) { /* ... unchanged ... */ }

io.on('connection', (socket) => {
    // --- SERVER-SIDE DEBUG LOGS ADDED ---
    socket.on('joinGame', ({ playerName, playerId }) => {
        console.log(`SERVER LOG: Received 'joinGame' event. PlayerName: ${playerName}, PlayerID: ${playerId}, SocketID: ${socket.id}`); // Log: Event received

        if (gameState) {
            console.log("SERVER LOG: Game in progress. Attempting reconnection..."); // Log: Reconnect path
            // --- Reconnection Logic ---
            let playerToRejoin = null;
            if (playerId) {
                playerToRejoin = gameState.players.find(p => p.playerId === playerId && p.status === 'Disconnected');
                console.log(`SERVER LOG: Searched by PlayerID (${playerId}), Found: ${!!playerToRejoin}`); // Log: ID search result
            }
            if (!playerToRejoin && playerName) {
                playerToRejoin = gameState.players.find(p => p.name.toLowerCase() === playerName.toLowerCase() && p.status === 'Disconnected');
                 console.log(`SERVER LOG: Searched by PlayerName (${playerName}), Found: ${!!playerToRejoin}`); // Log: Name search result
            }

            if (playerToRejoin) {
                console.log(`SERVER LOG: Player ${playerToRejoin.name} found. Processing reconnection.`); // Log: Reconnect success
                playerToRejoin.status = 'Active';
                playerToRejoin.socketId = socket.id;
                clearTimeout(reconnectTimers[playerToRejoin.playerId]);
                delete reconnectTimers[playerToRejoin.playerId];
                addLog(`Player ${playerToRejoin.name} has reconnected!`);
                const stillDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
                if (stillDisconnected.length === 0) {
                    gameState.isPaused = false; gameState.pausedForPlayerNames = []; gameState.pauseEndTime = null; addLog('All players reconnected. Game resumed.');
                } else { gameState.pausedForPlayerNames = stillDisconnected.map(p => p.name); }
                console.log("SERVER LOG: Emitting 'joinSuccess' and 'updateGameState' for reconnect."); // Log: Emitting reconnect events
                socket.emit('joinSuccess', playerToRejoin.playerId);
                io.emit('updateGameState', gameState);
            } else {
                 console.log("SERVER LOG: Reconnecting player not found. Emitting 'joinFailed'."); // Log: Reconnect fail
                socket.emit('joinFailed', 'Game in progress and you are not a disconnected player.');
            }
        } else {
            console.log("SERVER LOG: No game in progress. Processing lobby join..."); // Log: Lobby path
            // --- Lobby Logic ---
            let existingPlayer = null;
            if (playerId) {
                existingPlayer = players.find(p => p.playerId === playerId);
                 console.log(`SERVER LOG: Checked for existing player in lobby by ID (${playerId}), Found: ${!!existingPlayer}`); // Log: Existing lobby player check
            }

            if (existingPlayer) {
                 console.log(`SERVER LOG: Updating existing lobby player ${existingPlayer.name}.`); // Log: Updating existing
                existingPlayer.socketId = socket.id;
                existingPlayer.name = playerName; // Update name in case it changed
                existingPlayer.active = true;
                // Don't emit joinSuccess here, just update lobby
            } else {
                 console.log(`SERVER LOG: Creating new player ${playerName}.`); // Log: Creating new player
                const newPlayer = {
                    playerId: `${socket.id}-${Date.now()}`,
                    name: playerName,
                    socketId: socket.id,
                    isHost: players.length === 0,
                    isReady: false,
                    active: true
                };
                if (newPlayer.isHost) newPlayer.isReady = true;
                players.push(newPlayer);
                 console.log(`SERVER LOG: Emitting 'joinSuccess' for new player. PlayerID: ${newPlayer.playerId}`); // Log: Emitting new player success
                socket.emit('joinSuccess', newPlayer.playerId);
            }

            console.log("SERVER LOG: Emitting 'lobbyUpdate'."); // Log: Emitting lobby update
            io.emit('lobbyUpdate', players);
        }
    });
    // --- END DEBUG LOGS ---

    socket.on('setPlayerReady', (isReady) => { /* ... unchanged ... */ });
    socket.on('kickPlayer', (playerIdToKick) => { /* ... unchanged ... */ });
    socket.on('startGame', ({ hostPassword, settings }) => { /* ... unchanged ... */ });
    socket.on('playCard', (card) => { /* ... unchanged ... */ });
    socket.on('passTurn', () => { /* ... unchanged ... */ });
    socket.on('markPlayerAFK', (playerIdToMark) => { /* ... unchanged ... */ });
    socket.on('playerIsBack', () => { /* ... unchanged ... */ });
    socket.on('endSession', () => { /* ... unchanged ... */ });
    socket.on('hardReset', () => { /* ... unchanged ... */ });
    socket.on('disconnect', () => { /* ... unchanged ... */ });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));