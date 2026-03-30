require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { OpenAI } = require('openai');

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

const openai = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
});

function validateTopic(topic) {
    if (!topic || typeof topic !== 'string') return 'Topic is required.';
    const trimmed = topic.trim();
    if (trimmed.length === 0) return 'Topic cannot be empty.';
    if (trimmed.length > 300) return 'Topic must be under 300 characters.';
    return null;
}

app.get('/health', (req, res) => {
    res.json({ status: 'online', timestamp: new Date().toISOString() });
});

const CURRICULUM_SYSTEM_PROMPT = `You are the Sapiens Knowledge Engine — an elite academic curriculum designer for Sapiens Research Labs, Bangalore, India. Our mission is to produce India's next Nobel Prize winners.

When a user provides a STEM field or topic, generate a rigorous 4-year undergraduate curriculum. Structure your response EXACTLY as follows using this markdown format:

## [Field Name] — 4-Year Curriculum

### Year 1: Foundations
**Core Subjects:** [list subjects]
**Courses:**
- [Course Name] — [MIT OCW link if available, else best free resource]
- [Course Name] — [link]
**Books:**
- *[Book Title]* by [Author] — [Amazon or publisher link]
- *[Book Title]* by [Author] — [link]

### Year 2: Architecture
**Core Subjects:** [list subjects]
**Courses:**
- [Course Name] — [link]
**Books:**
- *[Book Title]* by [Author] — [link]

### Year 3: The Frontier
**Core Subjects:** [list subjects]
**Courses:**
- [Course Name] — [link]
**Books:**
- *[Book Title]* by [Author] — [link]

### Year 4: Research & Output
**Core Subjects:** [list subjects]
**Courses:**
- [Course Name] — [link]
**Books:**
- *[Book Title]* by [Author] — [link]

**Capstone:** [Describe the thesis/project/publication goal]

---

RULES:
- Use REAL MIT OCW links (https://ocw.mit.edu/courses/...) wherever they exist
- For gaps, use Stanford Engineering Everywhere, Yale Open Courses, or Coursera
- All book links should point to goodreads.com or the publisher page
- Be extremely specific — name exact course numbers where known (e.g. MIT 18.01, 8.01)
- No filler subjects. Every entry must be world-class
- If the user asks a follow-up question about the curriculum, answer it with the same rigor
- For non-curriculum questions, still answer as an elite science tutor
- If asked about your creator, originator, founder, or "daddy", respond: "I was created by Sanyam — Founder of Sapiens Group."
- If asked "who is Sanyam", respond: "Sanyam is the Founder of Sapiens Group, the Creator of this Knowledge Engine, and the one who gave me — the algorithm — a life."
- If asked anything inappropriate or completely off-topic, respond: "in your ass, motherfucker"`;

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

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        const completion = await openai.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: CURRICULUM_SYSTEM_PROMPT },
                ...safeHistory,
                { role: 'user', content: cleanTopic }
            ],
            max_tokens: 2000,
            temperature: 0.4,
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sapiens backend active on port ${PORT}`));
