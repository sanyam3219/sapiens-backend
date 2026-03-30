require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { OpenAI } = require('openai');

const app = express();
app.use(express.json());

// CORS — origin from env for flexibility
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://sanyam3219.github.io/research-school';
app.use(cors({ origin: allowedOrigin }));

// Rate limiting — 10 requests per IP per 15 minutes
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Try again in 15 minutes.' }
});
app.use('/api/', limiter);

// OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Input validation helper
function validateTopic(topic) {
    if (!topic || typeof topic !== 'string') return 'Topic is required.';
    const trimmed = topic.trim();
    if (trimmed.length === 0) return 'Topic cannot be empty.';
    if (trimmed.length > 200) return 'Topic must be under 200 characters.';
    return null; // null = valid
}

// Health check endpoint — keeps Render free tier warm, confirms uptime
app.get('/health', (req, res) => {
    res.json({ status: 'online', timestamp: new Date().toISOString() });
});

app.post('/api/generate', async (req, res) => {
    const { topic } = req.body;

    // Validate input before touching the API
    const validationError = validateTopic(topic);
    if (validationError) {
        return res.status(400).json({ error: validationError });
    }

    const cleanTopic = topic.trim().slice(0, 200);

    try {
        // AbortController for 25s timeout — prevents hanging on slow OpenAI responses
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000);

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: 'You are an elite scientific curriculum generator for Sapiens Research Labs. The user will give you a topic. Provide a sharp, deep, 4-step learning path. Use no fluff. Be rigorous.'
                },
                {
                    role: 'user',
                    content: cleanTopic
                }
            ],
            max_tokens: 800,       // Cap cost per request
            temperature: 0.7,
        }, { signal: controller.signal });

        clearTimeout(timeout);

        const result = completion.choices[0]?.message?.content;
        if (!result) throw new Error('Empty response from model.');

        res.json({ result });

    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('[Timeout] OpenAI took too long.');
            return res.status(504).json({ error: 'Request timed out. Please try again.' });
        }
        console.error('[OpenAI Error]', error.message);
        res.status(500).json({ error: 'System failure. Please try again.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sapiens backend active on port ${PORT}`));
