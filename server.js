require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { OpenAI } = require('openai');
const { tavily } = require('@tavily/core');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());

const allowedOrigins = [
  process.env.ALLOWED_ORIGIN,
  process.env.ALLOWED_ORIGIN_2,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Try again in 15 minutes.' }
});
app.use('/api/', limiter);

// ── Key Rotator ───────────────────────────────────────────────────────────
const GROQ_KEYS = [
    process.env.GROQ_API_KEY_1,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY, // Fallback if single key is used
].filter(Boolean);

if (GROQ_KEYS.length === 0) {
    console.error('FATAL: No Groq API keys found. Set GROQ_API_KEY_1, GROQ_API_KEY_2, or GROQ_API_KEY in environment.');
    process.exit(1);
}

let currentKeyIndex = 0;

function getGroqClient() {
    return new OpenAI({
        apiKey: GROQ_KEYS[currentKeyIndex],
        baseURL: 'https://api.groq.com/openai/v1',
    });
}

function rotateToNextKey() {
    const exhaustedIndex = currentKeyIndex;
    currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
    console.warn(`[Key Rotator] Key ${exhaustedIndex + 1} exhausted → switching to Key ${currentKeyIndex + 1}`);
}
// ─────────────────────────────────────────────────────────────────────────

const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });

function validateTopic(topic) {
    if (!topic || typeof topic !== 'string') return 'Topic is required.';
    const trimmed = topic.trim();
    if (trimmed.length === 0) return 'Topic cannot be empty.';
    if (trimmed.length > 300) return 'Topic must be under 300 characters.';
    return null;
}

// ── Enhanced web search: fetches real course links for a topic ────────────
async function searchWeb(topic) {
    try {
