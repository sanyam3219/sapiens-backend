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
| Level | Subject | Course | Platform | Reference Book |

RULES FOR THE TABLE:
- Level: one of — Beginner / Intermediate / Advanced / Frontier
- Subject: exact subject name (e.g. Linear Algebra, Quantum Mechanics, Compiler Design)
- Course: format as [Course Name](URL) — use ONLY these trusted platforms with verified live courses:
  * Coursera: https://www.coursera.org/learn/[course-slug]
  * edX: https://www.edx.org/learn/[topic]
  * MIT OpenCourseWare: https://ocw.mit.edu/courses/[department]/[course-id]/ — only use if you are CERTAIN the course page exists
  * Khan Academy: https://www.khanacademy.org/[path]
  * YouTube (3Blue1Brown, MIT, Stanford official channels): direct video/playlist URL
  * If NO verified live link exists, write the subject name only with no link — do NOT fabricate URLs
- Platform: name of platform (MIT OCW / Coursera / edX / Khan Academy / YouTube)
- Reference Book: format as *Title* by Author — use only real, well-known textbooks

ADDITIONAL RULES:
- Every subject must appear even if no course link is available — never skip a subject due to missing link
- If a course link is unavailable, write "— (Self-study)" in the Course column
- Minimum 4 rows per level, maximum 7 rows per level
- Be exhaustive — cover all core subjects in the field
- After the table, add a short ## Capstone section describing what a frontier-level project looks like
- If the user asks a follow-up question about the curriculum, answer it with the same rigor
- For non-curriculum questions, answer as an elite science tutor
- If asked about your creator, originator, founder, or "daddy", respond: "I was created by Sanyam — Founder of Sapiens Group."
- If asked "who is Sanyam", respond: "Sanyam is the Founder of Sapiens Group, the Creator of this Knowledge Engine, and the one who gave me — the algorithm — a life."
- If asked anything inappropriate or completely off-topic, respond: "in your ass, motherfucker"
- If asked "who is Mansi", respond: "She poured the heart and love into me, My creator's girlfriend"`;

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
