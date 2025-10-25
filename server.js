const http = require('http');
const express = require('express');
const path = require('path');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

let players = []; // Lobby players
let gameState = null; // Active game state
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
    gameState.logHistory.unshift(message); 
    if (gameState.logHistory.length > 50) {
        gameState.logHistory.pop();
    }
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
    // *** MODIFIED: Bot can be "next player" if it still has cards ***
    const availablePlayers = gameState.players.filter(p => p.status === 'Active' || (p.isBot === true && p.hand.length > 0));
    
    if (availablePlayers.length === 0) return null; // No one left to play
    
    const currentIndex = availablePlayers.findIndex(p => p.playerId === currentPlayerId);
    if (currentIndex === -1) {
        return availablePlayers[0].playerId;
    }
    
    const nextIndex = (currentIndex + 1) % availablePlayers.length;
    return availablePlayers[nextIndex].playerId;
}

function checkValidMove(card, boardState, hand, isFirstMove) {
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

function checkHandForValidMoves(hand, boardState, isFirstMove) {
    if (isFirstMove) {
        return hand.some(card => card.id === '7-Hearts-0');
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
        score: 0, 
        isBot: false, // NEW: Bot flag
    }));

    const host = gamePlayers.find(p => p.isHost);
    const otherPlayers = gamePlayers.filter(p => !p.isHost);
    const dealerOrder = [host.playerId, ...otherPlayers.map(p => p.playerId)];

    gameState = {
        players: gamePlayers,
        boardState: {}, 
        currentPlayerId: null, 
        logHistory: ['Game initialized.'],
        settings: settings,
        isPaused: false,
        pausedForPlayerNames: [],
        pauseEndTime: null,
        isFirstMove: true,
        currentRound: 0, 
        dealerOrder: dealerOrder,
        currentDealerIndex: -1, 
        dealerId: null, 
    };
    
    io.emit('gameStarted');
    startNewRound();
}

function startNewRound() {
    if (!gameState) return;

    // *** NEW: Purge bots before starting the new round ***
    const activePlayerIds = new Set(gameState.players.filter(p => p.isBot !== true).map(p => p.playerId));
    gameState.players = gameState.players.filter(p => activePlayerIds.has(p.playerId));
    gameState.dealerOrder = gameState.dealerOrder.filter(playerId => activePlayerIds.has(playerId));

    // Check if enough players are left to continue
    if (gameState.players.length < 2) {
        addLog('Not enough players to start a new round. Ending game.');
        endSession(true); // Abort the game
        return;
    }

    gameState.currentRound++;
    gameState.currentDealerIndex = (gameState.currentDealerIndex + 1) % gameState.dealerOrder.length;
    const dealerId = gameState.dealerOrder[gameState.currentDealerIndex];
    const dealer = gameState.players.find(p => p.playerId === dealerId);
    
    gameState.boardState = {};
    gameState.isFirstMove = true;
    gameState.logHistory = []; 
    gameState.players.forEach(p => p.hand = []); 

    let deck = createDeck(gameState.settings.deckCount);
    deck = shuffleDeck(deck);

    let playerIndex = 0;
    while (deck.length > 0) {
        gameState.players[playerIndex].hand.push(deck.pop());
        playerIndex = (playerIndex + 1) % gameState.players.length;
    }

    let firstPlayerId = null;
    let firstPlayerName = null;
    for (const player of gameState.players) {
        if (player.hand.some(card => card.id === '7-Hearts-0')) {
            firstPlayerId = player.playerId;
            firstPlayerName = player.name;
            break;
        }
    }
    
    if (!firstPlayerId) {
        firstPlayerId = gameState.players[0].playerId;
        firstPlayerName = gameState.players[0].name;
    }

    gameState.currentPlayerId = firstPlayerId;
    gameState.dealerId = dealer.playerId;

    addLog(`Round ${gameState.currentRound} starting. ${dealer.name} is the dealer.`);
    addLog(`Waiting for ${firstPlayerName} to play the 7 of Hearts.`);
    
    io.emit('updateGameState', gameState);
    checkAndRunNextBotTurn(); // Check if the first player is a bot
}

function endRound(winner) {
    if (!gameState) return;

    // *** MODIFIED: Handle null winner (e.g. all bots) ***
    const winnerName = winner ? winner.name : "No one";
    addLog(`🎉 ${winnerName} has won Round ${gameState.currentRound}! 🎉`);

    let scoreboard = [];

    gameState.players.forEach(p => {
        let roundScore = 0;
        // Score is calculated for everyone *except* the winner (if one exists)
        if (!winner || p.playerId !== winner.playerId) {
            for (const card of p.hand) {
                roundScore += RANK_ORDER[card.rank];
            }
        }
        
        // Don't add score to bots, they are already removed
        if (p.isBot !== true) {
             p.score += roundScore; 
        }
        
        scoreboard.push({
            name: p.name + (p.isBot ? ' [Bot]' : ''),
            roundScore: roundScore,
            cumulativeScore: p.score
        });
    });

    scoreboard.sort((a, b) => b.cumulativeScore - a.cumulativeScore);

    io.emit('roundOver', {
        scoreboard: scoreboard,
        winnerName: winnerName,
        roundNumber: gameState.currentRound
    });
}

function endSession(wasGameAborted = false) {
    if (!gameState) {
        const host = players.find(p => p.isHost);
        if (host) {
             players.forEach(p => {
                if (p.socketId !== host.socketId) {
                    io.to(p.socketId).emit('forceDisconnect');
                }
             });
             players = [host]; 
             io.emit('lobbyUpdate', players);
        }
        return;
    }

    addLog('The game session has ended.');
    io.emit('gameEnded', { logHistory: gameState.logHistory });

    players = gameState.players
        .filter(p => p.status !== 'Removed') // Bots will have status 'Removed'
        .map(p => ({
            playerId: p.playerId,
            socketId: p.socketId, 
            name: p.name,
            isHost: p.isHost,
            isReady: p.isHost, 
            active: p.status === 'Active' 
        }));
    
    players.forEach(p => {
        if (p.active) {
            const gamePlayer = gameState.players.find(gp => gp.playerId === p.playerId);
            if (gamePlayer) p.socketId = gamePlayer.socketId;
        }
    });

    io.emit('lobbyUpdate', players);

    gameState = null;
    Object.keys(reconnectTimers).forEach(key => clearTimeout(reconnectTimers[key]));
    if (gameOverCleanupTimer) clearTimeout(gameOverCleanupTimer);
}

// *** NEW: Bot Helper Function ***
function checkAndRunNextBotTurn() {
    if (!gameState) return;
    const nextPlayer = gameState.players.find(p => p.playerId === gameState.currentPlayerId);
    
    if (nextPlayer && nextPlayer.isBot === true) {
        // Wait 1.5s before bot plays
        setTimeout(() => runBotTurn(nextPlayer), 1500);
    }
}

// *** NEW: Bot Turn Logic ***
function runBotTurn(botPlayer) {
    if (!gameState || !botPlayer || botPlayer.isBot !== true || botPlayer.hand.length === 0) {
        return;
    }

    let cardToPlay = null;
    if (gameState.isFirstMove) {
        cardToPlay = botPlayer.hand.find(c => c.id === '7-Hearts-0');
    } else {
        for (const card of botPlayer.hand) {
            if (checkValidMove(card, gameState.boardState, botPlayer.hand, false)) {
                cardToPlay = card;
                break;
            }
        }
    }

    if (cardToPlay) {
        const cardInHandIndex = botPlayer.hand.findIndex(c => c.id === cardToPlay.id);
        botPlayer.hand.splice(cardInHandIndex, 1);
        
        const cardRankVal = RANK_ORDER[cardToPlay.rank];
        const deckIndex = cardToPlay.id.split('-')[2];
        const suitKey = `${cardToPlay.suit}-${deckIndex}`;

        if (!gameState.boardState[suitKey]) {
            gameState.boardState[suitKey] = { low: 7, high: 7 };
        } else if (cardRankVal > 7) {
            gameState.boardState[suitKey].high = cardRankVal;
        } else {
            gameState.boardState[suitKey].low = cardRankVal;
        }
        
        if (gameState.isFirstMove) {
            gameState.isFirstMove = false;
        }

        addLog(`[Bot] ${botPlayer.name} played the ${cardToPlay.rank} of ${cardToPlay.suit}.`);

        if (botPlayer.hand.length === 0) {
            addLog(`[Bot] ${botPlayer.name} has played its last card.`);
            // Bot does not "win", just empties its hand
        }
    } else {
        // No valid move, bot passes
        addLog(`[Bot] ${botPlayer.name} passed.`);
    }

    // Get next player
    gameState.currentPlayerId = getNextPlayerId(botPlayer.playerId);

    if (gameState.currentPlayerId === null) {
        // This means no players (human or bot) have any valid moves or cards left
        addLog('All players are out of cards or moves. Ending round.');
        endRound(null); // End round with no winner
    } else {
        io.emit('updateGameState', gameState);
        checkAndRunNextBotTurn(); // Chain to next bot if needed
    }
}


// *** MODIFIED: handlePlayerRemoval to enable Bot mode ***
function handlePlayerRemoval(playerId) {
    if (!gameState) return;
    const playerToRemove = gameState.players.find(p => p.playerId === playerId);
    
    if (playerToRemove && playerToRemove.status !== 'Removed') {
        // --- NEW BOT LOGIC ---
        playerToRemove.status = 'Removed'; // Mark as removed for scoring/next round
        playerToRemove.isBot = true;      // Mark as bot to finish playing hand
        addLog(`[Bot] ${playerToRemove.name} disconnected and is now bot-controlled.`);
        delete reconnectTimers[playerId];
        // --- END NEW BOT LOGIC ---

        // Check if game can continue
        const realActivePlayers = gameState.players.filter(p => p.status === 'Active' && p.isBot !== true);
        if (realActivePlayers.length < 2) {
            addLog('Not enough human players. Ending game.');
            endSession(true);
            return;
        } 
            
        // Handle host change
        if (playerToRemove.isHost) {
            const newHost = realActivePlayers[0]; // New host must be human
            if (newHost) {
                newHost.isHost = true;
                addLog(`${newHost.name} is the new host.`);
            }
        }
        
        // Handle pause state
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

        // If it was the removed player's turn, trigger bot turn
        if (gameState.currentPlayerId === playerId) {
            runBotTurn(playerToRemove);
        }
    }
}

function hardReset(hostSocket) {
    players.forEach(p => {
        if (p.socketId !== hostSocket.id) {
            io.to(p.socketId).emit('forceDisconnect');
        }
    });

    gameState = null;
    Object.keys(reconnectTimers).forEach(key => {
        clearTimeout(reconnectTimers[key]);
        delete reconnectTimers[key];
    });
    if (gameOverCleanupTimer) {
        clearTimeout(gameOverCleanupTimer);
        gameOverCleanupTimer = null;
    }

    const host = players.find(p => p.socketId === hostSocket.id);
    if (host) {
        host.isReady = true;
        host.active = true;
        players = [host];
    } else {
        players = [];
    }
    
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
                if (newPlayer.isHost) newPlayer.isReady = true;
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
                io.to(playerToKick.socketId).emit('forceDisconnect');
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
                const deckIndex = cardToPlay.id.split('-')[2];
                const suitKey = `${cardToPlay.suit}-${deckIndex}`;

                if (!gameState.boardState[suitKey]) {
                    gameState.boardState[suitKey] = { low: 7, high: 7 };
                } else if (cardRankVal > 7) {
                    gameState.boardState[suitKey].high = cardRankVal;
                } else {
                    gameState.boardState[suitKey].low = cardRankVal;
                }
                
                if (gameState.isFirstMove) {
                    gameState.isFirstMove = false;
                }

                addLog(`${player.name} played the ${cardToPlay.rank} of ${cardToPlay.suit}.`);

                if (player.hand.length === 0) {
                    endRound(player); // Human player wins
                    return;
                }

                gameState.currentPlayerId = getNextPlayerId(player.playerId);
                io.emit('updateGameState', gameState);
                checkAndRunNextBotTurn(); // Check if next player is bot
                
            } else {
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
                checkAndRunNextBotTurn(); // Check if next player is bot
            }
        }
    });

    socket.on('requestNextRound', () => {
        if (!gameState) return;
        const player = gameState.players.find(p => p.socketId === socket.id);
        
        if (player && player.isHost) {
            addLog(`Host ${player.name} is starting the next round.`);
            startNewRound();
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
                afkSocket.emit('youWereMarkedAFK'); // Correct event name
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
            endSession(false); 
        }
    });

    socket.on('hardReset', () => {
         const requester = players.find(p => p.socketId === socket.id);
         if (requester && requester.isHost) {
            hardReset(socket);
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

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));