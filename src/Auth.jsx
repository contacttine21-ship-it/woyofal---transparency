import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase.js';

export default function Auth() {
  const [mode, setMode] = useState('signup');
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [telephone, setTelephone] = useState('');
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(false);

  async function handleSignup(e) {
    e.preventDefault();
    setErreur('');
    if (!prenom.trim() || !nom.trim() || !telephone.trim() || !email.trim() || !motDePasse) {
      setErreur('Merci de remplir tous les champs.');
      return;
    }
    if (motDePasse.length < 6) {
      setErreur('Le mot de passe doit contenir au moins 6 caractères.');
      return;
    }
    setChargement(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), motDePasse);
      await updateProfile(cred.user, { displayName: `${prenom.trim()} ${nom.trim()}` });
      await setDoc(doc(db, 'users', cred.user.uid), {
        prenom: prenom.trim(),
        nom: nom.trim(),
        telephone: telephone.trim(),
        email: email.trim(),
        creeLe: new Date().toISOString()
      });
    } catch (err) {
      setErreur(traduireErreur(err.code));
    } finally {
      setChargement(false);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setErreur('');
    if (!email.trim() || !motDePasse) {
      setErreur('Merci de renseigner e-mail et mot de passe.');
      return;
    }
    setChargement(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), motDePasse);
    } catch (err) {
      setErreur(traduireErreur(err.code));
    } finally {
      setChargement(false);
    }
  }

  function traduireErreur(code) {
    const map = {
      'auth/email-already-in-use': 'Cet e-mail est déjà utilisé par un compte.',
      'auth/invalid-email': 'Adresse e-mail invalide.',
      'auth/weak-password': 'Mot de passe trop faible (6 caractères minimum).',
      'auth/user-not-found': 'Aucun compte ne correspond à cet e-mail.',
      'auth/wrong-password': 'Mot de passe incorrect.',
      'auth/invalid-credential': 'E-mail ou mot de passe incorrect.',
      'auth/network-request-failed': 'Problème de connexion réseau.'
    };
    return map[code] || 'Une erreur est survenue. Réessaie.';
  }

  return (
    <div className="app-shell">
      <div className="auth-hero">
        <div className="mark"><i className="ti ti-bolt" aria-hidden="true"></i></div>
        <div className="title">Woyofal Transparency</div>
        <div className="tag">Comprenez chaque franc de votre électricité.</div>
      </div>

      <div className="wrap">
        <div className="card">
          <div className="auth-tabs">
            <button type="button" className={`auth-tab ${mode === 'signup' ? 'active' : ''}`} onClick={() => { setMode('signup'); setErreur(''); }}>Inscription</button>
            <button type="button" className={`auth-tab ${mode === 'login' ? 'active' : ''}`} onClick={() => { setMode('login'); setErreur(''); }}>Connexion</button>
          </div>

          {mode === 'signup' ? (
            <form onSubmit={handleSignup}>
              <div className="row2">
                <div className="field">
                  <label>Prénom</label>
                  <div className="field-input"><i className="ti ti-user" aria-hidden="true"></i><input type="text" value={prenom} onChange={e => setPrenom(e.target.value)} placeholder="Awa" /></div>
                </div>
                <div className="field">
                  <label>Nom</label>
                  <div className="field-input"><i className="ti ti-user" aria-hidden="true"></i><input type="text" value={nom} onChange={e => setNom(e.target.value)} placeholder="Diop" /></div>
                </div>
              </div>
              <div className="field">
                <label>Numéro de téléphone</label>
                <div className="field-input"><i className="ti ti-phone" aria-hidden="true"></i><input type="tel" value={telephone} onChange={e => setTelephone(e.target.value)} placeholder="77 123 45 67" /></div>
              </div>
              <div className="field">
                <label>E-mail</label>
                <div className="field-input"><i className="ti ti-mail" aria-hidden="true"></i><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="awa.diop@exemple.com" /></div>
              </div>
              <div className="field">
                <label>Mot de passe</label>
                <div className="field-input"><i className="ti ti-lock" aria-hidden="true"></i><input type="password" value={motDePasse} onChange={e => setMotDePasse(e.target.value)} placeholder="6 caractères minimum" /></div>
              </div>
              {erreur && <div className="auth-error">{erreur}</div>}
              <button className="btn" type="submit" disabled={chargement}>
                {chargement ? 'Création…' : 'Créer mon compte'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin}>
              <div className="field">
                <label>E-mail</label>
                <div className="field-input"><i className="ti ti-mail" aria-hidden="true"></i><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="awa.diop@exemple.com" /></div>
              </div>
              <div className="field">
                <label>Mot de passe</label>
                <div className="field-input"><i className="ti ti-lock" aria-hidden="true"></i><input type="password" value={motDePasse} onChange={e => setMotDePasse(e.target.value)} placeholder="Ton mot de passe" /></div>
              </div>
              {erreur && <div className="auth-error">{erreur}</div>}
              <button className="btn" type="submit" disabled={chargement}>
                {chargement ? 'Connexion…' : 'Se connecter'}
              </button>
            </form>
          )}
        </div>

        <div className="foot-note">
          Tes données (recharge, appareils, suivi) seront liées à ton compte et accessibles depuis n'importe quel appareil une fois connecté.
        </div>
      </div>
    </div>
  );
}
