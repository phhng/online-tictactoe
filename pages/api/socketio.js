import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import {getPlayerStats, updatePlayerStats} from "../../utils/playerUtils";
import {db} from "../../lib/db";

const Socketio = (req, res) => {
    // let ROOMS = [];
    const WIN_CON = [
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
        [0, 3, 6],
        [1, 4, 7],
        [2, 5, 8],
        [0, 4, 8],
        [2, 4, 6]
    ];

    let ROOMS = [];
    let PLAYERS = [];
    let onlinePlayersCount = 0;
    const connectedSockets = new Set();
    
    res.status(200).json({ user: 'hazel' });

    if (!res.socket.server.io) {
        console.log('*First use, starting socket.io')

        const io = new Server(res.socket.server)
        
        io.on('connection', (socket) => {
            console.log('New connection:', socket.id);

            if (!connectedSockets.has(socket.id)) {
                console.log('New connection:', socket.id);
                connectedSockets.add(socket.id);
                onlinePlayersCount++;
                io.emit('update-online-players', onlinePlayersCount);
            }
            
            socket.on('disconnect', () => {
                if (connectedSockets.has(socket.id)) {
                    console.log('Disconnected:', socket.id);
                    connectedSockets.delete(socket.id);
                    onlinePlayersCount = Math.max(0, onlinePlayersCount - 1);
                    io.emit('update-online-players', onlinePlayersCount);
                }
            });

            socket.on('enemy-timer', (data) => {
                socket.to(data.room).emit('enemy-timer', { timer: data.timer });
            });
            
            socket.on('exit-room', (data, callback) => {
                socket.leave(data.room);
                ROOMS = ROOMS.filter(item => item.room !== data.room);
                callback({
                    status: 'ok'
                });
                socket.to(data.room).emit('exit-room', {});
            });

            socket.on('rematch', (data, callback) => {
                socket.to(data.room).emit('rematch');

                if (typeof data.acceptRematch !== 'undefined') {
                    if (data.acceptRematch) {
                        console.log('accepted');

                        io.to(data.room).emit('game-ready', {
                            isReady: true,
                        });
                    }
                }

                callback({
                    status: 'ok'
                });
            })

            socket.on('move', (data) => {
                socket.to(data.room).emit('move', {
                    moves: data.moves,
                    turn: data.turn
                });

                const winObj = checkWinV2(data.turn, data.moves);
                if (winObj !== false) {

                    io.to(data.room).emit('game-result', {
                        winner: winObj.symbol,
                        result: 'done',
                        combination: winObj.combination
                    });

                } else if (isDraw(data.moves)) {
                    console.log('draw', isDraw(data.moves));
                    io.to(data.room).emit('game-result', {
                        winner: 'none',
                        result: 'draw'
                    });
                }

            });

            socket.on('times-up', (data) => {
                io.to(data.room).emit('game-result', {
                    winner: 'none',
                    result: 'timesup',
                    winner: data.symbol === 'x' ? 'circle' : 'x'
                });
            });

            socket.on('join-room', (data) => {

                getAvailableRoom(io).then(r => {
                    if (r) {

                        // find available room and join
                        getRoomDetails(r).then(h => {
                            if (h) {
                                socket.emit('joined-room', {
                                    room: r,
                                    isHost: false,
                                    isReady: true,
                                    name: (typeof h.hostName === 'undefined' || h.hostName === null || h.hostName === '') ? 'unknown' : h.hostName

                                });
                                socket.to(r).emit('game-ready', {
                                    isReady: true,
                                    name: data.name
                                });

                                socket.join(r);
                            }
                        });

                    } else {
                        // create room
                        let autoroom = uuidv4();
                        socket.join(autoroom);
                        ROOMS.push({
                            hostId: data.id,
                            hostName: data.name,
                            room: autoroom
                        });
                        socket.emit('joined-room', {
                            room: autoroom,
                            isHost: true,
                            isReady: false
                        });
                    }

                });
            });
            const processedGames = new Set();

            socket.on('update-game-result', async (data) => {
                console.log('Received game result:', data);

                const gameIdentifier = `${data.room}-${data.player1.username}-${data.player2.username}`;

                if (processedGames.has(gameIdentifier)) {
                    console.log('Game result already processed, skipping update');
                    return;
                }

                processedGames.add(gameIdentifier);

                try {
                    const [player1Stats, player2Stats] = await Promise.all([
                        getPlayerStats(data.player1.username),
                        getPlayerStats(data.player2.username)
                    ]);

                    const player1OldRating = player1Stats?.elo || 1000;
                    const player2OldRating = player2Stats?.elo || 1000;

                    const [player1Update, player2Update] = await Promise.all([
                        updatePlayerStats(data.player1.username, data.player1.result, player2OldRating),
                        updatePlayerStats(data.player2.username, data.player2.result, player1OldRating)
                    ]);

                    console.log('Player 1 update:', player1Update);
                    console.log('Player 2 update:', player2Update);

                    // Emit updated ratings to clients
                    io.to(data.room).emit('ratings-updated', {
                        player1: {
                            username: data.player1.username,
                            oldRating: player1OldRating,
                            newRating: player1Update.elo,
                            eloChange: player1Update.eloChange
                        },
                        player2: {
                            username: data.player2.username,
                            oldRating: player2OldRating,
                            newRating: player2Update.elo,
                            eloChange: player2Update.eloChange
                        }
                    }); } catch (error) {
                    console.error('Error updating player stats:', error);
                    io.to(data.room).emit('stats-update-error', { message: 'Failed to update stats' });
                }
            });
        });

        function getActiveRooms(io) {
            // Convert map into 2D list:
            // ==> [['4ziBKG9XFS06NdtVAAAH', Set(1)], ['room1', Set(2)], ...]
            const arr = Array.from(io.sockets.adapter.rooms);
            // Filter rooms whose name exist in set:
            // ==> [['room1', Set(2)], ['room2', Set(2)]]
            const filtered = arr.filter(room => !room[1].has(room[0]))
            // Return only the room name: 
            // ==> ['room1', 'room2']
            const res = filtered.map(i => i[0]);
            return res;
        }

        const adminGetRooms = (io) => {
            io.emit('admin-rooms', {
                rooms: ROOMS,
                activeRooms: getActiveRooms(io)
            });
        }

        const isDraw = (_moves) => {
            return [..._moves].every(index => {
                return index === "circle" || index === "x"
            })
        }

        const checkWin = (symbol, _moves) => {
            return WIN_CON.some(combination => {
                return combination.every(index => {
                    return _moves[index] === symbol
                })
            })
        }

        const checkWinV2 = (symbol, _moves) => {
            for (let i = 0; i < WIN_CON.length; i++) {
                const c = WIN_CON[i].every(index => _moves[index] === symbol);
                if (c) return { combination: WIN_CON[i], symbol: symbol };
            }
            return false;
        }

        const getAvailableRoom = async (io) => {
            const rooms = getActiveRooms(io);
            for (let room of rooms) {
                let c = await io.in(room).fetchSockets();
                let filtered = c.map(function (item) { return item.id; });
                if (filtered.length === 1) {
                    return room;
                } else {
                    console.log('no room available')
                }
            }
        }

        const getRoomDetails = async (room) => {
            const h = await ROOMS.find(item => item.room === room);
            if (h) {
                return h;
            } else {
                console.log('Error: No room found, Function: getRoomDetails')
            }
        }

        const getRoomClients = async (io, room) => {
            const c = await io.in(room).fetchSockets();
            const filtered = c.map(function (item) { return item.id; });
            return filtered;
        }

        res.socket.server.io = io
    } else {
        // console.log('socket.io already running');
    }
    res.end();
}

export const config = {
    api: {
        bodyParser: false
    }
}

export default Socketio;