# Trivia Arena

A real-time, room-based multiplayer quiz game with a dedicated admin control panel.
Built with **Node.js + Express + Socket.IO** and a themed client UI for players.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Core Features](#core-features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [How It Works (Game Flow)](#how-it-works-game-flow)
- [Power-Up Mechanics](#power-up-mechanics)
- [Scoring System](#scoring-system)
- [Question System](#question-system)
- [Setup & Run](#setup--run)
- [Usage Guide](#usage-guide)
- [Socket Event Reference](#socket-event-reference)
- [State Model](#state-model)
- [Data Persistence](#data-persistence)
- [Validation & Rules](#validation--rules)
- [Known Notes](#known-notes)
- [Troubleshooting](#troubleshooting)
- [Future Improvements](#future-improvements)

---

## Project Overview

This project is an **real-time competitive quiz platform** where:

- One host uses the **Admin Panel** to create/reconnect a room and control game progression.
- Multiple teams join from the **Player UI** using a room code, team name, and avatar.
- Questions are asked in phases, scored in real time, and ranked on a live leaderboard.
- Power-Ups add strategy and variation to gameplay.

The application is designed for classrooms, events, and friendly team competitions on local Wi-Fi or LAN.

---

## Core Features

- Room-based multiplayer sessions with 6-character room codes.
- Admin reconnection support to recover control after refresh/disconnect.
- Five quiz phases with configurable questions and per-question timers.
- Real-time question delivery, timer ticks, answer locking, and result broadcast.
- Live leaderboard with tie-break using total response time.
- Power-Up gameplay (Power, Reality, Space).
- In-browser question editor from admin panel (including backup question set).
- Team connection status tracking and kick controls.
- Support for both:
	- Multiple-choice answers
	- Text answers (`textAnswer: true`)
- Optional question media/link mode (`image`, `externalUrl`, `linkFriendly`).

---

## Tech Stack

- **Runtime:** Node.js
- **Server:** Express 4
- **Realtime:** Socket.IO 4
- **Frontend:** HTML, CSS, Vanilla JavaScript
- **Data store:** JSON file (`public/questions.json`)

---

## Project Structure & File Details

```text
trivia-arena/
├── package.json              # scripts + dependencies
├── README.md
├── backend/
│   ├── server.js                 # Entry point: Express + Socket.IO server setup and initialization
│   ├── data/
│   │   └── questions.json        # Persistent storage for quiz questions, phases, and backup pool
│   └── src/
│       ├── gameLogic.js          # Core game logic: scoring calculations, phase state, time checks
│       ├── questionsManager.js   # Interacts with questions.json to read, update, and save questions
│       ├── roomManager.js        # Manages in-memory state of active rooms, connected teams, and admin sessions
│       └── socketHandler.js      # Socket.IO event router: handles client connections, answering, and phase triggers
└── frontend/
    ├── index.html                # Player client: UI for teams to join, wait, answer questions, and view leaderboards
    ├── admin.html                # Admin control panel: UI for the host to manage the game flow
    ├── css/
    │   ├── style.css             # Main stylesheet for the player interface
    │   └── admin.css             # Stylesheet for the admin interface
    └── js/
        ├── main.js               # Client-side logic for the player UI (joining room, submitting answers, using stones)
        ├── admin.js              # Client-side logic for the admin panel (creating room, triggering questions, kicking teams)
        ├── bg.js                 # Dynamic space-black background canvas generator and interactive logic
        └── bg-physics.js         # Particle physics, animations, and glowing shockwave rendering for the background
```

### Backend Functionality
- **`backend/server.js`**: Initializes the Express server and Socket.IO. It sets up the static file serving for the frontend and delegates socket connection handling to `socketHandler.js`.
- **`backend/src/socketHandler.js`**: Listens to all incoming socket events (from both players and the admin) and routes them to the appropriate functions in `roomManager.js` and `gameLogic.js`.
- **`backend/src/roomManager.js`**: Maintains the state of all active game rooms. This includes tracking connected teams, their scores, their power-ups, and the admin's connection status.
- **`backend/src/gameLogic.js`**: Handles the core rules of the game. It calculates scores based on response time, applies Power-Up multipliers (like the Power Stone), and determines leaderboard rankings.
- **`backend/src/questionsManager.js`**: A utility module that reads from and writes to `backend/data/questions.json`. It provides the active questions for the current phase and serves backup questions for the Space Stone.

### Frontend Functionality
- **Player Interface (`frontend/index.html` & `frontend/js/main.js`)**: Provides a responsive interface for players. It handles joining a room, displaying the current question, capturing the user's answer (multiple choice or text), and rendering the post-game leaderboard.
- **Admin Interface (`frontend/admin.html` & `frontend/js/admin.js`)**: The command center for the host. It provides controls to start phases, reveal questions, lock answers, grant Power-Ups, and monitor team connections. It also includes a built-in question editor.
- **Dynamic Background (`frontend/js/bg.js` & `frontend/js/bg-physics.js`)**: Renders a visually immersive, interactive canvas background that responds to mouse movements and game events (like shockwaves when an answer is locked).

---

## System Workflow (Game Flow)

1. **Room Creation:**
   - The Admin opens `/admin.html` and clicks "CREATE NEW ROOM".
   - `admin.js` emits `admin:createRoom` to the server.
   - `socketHandler.js` receives the event and calls `roomManager.js` to initialize a new room state.
   - The server replies with a unique 6-character room code.

2. **Player Joining:**
   - Players open `/` (`index.html`), enter the room code, a team name, and select an avatar.
   - `main.js` emits `player:join` with these details.
   - The server validates the room code and adds the team to the room in `roomManager.js`.
   - The server broadcasts `teamJoined` to update the Admin panel.

3. **Starting the Game & Phases:**
   - The Admin clicks to start Phase 1. `admin.js` emits `admin:startPhase`.
   - `gameLogic.js` updates the room state to `PHASE_ACTIVE` and loads the Phase 1 questions via `questionsManager.js`.
   - The server broadcasts `phaseStarted` to all players, transitioning their UI.

4. **Asking Questions:**
   - The Admin clicks "NEXT QUESTION". `admin.js` emits `admin:nextQuestion`.
   - The server fetches the next question, sets the room state to `QUESTION_ACTIVE`, and starts a server-side timer.
   - The server emits `question` to players and `question:admin` to the host (which includes the correct answer).

5. **Answering & Scoring:**
   - Players select an option or type an answer. `main.js` emits `player:submitAnswer`.
   - The server records the answer and the exact timestamp.
   - When the timer expires (or the Admin forces it to end), `gameLogic.js` processes all answers.
   - Scores are calculated based on response speed and active Power-Ups.
   - The server emits `questionResult` to all clients, showing who was correct and updating the live scores.

6. **Power-Ups:**
   - Top-performing teams can be granted Power-Ups by the Admin.
   - Players activate stones via their UI (`player:useStone`).
   - For example, if a player uses the Space Stone, `socketHandler.js` asks `questionsManager.js` for a backup question and sends it directly to that specific player.

7. **End of Game:**
   - After all phases, the Admin clicks "END GAME".
   - The server transitions to `GAME_ENDED` and broadcasts `showLeaderboard`.
   - Both Admin and Player UIs display the final rankings, calculated by `gameLogic.js`.

---

## Power-Up Mechanics

Stones are granted by admin and consumed by players per use.

### 1) Power Stone (`power`)
- Can be activated only in the **first 10 seconds** of a question.
- Cannot be activated after answering.
- Effect: doubles earned score for a correct answer.

### 2) Reality Stone (`reality`)
- Removes two wrong options for current question (client-side guidance).
- Only works on MCQ options.

### 3) Space Stone (`space`)
- Replaces team’s current question with a random unused backup question.
- Cannot be used after answering.
- Backup picks are tracked to avoid reuse until pool is exhausted.

### Stone selection phase
- Triggered by admin (`admin:triggerStoneSelection`).
- Eligibility defaults to top 3 with tie handling at rank 3.
- In current implementation, selection is **admin-controlled**; player self-selection is disabled.

---

## Scoring System

For a correct answer:

```text
remaining = max(0, totalTime - responseTime)
baseScore = round(100 * (remaining / totalTime))
finalScore = powerStoneActive ? baseScore * 2 : baseScore
```

- Wrong or missing answer => `0` points.
- Per-team totals tracked as:
	- `totalScore`
	- `phaseScores` (array of 5)
	- `totalResponseTime` (used as tie-breaker)

Leaderboard sort order:
1. Higher `totalScore`
2. Lower `totalResponseTime`

---

## Question System

Questions are loaded from `public/questions.json` at startup and rewritten to disk.

Top-level shape:

```json
{
	"phases": [ [/* phase1 questions */], [/* phase2 */], [/* ... */], [/* phase5 */] ],
	"backupQuestions": [ /* used by Space Stone */ ]
}
```

### Question object fields

Common fields:
- `id` (string)
- `text` (string)
- `options` (array of 4 strings)
- `correct` (number index: 0-3)
- `timer` (seconds)
- `image` (optional string URL/data URL)

Optional behavior fields:
- `textAnswer` (boolean): if true, answer is text-based.
- `correctText` (string): expected answer for text-based checking (normalized lowercase/trim).
- `linkFriendly` (boolean): indicates link-driven question UI behavior.
- `externalUrl` (string): website URL shown for research-style questions.

### Question counts by phase
- Phase 1-4: 5 questions each
- Phase 5: 3 questions

---

## Setup & Run

### Prerequisites
- Node.js 18+ recommended
- npm

### Install

```bash
npm install
```

### Start server

```bash
npm start
```

### Development mode

```bash
npm run dev
```

Server defaults:
- `PORT=3000` (override with env var)
- Binds to `0.0.0.0` for LAN accessibility

---

## Usage Guide

### Admin

1. Open `http://localhost:3000/admin.html`
2. Click **Create New Room**
3. Share room code with teams
4. Start phases and push questions
5. Monitor answer feed/timer/status
6. Trigger leaderboard/stone actions/end game
7. Use Questions tab to edit and save question data

### Player

1. Open `http://localhost:3000/`
2. Enter room code, team name, and avatar
3. Wait in lobby until phase starts
4. Answer each question before timer ends
5. Use available stones strategically
6. Track score and leaderboard updates

---

## Socket Event Reference

### Admin -> Server
- `admin:createRoom`
- `admin:reconnect`
- `admin:getQuestions`
- `admin:updateQuestions`
- `admin:updateBackup`
- `admin:startPhase`
- `admin:nextQuestion`
- `admin:forceEndQuestion`
- `admin:triggerStoneSelection`
- `admin:grantStone`
- `admin:lockStoneSelection`
- `admin:showLeaderboard`
- `admin:endGame`
- `admin:kickTeam`

### Player -> Server
- `player:join`
- `player:submitAnswer`
- `player:useStone`
- `player:selectStone` (currently rejected; admin-controlled flow)

### Server -> Clients (selected)
- `teamJoined`, `teamDisconnected`, `teamList`
- `phaseStarted`, `phaseComplete`, `showLeaderboard`, `gameEnded`
- `question`, `question:admin`, `timerTick`, `questionEnded`, `questionResult`
- `answerReceived`
- `stoneSelection`, `stoneSelectionLocked`, `stoneGranted`, `stoneUsed`, `stonesUpdated`, `realityStoneEffect`
- `kicked`

---

## State Model

Room game states used by server logic:

- `WAITING_ROOM`
- `PHASE_ACTIVE`
- `QUESTION_ACTIVE`
- `QUESTION_ENDED`
- `STONE_SELECTION`
- `LEADERBOARD`
- `GAME_ENDED`

Each room keeps:
- admin socket id
- team map + team stats
- phase/question indices
- timer state
- current question sets (copied from persistent store)
- backup usage history

---

## Data Persistence

- Questions are loaded from `public/questions.json` on boot.
- Admin updates to phase/backup questions are persisted immediately.
- Room runtime state is in-memory only (lost when server restarts).

---

## Validation & Rules

- Team joins are blocked once game has started (except reconnecting known team names).
- Answer submission allowed only during `QUESTION_ACTIVE`.
- MCQ answers must be numeric indexes `0-3`.
- Text answers are normalized via trim + lowercase before comparison.
- Stone use is available only from phase 2 onward.
- Duplicate stone use for same stone in one question is blocked.

---

## Known Notes

- Some sample questions in `public/questions.json` currently mix `textAnswer` with option-based answers and placeholder `correctText`; update before production play.
- Backup question IDs include duplicates in sample data (`bq2`, `bq3` repeated). Functionality still works, but unique IDs are recommended.
- Server startup log prints a fixed network IP string in console output; this may not match actual host IP on every machine.

---

## Troubleshooting

### Port already in use
- Change port:

```bash
set PORT=4000 && npm start
```

### Players cannot connect over LAN
- Ensure host firewall allows Node.js/port 3000.
- Use host machine’s real local IP, not `localhost`, on player devices.
- Confirm all devices are on same network.

### Questions not saving
- Verify write permission for `public/questions.json`.
- Check server logs for `Failed to save questions` warnings.

### Admin lost connection
- Use Admin reconnect flow with existing room code.

---

## Future Improvements

- Persist room/game sessions in a database (Redis/Mongo/Postgres).
- Add authentication for admin actions.
- Add import/export for question banks.
- Add unit/integration tests for scoring and room state transitions.
- Add dynamic network URL detection in startup logs.