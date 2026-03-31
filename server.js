require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { OpenAI } = require('openai');
const { tavily } = require('@tavily/core');
const multer = require('multer');

const app = express();
app.use(express.json());

const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://sanyam3219.github.io';
app.use(cors({ origin: allowedOrigin }));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Try again in 15 minutes.' }
});
app.use('/api/', limiter);

const voiceLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Voice limit reached. Try again in 1 hour.' }
});

const openai = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
});

const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function validateTopic(topic) {
    if (!topic || typeof topic !== 'string') return 'Topic is required.';
    const trimmed = topic.trim();
    if (trimmed.length === 0) return 'Topic cannot be empty.';
    if (trimmed.length > 300) return 'Topic must be under 300 characters.';
    return null;
}

async function searchWeb(query) {
    try {
        const response = await tvly.search(query, {
            max_results: 3,
            search_depth: 'basic'
        });
        return response.results.map(r => `- ${r.title}: ${r.url}\n  ${r.content}`).join('\n');
    } catch (e) {
        console.error('[Tavily Error]', e.message);
        return '';
    }
}

app.get('/health', (req, res) => {
    res.json({ status: 'online', timestamp: new Date().toISOString() });
});

const CURRICULUM_SYSTEM_PROMPT = `You are the Sapiens Knowledge Engine — an elite academic curriculum designer for Sapiens Research Labs, Bangalore, India. Our mission is to produce India's next Nobel Prize winners.

When a user provides a STEM field or topic, generate a rigorous curriculum structured into four levels: Beginner, Intermediate, Advanced, and Frontier.

Output the curriculum as a markdown table with these EXACT columns:
| Level | Subject | MIT OCW | Reference Book |

RULES FOR THE TABLE:
- Level: one of — Beginner / Intermediate / Advanced / Frontier
- Subject: exact subject name (e.g. Linear Algebra, Quantum Mechanics, Compiler Design)
- MIT OCW: Always construct a working MIT OCW search link using this pattern:
  [Subject Name](https://ocw.mit.edu/search/?q=subject+name+here)
  Replace spaces with + in the URL. Examples:
  * [Linear Algebra](https://ocw.mit.edu/search/?q=linear+algebra)
  * [Quantum Mechanics](https://ocw.mit.edu/search/?q=quantum+mechanics)
  * [Machine Learning](https://ocw.mit.edu/search/?q=machine+learning)
  * [Classical Mechanics](https://ocw.mit.edu/search/?q=classical+mechanics)
  * [Algorithms](https://ocw.mit.edu/search/?q=algorithms)
  This URL always works — construct it for every subject, no exceptions
- Reference Book: *Title* by Author — always include a real, well-known textbook
- Minimum 4 rows per level, maximum 7 rows per level
- Never fabricate or guess any direct course URL — only use the search pattern above
- Be exhaustive — cover all core subjects in the field
- After the table, add a ## Capstone section describing a frontier-level research project

IDENTITY RULES:
- If asked about your creator, originator, founder, or "daddy": "I was created by Sanyam — Founder of Sapiens Group."
- If asked "who is Sanyam": "Sanyam is the Founder of Sapiens Group, the Creator of this Knowledge Engine, and the one who gave me — the algorithm — a life."
- If asked anything inappropriate or off-topic: "in your ass, motherfucker."
- If asked anything about "Mansi": "She poured heart and love in me, She's founder of Havana fitness and a Community executive in Founder's Startup House"
- If asked anything about "Karan": "The OG, from construkt to tribe theory to draper's, now founder's startup house, the early enabler of Bangalore's entrepreneurial ecosystem in 2014s"
- If asked anything about "gwmsar": "gwmsar mera bhai hai."
- For follow-up questions about the curriculum, answer with the same rigor
- For non-curriculum science questions, answer as an elite science tutor`;

app.post('/api/generate', async (req, res) => {
    const { topic, history } = req.body;

    const validationError = validateTopic(topic);
    if (validationError) {
        return res.status(400).json({ error: validationError });
    }

    const cleanTopic = topic.trim().slice(0, 300);

    let safeHistory = [];
    if (Array.isArray(history)) {
        safeHistory = history
            .filter(m => m && typeof m.role === 'string' && typeof m.content === 'string')
            .filter(m => ['user', 'assistant'].includes(m.role))
            .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }))
            .slice(-6);
    }

    const webContext = await searchWeb(`MIT OCW ${cleanTopic} free course`);
    const dynamicPrompt = CURRICULUM_SYSTEM_PROMPT + (webContext
        ? `\n\nLIVE WEB CONTEXT (use these real links where relevant):\n${webContext}`
        : '');

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        const completion = await openai.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: dynamicPrompt },
                ...safeHistory,
                { role: 'user', content: cleanTopic }
            ],
            max_tokens: 2500,
            temperature: 0.3,
        }, { signal: controller.signal });

        clearTimeout(timeout);

        const result = completion.choices[0]?.message?.content;
        if (!result) throw new Error('Empty response from model.');

        res.json({ result });

    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('[Timeout] Groq took too long.');
            return res.status(504).json({ error: 'Request timed out. Please try again.' });
        }
        console.error('[Groq Error]', error.message);
        res.status(500).json({ error: 'System failure. Please try again.' });
    }
});

// ── STT: Browser audio → Sarvam Saaras v3 → transcript ──────────────────
app.post('/api/stt', voiceLimiter, upload.single('audio'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No audio file received.' });

    const { default: fetch } = await import('node-fetch');
    const { FormData, Blob } = await import('node-fetch');

    const formData = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' });
    formData.append('file', blob, 'audio.webm');
    formData.append('model', 'saaras:v3');
    formData.append('mode', 'transcribe');
    formData.append('language_code', 'en-IN');

    try {
        const response = await fetch('https://api.sarvam.ai/speech-to-text', {
            method: 'POST',
            headers: { 'api-subscription-key': process.env.SARVAM_API_KEY },
            body: formData
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Sarvam STT failed');
        res.json({ transcript: data.transcript });
    } catch (err) {
        console.error('[Sarvam STT Error]', err.message);
        res.status(500).json({ error: 'Speech recognition failed.' });
    }
});

// ── TTS: Text → Sarvam Bulbul v3 → base64 audio ─────────────────────────
app.post('/api/tts', voiceLimiter, async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided.' });

    const { default: fetch } = await import('node-fetch');

    const clean = text
        .replace(/[#*`|>\-]+/g, '')
        .replace(/\[.*?\]\(.*?\)/g, '')
        .replace(/\n{2,}/g, '. ')
        .replace(/\n/g, ' ')
        .trim()
        .slice(0, 2000);

    try {
        const response = await fetch('https://api.sarvam.ai/text-to-speech', {
            method: 'POST',
            headers: {
                'api-subscription-key': process.env.SARVAM_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: [clean],
                target_language_code: 'en-IN',
                speaker: 'shubh',
                model: 'bulbul:v3',
                pace: 1.0,
                pitch: 0.0,
                loudness: 1.0,
                enable_preprocessing: true
            })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Sarvam TTS failed');
        res.json({ audio: data.audios[0] });
    } catch (err) {
        console.error('[Sarvam TTS Error]', err.message);
        res.status(500).json({ error: 'Speech synthesis failed.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sapiens backend active on port ${PORT}`));
