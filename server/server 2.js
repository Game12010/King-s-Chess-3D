const WebSocket = require('ws');
const { Chess } = require('chess.js');

const PORT = 8080;

const wss = new WebSocket.Server({
    port: PORT
});

console.log('======================================');
console.log(' ONLINE CHESS SERVER');
console.log('======================================');
console.log(`Server running on port ${PORT}`);
console.log('');


// ============================================================
// WAITING PLAYER
// ============================================================

let waitingPlayer = null;


// ============================================================
// ACTIVE ROOMS
// ============================================================

const rooms = new Map();

let nextRoomId = 1;


// ============================================================
// SEND JSON MESSAGE
// ============================================================

function send(socket, data) {

    if (
        socket &&
        socket.readyState === WebSocket.OPEN
    ) {
        socket.send(
            JSON.stringify(data)
        );
    }

}


// ============================================================
// CREATE MATCH
// ============================================================

function createMatch(player1, player2) {

    const roomId =
        String(nextRoomId++);

    const chess = new Chess();


    // ========================================================
    // RANDOMLY ASSIGN WHITE / BLACK
    // ========================================================

    let whitePlayer;
    let blackPlayer;

    if (Math.random() < 0.5) {

        whitePlayer = player1;
        blackPlayer = player2;

    } else {

        whitePlayer = player2;
        blackPlayer = player1;

    }


    // ========================================================
    // CREATE ROOM
    // ========================================================

    const room = {

        id: roomId,

        chess: chess,

        players: {

            w: whitePlayer,

            b: blackPlayer

        }

    };


    rooms.set(
        roomId,
        room
    );


    // ========================================================
    // ASSIGN PLAYER INFORMATION
    // ========================================================

    whitePlayer.roomId = roomId;
    whitePlayer.color = 'w';

    blackPlayer.roomId = roomId;
    blackPlayer.color = 'b';


    console.log(
        `Match ${roomId} created`
    );

    console.log(
        `White = Player ${whitePlayer.playerId}`
    );

    console.log(
        `Black = Player ${blackPlayer.playerId}`
    );


    // ========================================================
    // TELL WHITE PLAYER
    // ========================================================

    send(
        whitePlayer,
        {

            type: 'matched',

            color: 'w',

            opponent: 'Black',

            fen: chess.fen()

        }
    );


    // ========================================================
    // TELL BLACK PLAYER
    // ========================================================

    send(
        blackPlayer,
        {

            type: 'matched',

            color: 'b',

            opponent: 'White',

            fen: chess.fen()

        }
    );

}


// ============================================================
// CONNECTION
// ============================================================

wss.on(
    'connection',
    socket => {

        socket.roomId = null;

        socket.color = null;

        socket.playerId =
            Math.random()
                .toString(36)
                .substring(2, 8);


        console.log(
            `Player connected: ${socket.playerId}`
        );


        // ====================================================
        // MATCHMAKING
        // ====================================================

        if (!waitingPlayer) {

            waitingPlayer = socket;


            send(
                socket,
                {
                    type: 'waiting'
                }
            );


            console.log(
                `Player ${socket.playerId} is waiting`
            );

        } else {

            const player1 =
                waitingPlayer;

            const player2 =
                socket;


            waitingPlayer = null;


            createMatch(
                player1,
                player2
            );

        }


        // ====================================================
        // RECEIVE MESSAGE
        // ====================================================

        socket.on(
            'message',
            raw => {

                let message;


                try {

                    message =
                        JSON.parse(
                            raw.toString()
                        );

                } catch (error) {

                    console.log(
                        'Invalid JSON received'
                    );

                    return;

                }


                const room =
                    rooms.get(
                        socket.roomId
                    );


                if (!room) {
                    return;
                }


                // =================================================
                // MOVE
                // =================================================

                if (
                    message.type === 'move'
                ) {

                    // ---------------------------------------------
                    // Check turn
                    // ---------------------------------------------

                    if (
                        room.chess.turn() !==
                        socket.color
                    ) {

                        send(
                            socket,
                            {

                                type: 'error',

                                message:
                                    'It is not your turn.'

                            }
                        );

                        return;

                    }


                    // ---------------------------------------------
                    // Create move
                    // ---------------------------------------------

                    const move = {

                        from:
                            message.from,

                        to:
                            message.to,

                        promotion:
                            message.promotion ||
                            undefined

                    };


                    let result = null;


                    // ---------------------------------------------
                    // Validate with chess.js
                    // ---------------------------------------------

                    try {

                        result =
                            room.chess.move(
                                move
                            );

                    } catch (error) {

                        result = null;

                    }


                    // ---------------------------------------------
                    // Illegal move
                    // ---------------------------------------------

                    if (!result) {

                        send(
                            socket,
                            {

                                type:
                                    'illegalMove'

                            }
                        );

                        return;

                    }


                    console.log(
                        `Room ${room.id}: ` +
                        `${result.color} ` +
                        `${result.from}-${result.to}` +
                        (
                            result.promotion
                                ? `=${result.promotion}`
                                : ''
                        )
                    );


                    // ---------------------------------------------
                    // Send accepted move to BOTH players
                    // ---------------------------------------------

                    const moveMessage = {

                        type: 'move',

                        from:
                            result.from,

                        to:
                            result.to,

                        promotion:
                            result.promotion ||
                            null,

                        flags:
                            result.flags,

                        fen:
                            room.chess.fen(),

                        turn:
                            room.chess.turn()

                    };


                    send(
                        room.players.w,
                        moveMessage
                    );

                    send(
                        room.players.b,
                        moveMessage
                    );


                    // ---------------------------------------------
                    // GAME OVER
                    // ---------------------------------------------

                    if (
                        room.chess.game_over()
                    ) {

                        let resultText =
                            'draw';


                        if (
                            room.chess.in_checkmate()
                        ) {

                            // The player who just moved won.

                            resultText =
                                result.color === 'w'
                                    ? 'white'
                                    : 'black';

                        } else if (
                            room.chess.in_stalemate()
                        ) {

                            resultText =
                                'stalemate';

                        } else {

                            resultText =
                                'draw';

                        }


                        const gameOverMessage = {

                            type:
                                'gameover',

                            result:
                                resultText,

                            fen:
                                room.chess.fen()

                        };


                        send(
                            room.players.w,
                            gameOverMessage
                        );

                        send(
                            room.players.b,
                            gameOverMessage
                        );

                    }

                }


                // =================================================
                // RESTART
                // =================================================

                if (
                    message.type ===
                    'restart'
                ) {

                    room.chess.reset();


                    const restartMessage = {

                        type:
                            'restart',

                        fen:
                            room.chess.fen()

                    };


                    send(
                        room.players.w,
                        restartMessage
                    );

                    send(
                        room.players.b,
                        restartMessage
                    );


                    console.log(
                        `Room ${room.id} restarted`
                    );

                }

            }
        );


        // ========================================================
        // DISCONNECT
        // ========================================================

        socket.on(
            'close',
            () => {

                console.log(
                    `Player disconnected: ${socket.playerId}`
                );


                // ----------------------------------------------
                // Remove from waiting queue
                // ----------------------------------------------

                if (
                    waitingPlayer === socket
                ) {

                    waitingPlayer = null;

                    return;

                }


                // ----------------------------------------------
                // Find room
                // ----------------------------------------------

                const room =
                    rooms.get(
                        socket.roomId
                    );


                if (!room) {
                    return;
                }


                // ----------------------------------------------
                // Find opponent
                // ----------------------------------------------

                const opponent =
                    socket.color === 'w'
                        ? room.players.b
                        : room.players.w;


                // ----------------------------------------------
                // Tell opponent
                // ----------------------------------------------

                send(
                    opponent,
                    {

                        type:
                            'opponentDisconnected'

                    }
                );


                // ----------------------------------------------
                // Delete room
                // ----------------------------------------------

                rooms.delete(
                    room.id
                );


                console.log(
                    `Room ${room.id} closed`
                );

            }
        );

    }
);


// ============================================================
// CLEAN SHUTDOWN
// ============================================================

process.on(
    'SIGINT',
    () => {

        console.log(
            '\nStopping server...'
        );

        wss.close(
            () => {

                process.exit(0);

            }
        );

    }
);