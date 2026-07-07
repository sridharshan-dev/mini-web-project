const fs = require('fs');
const path = require('path');

const DEFAULT_QUESTIONS = {
  phases: [[], [], [], [], []],
  backupQuestions: [],
};

const QUESTIONS_FILE = path.join(__dirname, '../data', 'questions.json');

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
  // Ensure the directory exists
  fs.mkdirSync(path.join(__dirname, '../data'), { recursive: true });
  saveQuestionsToFile(questionsStore);
} catch (err) {
  console.warn('Failed to write questions file:', err.message);
}

function getTotalQuestionsForPhase(phaseNum) {
  return phaseNum === 5 ? 3 : 5;
}

module.exports = {
  loadQuestionsFromFile,
  saveQuestionsToFile,
  questionsStore,
  getTotalQuestionsForPhase,
};
