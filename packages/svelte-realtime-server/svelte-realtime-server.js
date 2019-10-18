// const crypto = require('crypto')

const socketIO = require('socket.io')
const socketIOAuth = require('socketio-auth')
const uuidv4 = require('uuid/v4')

const DEFAULT_NAMESPACE = '/svelte-realtime'

function getServer(server, adapters, authenticate, namespace = DEFAULT_NAMESPACE) {
  const io = socketIO(server)
  const nsp = io.of(namespace)
  const sessions = {}  // {sessionID: {sessionID, user, sockets: Set()}}

  if (!authenticate) {
    authenticate = function(socket, data, callback) {
      return callback(null, true)
    }
  }

  function wrappedAuthenticate(socket, data, callback) {
    if (data.sessionID) {
      const session = sessions[data.sessionID]
      if (session) {
        session.sockets.add(socket)
        return callback(null, true)
      } else {
        authenticate(socket, data, callback)
      }
    } else {
      authenticate(socket, data, callback)
    }
  }
  
  function postAuthenticate(socket, user) {  // TODO: How do we get the user into this function?
    // socket.on('disconnect', () => {})  // Since we're storing everything in the nsp's socket or room, we shouldn't need any additional cleanup

    if (!user.sessionID) {
      const sessionID = uuidv4()
      const session = {sessionID, user, sockets: new Set([socket])}
      sessions[sessionID] = session
      socket.emit('new-session', sessionID, user.username)
    }

    socket.on('join', (stores) => {  // TODO: Check access control before joining
      for (const {storeID, value} of stores) {
        socket.join(storeID)
        const room = nsp.adapter.rooms[storeID]
        if (room) {  // There should always be a room but better safe
          const cachedValue = room.cachedValue
          if (cachedValue) {
            socket.emit('set', storeID, cachedValue)  // This sends only the originator
          } else {
            room.cachedValue = value
            // socket.to(storeID).emit('set', storeID, value)  // This sends to all clients except the originating client
            nsp.in(storeID).emit('set', storeID, value)  // This sends to all clients including the originator
          }
        } else {
          throw new Error('Unexpected condition. There should be one but there is no room for storeID: ' + storeID)
        }
      }
    })

    socket.on('set', (storeID, value) => {
      let room = nsp.adapter.rooms[storeID]
      if (!room) {
        socket.join(storeID)
        room = nsp.adapter.rooms[storeID]
      }
      if (room) {  // There should always be a room now but better safe
        room.cachedValue = value
      } else {
        throw new Error('Unexpected condition. There should be one but there is no room for storeID: ' + storeID)
      }
      // socket.to(storeID).emit('set', storeID, value)  // This sends to all clients except the originating client
      nsp.in(storeID).emit('set', storeID, value)  // This sends to all clients including the originator
    })

    socket.on('initialize', (storeID, defaultValue, callback) => {
      const room = nsp.adapter.rooms[storeID]
      if (room && room.cachedValue) {
        callback(room.cachedValue)
      } else {
        callback(defaultValue)
      }
    })

    socket.on('logout', (sessionID) => {
      const session = sessions[sessionID]
      session.sockets.forEach((socket) => {
        socket.disconnect()
      })
    })

  }

  socketIOAuth(nsp, {authenticate: wrappedAuthenticate, postAuthenticate})

  return nsp
}

module.exports = {getServer}  // TODO: Eventually change this to export once supported
