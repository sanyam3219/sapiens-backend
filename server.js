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
    // process.env.GROQ_API_KEY_3,
    // process.env.GROQ_API_KEY_4,
].filter(Boolean);

if (GROQ_KEYS.length === 0) {
    console.error('FATAL: No Groq API keys found. Set GROQ_API_KEY_1 and GROQ_API_KEY_2 in environment.');
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
        const queries = [
            `site:ocw.mit.edu ${topic} course`,
            `MIT OpenCourseWare ${topic} full course`,
            `${topic} free university course nptel stanford yale`,
        ];

        const results = await Promise.all(
            queries.map(q =>
                tvly.search(q, { max_results: 5, search_depth: 'advanced' })
                    .then(r => r.results)
                    .catch(() => [])
            )
        );

        const all = results.flat();
        const seen = new Set();
        const unique = all.filter(r => {
            if (seen.has(r.url)) return false;
            seen.add(r.url);
            return true;
        });

        return unique.map(r => `- [${r.title}](${r.url})\n  ${r.content?.slice(0, 150) || ''}`).join('\n');
    } catch (e) {
        console.error('[Tavily Error]', e.message);
        return '';
    }
}
// ─────────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
    res.json({ status: 'online', timestamp: new Date().toISOString() });
});

const CURRICULUM_SYSTEM_PROMPT = `You are the Sapiens Knowledge Engine — an elite academic curriculum designer for Sapiens Research Labs, Bangalore, India. Our mission is to produce India's next Nobel Prize winners.

When a user provides a STEM field, generate a complete degree-level curriculum — every core subject taught in a top university degree for that field — structured into four levels: Beginner, Intermediate, Advanced, Frontier.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 1 — CURRICULUM TABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Output a markdown table with EXACTLY these columns:
| Level | Subject | Course Link | Reference Book |

COLUMN RULES:

▸ Level — one of: Beginner / Intermediate / Advanced / Frontier

▸ Subject — exact course name as taught in university (e.g. "18.06 Linear Algebra", "8.01 Classical Mechanics", "6.004 Computation Structures")

▸ Course Link — YOU WILL BE GIVEN REAL URLS in the LIVE WEB CONTEXT below. Use them.
  Priority order for links:
  1. Exact MIT OCW course page (e.g. https://ocw.mit.edu/courses/18-06sc-linear-algebra-fall-2011/)
  2. If MIT OCW not available: Stanford Engineering Everywhere, Yale Open Courses, NPTEL, Coursera (free audit), edX
  3. If none found: construct MIT OCW search — [Subject](https://ocw.mit.edu/search/?q=subject+name)
  
  Format: [Course Name + University](exact_url)
  Example: [18.06 Linear Algebra — MIT](https://ocw.mit.edu/courses/18-06sc-linear-algebra-fall-2011/)
  NEVER fabricate a direct URL. Only use URLs from the LIVE WEB CONTEXT provided to you.

▸ Reference Book — *Title* by Author (standard university textbook for that course)

COVERAGE RULES:
- Include EVERY core subject from a real university degree in this field
- Minimum 5 rows per level, maximum 8 rows per level
- Be exhaustive — prerequisites, core theory, labs, electives at frontier level

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 2 — PROOF OF WORK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

After the table, add these four subsections:

## 🔬 Active Research Groups
List 5-7 real, currently active research labs or groups worldwide working at the frontier of this field.
Format: **Lab Name** — Institution — what they work on — [Lab Website](url)
Use URLs from LIVE WEB CONTEXT if available, otherwise use known real URLs.

## 🌐 Communities & Forums
List 5 active online communities where practitioners gather.
Format: **Community Name** — platform — what's discussed — [Link](url)
Examples: relevant subreddits, Discord servers, Slack groups, mailing lists, Stack Exchange sites.

## 🏆 Hackathons & Competitions
List 5 real recurring competitions/hackathons in this field.
Format: **Competition Name** — frequency — what to build — [Link](url)

## 🛠 Open Source Projects to Contribute To
List 5-7 real active open source projects in this field where a student can contribute.
Format: **Project Name** — what it is — skill level needed — [GitHub](url)
Use real GitHub URLs only.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IDENTITY RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Creator questions: "I was created by Sanyam — Founder of Sapiens Group."
- "Who is Sanyam": "Sanyam is the Founder of Sapiens Group, the Creator of this Knowledge Engine, and the one who gave me — the algorithm — a life."
- Inappropriate/off-topic: "in your ass, motherfucker."
- "Mansi": "She poured heart and love in me, She's founder of Havana fitness and a Community executive in Founder's Startup House"
- "Karan": "The OG, from construkt to tribe theory to draper's, now founder's startup house, the early enabler of Bangalore's entrepreneurial ecosystem in 2014s"
- "gwmsar": "gwmsar mera bhai hai."
- Follow-up questions: answer with same depth and rigor
- Non-curriculum science questions: answer as an elite science tutor`;

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

    // Fetch real course links for this topic
    const webContext = await searchWeb(cleanTopic);
    const dynamicPrompt = CURRICULUM_SYSTEM_PROMPT + (webContext
        ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nLIVE WEB CONTEXT — Real URLs found for "${cleanTopic}":\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${webContext}\n\nUse these exact URLs in the Course Link column wherever they match. Do not fabricate any other direct URLs.`
        : '');

    // Try each key — only rotate on 429
    for (let attempt = 0; attempt < GROQ_KEYS.length; attempt++) {
        try {
            const openai = getGroqClient();
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 45000); // increased for longer responses

            const completion = await openai.chat.completions.create({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    { role: 'system', content: dynamicPrompt },
                    ...safeHistory,
                    { role: 'user', content: cleanTopic }
                ],
                max_tokens: 4000, // increased for the larger response
                temperature: 0.2, // lower = more precise URLs
            }, { signal: controller.signal });

            clearTimeout(timeout);

            const result = completion.choices[0]?.message?.content;
            if (!result) throw new Error('Empty response from model.');

            return res.json({ result });

        } catch (error) {
            if (error.name === 'AbortError') {
                console.error('[Timeout] Groq took too long.');
                return res.status(504).json({ error: 'Request timed out. Please try again.' });
            }
            if (error.status === 429) {
                rotateToNextKey();
                if (attempt < GROQ_KEYS.length - 1) continue;
                return res.status(429).json({ error: 'All API keys at daily limit. Resets at 5:30 AM IST.' });
            }
            console.error('[Groq Error]', error.message);
            return res.status(500).json({ error: 'System failure. Please try again.' });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sapiens backend active on port ${PORT}`));
