const { questionsStore } = require('./questionsManager');

const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createRoom(adminSocketId) {
  let code;
  do { code = generateRoomCode(); } while (rooms.has(code));
  const room = {
    code,
    adminSocketId,
    gameState: 'WAITING_ROOM',
    currentPhase: 0,
    currentQuestionIndex: -1,
    teams: new Map(),
    questions: JSON.parse(JSON.stringify(questionsStore.phases)),
    backupQuestions: JSON.parse(JSON.stringify(questionsStore.backupQuestions)),
    usedBackupIndices: [],
    timerDuration: 0,
    timerRemaining: 0,
    timerInterval: null,
    questionStartTime: null,
    stoneSelectionActive: false,
    stoneSelectionWinners: [],
    stoneSelectionsReceived: new Set(),
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function createTeam(name, avatar, socketId, sessionToken) {
  return {
    name, avatar, socketId, sessionToken,
    connected: true,
    totalScore: 0,
    phaseScores: [0, 0, 0, 0, 0],
    totalResponseTime: 0,
    answers: {},
    stones: { power: 0, reality: 0, space: 0, time: 0, soul: 0 },
    stonesUsedThisQuestion: [],
    activeStones: {},
    stoneSelectedThisRound: false,
  };
}

module.exports = {
  rooms,
  generateRoomCode,
  createRoom,
  createTeam,
};
