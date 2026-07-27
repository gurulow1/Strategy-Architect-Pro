import crypto from 'node:crypto';
import { getModel } from './openaiClient.js';
import { parseJournal, generateSummary, answerQuestion, explainWeaknesses } from './aiService.js';

function safetyIdentifier(subject) {
  return typeof subject === 'string' && subject
    ? crypto.createHash('sha256').update(subject, 'utf8').digest('hex')
    : undefined;
}

export async function handleFeature(feature, payload, context = {}) {
  const lang = payload?.lang || 'en';
  const model = getModel(safetyIdentifier(context.subject));

  switch (feature) {
    case 'parseJournal': {
      try {
        return { status: 200, body: await parseJournal(payload.rawText, model, lang) };
      } catch (err) {
        console.error('[parseJournal]', err.message);
        return { status: 503, body: { error: 'AI service temporarily unavailable', lang } };
      }
    }

    case 'generateSummary': {
      try {
        return { status: 200, body: await generateSummary(payload.metrics, payload.diagnostics, model, lang) };
      } catch (err) {
        console.error('[generateSummary]', err.message);
        return { status: 503, body: { error: 'AI service temporarily unavailable', lang } };
      }
    }

    case 'answerQuestion': {
      try {
        return {
          status: 200,
          body: await answerQuestion(
            payload.question, payload.metrics, payload.diagnostics, model, lang
          ),
        };
      } catch (err) {
        console.error('[answerQuestion]', err.message);
        return { status: 503, body: { error: 'AI service temporarily unavailable', lang } };
      }
    }

    case 'explainWeaknesses': {
      try {
        return { status: 200, body: await explainWeaknesses(payload.diagnostics, model, lang) };
      } catch (err) {
        console.error('[explainWeaknesses]', err.message);
        return { status: 503, body: { error: 'AI service temporarily unavailable', lang } };
      }
    }

    default:
      return { status: 400, body: { error: 'Unknown feature', lang } };
  }
}

export { getModel };
