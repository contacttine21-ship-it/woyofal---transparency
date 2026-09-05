import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase.js';
import App from './App.jsx';
import Auth from './Auth.jsx';
import './App.css';

function Root() {
  const [user, setUser] = useState(undefined); // undefined = chargement, null = déconnecté
  const [profil, setProfil] = useState(null);
  const [donnees, setDonnees] = useState(null); // { appareils, consommation }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const snap = await getDoc(doc(db, 'users', u.uid));
          if (snap.exists()) {
            const data = snap.data();
            setProfil(data);
            setDonnees({
              appareils: data.appareils || null,
              consommation: data.consommation || [],
              recharges: data.recharges || [],
              notifications: data.notifications || [],
              compteurs: data.compteurs || []
            });
          } else {
            setDonnees({ appareils: null, consommation: [], recharges: [], notifications: [], compteurs: [] });
          }
        } catch (e) {
          console.error('Erreur chargement profil', e);
          setDonnees({ appareils: null, consommation: [], recharges: [], notifications: [], compteurs: [] });
        }
      } else {
        setProfil(null);
        setDonnees(null);
      }
    });
    return unsub;
  }, []);

  if (user === undefined) {
    return <div className="auth-loading"><div className="mark"><i className="ti ti-bolt"></i></div>Chargement…</div>;
  }
  if (user === null) {
    return <Auth />;
  }
  if (donnees === null) {
    return <div className="auth-loading"><div className="mark"><i className="ti ti-bolt"></i></div>Chargement de tes données…</div>;
  }
  return <App profil={profil} uid={user.uid} donneesInitiales={donnees} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
