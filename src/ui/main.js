import './styles.css';
import { boot } from './app.js';
import { createAIChat } from './aiComponents.js';

window.__sap_currentAnalysis = {};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { boot(); createAIChat(); });
} else {
  boot();
  createAIChat();
}
