const crypto = require('crypto');
const { rooms, createRoom, createTeam } = require('./roomManager');
const { getTotalQuestionsForPhase } = require('./questionsManager');
const {
  startTimer,
  clearTimer,
  getLeaderboard,
  getStoneSelectionPayload,
  getTeamQuestion,
  buildQuestionPayload,
  endQuestion,
} = require('./gameLogic');

const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || Math.floor(100000 + Math.random() * 900000).toString();

function setupSocket(io) {
  io.on('connection', (socket) => {

    // ===== ADMIN EVENTS =====
    socket.on('admin:createRoom', (data, cb) => {
      if (data.passcode !== ADMIN_PASSCODE) return cb({ error: 'Invalid admin passcode' });
      const room = createRoom(socket.id);
      socket.join(room.code);
      socket.roomCode = room.code;
      socket.isAdmin = true;
      cb({ success: true, roomCode: room.code });
    });

    socket.on('admin:reconnect', (data, cb) => {
      if (data.passcode !== ADMIN_PASSCODE) return cb({ error: 'Invalid admin passcode' });
      const room = rooms.get(data.roomCode);
      if (!room) return cb({ error: 'Room not found' });
      room.adminSocketId = socket.id;
      socket.join(data.roomCode);
      socket.roomCode = data.roomCode;
      socket.isAdmin = true;
      cb({
        success: true,
        gameState: room.gameState,
        currentPhase: room.currentPhase,
        currentQuestionIndex: room.currentQuestionIndex,
        timerRemaining: room.timerRemaining,
        timerDuration: room.timerDuration,
        teams: Array.from(room.teams.values()).map(t => ({
          name: t.name, avatar: t.avatar, connected: t.connected,
          totalScore: t.totalScore, stones: t.stones,
        })),
        questions: room.questions,
        backupQuestions: room.backupQuestions,
        leaderboard: getLeaderboard(room),
      });
    });

    socket.on('admin:getQuestions', (data, cb) => {
      const room = rooms.get(socket.roomCode);
      if (!room) return cb({ error: 'Room not found' });
      cb({
        success: true,
        questions: room.questions,
        backupQuestions: room.backupQuestions,
      });
    });

    socket.on('admin:updateQuestions', (data, cb) => {
      const room = rooms.get(data.roomCode || socket.roomCode);
      if (!room || room.adminSocketId !== socket.id) return;
      room.questions = data.questions;
      if (cb) cb({ success: true });
    });

    socket.on('admin:updateBackup', (data, cb) => {
      const room = rooms.get(data.roomCode || socket.roomCode);
      if (!room || room.adminSocketId !== socket.id) return;
      room.backupQuestions = data.backupQuestions;
      if (cb) cb({ success: true });
    });

    socket.on('admin:startPhase', (data) => {
      const room = rooms.get(socket.roomCode);
      if (!room || room.adminSocketId !== socket.id) return;
      const phase = data.phase;
      if (phase < 1 || phase > 5) return;
      room.currentPhase = phase;
      room.currentQuestionIndex = -1;
      room.gameState = 'PHASE_ACTIVE';
      room.usedBackupIndices = [];
      const totalQuestions = getTotalQuestionsForPhase(phase);
      io.to(room.code).emit('phaseStarted', { phase, totalPhases: 5, totalQuestions });
      io.to(room.adminSocketId).emit('phaseStarted', { phase, totalPhases: 5, totalQuestions });
    });

    socket.on('admin:nextQuestion', (data) => {
      const room = rooms.get(socket.roomCode);
      if (!room || room.adminSocketId !== socket.id) return;
      if (room.currentPhase < 1 || room.currentPhase > 5) return;
      if (room.gameState === 'STONE_SELECTION') {
        room.stoneSelectionActive = false;
        room.gameState = 'PHASE_ACTIVE';
        io.to(room.code).emit('stoneSelectionLocked', {});
        io.to(room.adminSocketId).emit('stoneSelectionLocked', {});
      }
      if (room.gameState !== 'PHASE_ACTIVE' && room.gameState !== 'QUESTION_ENDED') return;
      const phaseIdx = room.currentPhase - 1;
      room.currentQuestionIndex++;
      const maxQuestions = getTotalQuestionsForPhase(room.currentPhase);
      if (room.currentQuestionIndex >= maxQuestions) {
        room.gameState = 'LEADERBOARD';
        const lb = getLeaderboard(room);
        io.to(room.code).emit('phaseComplete', { phase: room.currentPhase, leaderboard: lb });
        io.to(room.adminSocketId).emit('phaseComplete', { phase: room.currentPhase, leaderboard: lb });
        return;
      }
      room.gameState = 'QUESTION_ACTIVE';
      const q = room.questions[phaseIdx][room.currentQuestionIndex];
      room.teams.forEach(t => { t.stonesUsedThisQuestion = []; t.activeStones = {}; });

      // Send question to each player (no correct answer)
      room.teams.forEach(team => {
        if (team.socketId && team.connected) {
          io.to(team.socketId).emit('question', buildQuestionPayload(room, team, false));
        }
      });

      // Send to admin WITH correct answer
      io.to(room.adminSocketId).emit('question:admin', {
        question: q,
        correct: q.correct,
        phaseNum: room.currentPhase,
        questionNum: room.currentQuestionIndex + 1,
        timerDuration: q.timer,
        totalQuestions: getTotalQuestionsForPhase(room.currentPhase),
      });

      // Start server-side timer
      startTimer(room, q.timer,
        (rem) => {
          io.to(room.code).emit('timerTick', { remaining: rem, total: room.timerDuration });
          io.to(room.adminSocketId).emit('timerTick', { remaining: rem, total: room.timerDuration });
        },
        () => endQuestion(room, io)
      );
    });

    socket.on('admin:forceEndQuestion', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || room.adminSocketId !== socket.id) return;
      if (room.gameState === 'QUESTION_ACTIVE') endQuestion(room, io);
    });

    socket.on('admin:triggerStoneSelection', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || room.adminSocketId !== socket.id) return;
      const lb = getLeaderboard(room);
      if (lb.length === 0) return;
      // Handle ties at rank 3 - include all tied teams
      const cutScore = lb[2] ? lb[2].totalScore : 0;
      const cutTime = lb[2] ? lb[2].totalResponseTime : Infinity;
      const eligible = lb.filter((t, i) => i < 3 ||
        (t.totalScore === cutScore && t.totalResponseTime === cutTime));
      room.stoneSelectionActive = true;
      room.stoneSelectionWinners = eligible.map(t => t.name);
      room.stoneSelectionsReceived = new Set();
      room.gameState = 'STONE_SELECTION';
      const payload = { eligible: eligible.map(t => ({ name: t.name, avatar: t.avatar, rank: t.rank })), stoneTypes: ['power','reality','space'] };
      io.to(room.code).emit('stoneSelection', payload);
      io.to(room.adminSocketId).emit('stoneSelection', payload);
    });

    socket.on('admin:grantStone', (data) => {
      const room = rooms.get(socket.roomCode);
      if (!room || room.adminSocketId !== socket.id) return;
      const { teamName, stoneType } = data;
      if (!['power','reality','space'].includes(stoneType)) return;
      
      const team = room.teams.get(teamName);
      if (!team) return;
      
      team.stones[stoneType]++;
      
      io.to(room.adminSocketId).emit('stoneGranted', {
        teamName, stoneType, stones: { ...team.stones }
      });

      if (team.socketId) {
        io.to(team.socketId).emit('stonesUpdated', { stones: { ...team.stones } });
      }
    });

    socket.on('admin:lockStoneSelection', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || room.adminSocketId !== socket.id) return;
      room.stoneSelectionActive = false;
      room.gameState = 'PHASE_ACTIVE';
      io.to(room.code).emit('stoneSelectionLocked', {});
      io.to(room.adminSocketId).emit('stoneSelectionLocked', {});
    });

    socket.on('admin:showLeaderboard', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || room.adminSocketId !== socket.id) return;
      io.to(room.code).emit('showLeaderboard', { leaderboard: getLeaderboard(room), phase: room.currentPhase });
    });

    socket.on('admin:endGame', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || room.adminSocketId !== socket.id) return;
      clearTimer(room);
      room.gameState = 'GAME_ENDED';
      room.endedAt = Date.now();
      const lb = getLeaderboard(room);
      io.to(room.code).emit('gameEnded', { leaderboard: lb });
      io.to(room.adminSocketId).emit('gameEnded', { leaderboard: lb });
    });

    socket.on('admin:destroyRoom', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || room.adminSocketId !== socket.id) return;
      clearTimer(room);
      io.to(room.code).emit('roomDestroyed', {});
      rooms.delete(room.code);
      console.log(`🗑️ Admin destroyed room ${room.code}`);
    });

    socket.on('admin:kickTeam', (data) => {
      const room = rooms.get(socket.roomCode);
      if (!room || room.adminSocketId !== socket.id) return;
      const team = room.teams.get(data.teamName);
      if (team && team.socketId) {
        io.to(team.socketId).emit('kicked', {});
      }
      room.teams.delete(data.teamName);
      io.to(room.adminSocketId).emit('teamList', {
        teams: Array.from(room.teams.values()).map(t => ({ name: t.name, avatar: t.avatar, connected: t.connected }))
      });
    });

    // ===== PLAYER EVENTS =====
    socket.on('player:join', (data, cb) => {
      const { roomCode, teamName, avatar, sessionToken } = data;
      if (!roomCode || !teamName || !avatar) return cb({ error: 'Missing fields' });
      const room = rooms.get(roomCode.toUpperCase());
      if (!room) return cb({ error: 'Room not found. Check your code.' });
      if (room.gameState === 'GAME_ENDED') return cb({ error: 'Game has ended.' });

      let team;
      if (room.teams.has(teamName)) {
        team = room.teams.get(teamName);
        if (team.sessionToken !== sessionToken) return cb({ error: 'Team name already taken or invalid session.' });
        team.socketId = socket.id;
        team.connected = true;
        team.avatar = avatar;
      } else {
        if (room.gameState !== 'WAITING_ROOM') return cb({ error: 'Game already in progress. Cannot join now.' });
        const newToken = crypto.randomBytes(16).toString('hex');
        team = createTeam(teamName, avatar, socket.id, newToken);
        room.teams.set(teamName, team);
      }

      socket.teamName = teamName;
      socket.roomCode = roomCode.toUpperCase();
      socket.join(roomCode.toUpperCase());

      io.to(room.adminSocketId).emit('teamJoined', {
        name: teamName, avatar,
        teams: Array.from(room.teams.values()).map(t => ({
          name: t.name, avatar: t.avatar, connected: t.connected, totalScore: t.totalScore,
        })),
      });

      const state = {
        success: true,
        gameState: room.gameState,
        currentPhase: room.currentPhase,
        totalScore: team.totalScore,
        phaseScores: [...team.phaseScores],
        stones: { ...team.stones },
        teamName: team.name,
        avatar: team.avatar,
        sessionToken: team.sessionToken,
      };

      if (room.gameState === 'QUESTION_ACTIVE') {
        state.currentQuestion = buildQuestionPayload(room, team, false);
      }

      if (room.gameState === 'LEADERBOARD' || room.gameState === 'GAME_ENDED') {
        state.leaderboard = getLeaderboard(room);
      }

      if (room.gameState === 'STONE_SELECTION' && room.stoneSelectionActive) {
        state.stoneSelection = getStoneSelectionPayload(room);
      }

      cb(state);
    });

    socket.on('player:submitAnswer', (data, cb) => {
      const room = rooms.get(socket.roomCode);
      if (!room) return cb({ error: 'Room not found' });
      if (room.gameState !== 'QUESTION_ACTIVE') return cb({ error: 'No active question' });
      const team = room.teams.get(socket.teamName);
      if (!team) return cb({ error: 'Team not found' });

      const phaseIdx = room.currentPhase - 1;
      const qIdx = room.currentQuestionIndex;
      const key = `${phaseIdx}-${qIdx}`;

      const q = getTeamQuestion(room, team);
      const isTextAnswer = !!(q && q.textAnswer);

      if (team.answers[key] && team.answers[key].answer !== undefined && team.answers[key].answerText !== undefined) {
        return cb({ success: true, locked: true, answer: team.answers[key].answer || team.answers[key].answerText });
      }

      const responseTime = room.timerDuration - room.timerRemaining;
      team.answers[key] = team.answers[key] || {};

      if (isTextAnswer) {
        const answerText = typeof data.answerText === 'string' ? data.answerText.trim() : '';
        if (!answerText) return cb({ error: 'Please enter a valid answer' });
        team.answers[key].answerText = answerText;
        team.answers[key].responseTime = responseTime;
        team.answers[key].powerStoneActive = !!team.activeStones.power;
        team.answers[key].soulStoneActive = !!team.activeStones.soul;
        team.answers[key].locked = true;

        io.to(room.adminSocketId).emit('answerReceived', {
          teamName: team.name,
          questionNum: qIdx + 1,
          phase: room.currentPhase,
          responseTime,
          totalAnswered: Array.from(room.teams.values()).filter(t => {
            const a = t.answers[key]; return a && (a.answer !== undefined || a.answerText !== undefined);
          }).length,
          totalTeams: room.teams.size,
        });

        cb({ success: true, locked: true, answer: answerText });
      } else {
        const answer = data.answer;
        if (typeof answer !== 'number' || answer < 0 || answer > 3) return cb({ error: 'Invalid answer' });

        team.answers[key].answer = answer;
        team.answers[key].responseTime = responseTime;
        team.answers[key].powerStoneActive = !!team.activeStones.power;
        team.answers[key].soulStoneActive = !!team.activeStones.soul;
        team.answers[key].locked = true;

        io.to(room.adminSocketId).emit('answerReceived', {
          teamName: team.name,
          questionNum: qIdx + 1,
          phase: room.currentPhase,
          responseTime,
          totalAnswered: Array.from(room.teams.values()).filter(t => {
            const a = t.answers[key]; return a && a.answer !== undefined;
          }).length,
          totalTeams: room.teams.size,
        });

        cb({ success: true, locked: true, answer });
      }
    });

    socket.on('player:useStone', (data, cb) => {
      const room = rooms.get(socket.roomCode);
      if (!room) return cb({ error: 'Room not found' });
      if (room.gameState !== 'QUESTION_ACTIVE') return cb({ error: 'No active question' });
      if (room.currentPhase < 2) return cb({ error: 'Stones unlock from Phase 2 onward' });

      const team = room.teams.get(socket.teamName);
      if (!team) return cb({ error: 'Team not found' });

      const { stoneType } = data;
      if (!['power','reality','space','time','soul'].includes(stoneType)) return cb({ error: 'Invalid stone type' });
      if (team.stones[stoneType] <= 0) return cb({ error: 'You do not have this stone' });
      if (team.stonesUsedThisQuestion.includes(stoneType)) return cb({ error: 'Already used this stone this question' });

      const phaseIdx = room.currentPhase - 1;
      const qIdx = room.currentQuestionIndex;
      const key = `${phaseIdx}-${qIdx}`;
      const alreadyAnswered = team.answers[key] && team.answers[key].answer !== undefined;

      if (stoneType === 'power') {
        const elapsed = room.timerDuration - room.timerRemaining;
        if (elapsed > 10) return cb({ error: 'Power Stone must be activated within the first 10 seconds' });
        if (alreadyAnswered) return cb({ error: 'Cannot activate Power Stone after answering' });
        team.activeStones.power = true;
        team.stones.power--;
        team.stonesUsedThisQuestion.push('power');
        io.to(team.socketId).emit('stonesUpdated', { stones: { ...team.stones }, activeStones: { ...team.activeStones } });
        io.to(room.adminSocketId).emit('stoneUsed', { teamName: team.name, stoneType: 'power', stonesLeft: team.stones.power });
        return cb({ success: true, stoneType: 'power' });
      }

      if (stoneType === 'reality') {
        let q = room.questions[phaseIdx][qIdx];
        if (team.answers[key] && team.answers[key].spaceStoneQuestion) q = team.answers[key].spaceStoneQuestion;
        const wrong = [0,1,2,3].filter(i => i !== q.correct);
        wrong.sort(() => Math.random() - 0.5);
        const removed = wrong.slice(0, 2);
        team.answers[key] = team.answers[key] || {};
        team.answers[key].removedOptions = removed;
        team.stones.reality--;
        team.stonesUsedThisQuestion.push('reality');
        io.to(team.socketId).emit('stonesUpdated', { stones: { ...team.stones }, activeStones: { ...team.activeStones } });
        io.to(team.socketId).emit('realityStoneEffect', { removedOptions: removed });
        io.to(room.adminSocketId).emit('stoneUsed', { teamName: team.name, stoneType: 'reality', stonesLeft: team.stones.reality });
        return cb({ success: true, stoneType: 'reality', removedOptions: removed });
      }

      if (stoneType === 'space') {
        const available = room.backupQuestions
          .map((q, i) => ({ q, i }))
          .filter(({ i }) => !room.usedBackupIndices.includes(i));
        if (available.length === 0) return cb({ error: 'No backup questions available. Space Stone cannot be used.' });
        if (alreadyAnswered) return cb({ error: 'Cannot use Space Stone after answering' });
        const pick = available[Math.floor(Math.random() * available.length)];
        room.usedBackupIndices.push(pick.i);
        team.answers[key] = team.answers[key] || {};
        team.answers[key].spaceStoneQuestion = pick.q;
        team.answers[key].removedOptions = [];
        team.stones.space--;
        team.stonesUsedThisQuestion.push('space');
        io.to(team.socketId).emit('stonesUpdated', { stones: { ...team.stones }, activeStones: { ...team.activeStones } });
        io.to(team.socketId).emit('question', {
          id: pick.q.id, text: pick.q.text, options: pick.q.options,
          timer: room.timerDuration, timerRemaining: room.timerRemaining,
          isSpaceStone: true, isBackup: true, removedOptions: [],
          phaseNum: room.currentPhase, questionNum: qIdx + 1, lockedAnswer: null,
          totalQuestions: getTotalQuestionsForPhase(room.currentPhase),
          image: pick.q.image || '',
          linkFriendly: pick.q.linkFriendly || false,
          externalUrl: pick.q.externalUrl || '',
          textAnswer: pick.q.textAnswer || false,
        });
        io.to(room.adminSocketId).emit('stoneUsed', { teamName: team.name, stoneType: 'space', stonesLeft: team.stones.space });
        return cb({ success: true, stoneType: 'space' });
      }

      if (stoneType === 'time') {
        room.timerRemaining += 15;
        team.stones.time--;
        team.stonesUsedThisQuestion.push('time');
        io.to(team.socketId).emit('stonesUpdated', { stones: { ...team.stones }, activeStones: { ...team.activeStones } });
        io.to(room.code).emit('timeExtended', { additionalSeconds: 15, teamName: team.name });
        io.to(room.adminSocketId).emit('stoneUsed', { teamName: team.name, stoneType: 'time', stonesLeft: team.stones.time });
        return cb({ success: true, stoneType: 'time' });
      }

      if (stoneType === 'soul') {
        if (alreadyAnswered) return cb({ error: 'Cannot use Soul Stone after answering' });
        team.activeStones.soul = true;
        team.stones.soul--;
        team.stonesUsedThisQuestion.push('soul');
        io.to(team.socketId).emit('stonesUpdated', { stones: { ...team.stones }, activeStones: { ...team.activeStones } });
        io.to(room.adminSocketId).emit('stoneUsed', { teamName: team.name, stoneType: 'soul', stonesLeft: team.stones.soul });
        return cb({ success: true, stoneType: 'soul' });
      }
    });

    socket.on('player:selectStone', (data, cb) => {
      const room = rooms.get(socket.roomCode);
      if (!room) return cb({ error: 'Room not found' });
      if (!room.stoneSelectionActive) return cb({ error: 'Stone selection not active' });
      const team = room.teams.get(socket.teamName);
      if (!team) return cb({ error: 'Team not found' });
      return cb({ error: 'Stone selection is admin-controlled only' });
    });

    // ===== DISCONNECT =====
    socket.on('disconnect', () => {
      const room = rooms.get(socket.roomCode);
      if (!room) return;
      if (socket.isAdmin) {
        console.log(`Admin disconnected from room ${socket.roomCode}`);
      } else if (socket.teamName) {
        const team = room.teams.get(socket.teamName);
        if (team) {
          team.connected = false;
          io.to(room.adminSocketId).emit('teamDisconnected', { name: socket.teamName });
        }
      }
    });
  });
}

module.exports = {
  setupSocket,
  ADMIN_PASSCODE
};
