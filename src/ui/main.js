import './styles.css';
import { boot, initTheme, showAuthOverlay } from './app.js';
import { initAuth, isFirebaseEnabled, hasFullAccess } from './auth.js';
import { createAIChat } from './aiComponents.js';

window.__sap_currentAnalysis = {};

(async () => {
  // 1. Apply saved/system theme immediately — prevents flash of wrong theme.
  initTheme();

  // 2. Initialise auth (instant if Firebase not configured).
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

  // 5. If Firebase is configured and nobody is authenticated (no demo, no user),
  //    show the auth overlay (landing / sign-in screen).
  if (isFirebaseEnabled() && !hasFullAccess()) {
    showAuthOverlay();
  }
})();
