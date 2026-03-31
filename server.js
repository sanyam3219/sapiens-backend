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
- If asked anything inappropriate or off-topic: "That is outside my domain. I am here to build scientists."
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sapiens backend active on port ${PORT}`));
