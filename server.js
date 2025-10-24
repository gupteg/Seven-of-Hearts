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

// --- Seven of Hearts Constants ---
const SUITS = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RANK_ORDER = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };
// --- END Constants ---

function addLog(message) {
    if (!gameState) return;
    // Add to beginning of array so latest log is first
    gameState.logHistory.unshift(message); 
    // Prune log to keep it from getting too large
    if (gameState.logHistory.length > 50) {
        gameState.logHistory.pop();
    }
    // Note: We don't emit here, we only emit on updateGameState
}

// --- Deck Creation Logic ---
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
// --- END: Deck Logic ---

// --- Game Helper Functions ---
function getNextPlayerId(currentPlayerId) {
    const activePlayers = gameState.players.filter(p => p.status === 'Active');
    if (activePlayers.length === 0) return null;
    
    const currentIndex = activePlayers.findIndex(p => p.playerId === currentPlayerId);
    if (currentIndex === -1) {
        // If current player is not active, just return the first active player
        return activePlayers[0].playerId;
    }
    
    const nextIndex = (currentIndex + 1) % activePlayers.length;
    return activePlayers[nextIndex].playerId;
}

// This is the single source of truth for move validation
function checkValidMove(card, boardState, hand, isFirstMove) {
    if (isFirstMove) {
        return card.rank === '7' && card.suit === 'Hearts';
    }

    // Rule 1: Can play a 7 ONLY if that suit's layout hasn't been started.
    // A layout "exists" if the 7 has been played.
    if (card.rank === '7') {
        return !boardState[card.suit];
    }

    // Rule 2: Can build on an existing layout
    const suitLayout = boardState[card.suit];
    if (suitLayout) {
        const cardRankVal = RANK_ORDER[card.rank];
        // Check if it's the next high card
        if (cardRankVal === suitLayout.high + 1) return true;
        // Check if it's the next low card
        if (cardRankVal === suitLayout.low - 1) return true;
    }

    return false;
}

function checkHandForValidMoves(hand, boardState, isFirstMove) {
    if (isFirstMove) {
        return hand.some(card => card.rank === '7' && card.suit === 'Hearts');
    }
    for (const card of hand) {
        if (checkValidMove(card, boardState, hand, false)) {
            return true;
        }
    }
    return false;
}
// --- END: Game Helpers ---


// --- Core Game Logic ---
function initializeGame(readyPlayers, settings) {
    addLog('Initializing new game of Seven of Hearts...');
    
    const gamePlayers = readyPlayers.map(p => ({
        playerId: p.playerId,
        name: p.name,
        socketId: p.socketId,
        isHost: p.isHost,
        status: 'Active',
        hand: [],
        score: 0, // Initialize score
    }));

    let deck = createDeck(settings.deckCount);
    deck = shuffleDeck(deck);

    let playerIndex = 0;
    while (deck.length > 0) {
        gamePlayers[playerIndex].hand.push(deck.pop());
        playerIndex = (playerIndex + 1) % gamePlayers.length;
    }

    let firstPlayerId = null;
    let firstPlayerName = null;
    for (const player of gamePlayers) {
        if (player.hand.some(card => card.rank === '7' && card.suit === 'Hearts')) {
            firstPlayerId = player.playerId;
            firstPlayerName = player.name;
            break;
        }
    }
    
    // Fallback if H7 isn't found (e.g., AFK player has it)
    if (!firstPlayerId) {
        firstPlayerId = gamePlayers[0].playerId;
        firstPlayerName = gamePlayers[0].name;
    }

    gameState = {
        players: gamePlayers,
        boardState: {}, // Empty board
        currentPlayerId: firstPlayerId,
        logHistory: ['Game initialized.'],
        settings: settings,
        isPaused: false,
        pausedForPlayerNames: [],
        pauseEndTime: null,
        isFirstMove: true,
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

        const activePlayers = gameState.players.filter(p => p.status === 'Active');
        if (activePlayers.length < 2) {
            addLog('Not enough players. Ending game.');
            endSession(true); // End session and update lobby
            return; // Stop further execution
        } 
            
        // Check for host transfer
        if (playerToRemove.isHost) {
            const newHost = activePlayers[0];
            if (newHost) {
                newHost.isHost = true;
                addLog(`${newHost.name} is the new host.`);
            }
        }
        // If it was the removed player's turn, advance it
        if (gameState.currentPlayerId === playerId) {
            gameState.currentPlayerId = getNextPlayerId(playerId);
        }
        
        // Unpause if this was the last disconnected player
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

// --- BUG FIX: Modified endSession to handle lobby update ---
function endSession(wasGameAborted = false) {
    if (wasGameAborted && gameState) {
        // Game ended abnormally (e.g., not enough players)
        // We need to reform the lobby from active game players
        addLog('The game session has ended.');
        io.emit('gameEnded', { logHistory: gameState.logHistory });

        players = gameState.players
            .filter(p => p.status !== 'Removed')
            .map(p => ({
                playerId: p.playerId,
                socketId: p.socketId,
                name: p.name,
                isHost: p.isHost,
                isReady: p.isHost, // Host is ready by default
                active: true
            }));
        
        io.emit('lobbyUpdate', players); // Send everyone back to lobby
    
    } else if (gameState) {
        // Normal game end (e.g., host clicks End Session)
        addLog('The game session has ended.');
        io.emit('gameEnded', { logHistory: gameState.logHistory });
        // The lobby is reformed from the 'players' array, not gameState.players
        io.emit('lobbyUpdate', players);
    
    } else {
         // Host clicks "End Session" from the lobby
         const host = players.find(p => p.isHost);
         if (host) {
             players.forEach(p => {
                if (p.socketId !== host.socketId) {
                    io.to(p.socketId).emit('forceDisconnect');
                }
             });
             players = [host]; // Lobby is just the host now
             io.emit('lobbyUpdate', players);
         }
    }
    
    gameState = null;
    Object.keys(reconnectTimers).forEach(key => clearTimeout(reconnectTimers[key]));
    if (gameOverCleanupTimer) clearTimeout(gameOverCleanupTimer);
}

// --- BUG FIX: Replaced hardReset with Judgment's logic ---
function hardReset(hostSocket) {
    // Disconnect all other players
    players.forEach(p => {
        if (p.socketId !== hostSocket.id) {
            io.to(p.socketId).emit('forceDisconnect');
        }
    });

    // Clear all game state
    gameState = null;
    Object.keys(reconnectTimers).forEach(key => {
        clearTimeout(reconnectTimers[key]);
        delete reconnectTimers[key];
    });
    if (gameOverCleanupTimer) {
        clearTimeout(gameOverCleanupTimer);
        gameOverCleanupTimer = null;
    }

    // Reset lobby to just the host
    const host = players.find(p => p.socketId === hostSocket.id);
    if (host) {
        host.isReady = true; // Host is always ready
        host.active = true;
        players = [host];
    } else {
        players = []; // Should not happen, but safeguard
    }
    
    // Update the host's UI, which effectively updates everyone as they've been kicked
    io.emit('lobbyUpdate', players);
}
// --- END: Core Game Logic ---


// --- Lobby & Player Management Logic ---
io.on('connection', (socket) => {
    socket.on('joinGame', ({ playerName, playerId }) => {
        if (gameState) {
            // --- Reconnection Logic ---
            let playerToRejoin = null;
            if (playerId) {
                playerToRejoin = gameState.players.find(p => p.playerId === playerId && p.status === 'Disconnected');
            }
            if (!playerToRejoin && playerName) {
                // Fallback: Find by name if ID fails
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
                socket.emit('joinSuccess', playerToRejoin.playerId); // Send success
                io.emit('updateGameState', gameState); // Send game state
            } else {
                // Player is not in the game, reject
                socket.emit('joinFailed', 'Game in progress and you are not a disconnected player.');
            }
        } else {
            // --- Lobby Logic ---
            // Check if player is already in lobby (e.g., host reset and they refreshed)
            let existingPlayer = null;
            if (playerId) {
                existingPlayer = players.find(p => p.playerId === playerId);
            }
            
            if (existingPlayer) {
                existingPlayer.socketId = socket.id;
                existingPlayer.name = playerName;
                existingPlayer.active = true;
            } else {
                const newPlayer = {
                    playerId: `${socket.id}-${Date.now()}`,
                    name: playerName,
                    socketId: socket.id,
                    isHost: players.length === 0,
                    isReady: false,
                    active: true
                };
                if (newPlayer.isHost) newPlayer.isReady = true; // Host is auto-ready
                players.push(newPlayer);
                socket.emit('joinSuccess', newPlayer.playerId);
            }
            
            io.emit('lobbyUpdate', players);
        }
    });

    socket.on('setPlayerReady', (isReady) => {
        const player = players.find(p => p.socketId === socket.id);
        if (player) {
            player.isReady = isReady;
            io.emit('lobbyUpdate', players);
        }
    });

    socket.on('kickPlayer', (playerIdToKick) => {
        const requester = players.find(p => p.socketId === socket.id);
        if (requester && requester.isHost) {
            const playerToKick = players.find(p => p.playerId === playerIdToKick);
            if (playerToKick) {
                io.to(playerToKick.socketId).emit('forceDisconnect'); // Use forceDisconnect
                players = players.filter(p => p.playerId !== playerIdToKick);
                io.emit('lobbyUpdate', players);
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
        
        if (readyPlayers.length < 3) { 
            socket.emit('warning', 'You need at least 3 ready players to start.');
            return;
        }

        initializeGame(readyPlayers, settings);
    });
    
    // --- Seven of Hearts Game Events ---
    socket.on('playCard', (card) => {
        if (!gameState || gameState.isPaused) return;
        const player = gameState.players.find(p => p.socketId === socket.id);
        
        if (player && player.playerId === gameState.currentPlayerId) {
            
            const cardInHandIndex = player.hand.findIndex(c => c.id === card.id);
            if (cardInHandIndex === -1) {
                return socket.emit('warning', { title: 'Error', message: 'Card not in hand.' });
            }
            
            const cardToPlay = player.hand[cardInHandIndex];

            const isValid = checkValidMove(cardToPlay, gameState.boardState, player.hand, gameState.isFirstMove);

            if (isValid) {
                player.hand.splice(cardInHandIndex, 1);
                
                const cardRankVal = RANK_ORDER[cardToPlay.rank];

                // Update boardState
                const suit = cardToPlay.suit;
                if (!gameState.boardState[suit]) {
                    // This is the 7, create the layout
                    gameState.boardState[suit] = { low: 7, high: 7 };
                } else if (cardRankVal > 7) {
                    gameState.boardState[suit].high = cardRankVal;
                } else {
                    gameState.boardState[suit].low = cardRankVal;
                }
                
                if (gameState.isFirstMove) {
                    gameState.isFirstMove = false;
                }

                addLog(`${player.name} played the ${cardToPlay.rank} of ${cardToPlay.suit}.`);

                if (player.hand.length === 0) {
                    addLog(`🎉 ${player.name} has won the round! 🎉`);
                    // TODO: End round, calculate scores
                    endSession(true); // End and go to lobby for now
                    return;
                }

                gameState.currentPlayerId = getNextPlayerId(player.playerId);
                io.emit('updateGameState', gameState);
                
            } else {
                // Send a modal warning
                socket.emit('warning', { title: 'Invalid Move', message: 'That is not a valid move.' });
            }
        }
    });

    socket.on('passTurn', () => {
        if (!gameState || gameState.isPaused) return;
        const player = gameState.players.find(p => p.socketId === socket.id);
        
        if (player && player.playerId === gameState.currentPlayerId) {
            
            const hasValidMove = checkHandForValidMoves(player.hand, gameState.boardState, gameState.isFirstMove);
            
            if (hasValidMove) {
                socket.emit('warning', { title: 'Invalid Pass', message: 'You cannot pass, you have a valid move.' });
            } else {
                addLog(`${player.name} passed.`);
                gameState.currentPlayerId = getNextPlayerId(player.playerId);
                io.emit('updateGameState', gameState);
            }
        }
    });
    // --- END: Seven of Hearts Events ---

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
        let isHost = false;
        const playerInLobby = players.find(p => p.socketId === socket.id);
        if (playerInLobby && playerInLobby.isHost) {
            isHost = true;
        } else if (gameState) {
            const playerInGame = gameState.players.find(p => p.socketId === socket.id);
            if (playerInGame && playerInGame.isHost) {
                isHost = true;
            }
        }

        if (isHost) {
            endSession(false); // Normal end, not an abort
        }
    });

    // --- BUG FIX: Swapped to Judgment's hard reset logic ---
    socket.on('hardReset', () => {
         const requester = players.find(p => p.socketId === socket.id);
         if (requester && requester.isHost) {
            hardReset(socket); // Pass the host's socket
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
                disconnectedPlayer.active = false; // Mark as inactive in lobby
                io.emit('lobbyUpdate', players);
            }
        }
    });
});
// --- END: Retained Logic ---

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));