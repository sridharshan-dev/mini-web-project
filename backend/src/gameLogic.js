const { getTotalQuestionsForPhase } = require('./questionsManager');

// =================== TEXT-ANSWER HELPERS ===================
function normalizeTextAnswer(value) {
  return String(value || '').trim().toLowerCase();
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
    stoneTypes: ['power','reality','space','time','soul'],
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
function endQuestion(room, io) {
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

    if (ans.soulStoneActive) {
      if (correct) score += 50;
      else if ((isTextAnswer && ans.answerText !== undefined) || (!isTextAnswer && ans.answer !== undefined)) score -= 20;
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

module.exports = {
  normalizeTextAnswer,
  startTimer,
  clearTimer,
  calculateScore,
  getLeaderboard,
  getStoneSelectionPayload,
  getTeamQuestion,
  buildQuestionPayload,
  endQuestion,
};
