/* Refresh application files only. Never clear IndexedDB or localStorage. */
(function (root) {
'use strict';
function waitForActivation(worker, timeoutMs = 15000) {
  if (!worker || worker.state === 'activated') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Обновление ещё загружается. Попробуй ещё раз через несколько секунд.')), timeoutMs);
    const finish = error => {clearTimeout(timer); worker.removeEventListener('statechange', changed); error ? reject(error) : resolve();};
    const changed = () => {
      if (worker.state === 'activated') finish();
      else if (worker.state === 'redundant') finish(new Error('Не удалось загрузить обновление. Проверь интернет и повтори.'));
      else if (worker.state === 'installed') worker.postMessage({type: 'ACTIVATE_UPDATE'});
    };
    worker.addEventListener('statechange', changed);
    changed();
  });
}
async function refresh(environment, version) {
  const {navigator, location} = environment;
  if (navigator.onLine === false) throw new Error('Для обновления подключись к интернету. Записи доступны и без сети.');
  if (navigator.serviceWorker && location.protocol === 'https:') {
    const registration = await navigator.serviceWorker.register('./sw.js', {updateViaCache: 'none'});
    await registration.update();
    await waitForActivation(registration.installing || registration.waiting);
  }
  const destination = new URL('./', location.href);
  destination.searchParams.set('v', version);
  destination.searchParams.set('refresh', String(Date.now()));
  location.replace(destination.href);
}
async function monitor(environment, version, onUpdate) {
  const {navigator, document, window} = environment;
  if (!navigator.serviceWorker || environment.location.protocol !== 'https:') return;
  const registration = await navigator.serviceWorker.register('./sw.js', {updateViaCache: 'none'});
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'APP_UPDATED' && typeof event.data.version === 'string' && event.data.version !== version) onUpdate();
  });
  let lastCheck = -Infinity;
  const check = () => {
    if (navigator.onLine === false || Date.now() - lastCheck < 5 * 60 * 1000) return;
    lastCheck = Date.now();
    registration.update().catch(() => {});
  };
  document.addEventListener('visibilitychange', () => {if (document.visibilityState === 'visible') check();});
  window.addEventListener('focus', check);
  check();
}
root.FinanceUpdates = {refresh, monitor, waitForActivation};
if (typeof module !== 'undefined' && module.exports) module.exports = root.FinanceUpdates;
})(typeof globalThis !== 'undefined' ? globalThis : this);
