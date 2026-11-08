const SDK = 'https://www.gstatic.com/firebasejs/11.10.0';
let config = null;
let app = null;

export async function webConfig() {
  if (config) return config;
  try {
    const res = await fetch('/web-config');
    config = res.ok ? await res.json() : {};
  } catch {
    config = {};
  }
  return config;
}

async function firebaseApp() {
  const cfg = await webConfig();
  if (!cfg.firebase) return null;
  if (!app) {
    const { initializeApp } = await import(`${SDK}/firebase-app.js`);
    app = initializeApp(cfg.firebase);
  }
  return app;
}

export async function startPhoneSignIn(phone, buttonId) {
  const a = await firebaseApp();
  if (!a) throw new Error('Phone sign-in is not set up here.');
  const { getAuth, RecaptchaVerifier, signInWithPhoneNumber } = await import(`${SDK}/firebase-auth.js`);
  const auth = getAuth(a);
  auth.languageCode = document.documentElement.lang || 'en';
  const verifier = new RecaptchaVerifier(auth, buttonId, { size: 'invisible' });
  const e164 = phone.startsWith('+') ? phone : `+91${phone.replace(/\D/g, '').slice(-10)}`;
  const confirmation = await signInWithPhoneNumber(auth, e164, verifier);
  return async (code) => {
    const cred = await confirmation.confirm(code);
    return cred.user.getIdToken();
  };
}

export async function enablePush(register) {
  const cfg = await webConfig();
  if (!cfg.push || !cfg.firebase || !cfg.vapidKey) throw new Error('Notifications are not set up here.');
  if (!('serviceWorker' in navigator) || !('Notification' in window)) throw new Error('This browser cannot show notifications.');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications were not allowed.');
  const a = await firebaseApp();
  const { getMessaging, getToken } = await import(`${SDK}/firebase-messaging.js`);
  const registration = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?config=${encodeURIComponent(JSON.stringify(cfg.firebase))}`);
  const token = await getToken(getMessaging(a), { vapidKey: cfg.vapidKey, serviceWorkerRegistration: registration });
  if (!token) throw new Error('Could not turn on notifications.');
  await register(token);
  return true;
}
