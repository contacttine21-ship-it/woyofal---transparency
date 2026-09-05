import React, { useState, useMemo, useRef, useEffect } from 'react';
import { signOut } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase.js';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import Tesseract from 'tesseract.js';

const APP_NAME = 'WoyofalCheck';

const TRANCHES = [
  { min: 0, max: 150, prix: 82, nom: 'T1', key: 't1' },
  { min: 150, max: 250, prix: 136.49, nom: 'T2', key: 't2' },
  { min: 250, max: Infinity, prix: 159.36, nom: 'T3', key: 't3' }
];
const REDEVANCE = 429;
const TRANCHE_COLOR = { t1: '#1E8A4C', t2: '#D98F1E', t3: '#D64545' };
const TRANCHE_BG = { t1: 'rgba(30,138,76,0.07)', t2: 'rgba(217,143,30,0.08)', t3: 'rgba(214,69,69,0.08)' };

const APP_PRESETS = [
  { nom: 'Ampoule LED', w: 10, h: 5 },
  { nom: 'Ventilateur', w: 60, h: 8 },
  { nom: 'Climatiseur', w: 1200, h: 6 },
  { nom: 'Réfrigérateur', w: 150, h: 24 },
  { nom: 'Téléviseur', w: 100, h: 5 },
  { nom: 'Fer à repasser', w: 1000, h: 0.5 },
  { nom: 'Congélateur', w: 200, h: 24 },
  { nom: 'Machine à laver', w: 500, h: 1 }
];

function fmt(n, dec) {
  return (n || 0).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtF(n) {
  return Math.round(n || 0).toLocaleString('fr-FR') + ' F';
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function trancheKeyDe(v) {
  return v <= 150 ? 't1' : v <= 250 ? 't2' : 't3';
}
function trancheNomDe(v) {
  return v <= 150 ? 'T1' : v <= 250 ? 'T2' : 'T3';
}

function calculer(montant, cumulDepart, premiereRecharge) {
  let montantRestant = montant;
  const redevance = premiereRecharge ? Math.min(REDEVANCE, montantRestant) : 0;
  montantRestant -= redevance;

  let cumul = cumulDepart;
  let kwhTotal = 0;
  const details = [];

  for (const tranche of TRANCHES) {
    if (montantRestant <= 0.0001) break;
    if (cumul >= tranche.max) continue;

    const kwhDispo = tranche.max - cumul;
    const prixEffectif = tranche.prix;
    const kwhAchetable = montantRestant / prixEffectif;

    let kwhAffecte;
    if (kwhAchetable <= kwhDispo) {
      kwhAffecte = kwhAchetable;
      montantRestant = 0;
    } else {
      kwhAffecte = kwhDispo;
      montantRestant -= kwhAffecte * prixEffectif;
    }

    if (kwhAffecte > 0.0001) {
      details.push({ nom: tranche.nom, key: tranche.key, kwh: kwhAffecte, prixEffectif });
      kwhTotal += kwhAffecte;
      cumul += kwhAffecte;
    }
  }

  return { kwhTotal, redevance, details, dernierTranche: details.length ? details[details.length - 1] : null };
}

function repartitionParTranche(points) {
  const totals = { t1: 0, t2: 0, t3: 0 };
  let prevCumul = 0;
  points.forEach(p => {
    const start = prevCumul, end = p.cumul;
    const segs = [[0, 150, 't1'], [150, 250, 't2'], [250, Infinity, 't3']];
    segs.forEach(([lo, hi, key]) => {
      const s = Math.max(start, lo), e = Math.min(end, hi);
      if (e > s) totals[key] += e - s;
    });
    prevCumul = end;
  });
  return totals;
}

function ConsoChart({ points }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = 190;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const padL = 32, padR = 8, padT = 10, padB = 20;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const maxCumul = Math.max(points[points.length - 1].cumul, 250) * 1.1;

    const x = i => padL + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
    const y = v => padT + plotH - (Math.min(v, maxCumul) / maxCumul) * plotH;

    const bounds = [
      { from: 0, to: 150, color: TRANCHE_BG.t1 },
      { from: 150, to: 250, color: TRANCHE_BG.t2 },
      { from: 250, to: maxCumul, color: TRANCHE_BG.t3 }
    ];
    bounds.forEach(b => {
      if (b.from > maxCumul) return;
      ctx.fillStyle = b.color;
      ctx.fillRect(padL, y(Math.min(b.to, maxCumul)), plotW, y(b.from) - y(Math.min(b.to, maxCumul)));
    });

    [150, 250].forEach(seuil => {
      if (seuil > maxCumul) return;
      ctx.strokeStyle = '#C7D2CB';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y(seuil));
      ctx.lineTo(w - padR, y(seuil));
      ctx.stroke();
      ctx.setLineDash([]);
    });

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i], p2 = points[i + 1];
      const mid = (p1.cumul + p2.cumul) / 2;
      const key = trancheKeyDe(mid);
      ctx.strokeStyle = TRANCHE_COLOR[key];
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x(i), y(p1.cumul));
      ctx.lineTo(x(i + 1), y(p2.cumul));
      ctx.stroke();
    }

    points.forEach((p, i) => {
      const key = trancheKeyDe(p.cumul);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = TRANCHE_COLOR[key];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x(i), y(p.cumul), p.estime ? 3.5 : 4, 0, Math.PI * 2);
      if (p.estime) { ctx.stroke(); } else { ctx.fillStyle = TRANCHE_COLOR[key]; ctx.fill(); }
    });

    ctx.fillStyle = '#9AA79E';
    ctx.font = '10px Space Grotesk, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('0', padL - 4, y(0) + 3);
    ctx.fillText(fmt(maxCumul, 0), padL - 4, y(maxCumul) + 8);
    ctx.textAlign = 'left';
    ctx.fillText(points[0].date.slice(5), padL, h - 4);
    ctx.textAlign = 'right';
    ctx.fillText(points[points.length - 1].date.slice(5), w - padR, h - 4);
  }, [points]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: 190, display: 'block' }} />;
}

function BottomNav({ tab, setTab }) {
  const items = [
    { id: 'accueil', icon: 'ti-home', label: 'Accueil' },
    { id: 'recharge', icon: 'ti-calculator', label: 'Simulateur' },
    { id: 'historique', icon: 'ti-history', label: 'Historique' },
    { id: 'profil', icon: 'ti-user', label: 'Profil' }
  ];
  return (
    <div className="bottom-nav">
      {items.map(it => (
        <button key={it.id} className={`nav-item ${tab === it.id ? 'active' : ''}`} onClick={() => setTab(it.id)}>
          <i className={`ti ${it.icon}`} aria-hidden="true"></i>
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  );
}

export default function App({ profil, uid, donneesInitiales }) {
  const [tab, setTab] = useState('accueil');
  const [historiqueSousTab, setHistoriqueSousTab] = useState('consommation');
  const [notifOuvert, setNotifOuvert] = useState(false);

  const [montant, setMontant] = useState(10000);
  const [date, setDate] = useState(todayISO());
  const [compteur, setCompteur] = useState('');
  const [cumul, setCumul] = useState(0);
  const [premiere, setPremiere] = useState(true);
  const [recu, setRecu] = useState('');
  const [modeSaisie, setModeSaisie] = useState('manuelle');
  const [scanEnCours, setScanEnCours] = useState(false);
  const [scanTexte, setScanTexte] = useState('');
  const [scanErreur, setScanErreur] = useState('');
  const [scanPhoto, setScanPhoto] = useState(null);

  const [appEntries, setAppEntries] = useState(
    donneesInitiales?.appareils && donneesInitiales.appareils.length > 0
      ? donneesInitiales.appareils
      : [
          { nom: 'Réfrigérateur', w: 150, h: 24, qte: 1 },
          { nom: 'Climatiseur', w: 1200, h: 6, qte: 1 }
        ]
  );
  const [consoEntries, setConsoEntries] = useState(donneesInitiales?.consommation || []);
  const [consoDate, setConsoDate] = useState(todayISO());
  const [consoKwh, setConsoKwh] = useState('');

  const [rechargeHistorique, setRechargeHistorique] = useState(donneesInitiales?.recharges || []);
  const [notifications, setNotifications] = useState(donneesInitiales?.notifications || []);
  const [compteurs, setCompteurs] = useState(donneesInitiales?.compteurs || []);
  const [nouveauCompteur, setNouveauCompteur] = useState('');

  const [syncEtat, setSyncEtat] = useState('idle');

  const res = useMemo(() => calculer(montant, parseFloat(cumul) || 0, premiere), [montant, cumul, premiere]);
  const coutMoyen = res.kwhTotal > 0 ? montant / res.kwhTotal : 0;

  const anomalie = useMemo(() => {
    if (recu === '') return null;
    const recuNum = parseFloat(recu) || 0;
    const ecart = res.kwhTotal - recuNum;
    const ecartPct = res.kwhTotal > 0 ? (ecart / res.kwhTotal) * 100 : 0;
    return { recuNum, ecart, ecartPct, ok: Math.abs(ecartPct) < 2 };
  }, [recu, res.kwhTotal]);

  const appTotalKwh = useMemo(
    () => appEntries.reduce((s, a) => s + (a.w * a.h * a.qte) / 1000, 0),
    [appEntries]
  );

  const consoPoints = useMemo(() => {
    const sorted = [...consoEntries].sort((a, b) => a.date.localeCompare(b.date));
    let run = 0;
    return sorted.map(e => {
      run += e.kwh;
      return { date: e.date, kwh: e.kwh, cumul: run, estime: !!e.estime };
    });
  }, [consoEntries]);

  const repartition = useMemo(() => repartitionParTranche(consoPoints), [consoPoints]);
  const repartitionTotal = repartition.t1 + repartition.t2 + repartition.t3;

  const totalKwhCredite = useMemo(
    () => rechargeHistorique.reduce((s, r) => s + (r.kwhRecu != null ? r.kwhRecu : r.kwhTheorique), 0),
    [rechargeHistorique]
  );
  const totalKwhConsomme = useMemo(() => consoEntries.reduce((s, e) => s + e.kwh, 0), [consoEntries]);
  const creditRestant = totalKwhCredite - totalKwhConsomme;

  useEffect(() => {
    if (consoPoints.length) {
      setCumul(String(Math.round(consoPoints[consoPoints.length - 1].cumul * 10) / 10));
    }
  }, [consoPoints]);

  useEffect(() => {
    if (compteur === '') {
      const actif = compteurs.find(c => c.actif);
      if (actif) setCompteur(actif.numero);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compteurs]);

  useEffect(() => {
    if (!uid) return;
    setSyncEtat('saving');
    const timer = setTimeout(() => {
      setDoc(doc(db, 'users', uid), {
        appareils: appEntries,
        consommation: consoEntries,
        recharges: rechargeHistorique,
        notifications: notifications,
        compteurs: compteurs
      }, { merge: true })
        .then(() => setSyncEtat('saved'))
        .catch(e => { console.error('Erreur sauvegarde', e); setSyncEtat('idle'); });
    }, 800);
    return () => clearTimeout(timer);
  }, [appEntries, consoEntries, rechargeHistorique, notifications, compteurs, uid]);

  function ajouterNotification(titre, message, type) {
    setNotifications(prev => [
      { id: Date.now().toString(), titre, message, type, date: new Date().toISOString(), lu: false },
      ...prev
    ].slice(0, 30));
  }
  function marquerLu(id) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, lu: true } : n));
  }
  function toutMarquerLu() {
    setNotifications(prev => prev.map(n => ({ ...n, lu: true })));
  }
  const notifNonLues = notifications.filter(n => !n.lu).length;

  function updateAppField(i, field, value) {
    setAppEntries(prev => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: field === 'nom' ? value : (parseFloat(value) || 0) };
      return next;
    });
  }
  function addAppFromPreset(p) {
    setAppEntries(prev => [...prev, { nom: p.nom, w: p.w, h: p.h, qte: 1 }]);
  }
  function addEmptyApp() {
    setAppEntries(prev => [...prev, { nom: '', w: 0, h: 0, qte: 1 }]);
  }
  function removeApp(i) {
    setAppEntries(prev => prev.filter((_, idx) => idx !== i));
  }
  function sendAppToSuivi() {
    if (appTotalKwh <= 0) return;
    setConsoEntries(prev => {
      const existing = prev.find(e => e.date === consoDate);
      const entry = { date: consoDate, kwh: appTotalKwh, estime: true };
      if (existing) return prev.map(e => e.date === consoDate ? entry : e);
      return [...prev, entry];
    });
    setTab('historique');
    setHistoriqueSousTab('consommation');
  }
  function addConsoEntry() {
    const k = parseFloat(consoKwh);
    if (!consoDate || isNaN(k) || k < 0) return;
    const cumulAvant = consoPoints.length ? consoPoints[consoPoints.length - 1].cumul : 0;
    const cumulApres = cumulAvant + k;
    setConsoEntries(prev => {
      const existing = prev.find(e => e.date === consoDate);
      const entry = { date: consoDate, kwh: k, estime: false };
      if (existing) return prev.map(e => e.date === consoDate ? entry : e);
      return [...prev, entry];
    });
    if (trancheKeyDe(cumulAvant) !== trancheKeyDe(cumulApres)) {
      ajouterNotification('Changement de tranche', `Tu es passé en ${trancheNomDe(cumulApres)} (${fmt(cumulApres, 1)} kWh cumulés).`, 'tranche');
    }
    setConsoKwh('');
  }
  function removeConsoEntry(d) {
    setConsoEntries(prev => prev.filter(e => e.date !== d));
  }

  async function scannerTicket() {
    setScanErreur('');
    setScanTexte('');
    try {
      const photo = await Camera.getPhoto({
        quality: 70,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Prompt,
        promptLabelHeader: 'Photo du ticket',
        promptLabelPhoto: 'Choisir dans la galerie',
        promptLabelPicture: 'Prendre une photo'
      });
      setScanPhoto(photo.dataUrl);
      setScanEnCours(true);
      const { data: { text } } = await Tesseract.recognize(photo.dataUrl, 'fra');
      setScanTexte(text);
      extraireDonneesDuTicket(text);
      setModeSaisie('manuelle');
    } catch (e) {
      console.error('Erreur scan', e);
      if (e?.message !== 'User cancelled photos app') {
        setScanErreur("Impossible de lire ce ticket automatiquement. Réessaie avec une photo plus nette et bien cadrée, ou passe en saisie manuelle.");
      }
    } finally {
      setScanEnCours(false);
    }
  }

  function extraireDonneesDuTicket(texteBrut) {
    const t = texteBrut.replace(/\s+/g, ' ');

    const mMontant = t.match(/(\d[\d\s]{1,8}\d|\d{2,6})\s*(?:FCFA|CFA|F\b)/i);
    if (mMontant) {
      const val = parseInt(mMontant[1].replace(/\s/g, ''), 10);
      if (!isNaN(val)) setMontant(val);
    }

    const mDate = t.match(/(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})/);
    if (mDate) setDate(`${mDate[3]}-${mDate[2]}-${mDate[1]}`);

    const mKwh = t.match(/(\d+[.,]\d+)\s*k\s*wh/i);
    if (mKwh) setRecu(mKwh[1].replace(',', '.'));

    const mCompteur = t.match(/\b\d{8,15}\b/);
    if (mCompteur) setCompteur(mCompteur[0]);
  }

  function reinitialiserFormulaireRecharge() {
    setMontant('');
    setDate(todayISO());
    setRecu('');
    setPremiere(false);
    setModeSaisie('manuelle');
    setScanTexte('');
    setScanErreur('');
    setScanPhoto(null);
    // le numéro de compteur reste (probablement le même la prochaine fois) ;
    // le cumul se remet automatiquement via l'effet lié à consoPoints
  }

  function analyserRecharge() {
    const entry = {
      id: Date.now().toString(),
      date, montant, compteur,
      cumulAvant: parseFloat(cumul) || 0,
      kwhTheorique: res.kwhTotal,
      kwhRecu: recu !== '' ? parseFloat(recu) : null,
      anomalie: anomalie ? !anomalie.ok : null,
      tranche: res.dernierTranche ? res.dernierTranche.nom : null,
      redevance: res.redevance,
      premiere
    };
    setRechargeHistorique(prev => [...prev, entry]);
    if (entry.anomalie) {
      ajouterNotification('Écart à vérifier', `Ta recharge du ${date} (${fmtF(montant)}) affiche un écart de ${fmt(Math.abs(anomalie.ecart), 2)} kWh.`, 'anomalie');
    } else {
      ajouterNotification('Recharge enregistrée', `${fmtF(montant)} → ${fmt(res.kwhTotal, 2)} kWh${entry.tranche ? ' (' + entry.tranche + ')' : ''}.`, 'info');
    }
    reinitialiserFormulaireRecharge();
    setTab('accueil');
  }

  function ajouterCompteur() {
    const num = nouveauCompteur.trim();
    if (!num || compteurs.some(c => c.numero === num)) { setNouveauCompteur(''); return; }
    setCompteurs(prev => [...prev, { numero: num, actif: prev.length === 0 }]);
    setNouveauCompteur('');
  }
  function definirCompteurActif(numero) {
    setCompteurs(prev => prev.map(c => ({ ...c, actif: c.numero === numero })));
    setCompteur(numero);
  }
  function supprimerCompteur(numero) {
    setCompteurs(prev => prev.filter(c => c.numero !== numero));
  }

  const initiales = (profil?.prenom?.[0] || '') + (profil?.nom?.[0] || '');
  const dernierePointe = consoPoints.length ? consoPoints[consoPoints.length - 1] : null;
  const hasRecharges = rechargeHistorique.length > 0;
  const anomaliesHistorique = rechargeHistorique.filter(r => r.anomalie === true);

  return (
    <div className="app-shell">
      <div className="topbar">
        <div>
          <div className="hello">Bonjour{profil?.prenom ? `, ${profil.prenom}` : ''} 👋</div>
          <div className="name">{APP_NAME}</div>
        </div>
        <button className="notif-bell" onClick={() => { setNotifOuvert(o => !o); }} aria-label="Notifications">
          <i className="ti ti-bell" aria-hidden="true"></i>
          {notifNonLues > 0 && <span className="notif-badge">{notifNonLues}</span>}
        </button>
      </div>
      {syncEtat !== 'idle' && (
        <div className="sync-note">{syncEtat === 'saving' ? 'Synchronisation…' : 'Synchronisé ✓'}</div>
      )}

      {notifOuvert && (
        <div className="notif-panel">
          <div className="notif-panel-head">
            <span>Notifications</span>
            {notifNonLues > 0 && <button onClick={toutMarquerLu}>Tout marquer lu</button>}
          </div>
          {notifications.length === 0 ? (
            <div className="empty-note">Aucune notification pour le moment.</div>
          ) : (
            notifications.slice(0, 15).map(n => (
              <div key={n.id} className={`notif-item ${n.lu ? '' : 'unread'}`} onClick={() => marquerLu(n.id)}>
                <i className={`ti ${n.type === 'anomalie' ? 'ti-alert-triangle' : n.type === 'tranche' ? 'ti-gauge' : 'ti-circle-check'}`} aria-hidden="true"></i>
                <div>
                  <div className="t">{n.titre}</div>
                  <div className="m">{n.message}</div>
                </div>
              </div>
            ))
          )}
          <div className="foot-note left" style={{ marginTop: 10 }}>
            Notifications internes à l'app — elles n'apparaissent que si tu l'ouvres, ce ne sont pas des notifications push.
          </div>
        </div>
      )}

      {tab === 'accueil' && (
        <div className="wrap" style={{ paddingTop: 10 }}>
          <div className="hero">
            {hasRecharges ? (
              <>
                <div className="hero-label">Crédit restant estimé</div>
                <div className="hero-value">{fmt(creditRestant, 2)}<span className="unit">kWh</span></div>
                <div className="hero-sub">{rechargeHistorique.length} recharge{rechargeHistorique.length > 1 ? 's' : ''} enregistrée{rechargeHistorique.length > 1 ? 's' : ''}</div>
              </>
            ) : (
              <>
                <div className="hero-label">Dernière analyse</div>
                <div className="hero-value">{fmt(res.kwhTotal, 2)}<span className="unit">kWh</span></div>
                <div className="hero-sub">pour {fmtF(montant)} payés — pas encore enregistrée</div>
              </>
            )}
            <div className="hero-row">
              <div className="hero-tag">
                <i className="ti ti-bolt" aria-hidden="true"></i>
                {dernierePointe ? trancheNomDe(dernierePointe.cumul) : (res.dernierTranche ? res.dernierTranche.nom : '—')}
              </div>
              <div className="hero-tag">{res.kwhTotal > 0 ? fmt(coutMoyen, 1) + ' F/kWh' : '—'}</div>
            </div>
          </div>

          <div className="quick-list">
            <div className="quick-row" onClick={() => setTab('historique')}>
              <div className="left">
                <div className="icon"><i className="ti ti-calendar" aria-hidden="true"></i></div>
                <div>
                  <div className="label">Cumul suivi</div>
                  <div className="sub">{consoPoints.length} entrée{consoPoints.length > 1 ? 's' : ''}</div>
                </div>
              </div>
              <div className="value">{fmt(dernierePointe ? dernierePointe.cumul : (parseFloat(cumul) || 0), 1)} kWh</div>
            </div>
            <div className="quick-row" onClick={() => setTab('historique')}>
              <div className="left">
                <div className="icon"><i className="ti ti-plug" aria-hidden="true"></i></div>
                <div>
                  <div className="label">Appareils suivis</div>
                  <div className="sub">{appEntries.length} appareil{appEntries.length > 1 ? 's' : ''}</div>
                </div>
              </div>
              <div className="value">{fmt(appTotalKwh, 2)} kWh/j</div>
            </div>
            <div className="quick-row" onClick={() => { setTab('historique'); setHistoriqueSousTab('anomalies'); }}>
              <div className="left">
                <div className="icon"><i className="ti ti-alert-triangle" aria-hidden="true"></i></div>
                <div>
                  <div className="label">Anomalies détectées</div>
                  <div className="sub">sur {rechargeHistorique.length} recharge{rechargeHistorique.length > 1 ? 's' : ''}</div>
                </div>
              </div>
              <div className="value">{anomaliesHistorique.length}</div>
            </div>
            <div className="quick-row" onClick={() => setTab('recharge')}>
              <div className="left">
                <div className="icon"><i className="ti ti-receipt" aria-hidden="true"></i></div>
                <div>
                  <div className="label">Redevance mensuelle</div>
                  <div className="sub">1ère recharge du mois</div>
                </div>
              </div>
              <div className="value">{fmtF(REDEVANCE)}</div>
            </div>
          </div>

          <button className="btn" onClick={() => setTab('recharge')}>
            <i className="ti ti-calculator" aria-hidden="true"></i>
            Analyser une recharge
          </button>
        </div>
      )}

      {tab === 'recharge' && (
        <div className="wrap" style={{ paddingTop: 10 }}>
          <div className="card">
            <h2><span className="num">1</span>Nouvelle recharge</h2>
            <div className="pill-toggle">
              <button className={modeSaisie === 'manuelle' ? 'active' : ''} onClick={() => setModeSaisie('manuelle')}>Saisie manuelle</button>
              <button className={modeSaisie === 'scan' ? 'active' : ''} onClick={() => setModeSaisie('scan')}>Scanner ticket</button>
            </div>

            {modeSaisie === 'scan' && (
              <div className="scan-box">
                {scanPhoto && <img src={scanPhoto} alt="Ticket scanné" className="scan-preview" />}
                {scanEnCours ? (
                  <div className="scan-loading">
                    <i className="ti ti-loader-2 spin" aria-hidden="true"></i>
                    Lecture du ticket en cours…
                  </div>
                ) : (
                  <button className="btn" onClick={scannerTicket}>
                    <i className="ti ti-camera" aria-hidden="true"></i>
                    {scanPhoto ? 'Scanner un autre ticket' : 'Prendre une photo du ticket'}
                  </button>
                )}
                {scanErreur && <div className="scan-error">{scanErreur}</div>}
                {scanTexte && !scanEnCours && (
                  <>
                    <div className="banner ok" style={{ marginTop: 12 }}>
                      <i className="ti ti-circle-check" aria-hidden="true"></i>
                      <div>
                        <div className="title">Champs pré-remplis ci-dessous</div>
                        <div className="desc">Vérifie-les avant d'analyser — la lecture automatique peut se tromper sur un ticket flou.</div>
                      </div>
                    </div>
                    <details className="scan-raw">
                      <summary>Texte brut détecté</summary>
                      <pre>{scanTexte}</pre>
                    </details>
                  </>
                )}
                <div className="foot-note left" style={{ marginTop: 10 }}>
                  La lecture se fait entièrement sur ton téléphone (pas d'envoi à un serveur). Le téléchargement du moteur de reconnaissance (une seule fois) nécessite une connexion internet.
                </div>
              </div>
            )}

            <div className="row2">
              <div className="field">
                <label>Montant payé</label>
                <div className="field-input">
                  <i className="ti ti-cash" aria-hidden="true"></i>
                  <input type="number" min="0" step="50" value={montant} onChange={e => setMontant(parseFloat(e.target.value) || 0)} />
                </div>
              </div>
              <div className="field">
                <label>Date</label>
                <div className="field-input">
                  <i className="ti ti-calendar" aria-hidden="true"></i>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="field">
              <label>Numéro de compteur</label>
              <div className="field-input">
                <i className="ti ti-plug-connected" aria-hidden="true"></i>
                {compteurs.length > 0 ? (
                  <select value={compteur} onChange={e => setCompteur(e.target.value)}>
                    <option value="">— choisir —</option>
                    {compteurs.map(c => <option key={c.numero} value={c.numero}>{c.numero}</option>)}
                  </select>
                ) : (
                  <input type="text" placeholder="ex. 05123456789" value={compteur} onChange={e => setCompteur(e.target.value)} />
                )}
              </div>
            </div>
            <div className="field">
              <label>kWh déjà consommés ce mois-ci</label>
              <div className="field-input">
                <i className="ti ti-gauge" aria-hidden="true"></i>
                <input type="number" min="0" step="1" value={cumul} onChange={e => setCumul(e.target.value)} />
              </div>
            </div>
            <div className="check">
              <input type="checkbox" checked={premiere} onChange={e => setPremiere(e.target.checked)} id="premiere" />
              <label htmlFor="premiere">C'est ma première recharge du mois</label>
            </div>
          </div>

          <div className="card">
            <h2><span className="num">2</span>Analyse de recharge</h2>

            {anomalie ? (
              anomalie.ok ? (
                <div className="banner ok">
                  <i className="ti ti-circle-check" aria-hidden="true"></i>
                  <div>
                    <div className="title">Recharge cohérente</div>
                    <div className="desc">Écart de {fmt(Math.abs(anomalie.ecart), 2)} kWh, dans la marge normale.</div>
                  </div>
                </div>
              ) : (
                <div className="banner warn">
                  <i className="ti ti-alert-triangle" aria-hidden="true"></i>
                  <div>
                    <div className="title">Écart à vérifier</div>
                    <div className="desc">{fmt(res.kwhTotal, 2)} kWh théoriques contre {fmt(anomalie.recuNum, 2)} kWh reçus ({fmt(Math.abs(anomalie.ecartPct), 1)}%).</div>
                  </div>
                </div>
              )
            ) : (
              <div className="banner ok">
                <i className="ti ti-info-circle" aria-hidden="true"></i>
                <div>
                  <div className="title">Aucune comparaison</div>
                  <div className="desc">Renseigne le kWh réellement reçu ci-dessous pour vérifier ta recharge.</div>
                </div>
              </div>
            )}

            {res.redevance > 0 && (
              <div className="detail-row">
                <div className="label">Redevance (1re recharge du mois)</div>
                <div className="value">-{fmtF(res.redevance)}</div>
              </div>
            )}
            {res.details.map((d, i) => (
              <div className="detail-row" key={i}>
                <div className="label"><span className={`tranche-chip ${d.key}`}>{d.nom}</span>{fmt(d.kwh, 2)} kWh</div>
                <div className="value">{fmt(d.prixEffectif, 2)} F/kWh</div>
              </div>
            ))}
            <div className="detail-row total">
              <div className="label">Total crédité</div>
              <div className="value">{fmt(res.kwhTotal, 2)} kWh</div>
            </div>

            <div className="compare-box">
              <div className="field">
                <label>kWh réellement reçus (ticket/compteur)</label>
                <div className="field-input">
                  <i className="ti ti-ticket" aria-hidden="true"></i>
                  <input type="number" step="0.01" placeholder="ex. 42,10" value={recu} onChange={e => setRecu(e.target.value)} />
                </div>
              </div>
            </div>

            {anomalie && !anomalie.ok && (
              <ul className="anomaly-list">
                <li><i className="ti ti-point" aria-hidden="true"></i>le numéro de compteur saisi correspond bien à celui de la recharge</li>
                <li><i className="ti ti-point" aria-hidden="true"></i>la catégorie tarifaire (DPP) et le cumul mensuel renseigné sont exacts</li>
                <li><i className="ti ti-point" aria-hidden="true"></i>ce n'est pas ta première recharge du mois alors que la case est cochée (ou l'inverse)</li>
                <li><i className="ti ti-point" aria-hidden="true"></i>aucun ajustement ou régularisation n'a été appliqué par SENELEC</li>
              </ul>
            )}

            <button className="btn" style={{ marginTop: 14 }} onClick={analyserRecharge}>
              <i className="ti ti-device-floppy" aria-hidden="true"></i>
              Enregistrer cette recharge dans l'historique
            </button>
          </div>
        </div>
      )}

      {tab === 'historique' && (
        <div className="wrap" style={{ paddingTop: 10 }}>
          <div className="pill-toggle three">
            <button className={historiqueSousTab === 'consommation' ? 'active' : ''} onClick={() => setHistoriqueSousTab('consommation')}>Consommation</button>
            <button className={historiqueSousTab === 'recharges' ? 'active' : ''} onClick={() => setHistoriqueSousTab('recharges')}>Recharges</button>
            <button className={historiqueSousTab === 'anomalies' ? 'active' : ''} onClick={() => setHistoriqueSousTab('anomalies')}>Anomalies</button>
          </div>

          {historiqueSousTab === 'consommation' && (
            <>
              <div className="card">
                <h2><span className="num">1</span>Appareils électriques</h2>
                <div className="foot-note left">Renseigne tes appareils et leur usage quotidien pour affiner l'estimation.</div>

                <div className="chips-row">
                  {APP_PRESETS.map((p, i) => (
                    <button key={i} type="button" className="chip" onClick={() => addAppFromPreset(p)}>+ {p.nom}</button>
                  ))}
                </div>

                {appEntries.map((a, i) => (
                  <div className="app-item" key={i}>
                    <div className="app-item-top">
                      <input type="text" value={a.nom} placeholder="Nom de l'appareil" onChange={e => updateAppField(i, 'nom', e.target.value)} />
                      <button className="del" aria-label="Supprimer" onClick={() => removeApp(i)}>×</button>
                    </div>
                    <div className="app-item-grid">
                      <div className="mini-field"><label>Watts</label><input type="number" min="0" value={a.w} onChange={e => updateAppField(i, 'w', e.target.value)} /></div>
                      <div className="mini-field"><label>H/jour</label><input type="number" min="0" max="24" step="0.5" value={a.h} onChange={e => updateAppField(i, 'h', e.target.value)} /></div>
                      <div className="mini-field"><label>Qté</label><input type="number" min="1" value={a.qte} onChange={e => updateAppField(i, 'qte', e.target.value)} /></div>
                    </div>
                    <div className="app-item-kwh">{fmt((a.w * a.h * a.qte) / 1000, 2)} kWh/jour</div>
                  </div>
                ))}

                <button className="btn outline" onClick={addEmptyApp}><i className="ti ti-plus" aria-hidden="true"></i>Ajouter un appareil</button>

                <div className="detail-row total" style={{ marginTop: 14 }}>
                  <div className="label">Estimation totale</div>
                  <div className="value">{fmt(appTotalKwh, 2)} kWh / jour</div>
                </div>
                <button className="btn" style={{ marginTop: 10 }} onClick={sendAppToSuivi}>
                  <i className="ti ti-arrow-down" aria-hidden="true"></i>
                  Ajouter au suivi ({consoDate.slice(8, 10)}/{consoDate.slice(5, 7)})
                </button>
              </div>

              <div className="card">
                <h2><span className="num">2</span>Suivi de consommation</h2>
                <div className="row2">
                  <div className="field">
                    <label>Date</label>
                    <div className="field-input">
                      <i className="ti ti-calendar" aria-hidden="true"></i>
                      <input type="date" value={consoDate} onChange={e => setConsoDate(e.target.value)} />
                    </div>
                  </div>
                  <div className="field">
                    <label>kWh ce jour</label>
                    <div className="field-input">
                      <i className="ti ti-bolt" aria-hidden="true"></i>
                      <input type="number" min="0" step="0.1" placeholder="4,2" value={consoKwh} onChange={e => setConsoKwh(e.target.value)} />
                    </div>
                  </div>
                </div>
                <button className="btn ghost" onClick={addConsoEntry}><i className="ti ti-plus" aria-hidden="true"></i>Ajouter au suivi</button>

                {consoPoints.length === 0 ? (
                  <div className="empty-note">Aucune entrée pour le moment. Ajoute tes consommations jour par jour pour voir la courbe.</div>
                ) : (
                  <div className="chart-wrap">
                    <ConsoChart points={consoPoints} />
                    <div className="chart-legend">
                      <div className="item"><span className="dot" style={{ background: TRANCHE_COLOR.t1 }}></span>Tranche 1 (0–150 kWh)</div>
                      <div className="item"><span className="dot" style={{ background: TRANCHE_COLOR.t2 }}></span>Tranche 2 (151–250 kWh)</div>
                      <div className="item"><span className="dot" style={{ background: TRANCHE_COLOR.t3 }}></span>Tranche 3 (+250 kWh)</div>
                      <div className="item"><span className="dot" style={{ background: '#9AA79E', border: '2px solid #9AA79E', width: 7, height: 7 }}></span>relevé réel</div>
                      <div className="item"><span className="dot" style={{ background: '#fff', border: '2px solid #9AA79E', width: 7, height: 7 }}></span>estimation appareils</div>
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 10 }}>
                  {[...consoPoints].reverse().map(p => (
                    <div className="conso-item" key={p.date}>
                      <span className="d">{p.date}</span>
                      <span className="badges">
                        <span className="src">{p.estime ? 'estimé' : 'réel'}</span>
                        <span className="k">+{fmt(p.kwh, 1)} kWh</span>
                      </span>
                      <button className="del" aria-label="Supprimer" onClick={() => removeConsoEntry(p.date)}>×</button>
                    </div>
                  ))}
                </div>
              </div>

              {repartitionTotal > 0 && (
                <div className="card">
                  <h2><span className="num">3</span>Répartition par tranche</h2>
                  <div className="foot-note left">Depuis le début de ton suivi — reflète la vraie grille Woyofal (pas de tarification par heure de la journée, contrairement à d'autres fournisseurs).</div>
                  {['t1', 't2', 't3'].map(key => {
                    const pct = repartitionTotal > 0 ? (repartition[key] / repartitionTotal) * 100 : 0;
                    return (
                      <div className="repartition-row" key={key}>
                        <div className="rep-label">
                          <span className="dot" style={{ background: TRANCHE_COLOR[key] }}></span>
                          {key === 't1' ? 'Tranche 1' : key === 't2' ? 'Tranche 2' : 'Tranche 3'}
                        </div>
                        <div className="rep-bar-track">
                          <div className="rep-bar-fill" style={{ width: `${pct}%`, background: TRANCHE_COLOR[key] }}></div>
                        </div>
                        <div className="rep-value">{fmt(repartition[key], 1)} kWh ({fmt(pct, 0)}%)</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {historiqueSousTab === 'recharges' && (
            <div className="card">
              <h2><span className="num">↺</span>Historique des recharges</h2>
              {rechargeHistorique.length === 0 ? (
                <div className="empty-note">Aucune recharge enregistrée. Analyse une recharge depuis l'onglet Simulateur puis enregistre-la.</div>
              ) : (
                [...rechargeHistorique].reverse().map(r => (
                  <div className="recharge-item" key={r.id}>
                    <div className="ri-top">
                      <span className="d">{r.date}</span>
                      {r.anomalie === true && <span className="statut warn">Écart détecté</span>}
                      {r.anomalie === false && <span className="statut ok">Cohérent</span>}
                      {r.anomalie === null && <span className="statut neutral">Non vérifié</span>}
                    </div>
                    <div className="ri-mid">
                      <span>{fmtF(r.montant)}</span>
                      <span>→ {fmt(r.kwhTheorique, 2)} kWh</span>
                      {r.tranche && <span className={`tranche-chip ${r.tranche.toLowerCase()}`}>{r.tranche}</span>}
                    </div>
                    {r.compteur && <div className="ri-bottom">Compteur {r.compteur}</div>}
                  </div>
                ))
              )}
            </div>
          )}

          {historiqueSousTab === 'anomalies' && (
            <div className="card">
              <h2><span className="num">!</span>Détection d'anomalies</h2>
              {anomaliesHistorique.length === 0 ? (
                <div className="banner ok">
                  <i className="ti ti-circle-check" aria-hidden="true"></i>
                  <div>
                    <div className="title">Aucune anomalie détectée</div>
                    <div className="desc">Sur {rechargeHistorique.length} recharge{rechargeHistorique.length > 1 ? 's' : ''} enregistrée{rechargeHistorique.length > 1 ? 's' : ''}.</div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="banner warn">
                    <i className="ti ti-alert-triangle" aria-hidden="true"></i>
                    <div>
                      <div className="title">{anomaliesHistorique.length} anomalie{anomaliesHistorique.length > 1 ? 's' : ''} détectée{anomaliesHistorique.length > 1 ? 's' : ''}</div>
                      <div className="desc">Un écart ne signifie pas forcément une erreur de SENELEC — à vérifier au cas par cas.</div>
                    </div>
                  </div>
                  {[...anomaliesHistorique].reverse().map(r => (
                    <div className="recharge-item" key={r.id}>
                      <div className="ri-top">
                        <span className="d">{r.date}</span>
                        <span className="statut warn">Écart détecté</span>
                      </div>
                      <div className="ri-mid">
                        <span>{fmtF(r.montant)}</span>
                        <span>{fmt(r.kwhTheorique, 2)} kWh théoriques vs {fmt(r.kwhRecu, 2)} kWh reçus</span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'profil' && (
        <div className="wrap" style={{ paddingTop: 10 }}>
          <div className="profile-head">
            <div className="profile-avatar">{initiales || <i className="ti ti-user" aria-hidden="true"></i>}</div>
            <div>
              <div className="pname">{profil?.prenom} {profil?.nom}</div>
              <div className="pmeta">{profil?.telephone}</div>
            </div>
          </div>

          <div className="menu-list">
            <div className="menu-row">
              <i className="ti ti-mail leading" aria-hidden="true"></i>
              <div className="txt"><div className="t">E-mail</div></div>
              <div className="val">{profil?.email}</div>
            </div>
            <div className="menu-row">
              <i className="ti ti-phone leading" aria-hidden="true"></i>
              <div className="txt"><div className="t">Téléphone</div></div>
              <div className="val">{profil?.telephone}</div>
            </div>
          </div>

          <div className="card">
            <h2><i className="ti ti-plug-connected" aria-hidden="true" style={{ marginRight: 6 }}></i>Mes compteurs</h2>
            {compteurs.length === 0 && <div className="empty-note">Aucun compteur enregistré.</div>}
            {compteurs.map(c => (
              <div className="compteur-row" key={c.numero}>
                <button className={`compteur-radio ${c.actif ? 'active' : ''}`} onClick={() => definirCompteurActif(c.numero)}>
                  {c.actif && <i className="ti ti-check" aria-hidden="true"></i>}
                </button>
                <span className="numero">{c.numero}</span>
                {c.actif && <span className="tag-actif">actif</span>}
                <button className="del" aria-label="Supprimer" onClick={() => supprimerCompteur(c.numero)}>×</button>
              </div>
            ))}
            <div className="row2" style={{ marginTop: 10 }}>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <div className="field-input">
                  <i className="ti ti-plus" aria-hidden="true"></i>
                  <input type="text" placeholder="Ajouter un numéro de compteur" value={nouveauCompteur} onChange={e => setNouveauCompteur(e.target.value)} />
                </div>
              </div>
            </div>
            <button className="btn outline" onClick={ajouterCompteur}>Ajouter ce compteur</button>
          </div>

          <div className="menu-list">
            <div className="menu-row">
              <i className="ti ti-file-invoice leading" aria-hidden="true"></i>
              <div className="txt">
                <div className="t">Grille tarifaire en vigueur</div>
                <div className="s">RFM 429 F · T1 82 F · T2 136,49 F · T3 159,36 F/kWh</div>
              </div>
            </div>
            <div className="menu-row">
              <i className="ti ti-bell leading" aria-hidden="true"></i>
              <div className="txt">
                <div className="t">Notifications</div>
                <div className="s">Internes à l'app uniquement (pas de push)</div>
              </div>
            </div>
            <div className="menu-row">
              <i className="ti ti-info-circle leading" aria-hidden="true"></i>
              <div className="txt"><div className="t">À propos</div><div className="s">{APP_NAME} · v0.3</div></div>
            </div>
          </div>

          <button className="btn danger" onClick={() => signOut(auth)}>
            <i className="ti ti-logout" aria-hidden="true"></i>
            Se déconnecter
          </button>
        </div>
      )}

      <BottomNav tab={tab} setTab={setTab} />
    </div>
  );
}
