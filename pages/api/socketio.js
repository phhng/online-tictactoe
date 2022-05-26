import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

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

    res.status(200).json({ rooms: ROOMS });
    if (!res.socket.server.io) {
        console.log('*First use, starting socket.io')

        const io = new Server(res.socket.server)

        // SOCKET IOs


        io.on('connection', (socket) => {
            // ROOMS = getActiveRooms(io);
            // console.log('connected :', socket.id);

            socket.emit('update', {
                rooms: getActiveRooms(io)
            });

            socket.on('disconnecting', () => {
                const room = Array.from(socket.rooms)[1];
                socket.to(room).emit('enemy-disconnect', {});

                // remove room/s that belongs to someone disconnected
                ROOMS = ROOMS.filter(item => item.hostId !== socket.id);
            });

            socket.on('exit-room', (data, callback) => {
                console.log(ROOMS);
                socket.leave(data.room);
                ROOMS = ROOMS.filter(item => item.hostId !== socket.id);

                callback({
                    status: 'ok'
                });

                console.log(ROOMS);
            });

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
                        socket.join(r);
                        const h = ROOMS.find(item => item.room === r);
                        socket.emit('joined-room', {
                            room: r,
                            isHost: false,
                            isReady: true,
                            name: (typeof h.hostName || h.hostName === null || h.hostName === '') ? 'unknown' : h.hostName

                        });
                        socket.to(r).emit('game-ready', {
                            isReady: true,
                            name: data.name
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

            // io.of("/").adapter.on("join-room", (room, id) => {
            //     if (getActiveRooms(io).length >= 1) {
            //         console.log(`socket ${id} has joined ${room}`);
            //     }
            // });

            // io.of("/").adapter.on("leave-room", (room, id) => {
            //     console.log(`socket ${id} has leave ${room}`);
            // });
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