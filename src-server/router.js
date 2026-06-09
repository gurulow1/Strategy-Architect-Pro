import { getModel } from './groqClient.js';
import { parseJournal, generateSummary, answerQuestion, explainWeaknesses } from './aiService.js';

export async function handleFeature(feature, payload) {
  const lang = payload?.lang || 'en';

  switch (feature) {
    case 'parseJournal': {
      const model = getModel(lang);
      try {
        return { status: 200, body: await parseJournal(payload.rawText, model, lang) };
      } catch (err) {
        console.error('[parseJournal]', err.message);
        return { status: 503, body: { error: 'AI service temporarily unavailable', lang } };
      }
    }

    case 'generateSummary': {
      const model = getModel(lang);
      try {
        return { status: 200, body: await generateSummary(payload.metrics, payload.diagnostics, model, lang) };
      } catch (err) {
        console.error('[generateSummary]', err.message);
        return { status: 503, body: { error: 'AI service temporarily unavailable', lang } };
      }
    }

    case 'answerQuestion': {
      const model = getModel(lang);
      try {
        return {
          status: 200,
          body: await answerQuestion(
            payload.question, payload.metrics, payload.tradeHistory, payload.diagnostics, model, lang
          ),
        };
      } catch (err) {
        console.error('[answerQuestion]', err.message);
        return { status: 503, body: { error: 'AI service temporarily unavailable', lang } };
      }
    }

    case 'explainWeaknesses': {
      const model = getModel(lang);
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
