import './styles.css';
import { boot, initTheme, showAuthOverlay } from './app.js';
import { initAuth, isLicenseMode, hasFullAccess } from './auth.js';
import { createAIChat } from './aiComponents.js';

window.__sap_currentAnalysis = {};

(async () => {
  // 1. Apply saved/system theme immediately — prevents flash of wrong theme.
  initTheme();

  // 2. Fetch auth mode from the backend (open vs license-key).
  await initAuth();

  // 3. Boot the app shell.
  boot();

  // 4. Create AI chat; expose visibility control so auth changes can toggle it.
  const chatControls = createAIChat();
  if (chatControls?.setVisible) {
    window.__sap_setAIChatVisible = chatControls.setVisible;
    // Apply initial visibility based on auth state.
    chatControls.setVisible(hasFullAccess());
  }

  // 5. In license mode, show the key-entry overlay if no valid token is present.
  if (isLicenseMode() && !hasFullAccess()) {
    showAuthOverlay();
  }
})();
