const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const { setupSocket, ADMIN_PASSCODE } = require('./src/socketHandler');
const { rooms } = require('./src/roomManager');
const { clearTimer } = require('./src/gameLogic');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.json());

// Setup Socket events
setupSocket(io);

// =================== GARBAGE COLLECTION ===================
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    const endedLongAgo = room.endedAt && (now - room.endedAt > 2 * 60 * 60 * 1000);
    const createdLongAgo = (now - room.createdAt > 12 * 60 * 60 * 1000);
    if (endedLongAgo || createdLongAgo) {
      clearTimer(room);
      rooms.delete(code);
      console.log(`🗑️ Garbage collected inactive room ${code}`);
    }
  }
}, 30 * 60 * 1000);

// =================== START ===================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n⚡ AVENGERS QUIZ SERVER RUNNING`);
  console.log(`──────────────────────────────────`);
  console.log(`🔑 Admin Passcode: ${ADMIN_PASSCODE}`);
  console.log(`📱 Player UI: http://localhost:${PORT}/`);
  console.log(`🛡️  Admin Panel: http://localhost:${PORT}/admin.html`);
  console.log(`──────────────────────────────────\n`);
});
