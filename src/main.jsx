import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase.js';
import App from './App.jsx';
import Auth from './Auth.jsx';
import './App.css';

function Root() {
  const [user, setUser] = useState(undefined);
  const [profil, setProfil] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const snap = await getDoc(doc(db, 'users', u.uid));
          if (snap.exists()) setProfil(snap.data());
        } catch (e) {
          console.error('Erreur chargement profil', e);
        }
      } else {
        setProfil(null);
      }
    });
    return unsub;
  }, []);

  if (user === undefined) {
    return <div className="auth-loading">Chargement…</div>;
  }
  if (user === null) {
    return <Auth />;
  }
  return <App profil={profil} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
