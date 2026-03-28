require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(express.json());

// SECURITY: Only allow requests from your specific GitHub Pages URL
app.use(cors({
    origin: 'https://sanyam3219.github.io' 
}));

// Initialize OpenAI using the hidden environment variable
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, 
});

app.post('/api/generate', async (req, res) => {
    try {
        const { topic } = req.body;
        
        // The Prompt System for your Agent
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini", // Fast and cost-effective
            messages: [
                { 
                    role: "system", 
                    content: "You are an elite scientific curriculum generator for Sapiens Research Labs. The user will give you a topic. Provide a sharp, deep, 4-step learning path. Use no fluff. Be rigorous." 
                },
                { 
                    role: "user", 
                    content: topic 
                }
            ]
        });

        res.json({ result: completion.choices[0].message.content });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "System failure. Try again." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server active on port ${PORT}`));
