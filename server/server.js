const WebSocket = require('ws');
const { Chess } = require('chess.js');

const PORT = 8080;

const wss = new WebSocket.Server({
    port: PORT
});

console.log('======================================');
console.log(' ONLINE CHESS SERVER');
console.log('======================================');
console.log(`Server running on port ${PORT}\n`);

// ============================================================
// WAITING PLAYER & ROOMS
// ============================================================

let waitingPlayer = null;
const rooms = new Map();
let nextRoomId = 1;

// ============================================================
// SEND JSON MESSAGE HELPER
// ============================================================

function send(socket, data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
    }
}

// Helper to safely handle chess.js v0.x and v1.x differences
function checkGameStatus(chess) {
    const isGameOver = typeof chess.isGameOver === 'function' ? chess.isGameOver() : chess.game_over();
    if (!isGameOver) return null;

    const isCheckmate = typeof chess.isCheckmate === 'function' ? chess.isCheckmate() : chess.in_checkmate();
    const isStalemate = typeof chess.isStalemate === 'function' ? chess.isStalemate() : chess.in_stalemate();

    if (isCheckmate) {
        // The color whose turn it currently is lost
        return chess.turn() === 'w' ? 'black' : 'white';
    } else if (isStalemate) {
        return 'stalemate';
    }
    return 'draw';
}

// ============================================================
// CREATE MATCH
// ============================================================

function createMatch(player1, player2) {
    const roomId = String(nextRoomId++);
    const chess = new Chess();

    let whitePlayer, blackPlayer;
    if (Math.random() < 0.5) {
        whitePlayer = player1;
        blackPlayer = player2;
    } else {
        whitePlayer = player2;
        blackPlayer = player1;
    }

    const room = {
        id: roomId,
        chess: chess,
        players: {
            w: whitePlayer,
            b: blackPlayer
        }
    };

    rooms.set(roomId, room);

    whitePlayer.roomId = roomId;
    whitePlayer.color = 'w';

    blackPlayer.roomId = roomId;
    blackPlayer.color = 'b';

    console.log(`Match ${roomId} created | White: ${whitePlayer.playerId} vs Black: ${blackPlayer.playerId}`);

    send(whitePlayer, {
        type: 'matched',
        color: 'w',
        opponent: 'Black',
        fen: chess.fen()
    });

    send(blackPlayer, {
        type: 'matched',
        color: 'b',
        opponent: 'White',
        fen: chess.fen()
    });
}

// ============================================================
// CONNECTION HANDLER
// ============================================================

wss.on('connection', socket => {
    socket.roomId = null;
    socket.color = null;
    socket.playerId = Math.random().toString(36).substring(2, 8);

    console.log(`Player connected: ${socket.playerId}`);

    // Matchmaking queue
    if (!waitingPlayer) {
        waitingPlayer = socket;
        send(socket, { type: 'waiting' });
        console.log(`Player ${socket.playerId} is waiting`);
    } else {
        const player1 = waitingPlayer;
        const player2 = socket;
        waitingPlayer = null;
        createMatch(player1, player2);
    }

    // Message handling
    socket.on('message', raw => {
        let message;
        try {
            message = JSON.parse(raw.toString());
        } catch (error) {
            console.log('Invalid JSON received');
            return;
        }

        const room = rooms.get(socket.roomId);
        if (!room) return;

        // Move validation & forwarding
        if (message.type === 'move') {
            if (room.chess.turn() !== socket.color) {
                send(socket, {
                    type: 'error',
                    message: 'It is not your turn.'
                });
                return;
            }

            const move = {
                from: message.from,
                to: message.to,
                promotion: message.promotion || undefined
            };

            let result = null;
            try {
                result = room.chess.move(move);
            } catch (error) {
                result = null;
            }

            if (!result) {
                send(socket, { type: 'illegalMove' });
                return;
            }

            console.log(`Room ${room.id}: ${result.color} ${result.from}-${result.to}${result.promotion ? '=' + result.promotion : ''}`);

            const opponent = socket.color === 'w' ? room.players.b : room.players.w;

            // Broadcast move ONLY to the opponent (the mover already animated it)
            send(opponent, {
                type: 'move',
                from: result.from,
                to: result.to,
                promotion: result.promotion || null,
                flags: result.flags,
                fen: room.chess.fen(),
                turn: room.chess.turn()
            });

            // Check game over status
            const gameResult = checkGameStatus(room.chess);
            if (gameResult) {
                const gameOverMessage = {
                    type: 'gameover',
                    result: gameResult,
                    fen: room.chess.fen()
                };

                send(room.players.w, gameOverMessage);
                send(room.players.b, gameOverMessage);
            }
        }

        // Restart handling
        if (message.type === 'restart') {
            room.chess.reset();
            const restartMessage = {
                type: 'restart',
                fen: room.chess.fen()
            };

            send(room.players.w, restartMessage);
            send(room.players.b, restartMessage);
            console.log(`Room ${room.id} restarted`);
        }
    });

    // Disconnect handling
    socket.on('close', () => {
        console.log(`Player disconnected: ${socket.playerId}`);

        if (waitingPlayer === socket) {
            waitingPlayer = null;
            return;
        }

        const room = rooms.get(socket.roomId);
        if (!room) return;

        const opponent = socket.color === 'w' ? room.players.b : room.players.w;
        send(opponent, { type: 'opponentDisconnected' });
        rooms.delete(room.id);
        console.log(`Room ${room.id} closed`);
    });
});

// Clean shutdown
process.on('SIGINT', () => {
    console.log('\nStopping server...');
    wss.close(() => process.exit(0));
});