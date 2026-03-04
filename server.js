const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// =================== DEFAULT QUESTIONS ===================
const DEFAULT_QUESTIONS = {
  phases: [[], [], [], [], []],
  backupQuestions: [],
};

const QUESTIONS_FILE = path.join(__dirname, 'public', 'questions.json');

function loadQuestionsFromFile() {
  try {
    const raw = fs.readFileSync(QUESTIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.phases) && Array.isArray(parsed.backupQuestions)) {
      return parsed;
    }
  } catch (err) {
    console.warn('Questions file missing or invalid. Using defaults.');
  }
  return JSON.parse(JSON.stringify(DEFAULT_QUESTIONS));
}

function saveQuestionsToFile(data) {
  const payload = {
    phases: data.phases,
    backupQuestions: data.backupQuestions,
  };
  fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(payload, null, 2), 'utf8');
}

let questionsStore = loadQuestionsFromFile();
try {
  saveQuestionsToFile(questionsStore);
} catch (err) {
  console.warn('Failed to write questions file:', err.message);
}

function getTotalQuestionsForPhase(phaseNum) {
  return phaseNum === 5 ? 3 : 5;
}

// =================== TEXT-ANSWER HELPERS ===================
function normalizeTextAnswer(value) {
  return String(value || '').trim().toLowerCase();
}

// =================== ROOM STATE ===================
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
  };
  rooms.set(code, room);
  return room;
}

function createTeam(name, avatar, socketId) {
  return {
    name, avatar, socketId,
    connected: true,
    totalScore: 0,
    phaseScores: [0, 0, 0, 0, 0],
    totalResponseTime: 0,
    answers: {},
    stones: { power: 0, reality: 0, space: 0 },
    stonesUsedThisQuestion: [],
    activeStones: {},
    stoneSelectedThisRound: false,
  };
}

// =================== TIMER ===================
function startTimer(room, duration, onTick, onEnd) {
  clearTimer(room);
  room.timerDuration = duration;
  room.timerRemaining = duration;
  room.questionStartTime = Date.now();
  onTick(duration);
  room.timerInterval = setInterval(() => {
    room.timerRemaining = Math.max(0, room.timerRemaining - 1);
    onTick(room.timerRemaining);
    if (room.timerRemaining <= 0) { clearTimer(room); onEnd(); }
  }, 1000);
}

function clearTimer(room) {
  if (room.timerInterval) { clearInterval(room.timerInterval); room.timerInterval = null; }
}

// =================== SCORING ===================
function calculateScore(responseTime, totalTime, powerActive) {
  const remaining = Math.max(0, totalTime - responseTime);
  const base = Math.round(100 * (remaining / totalTime));
  return powerActive ? base * 2 : base;
}

// =================== LEADERBOARD ===================
function getLeaderboard(room) {
  return Array.from(room.teams.values())
    .sort((a, b) => b.totalScore !== a.totalScore
      ? b.totalScore - a.totalScore
      : a.totalResponseTime - b.totalResponseTime)
    .map((t, i) => ({
      rank: i + 1,
      name: t.name,
      avatar: t.avatar,
      totalScore: t.totalScore,
      phaseScores: [...t.phaseScores],
      totalResponseTime: t.totalResponseTime,
      stones: { ...t.stones },
      connected: t.connected,
    }));
}

function getStoneSelectionPayload(room) {
  if (!room.stoneSelectionActive) return null;
  const lb = getLeaderboard(room);
  const eligible = room.stoneSelectionWinners.length
    ? lb.filter(t => room.stoneSelectionWinners.includes(t.name))
    : [];
  return {
    eligible: eligible.map(t => ({ name: t.name, avatar: t.avatar, rank: t.rank })),
    stoneTypes: ['power','reality','space'],
  };
}

// =================== QUESTION HELPERS ===================
function getTeamQuestion(room, team) {
  if (room.currentPhase < 1 || room.currentQuestionIndex < 0) return null;
  const key = `${room.currentPhase - 1}-${room.currentQuestionIndex}`;
  const ans = team.answers[key];
  if (ans && ans.spaceStoneQuestion) return ans.spaceStoneQuestion;
  return room.questions[room.currentPhase - 1][room.currentQuestionIndex];
}

function buildQuestionPayload(room, team, withCorrect = false) {
  const q = getTeamQuestion(room, team);
  if (!q) return null;
  const key = `${room.currentPhase - 1}-${room.currentQuestionIndex}`;
  const ans = team.answers[key];
  const payload = {
    id: q.id,
    text: q.text,
    options: q.options,
    timer: room.timerDuration,
    timerRemaining: room.timerRemaining,
    isSpaceStone: !!(ans && ans.spaceStoneQuestion),
    isBackup: !!(ans && ans.spaceStoneQuestion),
    removedOptions: (ans && ans.removedOptions) || [],
    phaseNum: room.currentPhase,
    questionNum: room.currentQuestionIndex + 1,
    totalQuestions: getTotalQuestionsForPhase(room.currentPhase),
    lockedAnswer: (ans && ans.answer !== undefined) ? ans.answer : null,
    stonesActive: { ...team.activeStones },
    image: q.image || '',
    linkFriendly: q.linkFriendly || false,
    externalUrl: q.externalUrl || '',
    textAnswer: q.textAnswer || false,
  };
  if (withCorrect) payload.correct = q.correct;
  return payload;
}

// =================== END QUESTION ===================
function endQuestion(room) {
  if (room.gameState !== 'QUESTION_ACTIVE') return;
  clearTimer(room);
  room.gameState = 'QUESTION_ENDED';
  const phaseIdx = room.currentPhase - 1;
  const qIdx = room.currentQuestionIndex;
  const key = `${phaseIdx}-${qIdx}`;
  const mainQ = room.questions[phaseIdx][qIdx];
  const isTextAnswer = !!(mainQ && mainQ.textAnswer);

  const adminResults = [];

  room.teams.forEach(team => {
    const ans = team.answers[key] || {};
    const q = (ans.spaceStoneQuestion) ? ans.spaceStoneQuestion : mainQ;
    let score = 0;
    let correct = false;
    let responseTime = mainQ.timer;

    if (isTextAnswer) {
      if (ans.answerText !== undefined) {
        responseTime = ans.responseTime !== undefined ? ans.responseTime : mainQ.timer;
        correct = normalizeTextAnswer(ans.answerText) === normalizeTextAnswer(q.correctText || '');
        if (correct) {
          score = calculateScore(responseTime, mainQ.timer, !!ans.powerStoneActive);
        }
      }
    } else {
      if (ans.answer !== undefined && ans.answer !== null) {
        responseTime = ans.responseTime !== undefined ? ans.responseTime : mainQ.timer;
        correct = (ans.answer === q.correct);
        if (correct) {
          score = calculateScore(responseTime, mainQ.timer, !!ans.powerStoneActive);
        }
      }
    }

    ans.correct = correct;
    ans.score = score;
    team.answers[key] = ans;
    team.totalScore += score;
    team.phaseScores[phaseIdx] += score;
    if ((isTextAnswer && ans.answerText !== undefined) || (!isTextAnswer && ans.answer !== undefined)) {
      team.totalResponseTime += responseTime;
    }

    team.stonesUsedThisQuestion = [];
    team.activeStones = {};

    // Send result to player
    if (team.socketId) {
      if (isTextAnswer) {
        io.to(team.socketId).emit('questionResult', {
          correctAnswer: q.correctText || 'No answer provided',
          yourAnswer: ans.answerText !== undefined ? ans.answerText : '',
          score,
          totalScore: team.totalScore,
          isCorrect: correct,
          phaseNum: room.currentPhase,
          questionNum: qIdx + 1,
          isTextAnswer: true,
        });
      } else {
        io.to(team.socketId).emit('questionResult', {
          correctAnswer: q.correct,
          yourAnswer: ans.answer !== undefined ? ans.answer : null,
          score,
          totalScore: team.totalScore,
          isCorrect: correct,
          phaseNum: room.currentPhase,
          questionNum: qIdx + 1,
        });
      }
    }

    adminResults.push({
      teamName: team.name,
      avatar: team.avatar,
      answer: isTextAnswer ? (ans.answerText !== undefined ? ans.answerText : null) : (ans.answer !== undefined ? ans.answer : null),
      correct,
      score,
      responseTime: (isTextAnswer ? ans.answerText : ans.answer) !== undefined ? responseTime : null,
      usedSpaceStone: !!ans.spaceStoneQuestion,
      correctOptionText: isTextAnswer ? (q.correctText || 'No answer') : q.options[q.correct],
      isTextAnswer: isTextAnswer,
    });
  });

  io.to(room.adminSocketId).emit('questionEnded', {
    correctAnswer: isTextAnswer ? (mainQ.correctText || 'No answer') : mainQ.correct,
    correctOptionText: isTextAnswer ? (mainQ.correctText || 'No answer') : mainQ.options[mainQ.correct],
    results: adminResults,
    leaderboard: getLeaderboard(room),
    isTextAnswer: isTextAnswer,
  });
}

// =================== SOCKET EVENTS ===================
io.on('connection', (socket) => {

  // ===== ADMIN EVENTS =====
  socket.on('admin:createRoom', (_, cb) => {
    const room = createRoom(socket.id);
    socket.join(room.code);
    socket.roomCode = room.code;
    socket.isAdmin = true;
    cb({ success: true, roomCode: room.code });
  });

  socket.on('admin:reconnect', (data, cb) => {
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
    questionsStore.phases = data.questions;
    try { saveQuestionsToFile(questionsStore); } catch (err) { console.warn('Failed to save questions:', err.message); }
    if (cb) cb({ success: true });
  });

  socket.on('admin:updateBackup', (data, cb) => {
    const room = rooms.get(data.roomCode || socket.roomCode);
    if (!room || room.adminSocketId !== socket.id) return;
    room.backupQuestions = data.backupQuestions;
    questionsStore.backupQuestions = data.backupQuestions;
    try { saveQuestionsToFile(questionsStore); } catch (err) { console.warn('Failed to save backup questions:', err.message); }
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
      () => endQuestion(room)
    );
  });

  socket.on('admin:forceEndQuestion', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.adminSocketId !== socket.id) return;
    if (room.gameState === 'QUESTION_ACTIVE') endQuestion(room);
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
    // Stone selection is admin-controlled only.
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
    const lb = getLeaderboard(room);
    io.to(room.code).emit('gameEnded', { leaderboard: lb });
    io.to(room.adminSocketId).emit('gameEnded', { leaderboard: lb });
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
    const { roomCode, teamName, avatar } = data;
    if (!roomCode || !teamName || !avatar) return cb({ error: 'Missing fields' });
    const room = rooms.get(roomCode.toUpperCase());
    if (!room) return cb({ error: 'Room not found. Check your code.' });
    if (room.gameState === 'GAME_ENDED') return cb({ error: 'Game has ended.' });

    let team;
    if (room.teams.has(teamName)) {
      team = room.teams.get(teamName);
      team.socketId = socket.id;
      team.connected = true;
      team.avatar = avatar;
    } else {
      if (room.gameState !== 'WAITING_ROOM') return cb({ error: 'Game already in progress. Cannot join now.' });
      team = createTeam(teamName, avatar, socket.id);
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
    if (!['power','reality','space'].includes(stoneType)) return cb({ error: 'Invalid stone type' });
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
  });

  socket.on('player:selectStone', (data, cb) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return cb({ error: 'Room not found' });
    if (!room.stoneSelectionActive) return cb({ error: 'Stone selection not active' });
    const team = room.teams.get(socket.teamName);
    if (!team) return cb({ error: 'Team not found' });
    // Only admin can trigger stone selection now - players cannot select stones
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

// =================== START ===================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n⚡ AVENGERS QUIZ SERVER RUNNING`);
  console.log(`──────────────────────────────────`);
  console.log(`📱 Player UI: http://localhost:${PORT}/`);
  console.log(`🛡️  Admin Panel: http://localhost:${PORT}/admin.html`);
  console.log(`🌐 Network:  http://172.24.240.107:${PORT}/`);
  console.log(`──────────────────────────────────\n`);
}); 