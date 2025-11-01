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
// --- *** NEW: Host Password from .env *** ---
const HOST_PASSWORD = process.env.HOST_PASSWORD || null;

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
// *** MODIFIED: Handle 'fungible' game mode ***
function createDeck(gameMode) {
    let decks = [];
    if (gameMode === 'fungible') {
        // Create two decks with unique copy IDs ('-c1', '-c2')
        for (let i = 1; i <= 2; i++) {
            for (const suit of SUITS) {
                for (const rank of RANKS) {
                    decks.push({ suit, rank, id: `${rank}-${suit}-c${i}` });
                }
            }
        }
    } else {
        // Existing logic for 1 or 2 decks (using '-0', '-1')
        const deckCount = parseInt(gameMode, 10);
        for (let i = 0; i < deckCount; i++) {
            for (const suit of SUITS) {
                for (const rank of RANKS) {
                    decks.push({ suit, rank, id: `${rank}-${suit}-${i}` });
                }
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

    const availablePlayers = gameState.players.filter(p => p.status === 'Active' || (p.isBot === true && p.hand.length > 0));

    if (availablePlayers.length === 0) return null;

    const currentIndex = availablePlayers.findIndex(p => p.playerId === currentPlayerId);
    if (currentIndex === -1) {
        // If current player is no longer available (e.g., bot finished hand), start from first available
        return availablePlayers[0].playerId;
    }

    const nextIndex = (currentIndex + 1) % availablePlayers.length;
    return availablePlayers[nextIndex].playerId;
}

// *** MODIFIED: checkValidMove split for fungible mode ***
function checkValidMove(card, boardState, hand, isFirstMove) {
    if (gameState.settings.gameMode === 'fungible') {
        return checkValidMoveFungible(card, boardState, hand, isFirstMove);
    } else {
        return checkValidMoveStrict(card, boardState, hand, isFirstMove);
    }
}

// *** NEW: Fungible move logic ***
function checkValidMoveFungible(card, boardState, hand, isFirstMove) {
    if (isFirstMove) {
        // Start card is always 7-Hearts-c1
        return card.id === '7-Hearts-c1';
    }

    const suitLayout = boardState[card.suit];
    const cardRankVal = RANK_ORDER[card.rank];

    if (card.rank === '7') {
        // Can play a 7 if its suit layout doesn't exist
        if (!suitLayout) return true;
        // Or if row1 exists but row2 doesn't
        if (suitLayout.row1 && !suitLayout.row2) return true;
        // Otherwise (if row1 and row2 exist), it's not valid
        return false;
    }

    // Check non-7 cards
    if (suitLayout) {
        // Check row 1
        if (suitLayout.row1) {
            if (cardRankVal === suitLayout.row1.high + 1) return true;
            if (cardRankVal === suitLayout.row1.low - 1) return true;
        }
        // Check row 2
        if (suitLayout.row2) {
            if (cardRankVal === suitLayout.row2.high + 1) return true;
            if (cardRankVal === suitLayout.row2.low - 1) return true;
        }
    }

    return false; // Not playable on any available row
}

// *** NEW: Original logic refactored for clarity ***
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

// *** MODIFIED: checkHandForValidMoves split for fungible mode ***
function checkHandForValidMoves(hand, boardState, isFirstMove) {
    if (gameState.settings.gameMode === 'fungible') {
        if (isFirstMove) {
            return hand.some(card => card.id === '7-Hearts-c1');
        }
        for (const card of hand) {
            if (checkValidMoveFungible(card, boardState, hand, false)) {
                return true;
            }
        }
    } else {
        // Original Strict Logic
        if (isFirstMove) {
            return hand.some(card => card.id === '7-Hearts-0');
        }
        for (const card of hand) {
            if (checkValidMoveStrict(card, boardState, hand, false)) {
                return true;
            }
        }
    }
    return false;
}

// *** NEW: Helper to place a card in fungible mode ***
function handleFungibleCardPlay(cardToPlay) {
    const suit = cardToPlay.suit;
    const rankVal = RANK_ORDER[cardToPlay.rank];

    if (cardToPlay.rank === '7') {
        if (!gameState.boardState[suit]) {
            // This is the first 7 of this suit, create row1
            gameState.boardState[suit] = { row1: { low: 7, high: 7 } };
        } else {
            // This is the second 7, create row2
            gameState.boardState[suit].row2 = { low: 7, high: 7 };
        }
    } else {
        // This is a non-7 card, use deterministic placement
        const layout = gameState.boardState[suit];
        let placed = false;

        // --- Priority Check: Row 1 ---
        if (layout.row1) {
            if (rankVal === layout.row1.high + 1) {
                layout.row1.high = rankVal;
                placed = true;
            } else if (rankVal === layout.row1.low - 1) {
                layout.row1.low = rankVal;
                placed = true;
            }
        }

        // --- Priority Check: Row 2 (only if not placed on row 1) ---
        if (!placed && layout.row2) {
             if (rankVal === layout.row2.high + 1) {
                layout.row2.high = rankVal;
                placed = true;
            } else if (rankVal === layout.row2.low - 1) {
                layout.row2.low = rankVal;
                placed = true;
            }
        }
    }
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
        isBot: false,
    }));

    // --- *** MODIFIED: Host is now always index 0 *** ---
    const host = gamePlayers[0]; // Host is guaranteed to be at index 0
    const otherPlayers = gamePlayers.slice(1); // All other players
    const dealerOrder = [host.playerId, ...otherPlayers.map(p => p.playerId)];
    // --- *** END MODIFICATION *** ---

    // *** MODIFIED: Store gameMode and deckCount separately ***
    const gameMode = settings.deckCount; // '1', '2', or 'fungible'
    let deckCountForDealing = 1;
    if (gameMode === '2') deckCountForDealing = 2;
    if (gameMode === 'fungible') deckCountForDealing = 2;
    // *** END MODIFICATION ***

    gameState = {
        players: gamePlayers,
        boardState: {},
        currentPlayerId: null,
        logHistory: ['Game initialized.'],
        settings: {
            ...settings,
            gameMode: gameMode, // NEW: '1', '2', or 'fungible'
            deckCount: deckCountForDealing // NEW: 1 or 2 (for client rendering)
        },
        isPaused: false,
        pausedForPlayerNames: [],
        pauseEndTime: null,
        isFirstMove: true,
        currentRound: 0,
        dealerOrder: dealerOrder,
        currentDealerIndex: -1,
        dealerId: null,
        isBetweenRounds: false,
        isEnding: false, // Flag to prevent pause during game end
    };

    io.emit('gameStarted');
    startNewRound();
}

function startNewRound() {
    if (!gameState) return;


    const activePlayerIds = new Set(gameState.players.filter(p => p.isBot !== true).map(p => p.playerId));
    gameState.players = gameState.players.filter(p => activePlayerIds.has(p.playerId));
    gameState.dealerOrder = gameState.dealerOrder.filter(playerId => activePlayerIds.has(playerId));


    if (gameState.players.length < 2) {
        addLog('Not enough players to start a new round. Ending game.');
        endSession(true);
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
    gameState.isBetweenRounds = false;

    // *** MODIFIED: Pass gameMode to createDeck ***
    let deck = createDeck(gameState.settings.gameMode);
    deck = shuffleDeck(deck);

    let playerIndex = 0;
    while (deck.length > 0) {
        gameState.players[playerIndex].hand.push(deck.pop());
        playerIndex = (playerIndex + 1) % gameState.players.length;
    }

    let firstPlayerId = null;
    let firstPlayerName = null;

    // *** MODIFIED: Find correct start card based on gameMode ***
    const startCardId = gameState.settings.gameMode === 'fungible' ? '7-Hearts-c1' : '7-Hearts-0';
    for (const player of gameState.players) {
        if (player.hand.some(card => card.id === startCardId)) {
            firstPlayerId = player.playerId;
            firstPlayerName = player.name;
            break;
        }
    }

    if (!firstPlayerId) {
        // Fallback if start card isn't dealt (e.g., player count vs deck size)
        // Note: In fungible mode with full decks, this shouldn't happen
        firstPlayerId = gameState.players[0].playerId;
        firstPlayerName = gameState.players[0].name;
    }

    gameState.currentPlayerId = firstPlayerId;
    gameState.dealerId = dealer.playerId;

    addLog(`Round ${gameState.currentRound} starting. ${dealer.name} is the dealer.`);
    addLog(`Waiting for ${firstPlayerName} to play the 7 of Hearts.`);

    io.emit('updateGameState', gameState);
    checkAndRunNextBotTurn();
}

function endRound(winner) {
    if (!gameState) return;


    const winnerName = winner ? winner.name : "No one";
    addLog(`🎉 ${winnerName} has won Round ${gameState.currentRound}! 🎉`);

    let scoreboard = [];
    let finalHands = {};

    gameState.players.forEach(p => {
        let roundScore = 0;

        if (!winner || p.playerId !== winner.playerId) {
            for (const card of p.hand) {
                roundScore += RANK_ORDER[card.rank];
            }
        }


        if (p.isBot !== true) {
             p.score += roundScore;
        }

        scoreboard.push({
            name: p.name + (p.isBot ? ' [Bot]' : ''),
            roundScore: roundScore,
            cumulativeScore: p.score
        });

        finalHands[p.playerId] = [...p.hand];
    });

    scoreboard.sort((a, b) => a.cumulativeScore - b.cumulativeScore);

    gameState.isBetweenRounds = true;

    const currentHost = gameState.players.find(p => p.isHost && p.status !== 'Removed');
    const hostId = currentHost ? currentHost.playerId : null;

    io.emit('roundOver', {
        scoreboard: scoreboard,
        winnerName: winnerName,
        roundNumber: gameState.currentRound,
        finalHands: finalHands,
        hostId: hostId
    });

    io.emit('updateGameState', gameState);
}

function endSession(wasGameAborted = false) {
    if (!gameState) {
        hardReset();
        return;
    }

    // --- *** MODIFICATION: Set isEnding flag *** ---
    gameState.isEnding = true;
    // --- *** END MODIFICATION *** ---

    addLog('The game session is ending...');

    let minScore = Infinity;
    let winners = [];
    gameState.players.filter(p => p.isBot !== true).forEach(p => {
        if (p.score < minScore) {
            minScore = p.score;
            winners = [p.name];
        } else if (p.score === minScore) {
            winners.push(p.name);
        }
    });

    io.emit('updateGameState', gameState);
    io.emit('gameOverAnnouncement', { winnerNames: winners });

    setTimeout(() => {
        if (!gameState) return;

        addLog('The game session has ended.');
        io.emit('gameEnded', { logHistory: gameState.logHistory });

        setTimeout(() => {
            if (!gameState) return;

            players = gameState.players
                .filter(p => p.isBot !== true)
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

        }, 12000);

    }, 12000);
}


function checkAndRunNextBotTurn() {
    if (!gameState) return;
    const nextPlayer = gameState.players.find(p => p.playerId === gameState.currentPlayerId);

    if (nextPlayer && nextPlayer.isBot === true) {

        setTimeout(() => runBotTurn(nextPlayer), 1500);
    }
}


function runBotTurn(botPlayer) {
    if (!gameState || !botPlayer || botPlayer.isBot !== true || botPlayer.hand.length === 0) {
        return;
    }

    let cardToPlay = null;
    if (gameState.isFirstMove) {
        // *** MODIFIED: Find correct start card for bot ***
        const startCardId = gameState.settings.gameMode === 'fungible' ? '7-Hearts-c1' : '7-Hearts-0';
        cardToPlay = botPlayer.hand.find(c => c.id === startCardId);
    } else {
        // Simple bot: find the first playable card
        for (const card of botPlayer.hand) {
            // *** MODIFIED: Use the main checkValidMove function ***
            if (checkValidMove(card, gameState.boardState, botPlayer.hand, false)) {
                cardToPlay = card;
                break;
            }
        }
    }

    if (cardToPlay) {
        const cardInHandIndex = botPlayer.hand.findIndex(c => c.id === cardToPlay.id);
        botPlayer.hand.splice(cardInHandIndex, 1);

        // *** MODIFIED: Handle card play based on gameMode ***
        if (gameState.settings.gameMode === 'fungible') {
            handleFungibleCardPlay(cardToPlay);
        } else {
            // Original Strict Logic
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
        }
        // *** END MODIFICATION ***

        if (gameState.isFirstMove) {
            gameState.isFirstMove = false;
        }

        addLog(`[Bot] ${botPlayer.name} played the ${cardToPlay.rank} of ${cardToPlay.suit}.`);

        if (botPlayer.hand.length === 0) {
            addLog(`[Bot] ${botPlayer.name} has played its last card.`);
        }
    } else {
        addLog(`[Bot] ${botPlayer.name} passed.`);
    }


    gameState.currentPlayerId = getNextPlayerId(botPlayer.playerId);

    if (gameState.currentPlayerId === null) {
        const humanWinner = gameState.players.find(p => p.status === 'Active' && p.isBot !== true && p.hand.length === 0);
        if (humanWinner) {
             endRound(humanWinner);
        } else {
            addLog('All players are out of cards or moves. Ending round.');
            endRound(null);
        }
    } else {
        io.emit('updateGameState', gameState);
        checkAndRunNextBotTurn();
    }
}



function handlePlayerRemoval(playerId) {
    if (!gameState) return;
    const playerToRemove = gameState.players.find(p => p.playerId === playerId);

    if (playerToRemove && playerToRemove.status !== 'Removed') {

        playerToRemove.status = 'Removed';
        playerToRemove.isBot = true;
        addLog(`[Bot] ${playerToRemove.name} disconnected and is now bot-controlled.`);
        delete reconnectTimers[playerId];


        const realActivePlayers = gameState.players.filter(p => p.status === 'Active' && p.isBot !== true);
        if (realActivePlayers.length < 1) {
            addLog('Not enough human players. Ending game.');
            endSession(true);
            return;
        }


        if (playerToRemove.isHost) {
            const newHost = realActivePlayers[0];
            if (newHost) {
                newHost.isHost = true;
                addLog(`${newHost.name} is the new host.`);
            } else {
                 addLog('Host disconnected, but no other human players to assign host to. Ending game.');
                 endSession(true);
                 return;
            }
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


        if (gameState.currentPlayerId === playerId) {
            runBotTurn(playerToRemove);
        }
    }
}


function hardReset() {
    console.log("Hard reset triggered.");

    const sockets = io.sockets.sockets;
    sockets.forEach((socket, socketId) => {
        const inLobby = players.some(p => p.socketId === socketId);
        const inGame = gameState?.players.some(p => p.socketId === socketId);

        if(inLobby || inGame) {
             console.log(`Forcing disconnect for socket ${socketId}`);
             socket.emit('forceDisconnect');
             socket.disconnect(true);
        }
    });


    gameState = null;
    players = [];

    Object.keys(reconnectTimers).forEach(key => {
        clearTimeout(reconnectTimers[key]);
        delete reconnectTimers[key];
    });
    if (gameOverCleanupTimer) {
        clearTimeout(gameOverCleanupTimer);
        gameOverCleanupTimer = null;
    }

    console.log("Server state wiped.");
}
// --- END: Core Game Logic ---


// --- Lobby & Player Management Logic ---
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // --- *** MODIFIED: joinGame Handler *** ---
    socket.on('joinGame', ({ playerName, playerId }) => {
        if (gameState) {
            // --- Reconnection Logic (Unchanged) ---
            let playerToRejoin = null;
            if (playerId) {
                playerToRejoin = gameState.players.find(p => p.playerId === playerId && p.status === 'Disconnected');
            }
            if (!playerToRejoin && playerName) {
                // Use case-insensitive matching for name rejoin
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
            // --- MODIFIED: Lobby Logic (Hostless) ---
            let existingPlayer = null;

             let nameExists = players.some(p => p.name.toLowerCase() === playerName.toLowerCase());
             if (nameExists) {
                socket.emit('joinFailed', `Name "${playerName}" is already taken.`);
                return;
             }

            // Check for existing player by persistent ID
            if (playerId) {
                 existingPlayer = players.find(p => p.playerId === playerId);
            }
            
            // Fallback: check for existing player by socket ID (e.g., page refresh)
            if (!existingPlayer) {
                existingPlayer = players.find(p => p.socketId === socket.id);
            }

            if (existingPlayer) {
                existingPlayer.name = playerName;
                existingPlayer.socketId = socket.id; // Update socket ID
                existingPlayer.active = true;
            } else {
                const newPlayerId = playerId || `${socket.id}-${Date.now()}`;
                const newPlayer = {
                    playerId: newPlayerId,
                    name: playerName,
                    socketId: socket.id,
                    isHost: false, // MODIFIED: No host on join
                    isReady: false, // MODIFIED: Not ready on join
                    active: true
                };
                players.push(newPlayer);
                socket.emit('joinSuccess', newPlayer.playerId);
            }

            io.emit('lobbyUpdate', players);
        }
    });
    // --- *** END MODIFIED: joinGame *** ---

    // --- *** NEW: claimHost Handler *** ---
    socket.on('claimHost', ({ password }) => {
        // 1. Check if a host already exists
        if (players.some(p => p.isHost)) {
            return socket.emit('warning', { title: 'Error', message: 'A host has already been claimed.' });
        }

        // 2. Refined Password Check (uses HOST_PASSWORD from top of file)
        if (HOST_PASSWORD !== null) {
            // A password IS required
            if (password !== HOST_PASSWORD) {
                return socket.emit('warning', { title: 'Error', message: 'Incorrect host password.' });
            }
            // Password is correct, so proceed...
        }
        // If HOST_PASSWORD is null, we skip the check
        // and the player automatically succeeds.

        // 4. Promote the player
        const newHost = players.find(p => p.socketId === socket.id);
        if (!newHost) { return; } // Safety check

        newHost.isHost = true;
        newHost.isReady = true; // Host is always ready

        // 5. Re-order the array
        // Find the full player object first
        const newHostPlayerObject = players.find(p => p.playerId === newHost.playerId);
        // Remove newHost from their current position
        players = players.filter(p => p.playerId !== newHost.playerId);

        // Add them to the very front (index 0)
        players.unshift(newHostPlayerObject);

        // 6. Broadcast the new lobby state
        io.emit('lobbyUpdate', players);
    });
    // --- *** END NEW HANDLER *** ---


    socket.on('setPlayerReady', (isReady) => {
        const player = players.find(p => p.socketId === socket.id);
        if (player && !player.isHost) { // Host is always ready
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

    // --- *** MODIFIED: startGame Handler *** ---
    socket.on('startGame', ({ settings }) => { // hostPassword removed
        const requester = players.find(p => p.socketId === socket.id);
        if (!requester || !requester.isHost) return;

        // Password check REMOVED
        
        const readyPlayers = players.filter(p => p.isReady && p.active);

        // *** MODIFIED: Logic for deckCount setting ***
        // settings.deckCount is '1', '2', or 'fungible'
        const gameMode = settings.deckCount;
        let minPlayers = 2; // Default min players
        if (gameMode === 'fungible' || gameMode === '2') {
             minPlayers = 2; // Can be 2
        }

        if (readyPlayers.length < minPlayers) {
            socket.emit('warning', `You need at least ${minPlayers} ready players to start.`);
            return;
        }
        // *** END MODIFICATION ***

        initializeGame(readyPlayers, settings);
    });
    // --- *** END MODIFIED: startGame *** ---

    // --- Seven of Hearts Game Events ---
    socket.on('playCard', (card) => {
        if (!gameState || gameState.isPaused) return;
        const player = gameState.players.find(p => p.socketId === socket.id);

        if (player && player.isBot) return;

        if (player && player.playerId === gameState.currentPlayerId) {

            const cardInHandIndex = player.hand.findIndex(c => c.id === card.id);
            if (cardInHandIndex === -1) {
                return socket.emit('warning', { title: 'Error', message: 'Card not in hand.' });
            }

            const cardToPlay = player.hand[cardInHandIndex];

            // *** MODIFIED: Use the main checkValidMove function ***
            const isValid = checkValidMove(cardToPlay, gameState.boardState, player.hand, gameState.isFirstMove);

            if (isValid) {
                player.hand.splice(cardInHandIndex, 1);

                // *** MODIFIED: Handle card play based on gameMode ***
                if (gameState.settings.gameMode === 'fungible') {
                    handleFungibleCardPlay(cardToPlay);
                } else {
                    // Original Strict Logic
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
                }
                // *** END MODIFICATION ***

                if (gameState.isFirstMove) {
                    gameState.isFirstMove = false;
                }

                addLog(`${player.name} played the ${cardToPlay.rank} of ${cardToPlay.suit}.`);

                if (player.hand.length === 0) {
                    endRound(player);
                    return;
                }

                gameState.currentPlayerId = getNextPlayerId(player.playerId);
                io.emit('updateGameState', gameState);
                checkAndRunNextBotTurn();

            } else {
                socket.emit('warning', { title: 'Invalid Move', message: 'That is not a valid move.' });
            }
        }
    });

    socket.on('passTurn', () => {
        if (!gameState || gameState.isPaused) return;
        const player = gameState.players.find(p => p.socketId === socket.id);

        if (player && player.isBot) return;

        if (player && player.playerId === gameState.currentPlayerId) {

            // *** MODIFIED: Use the main checkHandForValidMoves function ***
            const hasValidMove = checkHandForValidMoves(player.hand, gameState.boardState, gameState.isFirstMove);

            if (hasValidMove) {
                socket.emit('warning', { title: 'Invalid Pass', message: 'You cannot pass, you have a valid move.' });
            } else {
                addLog(`${player.name} passed.`);
                gameState.currentPlayerId = getNextPlayerId(player.playerId);
                io.emit('updateGameState', gameState);
                checkAndRunNextBotTurn();
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

        if (requester && requester.isHost && playerToMark && playerToMark.status === 'Active' && !playerToMark.isBot) {
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

        if (gameState) {
            const playerInGame = gameState.players.find(p => p.socketId === socket.id);
            if (playerInGame && playerInGame.isHost) {
                isHost = true;
            }
        } else {
             const playerInLobby = players.find(p => p.socketId === socket.id);
             // Cannot end session from lobby
        }

        if (isHost) {
            endSession(false);
        }
    });

    socket.on('hardReset', () => {
         let isHost = false;
         if (gameState?.players) {
            const playerInGame = gameState.players.find(p => p.socketId === socket.id);
            if (playerInGame && playerInGame.isHost) isHost = true;
         }
         if (!isHost && players) {
            const playerInLobby = players.find(p => p.socketId === socket.id);
            if (playerInLobby && playerInLobby.isHost) isHost = true;
         }

         if (isHost) {
            hardReset();
         }
    });

    // --- *** MODIFIED: disconnect Handler *** ---
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        if (gameState) {
            // --- *** MODIFICATION: Check if game is ending/between rounds *** ---
            if (gameState.isEnding || gameState.isBetweenRounds) {
                const playerInGame = gameState.players.find(p => p.socketId === socket.id);
                if (playerInGame) {
                    addLog(`Player ${playerInGame.name} disconnected during game end/round transition.`);
                    // Optionally mark as disconnected but DO NOT pause
                    // playerInGame.status = 'Disconnected';
                    // io.emit('updateGameState', gameState);
                }
                return; // Skip pause logic
            }
            // --- *** END MODIFICATION ***

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
            // --- MODIFIED: Lobby Disconnect Logic ---
            const disconnectedPlayer = players.find(p => p.socketId === socket.id);
            if (disconnectedPlayer) {
                 console.log(`Player ${disconnectedPlayer.name} left lobby.`);
                 const wasHost = disconnectedPlayer.isHost;
                 // Mark as inactive instead of removing, to preserve persistent ID if they rejoin
                 disconnectedPlayer.active = false; 

                 if (wasHost) {
                     // Host left. Make lobby hostless and force all players to be "not ready"
                     disconnectedPlayer.isHost = false; // Revoke host
                     players.forEach(p => {
                         p.isReady = false; // All players must re-ready
                     });
                     console.log(`Host ${disconnectedPlayer.name} disconnected. Lobby is now hostless.`);
                 }

                 // Clean up lobby if all players are inactive
                 if (!players.some(p => p.active)) {
                     players = [];
                     console.log("All players inactive. Clearing lobby.");
                 }
                 
                 io.emit('lobbyUpdate', players);
            }
            // --- END MODIFIED: Lobby Disconnect ---
        }
    });
});
// --- *** END MODIFIED: disconnect *** ---


const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));