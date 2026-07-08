function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>'"\/]/g, function (s) {
    return {
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;', '/': '&#x2F;'
    }[s];
  });
}

// =================== STATE ===================
const socket = io();
let state = {
  teamName: '', avatar: '', roomCode: '',
  totalScore: 0, phaseScores: [],
  stones: { power:0, reality:0, space:0 },
  currentPhase: 0,
  totalQuestions: 5,
  gameState: 'WAITING_ROOM',
  lockedAnswer: null,
  stonesUsedThisQ: [],
  activeStonesThisQ: {},
  timerTotal: 30, timerRemaining: 30,
  pendingStoneChoice: null,
  eligibleForStone: false,
  lastQuestion: null,
};

const DEFAULT_AVATAR = 'https://placehold.co/96x96?text=TEAM';
const AVATARS = [
  'https://api.dicebear.com/7.x/bottts/svg?seed=Alpha',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Beta',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Gamma',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Delta',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Epsilon',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Zeta',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Eta',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Theta',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Iota',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Kappa',
];
const STONE_IMAGES = {
  power: 'https://placehold.co/48x48/8b5cf6/FFFFFF?text=PWR',
  reality: 'https://placehold.co/48x48/a78bfa/FFFFFF?text=RLT',
  space: 'https://placehold.co/48x48/3b82f6/FFFFFF?text=SPC',
  time: 'https://placehold.co/48x48/10b981/FFFFFF?text=TIM',
  soul: 'https://placehold.co/48x48/f59e0b/FFFFFF?text=SOL',
};

// =================== INIT ===================
window.addEventListener('load', () => {
  renderAvatarGrid();
  setStoneImages();
  const saved = JSON.parse(localStorage.getItem('avq_state') || '{}');
  if (saved.teamName) document.getElementById('inp-team').value = saved.teamName;
  if (saved.roomCode) document.getElementById('inp-code').value = saved.roomCode;
  if (saved.avatar) {
    state.avatar = saved.avatar;
    document.querySelectorAll('.avatar-opt').forEach(el => {
      if (el.dataset.avatar === saved.avatar) el.classList.add('selected');
    });
  }
  if (saved.teamName && saved.roomCode && saved.avatar) {
    joinGame(true);
  }
});

function renderAvatarGrid() {
  const grid = document.getElementById('avatarGrid');
  grid.innerHTML = AVATARS.map(url =>
    `<div class="avatar-opt" data-avatar="${url}" onclick="selectAvatar(this,'${url}')">
      <img src="${url}" alt="Avatar">
    </div>`
  ).join('');
}

function selectAvatar(el, avatarUrl) {
  document.querySelectorAll('.avatar-opt').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  state.avatar = avatarUrl;
}

function setAvatarImage(el, url) {
  if (!el) return;
  el.src = url || DEFAULT_AVATAR;
}

function setStoneImages() {
  const ids = ['power','reality','space','time','soul'];
  ids.forEach(type => {
    const icon = document.getElementById(`icon-${type}`);
    const choice = document.getElementById(`choice-${type}`);
    if (icon) icon.src = STONE_IMAGES[type];
    if (choice) choice.src = STONE_IMAGES[type];
  });
}

// =================== JOIN ===================
function joinGame(auto = false) {
  const code = document.getElementById('inp-code').value.trim().toUpperCase();
  const team = document.getElementById('inp-team').value.trim();
  const avatar = state.avatar || document.querySelector('.avatar-opt.selected')?.dataset.avatar || DEFAULT_AVATAR;
  const errEl = document.getElementById('joinError');

  if (!code || code.length < 4) { errEl.textContent = 'Enter a valid room code'; return; }
  if (!team || team.length < 1) { errEl.textContent = 'Enter your team name'; return; }
  errEl.textContent = '';
  document.getElementById('btnJoin').disabled = true;
  document.getElementById('btnJoin').textContent = auto ? 'RECONNECTING...' : 'CONNECTING...';

  const saved = JSON.parse(localStorage.getItem('avq_state') || '{}');
  const sessionToken = saved.teamName === team ? saved.sessionToken : undefined;

  socket.emit('player:join', { roomCode: code, teamName: team, avatar, sessionToken }, (res) => {
    document.getElementById('btnJoin').disabled = false;
    document.getElementById('btnJoin').textContent = 'CONNECT';
    if (res.error) { errEl.textContent = res.error; return; }

    state.teamName = team; state.avatar = avatar; state.roomCode = code;
    state.totalScore = res.totalScore || 0;
    state.phaseScores = res.phaseScores || [];
    state.stones = res.stones || { power:0, reality:0, space:0 };
    state.currentPhase = res.currentPhase || 0;
    state.gameState = res.gameState;

    localStorage.setItem('avq_state', JSON.stringify({ teamName: team, avatar, roomCode: code, sessionToken: res.sessionToken }));
    updateHUD();

    if (res.gameState === 'QUESTION_ACTIVE' && res.currentQuestion) {
      showScreen('screen-question');
      renderQuestion(res.currentQuestion, res.currentQuestion.timerRemaining);
    } else if (res.gameState === 'STONE_SELECTION') {
      if (res.stoneSelection) handleStoneSelection(res.stoneSelection);
      showScreen('screen-stone-select');
    } else if (res.gameState === 'LEADERBOARD' && res.leaderboard) {
      document.getElementById('lb-title').textContent = `⚡ LEADERBOARD`;
      renderLeaderboard(res.leaderboard, 'lb-list');
      showScreen('screen-leaderboard');
    } else if (res.gameState === 'GAME_ENDED' && res.leaderboard) {
      const winner = res.leaderboard[0];
      document.getElementById('end-winner').textContent = winner ? `${winner.name} WINS!` : 'GAME OVER!';
      renderLeaderboard(res.leaderboard, 'end-lb');
      showScreen('screen-ended');
    } else if (res.gameState === 'WAITING_ROOM') {
      setAvatarImage(document.getElementById('wt-avatar'), avatar);
      document.getElementById('wt-name').textContent = team;
      showScreen('screen-waiting');
    } else {
      setAvatarImage(document.getElementById('wt-avatar'), avatar);
      document.getElementById('wt-name').textContent = team;
      showScreen('screen-waiting');
    }
  });
}

// =================== SCREENS ===================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const s = document.getElementById(id);
  if (s) s.classList.add('active');
}

// =================== HUD ===================
function updateHUD() {
  setAvatarImage(document.getElementById('q-hud-avatar'), state.avatar);
  document.getElementById('q-hud-team').textContent = state.teamName;
  document.getElementById('q-hud-score').textContent = state.totalScore;
  updateStoneUI();
}

function updateStoneUI() {
  ['power','reality','space','time','soul'].forEach(type => {
    const cnt = document.getElementById(`cnt-${type}`);
    const btn = document.getElementById(`stone-${type}`);
    if (cnt) cnt.textContent = state.stones[type] || 0;
    if (btn) {
      const noStones = (state.stones[type] || 0) <= 0;
      const usedThisQ = state.stonesUsedThisQ.includes(type);
      btn.disabled = noStones || usedThisQ || state.lockedAnswer !== null || state.lockedTextAnswer !== null || state.currentPhase < 2;
      btn.classList.toggle('used-this-q', usedThisQ);
      if (type === 'power') btn.classList.toggle('active', !!state.activeStonesThisQ.power);
      if (type === 'soul') btn.classList.toggle('active', !!state.activeStonesThisQ.soul);
    }
  });
}

// =================== QUESTION ===================
let timerInterval = null;

function renderQuestion(q, timerOverride) {
  state.lockedAnswer = q.lockedAnswer !== undefined ? q.lockedAnswer : null;
  state.lockedTextAnswer = q.lockedTextAnswer !== undefined ? q.lockedTextAnswer : null;
  state.stonesUsedThisQ = [];
  state.activeStonesThisQ = {};
  state.timerTotal = q.timer;
  state.lastQuestion = q;
  state.totalQuestions = q.totalQuestions || state.totalQuestions || 5;
  const remaining = timerOverride !== undefined ? timerOverride : q.timer;
  state.timerRemaining = remaining;

  // HUD info
  document.getElementById('q-hud-info').textContent = `Phase ${q.phaseNum} · Q${q.questionNum}`;
  document.getElementById('q-phase-info').textContent = `PHASE ${q.phaseNum} · QUESTION ${q.questionNum}/${state.totalQuestions}`;
  document.getElementById('q-text').textContent = q.text;

  const mediaWrap = document.getElementById('q-media');
  const mediaImg = document.getElementById('q-image');
  if (q.image) {
    mediaImg.src = q.image;
    mediaWrap.style.display = 'flex';
  } else {
    mediaImg.src = '';
    mediaWrap.style.display = 'none';
  }

  const linkWrap = document.getElementById('q-link-wrap');
  const linkBtn = document.getElementById('q-link');
  if (q.externalUrl) {
    linkBtn.href = q.externalUrl;
    linkWrap.style.display = 'flex';
  } else {
    linkBtn.removeAttribute('href');
    linkWrap.style.display = 'none';
  }

  // Space stone flag
  const backup = q.isBackup || q.isSpaceStone;
  const backupLabel = document.getElementById('q-backup-label');
  backupLabel.style.display = backup ? 'block' : 'none';
  const qCard = document.getElementById('q-text').parentElement;

  // Check if text answer question
  const isTextAnswer = q.textAnswer;
  const grid = document.getElementById('optionsGrid');
  const textAnswerWrap = document.getElementById('text-answer-wrap');

  if (isTextAnswer) {
    // Hide multiple-choice options
    grid.style.display = 'none';
    
    // Show text input
    if (!textAnswerWrap) {
      const wrapper = document.createElement('div');
      wrapper.id = 'text-answer-wrap';
      wrapper.style.cssText = 'display:flex;flex-direction:column;gap:12px;margin-top:20px;max-width:500px;margin-left:auto;margin-right:auto';
      wrapper.innerHTML = `
        <input type="text" id="text-answer-input" placeholder="Enter your answer..." style="padding:12px;background:var(--surface3);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:16px;font-family:inherit">
        <button id="text-answer-btn" class="btn" style="width:100%">SUBMIT ANSWER</button>
      `;
      grid.parentElement.appendChild(wrapper);
    } else {
      textAnswerWrap.style.display = 'flex';
    }
    
    // Set up event listeners
    const inputEl = document.getElementById('text-answer-input');
    const btnEl = document.getElementById('text-answer-btn');
    inputEl.disabled = state.lockedTextAnswer !== null;
    btnEl.disabled = state.lockedTextAnswer !== null;
    if (state.lockedTextAnswer) inputEl.value = state.lockedTextAnswer;
    
    inputEl.oninput = null;
    btnEl.onclick = () => submitTextAnswer();
  } else {
    // Show multiple-choice options
    grid.style.display = 'grid';
    if (textAnswerWrap) textAnswerWrap.style.display = 'none';
    
    const opts = grid.querySelectorAll('.option-btn');
    const badges = ['A','B','C','D'];
    opts.forEach((btn, i) => {
      btn.textContent = '';
      btn.className = 'option-btn';
      btn.disabled = false;
      const badge = document.createElement('span');
      badge.className = 'option-badge'; badge.textContent = badges[i];
      btn.appendChild(badge);
      btn.appendChild(document.createTextNode(q.options[i]));

      // Removed options (Reality Stone)
      if (q.removedOptions && q.removedOptions.includes(i)) {
        btn.classList.add('removed'); btn.disabled = true;
      }
      // Locked answer
      if (state.lockedAnswer !== null) {
        btn.disabled = true;
        if (i === state.lockedAnswer) btn.classList.add('selected');
      }
    });
  }

  // Timer
  startTimerDisplay(state.timerTotal, remaining);
  updateHUD();
  showScreen('screen-question');
}

function startTimerDisplay(total, remaining) {
  clearInterval(timerInterval);
  updateTimerDisplay(remaining, total);
  timerInterval = setInterval(() => {
    if (state.timerRemaining > 0) {
      state.timerRemaining--;
      updateTimerDisplay(state.timerRemaining, total);
    }
  }, 1000);
}

function updateTimerDisplay(remaining, total) {
  const val = document.getElementById('timerVal');
  const arc = document.getElementById('timerArc');
  val.textContent = remaining;
  const circumference = 2 * Math.PI * 35;
  const offset = circumference * (1 - remaining / total);
  arc.style.strokeDashoffset = offset;

  const ratio = remaining / total;
  arc.className = 'timer-ring-fg';
  if (ratio <= 0.25) { arc.classList.add('critical'); val.style.color = 'var(--power)'; }
  else if (ratio <= 0.5) { arc.classList.add('warn'); val.style.color = 'var(--timer-warn)'; }
  else { val.style.color = 'var(--gold)'; }
}

function selectAnswer(idx) {
  if (state.lockedAnswer !== null) return;
  const opts = document.querySelectorAll('.option-btn');
  if (opts[idx].classList.contains('removed') || opts[idx].disabled) return;

  socket.emit('player:submitAnswer', { answer: idx }, (res) => {
    if (res.error) { showToast(res.error, 'error'); return; }
    state.lockedAnswer = idx;
    opts.forEach(btn => { btn.disabled = true; });
    opts[idx].classList.add('selected');
    updateStoneUI();
    showToast('Answer locked!', 'success');
  });
}

function submitTextAnswer() {
  if (state.lockedTextAnswer !== null) return;
  const inputEl = document.getElementById('text-answer-input');
  const answerText = inputEl.value.trim();
  
  if (!answerText) {
    showToast('Please enter an answer', 'error');
    return;
  }
  
  socket.emit('player:submitAnswer', { answerText }, (res) => {
    if (res.error) { showToast(res.error, 'error'); return; }
    state.lockedTextAnswer = answerText;
    inputEl.disabled = true;
    document.getElementById('text-answer-btn').disabled = true;
    updateStoneUI();
    showToast('Answer submitted!', 'success');
  });
}

function useStone(type) {
  if (state.currentPhase < 2) { showToast('Boosts unlock from Phase 2!', 'error'); return; }
  if ((state.stones[type] || 0) <= 0) { showToast('No ' + type + ' boost!', 'error'); return; }
  if (state.stonesUsedThisQ.includes(type)) { showToast('Already used ' + type + ' boost this question!', 'error'); return; }
  if (type === 'power' && state.lockedAnswer !== null) { showToast('Cannot activate after answering!', 'error'); return; }

  socket.emit('player:useStone', { stoneType: type }, (res) => {
    if (res.error) { showToast(res.error, 'error'); return; }
    state.stonesUsedThisQ.push(type);
    if (type === 'power') {
      state.activeStonesThisQ.power = true;
      document.getElementById('q-power-label').style.display = 'block';
      showToast('🔴 Power Stone activated! 2× score ready!', 'gold');
    } else if (type === 'reality') {
      if (res.removedOptions) {
        const opts = document.querySelectorAll('.option-btn');
        res.removedOptions.forEach(i => {
          opts[i].classList.add('removed'); opts[i].disabled = true;
        });
      }
      showToast('🟡 Reality Stone! 2 wrong options eliminated!', 'gold');
    } else if (type === 'space') {
      showToast('🔵 Space Stone! New question incoming!', 'gold');
    } else if (type === 'time') {
      showToast('🟢 Time Stone activated! +15 seconds!', 'time');
    } else if (type === 'soul') {
      state.activeStonesThisQ.soul = true;
      showToast('🟠 Soul Stone activated! +50 if correct, -20 if wrong!', 'soul');
    }
    updateStoneUI();
  });
}

// =================== STONE PICK ===================
function pickStone(type) {
  if (!state.eligibleForStone) return;
  showToast('Stone selection is handled by the admin.', 'error');
}

function confirmStone() {
  if (!state.pendingStoneChoice) return;
  socket.emit('player:selectStone', { stoneType: state.pendingStoneChoice }, (res) => {
    if (res.error) { showToast(res.error, 'error'); return; }
    state.stones = res.stones;
    showToast(`🏆 ${state.pendingStoneChoice.toUpperCase()} STONE claimed!`, 'gold');
    document.getElementById('ss-choices').style.display = 'none';
    document.getElementById('ss-confirm').style.display = 'none';
    document.getElementById('ss-sub').textContent = `✅ ${state.pendingStoneChoice.toUpperCase()} STONE added to your arsenal!`;
    state.eligibleForStone = false;
    state.pendingStoneChoice = null;
    updateStoneUI();
  });
}

// =================== LEADERBOARD ===================
function renderLeaderboard(lb, containerId) {
  const container = document.getElementById(containerId);
  let html = '';
  let listData = lb;
  
  if (containerId === 'end-lb' && lb.length >= 3) {
    const t1 = lb[0], t2 = lb[1], t3 = lb[2];
    html += `<div class="podium">
      <div class="podium-spot podium-2">
        <img class="podium-avatar" src="${escapeHTML(t2.avatar || DEFAULT_AVATAR)}" alt="Avatar">
        <div class="podium-name">${escapeHTML(t2.name)}</div>
        <div class="podium-score">${t2.totalScore}</div>
        <div class="podium-rank">2</div>
      </div>
      <div class="podium-spot podium-1">
        <img class="podium-avatar" src="${escapeHTML(t1.avatar || DEFAULT_AVATAR)}" alt="Avatar">
        <div class="podium-name">${escapeHTML(t1.name)}</div>
        <div class="podium-score">${t1.totalScore}</div>
        <div class="podium-rank">1</div>
      </div>
      <div class="podium-spot podium-3">
        <img class="podium-avatar" src="${escapeHTML(t3.avatar || DEFAULT_AVATAR)}" alt="Avatar">
        <div class="podium-name">${escapeHTML(t3.name)}</div>
        <div class="podium-score">${t3.totalScore}</div>
        <div class="podium-rank">3</div>
      </div>
    </div>`;
    listData = lb.slice(3);
  }

  html += listData.map((t, index) => {
    const i = (containerId === 'end-lb' && lb.length >= 3) ? index + 3 : index;
    const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    const rankEmoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}`;
    const isMe = t.name === state.teamName;
    const mins = Math.floor(t.totalResponseTime / 60);
    const secs = t.totalResponseTime % 60;
    const timeStr = `${mins}:${String(secs).padStart(2,'0')}`;
    return `<div class="lb-row ${isMe ? 'my-team' : ''}">
      <div class="lb-rank ${rankClass}">${rankEmoji}</div>
      <img class="lb-avatar" src="${escapeHTML(t.avatar || DEFAULT_AVATAR)}" alt="Avatar">
      <div style="flex:1">
        <div class="lb-name">${escapeHTML(t.name)}${isMe ? ' <span style="color:var(--gold);font-size:11px;">(you)</span>' : ''}</div>
        <div style="font-size:11px;color:var(--text-dim);">⏱ ${timeStr}</div>
      </div>
      <div class="lb-score">${t.totalScore}</div>
    </div>`;
  }).join('');
  container.innerHTML = html;
}

// =================== TOAST ===================
let toastTimer;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3000);
}

// =================== SOCKET EVENTS ===================
socket.on('connect', () => {
  document.getElementById('connStatus').classList.remove('offline');
});
socket.on('disconnect', () => {
  document.getElementById('connStatus').classList.add('offline');
  showToast('Connection lost. Reconnecting...', 'error');
});

socket.on('phaseStarted', (data) => {
  state.currentPhase = data.phase;
  state.totalQuestions = data.totalQuestions || state.totalQuestions || 5;
  state.stonesUsedThisQ = [];
  state.activeStonesThisQ = {};
  document.getElementById('phaseNum').textContent = data.phase;
  document.getElementById('phaseOf').textContent = `OF ${data.totalPhases}`;
  showScreen('screen-phase');
  clearInterval(timerInterval);
});

socket.on('question', (q) => {
  clearInterval(timerInterval);
  state.currentPhase = q.phaseNum;
  state.stonesUsedThisQ = [];
  state.activeStonesThisQ = {};
  document.getElementById('q-power-label').style.display = 'none';
  renderQuestion(q, q.timerRemaining);
});

socket.on('timerTick', (data) => {
  state.timerRemaining = data.remaining;
  updateTimerDisplay(data.remaining, data.total);
});

socket.on('questionResult', (data) => {
  clearInterval(timerInterval);
  state.totalScore = data.totalScore;
  state.lockedAnswer = null;
  state.lockedTextAnswer = null;

  const icon = data.isCorrect ? '✅' : '❌';
  document.getElementById('r-icon').textContent = data.score > 0 ? (data.score >= 150 ? '💎' : '✅') : (data.yourAnswer !== null ? '❌' : '⏰');
  document.getElementById('r-score').textContent = `+${data.score}`;
  document.getElementById('r-score').style.color = data.isCorrect ? 'var(--gold)' : 'var(--wrong)';

  // Build options display for correct answer reveal
  const last = state.lastQuestion;
  
  if (data.isTextAnswer) {
    // Text answer display
    document.getElementById('r-correct-text').innerHTML = `
      <div style="margin-bottom:8px;font-size:14px;color:var(--text-dim)">Your Answer:</div>
      <div style="padding:10px;background:var(--surface2);border-radius:4px;border-left:4px solid var(--gold);margin-bottom:12px;font-size:14px">${escapeHTML(data.yourAnswer || '(No answer submitted)')}</div>
      <div style="margin-bottom:8px;font-size:14px;color:var(--text-dim)">Correct Answer:</div>
      <div style="padding:10px;background:rgba(76,175,80,0.1);border-radius:4px;border-left:4px solid var(--correct);font-size:14px">${escapeHTML(data.correctAnswer)}</div>
    `;
  } else {
    const correctText = last && last.options ? last.options[data.correctAnswer] : null;
    document.getElementById('r-correct-text').textContent = correctText
      ? `Option ${['A','B','C','D'][data.correctAnswer]}: ${correctText}`
      : `Option ${['A','B','C','D'][data.correctAnswer]}: was correct`;
  }
  
  document.getElementById('r-total').textContent = data.totalScore;

  showScreen('screen-result');
  updateHUD();
});

socket.on('realityStoneEffect', (data) => {
  const opts = document.querySelectorAll('.option-btn');
  data.removedOptions.forEach(i => {
    opts[i].classList.add('removed'); opts[i].disabled = true;
  });
});

socket.on('stonesUpdated', (data) => {
  if (data.stones) {
    state.stones = data.stones;
  } else if (data.teams && Array.isArray(data.teams)) {
    const mine = data.teams.find(t => t.name === state.teamName);
    if (mine && mine.stones) state.stones = mine.stones;
  }
  if (data.activeStones) state.activeStonesThisQ = data.activeStones;
  updateStoneUI();
});

socket.on('phaseComplete', (data) => {
  clearInterval(timerInterval);
  state.currentPhase = data.phase;
  document.getElementById('lb-title').textContent = `⚡ PHASE ${data.phase} COMPLETE`;
  document.getElementById('lb-wait').textContent = 'Waiting for next phase...';
  renderLeaderboard(data.leaderboard, 'lb-list');
  showScreen('screen-leaderboard');
});

socket.on('showLeaderboard', (data) => {
  document.getElementById('lb-title').textContent = `⚡ LEADERBOARD`;
  renderLeaderboard(data.leaderboard, 'lb-list');
  showScreen('screen-leaderboard');
});

function handleStoneSelection(data) {
  state.eligibleForStone = false;
  state.pendingStoneChoice = null;
  const eligibleNames = data.eligible.map(e => e.name);

  document.getElementById('ss-choices').style.display = 'none';
  document.getElementById('ss-watch').style.display = 'block';
  document.getElementById('ss-confirm').style.display = 'none';
  document.querySelectorAll('.stone-choice').forEach(el => el.classList.remove('selected'));

  document.getElementById('ss-sub').textContent = `Top 3 teams: ${eligibleNames.join(', ')} — Admin assigns stones.`;
  showScreen('screen-stone-select');
}

socket.on('stoneSelection', (data) => {
  handleStoneSelection(data);
});

socket.on('yourTurnToSelectStone', () => {
  showToast('Admin will assign stones shortly.', 'gold');
});

socket.on('stoneSelectionLocked', () => {
  document.getElementById('ss-choices').style.display = 'none';
  document.getElementById('ss-confirm').style.display = 'none';
  document.getElementById('ss-watch').style.display = 'none';
  document.getElementById('ss-sub').textContent = 'Stone selection complete. Get ready for the next phase!';
  showToast('Stone selection complete!', 'gold');
});

socket.on('roomDestroyed', () => {
  showToast('Room destroyed by admin', 'error');
  localStorage.removeItem('avq_state');
  setTimeout(() => location.reload(), 1500);
});

socket.on('timeExtended', (data) => {
  showToast(`+${data.additionalSeconds}s (Time Stone used by ${data.teamName})`, 'success');
});

socket.on('gameEnded', (data) => {
  clearInterval(timerInterval);
  const winner = data.leaderboard[0];
  document.getElementById('end-trophy').textContent = '🏆';
  document.getElementById('end-winner').textContent = winner ? `${winner.name} WINS!` : 'GAME OVER!';
  renderLeaderboard(data.leaderboard, 'end-lb');
  showScreen('screen-ended');
});

socket.on('kicked', () => {
  showToast('You have been removed from the game.', 'error');
  setTimeout(() => showScreen('screen-join'), 2000);
});