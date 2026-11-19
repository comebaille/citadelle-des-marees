import './style.css';
import { AppController } from './ui/controller';

function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      // Offline registration failed (e.g., restricted context) — app still runs normally
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  new AppController();
  registerServiceWorker();
});
