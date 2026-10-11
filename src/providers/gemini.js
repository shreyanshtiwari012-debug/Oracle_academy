'use strict';

// Answer engine backed by the Gemini API (BYO key). One request per question,
// since the assessment shows one question at a time.

const { extractJson, normalizeLetters, buildPrompt } = require('./util');

const DEFAULT_MODEL = process.env.ORACLE_QUIZ_GEMINI_MODEL || 'gemini-3.1-flash-lite';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

async function answerOne(opts) {
  const apiKey = opts.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY (or GOOGLE_API_KEY) is not set.');
  const initialModel = opts.model || DEFAULT_MODEL;

  const candidateModels = [
    initialModel,
    'gemini-3.1-flash-lite',
    'gemini-3.6-flash',
    'gemini-3.7-flash',
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite'
  ].filter((m, i, arr) => arr.indexOf(m) === i);

  const body = {
    contents: [{ parts: [{ text: buildPrompt(opts) }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 256,
      responseMimeType: 'application/json'
    }
  };

  let lastErr = null;
  for (const model of candidateModels) {
    const url = `${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (res.status === 429) {
          const text = await res.text().catch(() => '');
          lastErr = new Error(`Gemini ${model} 429: ${text.slice(0, 200)}`);
          break; // Fall through immediately to next candidate model with available quota!
        }
        if (res.status === 503) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          lastErr = new Error(`Gemini API error ${res.status}: ${text.slice(0, 300)}`);
          break; // Try next candidate model
        }

        const json = await res.json();
        const text =
          json &&
          json.candidates &&
          json.candidates[0] &&
          json.candidates[0].content &&
          json.candidates[0].content.parts &&
          json.candidates[0].content.parts.map((p) => p.text || '').join('');
        if (!text) throw new Error('Gemini returned an empty response.');

        return normalizeLetters(extractJson(text), opts.choices.length);
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
      }
    }
  }

  throw lastErr || new Error('Failed to get answer from Gemini.');
}

module.exports = { answerOne, DEFAULT_MODEL };
