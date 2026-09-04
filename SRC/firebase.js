import { initializeApp } from 'firebase/app';
import { initializeFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyBiKnGQU3ndKz4Lu_wTJRe-bZ4mT_XZd14",
  authDomain: "woyofal--transparency.firebaseapp.com",
  projectId: "woyofal--transparency",
  storageBucket: "woyofal--transparency.firebasestorage.app",
  messagingSenderId: "88478087142",
  appId: "1:88478087142:web:a26fe498c750b8880b0827"
};

const app = initializeApp(firebaseConfig);

// experimentalForceLongPolling : nécessaire car la WebView Android/Capacitor
// est incompatible avec le mode streaming par défaut de Firestore
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true
});

export const auth = getAuth(app);
