function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>'"\/]/g, function (s) {
    return {
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;', '/': '&#x2F;'
    }[s];
  });
}

const socket = io();
let roomCode = null;
let appState = {
  gameState: 'WAITING_ROOM',
  currentPhase: 0,
  currentQuestionIndex: -1,
  totalQuestions: 5,
  questions: [[], [], [], [], []],
  backupQuestions: [],
  teams: [],
  timerRemaining: 0,
  timerDuration: 0,
  currentAdminQ: null,
};
let editingPhase = 0;
let localTimerInterval = null;
let answerCount = 0;
const DEFAULT_AVATAR = 'https://placehold.co/64x64?text=TEAM';
const STONE_IMAGES = {
  power: 'https://placehold.co/48x48?text=POW',
  reality: 'https://placehold.co/48x48?text=REA',
  space: 'https://placehold.co/48x48?text=SPA',
  time: 'https://placehold.co/48x48/228b22/FFFFFF?text=TIM',
  soul: 'https://placehold.co/48x48/ff8c00/FFFFFF?text=SOU',
};

// =================== SETUP ===================
function createRoom() {
  const passcode = document.getElementById('admin-passcode').value;
  socket.emit('admin:createRoom', { passcode }, (res) => {
    if (res.error) { document.getElementById('setup-error').textContent = res.error; return; }
    roomCode = res.roomCode;
    document.getElementById('display-code').textContent = res.roomCode;
    document.getElementById('setup-room-display').style.display = 'block';
    document.querySelector('.setup-card').style.display = 'none';
    document.getElementById('setup-error').textContent = '';
  });
}

function reconnectRoom() {
  const code = document.getElementById('rejoin-code').value.trim().toUpperCase();
  const passcode = document.getElementById('admin-passcode').value;
  if (!code) return;
  socket.emit('admin:reconnect', { roomCode: code, passcode }, (res) => {
    if (res.error) { document.getElementById('setup-error').textContent = res.error; return; }
    roomCode = code;
    socket.roomCode = code;
    appState.questions = res.questions;
    appState.backupQuestions = res.backupQuestions;
    appState.teams = res.teams;
    appState.gameState = res.gameState;
    appState.currentPhase = res.currentPhase;
    appState.currentQuestionIndex = res.currentQuestionIndex;
    appState.timerRemaining = res.timerRemaining;
    appState.timerDuration = res.timerDuration;
    appState.totalQuestions = res.currentPhase === 5 ? 3 : 5;
    initAdminUI();
    enterAdminPanel();
  });
}

function enterAdmin() {
  // Fetch questions from server if not already loaded
  socket.emit('admin:getQuestions', {}, (res) => {
    if (res && res.questions) {
      appState.questions = res.questions || [[], [], [], [], []];
      appState.backupQuestions = res.backupQuestions || [];
    }
    initAdminUI();
    enterAdminPanel();
  });
}

function enterAdminPanel() {
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('admin-app').style.display = 'flex';
  document.getElementById('tb-code').textContent = roomCode;
}

function initAdminUI() {
  renderTeamList();
  renderEditPhase();
  renderAdminLB([]);
  updateTopbar();
}

// =================== TABS ===================
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    const names = ['control','questions','leaderboard'];
    b.classList.toggle('active', names[i] === name);
  });
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  if (name === 'leaderboard') refreshLeaderboard();
}

// =================== TOPBAR ===================
function updateTopbar() {
  document.getElementById('tb-state').textContent = appState.gameState;
  document.getElementById('tb-phase').textContent = appState.currentPhase || '—';
  document.getElementById('tb-q').textContent = appState.currentQuestionIndex >= 0 ? appState.currentQuestionIndex + 1 : '—';
  document.getElementById('tb-q-total').textContent = appState.totalQuestions || 5;
  document.getElementById('tb-teams').textContent = appState.teams.length;
  document.getElementById('team-count-badge').textContent = appState.teams.length;
}

// =================== TEAMS ===================
function renderTeamList() {
  const el = document.getElementById('team-list');
  const sel = document.getElementById('grant-team');
  sel.innerHTML = '<option value="">Team...</option>';
  if (!appState.teams.length) { el.innerHTML = '<div style="color:var(--text-dim);font-size:13px;">No teams yet</div>'; return; }
  el.innerHTML = appState.teams.map(t => `
    <div class="team-row">
      <div class="t-dot ${t.connected ? 'online' : ''}"></div>
      <div class="t-avatar"><img src="${escapeHTML(t.avatar || DEFAULT_AVATAR)}" alt="Avatar"></div>
      <div class="t-name">${escapeHTML(t.name)}</div>
      <div class="t-stones">
        ${(t.stones?.power || 0) > 0 ? `<span class="t-stone"><img class="avatar-img" src="${STONE_IMAGES.power}" alt="Power">${t.stones.power}</span>` : ''}
        ${(t.stones?.reality || 0) > 0 ? `<span class="t-stone"><img class="avatar-img" src="${STONE_IMAGES.reality}" alt="Reality">${t.stones.reality}</span>` : ''}
        ${(t.stones?.space || 0) > 0 ? `<span class="t-stone"><img class="avatar-img" src="${STONE_IMAGES.space}" alt="Space">${t.stones.space}</span>` : ''}
        ${(t.stones?.time || 0) > 0 ? `<span class="t-stone"><img class="avatar-img" src="${STONE_IMAGES.time}" alt="Time">${t.stones.time}</span>` : ''}
        ${(t.stones?.soul || 0) > 0 ? `<span class="t-stone"><img class="avatar-img" src="${STONE_IMAGES.soul}" alt="Soul">${t.stones.soul}</span>` : ''}
      </div>
      <div class="t-score">${t.totalScore || 0}</div>
      <button class="btn btn-danger btn-sm" onclick="kickTeam('${escapeHTML(t.name).replace(/'/g,"\\'")}')">✕</button>
    </div>
  `).join('');
  appState.teams.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.name; opt.textContent = t.name;
    sel.appendChild(opt);
  });
}

function grantStone() {
  const teamSelect = document.getElementById('grant-team');
  const stoneSelect = document.getElementById('grant-stone');
  const teamName = teamSelect.value;
  const stoneType = stoneSelect.value;
  
  if (!teamName || !stoneType) {
    alert('Please select a team and stone type');
    return;
  }
  
  if (!confirm(`Grant ${stoneType} stone to ${teamName}?`)) return;
  
  socket.emit('admin:grantStone', { teamName, stoneType });
  addLog(`Granted ${stoneType} stone to ${teamName}`, 'gold');
}

function kickTeam(name) {
  if (!confirm(`Remove team "${name}"?`)) return;
  socket.emit('admin:kickTeam', { teamName: name });
}

// =================== GAME CONTROL ===================
function startPhase(phase) {
  if (!confirm(`Start Phase ${phase}?`)) return;
  socket.emit('admin:startPhase', { phase });
  appState.currentPhase = phase;
  appState.currentQuestionIndex = -1;
  appState.gameState = 'PHASE_ACTIVE';
  appState.totalQuestions = phase === 5 ? 3 : 5;
  document.getElementById('btn-next-q').disabled = false;
  document.getElementById('btn-force-end').disabled = true;
  document.getElementById('btn-stone-select').disabled = phase > 1 ? false : true;
  document.querySelectorAll('.phase-tab').forEach((t, i) => t.classList.toggle('active-tab', i+1 === phase));
  updateTopbar();
  addLog(`Phase ${phase} started`, 'gold');
  clearAnswerFeed();
  document.getElementById('answer-status').innerHTML = '<span style="color:var(--text-dim)">Phase started. Click Next Question.</span>';
}

function nextQuestion() {
  socket.emit('admin:nextQuestion', {});
  document.getElementById('btn-next-q').disabled = true;
  document.getElementById('btn-force-end').disabled = false;
  answerCount = 0;
  document.getElementById('ans-count').textContent = '0';
  document.getElementById('ans-total').textContent = appState.teams.length;
  clearAnswerFeed();
}

function forceEndQuestion() {
  socket.emit('admin:forceEndQuestion');
  document.getElementById('btn-force-end').disabled = true;
}

function triggerStoneSelection() {
  socket.emit('admin:triggerStoneSelection');
  document.getElementById('btn-stone-select').disabled = true;
  document.getElementById('btn-lock-stones').style.display = 'inline-block';
  addLog('Stone selection triggered', 'gold');
  clearStoneFeed();
}

function lockStoneSelection() {
  socket.emit('admin:lockStoneSelection');
  document.getElementById('btn-lock-stones').style.display = 'none';
  document.getElementById('btn-stone-select').disabled = false;
  addLog('Stone selection locked', 'gold');
}

function showLeaderboard() {
  socket.emit('admin:showLeaderboard');
  addLog('Leaderboard broadcast', 'gold');
}

function endGame() {
  if (!confirm('End the game for everyone?')) return;
  socket.emit('admin:endGame');
}

function destroyRoom() {
  if (!confirm('WARNING: This will instantly destroy the room and disconnect everyone. Are you sure?')) return;
  socket.emit('admin:destroyRoom');
}

function refreshLeaderboard() {
  socket.emit('admin:reconnect', { roomCode }, (res) => {
    if (res.leaderboard) renderAdminLB(res.leaderboard);
  });
}

// =================== QUESTIONS EDITOR ===================
function editPhase(phaseIdx) {
  editingPhase = phaseIdx;
  document.querySelectorAll('#edit-phase-tabs .phase-tab').forEach((t, i) => {
    const labels = [0,1,2,3,4,'backup'];
    t.classList.toggle('active-tab', labels[i] == phaseIdx);
  });
  renderEditPhase();
}

function renderEditPhase() {
  const area = document.getElementById('q-editor-area');
  const questions = editingPhase === 'backup'
    ? (appState.backupQuestions || [])
    : (appState.questions[editingPhase] || []);
  const labels = ['A','B','C','D'];
  
  if (questions.length === 0) {
    // Show empty state with add button
    area.innerHTML = `
      <div style="text-align:center;padding:40px 20px;background:rgba(201,168,76,0.05);border:2px dashed var(--border);border-radius:8px;margin-bottom:16px">
        <div style="color:var(--text-dim);font-size:14px;margin-bottom:16px">No questions in this ${editingPhase === 'backup' ? 'backup' : 'phase'} yet</div>
        <button class="btn" onclick="addQuestion(${editingPhase === 'backup' ? "'backup'" : editingPhase})" style="padding:10px 20px">+ ADD QUESTION</button>
      </div>
    `;
    return;
  }
  
  area.innerHTML = questions.map((q, qi) => {
    const isTextAnswer = q.textAnswer;
    return `
    <div class="q-editor ${appState.currentQuestionIndex === qi && appState.currentPhase - 1 === editingPhase ? 'active' : ''}" id="qed-${editingPhase}-${qi}">
      <div class="q-editor-header">
        <div class="q-num">Q${qi+1}</div>
        <div class="q-type-toggle" style="display:flex;gap:6px;align-items:center">
          <label style="font-size:11px;color:var(--text-dim)">Type:</label>
          <select id="q-type-${editingPhase}-${qi}" onchange="changeQuestionType(${editingPhase === 'backup' ? "'backup'" : editingPhase}, ${qi}, this.value)" style="padding:4px 8px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px;font-size:12px;cursor:pointer">
            <option value="0" ${!isTextAnswer ? 'selected' : ''}>Multiple Choice</option>
            <option value="1" ${isTextAnswer ? 'selected' : ''}>Text Answer</option>
          </select>
        </div>
        <div class="q-timer-label">Timer: <input type="number" class="input" style="width:65px;display:inline-block;padding:4px 6px" id="q-timer-${editingPhase}-${qi}" value="${q.timer}" min="5" max="120"> sec</div>
      </div>
      <textarea class="input" id="q-text-${editingPhase}-${qi}" rows="2" style="margin-bottom:8px">${q.text}</textarea>
      <div class="option-row" style="margin-bottom:8px">
        <div class="opt-letter">IMG</div>
        <input class="input" id="q-img-${editingPhase}-${qi}" placeholder="Image URL (optional)" value="${q.image || ''}" style="flex:1">
      </div>
      ${isTextAnswer ? `
        <div class="option-row" style="background:rgba(76,175,80,0.05);padding:10px;border-radius:4px;margin-bottom:8px;border:1px solid rgba(76,175,80,0.2)">
          <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:6px">Correct Text Answer (case-insensitive match):</label>
          <input class="input" id="q-correct-text-${editingPhase}-${qi}" placeholder="e.g., 'Iron Man' or '2012'" value="${q.correctText || ''}" style="width:100%;padding:6px">
        </div>
      ` : `
        ${q.options.map((opt, oi) => `
        <div class="option-row">
          <div class="opt-letter">${labels[oi]}</div>
          <input class="input" id="q-opt-${editingPhase}-${qi}-${oi}" value="${opt}" style="flex:1">
          <button class="opt-correct-btn ${q.correct === oi ? 'correct' : ''}" onclick="setCorrect(${editingPhase === 'backup' ? '"backup"' : editingPhase}, ${qi}, ${oi})" title="Mark correct"></button>
        </div>
        `).join('')}
      `}
      <div style="margin-top:10px;display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" onclick="addQuestion(${editingPhase === 'backup' ? "'backup'" : editingPhase})" style="flex:1">+ Add</button>
        <button class="btn btn-danger btn-sm" onclick="deleteQuestion(${editingPhase === 'backup' ? "'backup'" : editingPhase}, ${qi})" style="flex:1">Delete</button>
      </div>
    </div>
    `;
  }).join('');
}

function setCorrect(phaseIdx, qi, optIdx) {
  if (phaseIdx === 'backup') {
    appState.backupQuestions[qi].correct = optIdx;
  } else {
    appState.questions[phaseIdx][qi].correct = optIdx;
  }
  renderEditPhase();
}

function changeQuestionType(phaseIdx, qi, typeValue) {
  const isTextAnswer = typeValue === '1';
  const questions = phaseIdx === 'backup'
    ? appState.backupQuestions
    : appState.questions[phaseIdx];
  const q = questions[qi];
  
  // Update the question object
  q.textAnswer = isTextAnswer;
  
  if (isTextAnswer) {
    // Initialize text answer fields if not present
    if (!q.correctText) q.correctText = '';
  } else {
    // Make sure options are initialized for multiple choice
    if (!q.options) q.options = ['', '', '', ''];
    if (q.correct === undefined) q.correct = 0;
  }
  
  // Re-render to show the appropriate form
  renderEditPhase();
}

function saveQuestions() {
  // Collect edited values
  const questions = editingPhase === 'backup'
    ? appState.backupQuestions
    : appState.questions[editingPhase];
  questions.forEach((q, qi) => {
    const textEl = document.getElementById(`q-text-${editingPhase}-${qi}`);
    const timerEl = document.getElementById(`q-timer-${editingPhase}-${qi}`);
    const imgEl = document.getElementById(`q-img-${editingPhase}-${qi}`);
    const typeEl = document.getElementById(`q-type-${editingPhase}-${qi}`);
    
    if (textEl) q.text = textEl.value;
    if (timerEl) q.timer = parseInt(timerEl.value) || 20;
    if (imgEl) q.image = imgEl.value.trim();
    
    // Handle question type change
    if (typeEl) {
      const isTextAnswer = typeEl.value === '1';
      q.textAnswer = isTextAnswer;
      
      if (isTextAnswer) {
        // Switch to text answer
        const correctTextEl = document.getElementById(`q-correct-text-${editingPhase}-${qi}`);
        if (correctTextEl) q.correctText = correctTextEl.value.trim();
        // Keep options array for compatibility, but they're not used
      } else {
        // Switch to multiple choice
        q.options = q.options || ['', '', '', ''];
        q.options.forEach((_, oi) => {
          const optEl = document.getElementById(`q-opt-${editingPhase}-${qi}-${oi}`);
          if (optEl) q.options[oi] = optEl.value;
        });
      }
    }
  });

  if (editingPhase === 'backup') {
    socket.emit('admin:updateBackup', { backupQuestions: appState.backupQuestions });
  } else {
    socket.emit('admin:updateQuestions', { questions: appState.questions });
  }
  const s = document.getElementById('save-status');
  s.textContent = '✓ Saved'; s.style.color = 'var(--correct)';
  setTimeout(() => s.textContent = '', 2000);
}

function addQuestion(phaseIdx) {
  const newQuestion = {
    id: `q-${Date.now()}`,
    text: 'New question text here',
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    correct: 0,
    timer: 20,
    image: '',
    textAnswer: false,
    correctText: '',
    linkFriendly: false,
    externalUrl: ''
  };
  
  if (phaseIdx === 'backup') {
    appState.backupQuestions.push(newQuestion);
  } else {
    appState.questions[phaseIdx].push(newQuestion);
  }
  
  renderEditPhase();
}

function deleteQuestion(phaseIdx, qIdx) {
  if (!confirm('Delete this question?')) return;
  if (phaseIdx === 'backup') {
    appState.backupQuestions.splice(qIdx, 1);
  } else {
    appState.questions[phaseIdx].splice(qIdx, 1);
  }
  renderEditPhase();
}

// =================== ADMIN LEADERBOARD ===================
function renderAdminLB(lb) {
  const el = document.getElementById('admin-lb');
  if (!lb.length) { el.innerHTML = '<div style="color:var(--text-dim)">No data yet</div>'; return; }
  el.innerHTML = `<table class="lb-table">
    <thead><tr><th>#</th><th></th><th>Team</th><th>Score</th><th>Time</th>${lb[0]?.phaseScores?.map((_,i) => `<th>P${i+1}</th>`).join('') || ''}</tr></thead>
    <tbody>
    ${lb.map((t, i) => {
      const rankClass = i===0?'r1':i===1?'r2':i===2?'r3':'';
      const rankSymbol = i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}`;
      const t_sec = t.totalResponseTime;
      const timeStr = `${Math.floor(t_sec/60)}:${String(t_sec%60).padStart(2,'0')}`;
      return `<tr>
        <td><span class="rank-badge ${rankClass}">${rankSymbol}</span></td>
        <td><img class="avatar-img" src="${escapeHTML(t.avatar || DEFAULT_AVATAR)}" alt="Avatar"></td>
        <td style="font-weight:700">${escapeHTML(t.name)} <span style="color:var(--text-dim);font-size:11px">${t.connected?'●':'○'}</span></td>
        <td style="color:var(--gold);font-weight:700;font-size:16px">${t.totalScore}</td>
        <td style="color:var(--text-dim);font-size:12px">${timeStr}</td>
        ${t.phaseScores?.map(s => `<td style="font-size:12px;color:var(--text-dim)">${s}</td>`).join('') || ''}
      </tr>`;
    }).join('')}
    </tbody></table>`;
}

// =================== FEEDS ===================
function clearAnswerFeed() {
  document.getElementById('answer-feed').innerHTML = '';
  document.getElementById('answer-status').innerHTML = '';
  answerCount = 0;
}

function clearStoneFeed() {
  document.getElementById('stone-feed').innerHTML = '';
}

function addAnswerEntry(data) {
  const feed = document.getElementById('answer-feed');
  const team = appState.teams.find(t => t.name === data.teamName);
  const avatar = team?.avatar || DEFAULT_AVATAR;
  const div = document.createElement('div');
  div.style.cssText = 'padding:5px 8px;border-radius:5px;background:rgba(76,175,80,0.1);border:1px solid rgba(76,175,80,0.2);margin-bottom:4px;display:flex;align-items:center;gap:6px;font-size:13px;';
  div.innerHTML = `<img class="avatar-img" src="${escapeHTML(avatar)}" alt="Avatar"><span style="flex:1">${escapeHTML(data.teamName)}</span><span style="color:var(--text-dim);">${(data.responseTime / 1).toFixed(1)}s</span><span style="color:var(--correct)">✓</span>`;
  feed.insertBefore(div, feed.firstChild);
  answerCount++;
  document.getElementById('ans-count').textContent = answerCount;

  // Update chip
  const chip = document.querySelector(`.ans-chip[data-team="${data.teamName}"]`);
  if (chip) { chip.classList.add('answered'); chip.querySelector('.ans-dot').classList.add('answered'); }
}

function addStoneEntry(data) {
  const feed = document.getElementById('stone-feed');
  const team = appState.teams.find(t => t.name === data.teamName);
  const avatar = team?.avatar || DEFAULT_AVATAR;
  const div = document.createElement('div');
  div.style.cssText = 'padding:5px 8px;border-radius:5px;background:var(--surface2);border:1px solid var(--border);margin-bottom:4px;display:flex;gap:6px;align-items:center;font-size:13px;';
  div.innerHTML = `<img class="avatar-img" src="${escapeHTML(avatar)}" alt="Avatar"><span>${escapeHTML(data.teamName)}</span><span style="margin-left:auto"><img class="avatar-img" src="${STONE_IMAGES[data.stoneType]}" alt="Stone"> ×${data.stonesLeft} left</span>`;
  feed.insertBefore(div, feed.firstChild);
}

// =================== LOG ===================
function addLog(msg, type = '') {
  const log = document.getElementById('event-log');
  const d = document.createElement('div');
  d.className = `log-entry ${type}`;
  const t = new Date().toLocaleTimeString('en', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  d.textContent = `[${t}] ${msg}`;
  log.insertBefore(d, log.firstChild);
  if (log.children.length > 50) log.removeChild(log.lastChild);
}

// =================== SOCKET EVENTS ===================
socket.on('connect', () => {
  document.getElementById('conn-dot').style.background = 'var(--correct)';
  document.getElementById('conn-dot').style.boxShadow = '0 0 6px var(--correct)';
  if (roomCode) socket.roomCode = roomCode;
});
socket.on('disconnect', () => {
  document.getElementById('conn-dot').style.background = 'var(--wrong)';
  document.getElementById('conn-dot').style.boxShadow = '0 0 6px var(--wrong)';
  addLog('Connection lost', 'warn');
});

socket.on('teamJoined', (data) => {
  appState.teams = data.teams;
  renderTeamList();
  updateTopbar();
  addLog(`${data.name} joined`, 'good');
});

socket.on('teamDisconnected', (data) => {
  const t = appState.teams.find(t => t.name === data.name);
  if (t) t.connected = false;
  renderTeamList();
  addLog(`${data.name} disconnected`, 'warn');
});

socket.on('question:admin', (data) => {
  appState.currentAdminQ = data;
  appState.currentQuestionIndex = data.questionNum - 1;
  appState.timerDuration = data.timerDuration;
  appState.timerRemaining = data.timerDuration;
  appState.gameState = 'QUESTION_ACTIVE';
  appState.totalQuestions = data.totalQuestions || appState.totalQuestions || 5;
  updateTopbar();

  // Show question
  const q = data.question;
  const labels = ['A','B','C','D'];
  document.getElementById('curr-q-display').innerHTML = `
    <div class="curr-q-card">
      <div style="font-size:11px;color:var(--text-dim);letter-spacing:2px;margin-bottom:6px">PHASE ${data.phaseNum} · Q${data.questionNum}/${appState.totalQuestions}</div>
      ${q.image ? `<img class="curr-q-image" src="${q.image}" alt="Question image">` : ''}
      <div class="curr-q-text">${q.text}</div>
      <div class="curr-q-opts">
        ${q.options.map((opt, i) => `<div class="curr-opt ${i === q.correct ? 'is-correct' : ''}">${labels[i]}: ${opt}</div>`).join('')}
      </div>
    </div>
  `;

  // Build answer chips
  const chips = appState.teams.map(t =>
    `<div class="ans-chip" data-team="${t.name}"><div class="ans-dot"></div><span><img class="avatar-img" src="${t.avatar || DEFAULT_AVATAR}" alt="Avatar"> ${t.name}</span></div>`
  ).join('');
  document.getElementById('answer-status').innerHTML = `<div class="ans-grid">${chips}</div>`;
  document.getElementById('result-preview').textContent = 'Awaiting question end...';

  clearTimerDisplay();
  addLog(`Q${data.questionNum} started (P${data.phaseNum})`, 'good');
});

socket.on('timerTick', (data) => {
  appState.timerRemaining = data.remaining;
  const el = document.getElementById('timer-display');
  el.textContent = data.remaining;
  el.className = 'timer-big' + (data.remaining <= 5 ? ' critical' : data.remaining <= data.total * 0.4 ? ' warn' : '');
});

socket.on('questionEnded', (data) => {
  appState.gameState = 'QUESTION_ENDED';
  document.getElementById('btn-next-q').disabled = false;
  document.getElementById('btn-force-end').disabled = true;
  clearTimerDisplay();

  const labels = ['A','B','C','D'];
  const resultHtml = data.results.map(r => {
    const color = r.correct ? 'var(--correct)' : r.answer !== null ? 'var(--wrong)' : 'var(--text-dim)';
    return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border)">
      <img class="avatar-img" src="${escapeHTML(appState.teams.find(t=>t.name===r.teamName)?.avatar||DEFAULT_AVATAR)}" alt="Avatar">
      <span style="flex:1;font-size:13px">${escapeHTML(r.teamName)}</span>
      <span style="color:${color};font-size:12px">${r.isTextAnswer ? escapeHTML(r.answer || '—') : (r.answer !== null ? labels[r.answer] : '—')}</span>
      <span style="color:var(--gold);font-weight:700;font-size:14px">+${r.score}</span>
    </div>`;
  }).join('');
  document.getElementById('result-preview').innerHTML = `
    <div style="margin-bottom:8px;font-size:11px;color:var(--text-dim);letter-spacing:2px">CORRECT: <span style="color:var(--correct)">${labels[data.correctAnswer]}: ${data.correctOptionText}</span></div>
    ${resultHtml}`;
  addLog(`Question ended. Correct: ${labels[data.correctAnswer]}`, 'gold');
  renderAdminLB(data.leaderboard);

  // Sync team scores
  if (data.leaderboard) {
    data.leaderboard.forEach(lb => {
      const t = appState.teams.find(t => t.name === lb.name);
      if (t) t.totalScore = lb.totalScore;
    });
    renderTeamList();
  }
});

socket.on('answerReceived', (data) => {
  addAnswerEntry(data);
  addLog(`${data.teamName} answered (${data.responseTime}s)`, 'good');
});

socket.on('stoneUsed', (data) => {
  addStoneEntry(data);
  addLog(`${data.teamName} used ${data.stoneType} stone`, 'warn');
  const t = appState.teams.find(t => t.name === data.teamName);
  if (t && t.stones) t.stones[data.stoneType] = data.stonesLeft;
  renderTeamList();
});

socket.on('stoneGranted', (data) => {
  const t = appState.teams.find(t => t.name === data.teamName);
  if (t && data.stones) t.stones = data.stones;
  renderTeamList();
  addLog(`Granted ${data.stoneType} stone to ${data.teamName}`, 'gold');
});

socket.on('stoneSelectionLocked', () => {
  document.getElementById('btn-lock-stones').style.display = 'none';
  document.getElementById('btn-stone-select').disabled = false;
  addLog('Stone selection locked', 'gold');
});

socket.on('stoneSelected', (data) => {
  const feed = document.getElementById('stone-select-feed');
  const t = appState.teams.find(t => t.name === data.teamName);
  const avatar = t?.avatar || DEFAULT_AVATAR;
  feed.innerHTML = `<div style="padding:6px 8px;border-radius:5px;background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.3);margin-bottom:4px;font-size:13px"><img class="avatar-img" src="${avatar}" alt="Avatar"> ${data.teamName}: <img class="avatar-img" src="${STONE_IMAGES[data.stoneType]}" alt="Stone"> ${data.stoneType.toUpperCase()}</div>` + feed.innerHTML;
  addLog(`${data.teamName} selected ${data.stoneType} stone (${data.totalSelected}/${data.totalEligible})`, 'gold');
  if (t && t.stones) t.stones[data.stoneType]++;
  renderTeamList();

  if (data.totalSelected >= data.totalEligible) {
    addLog('All stones selected! Lock selection when ready.', 'gold');
  }
});

socket.on('phaseStarted', (data) => {
  appState.currentPhase = data.phase;
  appState.totalQuestions = data.totalQuestions || appState.totalQuestions || 5;
  addLog(`Phase ${data.phase} started`, 'gold');
  updateTopbar();
});

socket.on('phaseComplete', (data) => {
  appState.gameState = 'LEADERBOARD';
  addLog(`Phase ${data.phase} complete`, 'gold');
  renderAdminLB(data.leaderboard);
  updateTopbar();
  document.getElementById('btn-next-q').disabled = true;
  document.getElementById('btn-force-end').disabled = true;
  clearTimerDisplay();
});

socket.on('gameEnded', (data) => {
  appState.gameState = 'GAME_ENDED';
  addLog('GAME ENDED', 'gold');
  renderAdminLB(data.leaderboard);
  updateTopbar();
  clearTimerDisplay();
});

socket.on('roomDestroyed', () => {
  alert('Room destroyed by admin.');
  location.reload();
});

socket.on('timeExtended', (data) => {
  addLog(`+${data.additionalSeconds}s (Time Stone by ${escapeHTML(data.teamName)})`, 'gold');
});

socket.on('teamList', (data) => {
  appState.teams = data.teams;
  renderTeamList();
  updateTopbar();
});

function clearTimerDisplay() {
  document.getElementById('timer-display').textContent = '—';
  document.getElementById('timer-display').className = 'timer-big';
}