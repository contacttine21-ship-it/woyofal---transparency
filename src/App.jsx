import React, { useState, useMemo, useRef, useEffect } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from './firebase.js';

const TRANCHES = [
  { min: 0, max: 150, prix: 82, nom: 'T1', color: '#145C4C', bg: '#E1EFEA' },
  { min: 150, max: 250, prix: 136.49, nom: 'T2', color: '#B9791E', bg: '#F6EAD4' },
  { min: 250, max: Infinity, prix: 159.36, nom: 'T3', color: '#B2472B', bg: '#F7E4DD' }
];
const REDEVANCE = 429;

const APP_PRESETS = [
  { nom: 'Ampoule LED', w: 10, h: 5, icon: 'ti-bulb' },
  { nom: 'Ventilateur', w: 60, h: 8, icon: 'ti-wind' },
  { nom: 'Climatiseur', w: 1200, h: 6, icon: 'ti-snowflake' },
  { nom: 'Réfrigérateur', w: 150, h: 24, icon: 'ti-fridge' },
  { nom: 'Téléviseur', w: 100, h: 5, icon: 'ti-device-tv' },
  { nom: 'Fer à repasser', w: 1000, h: 0.5, icon: 'ti-iron' },
  { nom: 'Congélateur', w: 200, h: 24, icon: 'ti-cube' },
  { nom: 'Machine à laver', w: 500, h: 1, icon: 'ti-wash' }
];

function trancheOf(cumul) {
  return TRANCHES.find(t => cumul < t.max) || TRANCHES[TRANCHES.length - 1];
}
function fmt(n, dec) {
  return (n || 0).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtF(n) {
  return Math.round(n || 0).toLocaleString('fr-FR') + ' F';
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
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
      details.push({ nom: tranche.nom, kwh: kwhAffecte, prixEffectif, color: tranche.color });
      kwhTotal += kwhAffecte;
      cumul += kwhAffecte;
    }
  }

  return { kwhTotal, redevance, details, dernierTranche: details.length ? details[details.length - 1] : null };
}

function ConsoChart({ points }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = 220;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const padL = 38, padR = 12, padT = 12, padB = 24;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const maxCumul = Math.max(points[points.length - 1].cumul, 250) * 1.1;

    const x = i => padL + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
    const y = v => padT + plotH - (Math.min(v, maxCumul) / maxCumul) * plotH;

    const bands = [
      { from: 0, to: Math.min(150, maxCumul), color: 'rgba(20,92,76,0.07)' },
      { from: 150, to: Math.min(250, maxCumul), color: 'rgba(185,121,30,0.08)' },
      { from: 250, to: maxCumul, color: 'rgba(178,71,43,0.07)' }
    ];
    bands.forEach(b => {
      if (b.from >= maxCumul) return;
      ctx.fillStyle = b.color;
      ctx.fillRect(padL, y(b.to), plotW, y(b.from) - y(b.to));
    });

    [150, 250].forEach(seuil => {
      if (seuil > maxCumul) return;
      ctx.strokeStyle = '#CFC4A9';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y(seuil));
      ctx.lineTo(w - padR, y(seuil));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#9A9280';
      ctx.font = '9.5px IBM Plex Mono, monospace';
      ctx.fillText(seuil + ' kWh', padL + 3, y(seuil) - 4);
    });

    ctx.beginPath();
    points.forEach((p, i) => {
      const px = x(i), py = y(p.cumul);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.lineTo(x(points.length - 1), y(0));
    ctx.lineTo(x(0), y(0));
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, 'rgba(20,92,76,0.22)');
    grad.addColorStop(1, 'rgba(20,92,76,0.02)');
    ctx.fillStyle = grad;
    ctx.fill();

    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const colorFor = v => trancheOf(v).color;
      ctx.strokeStyle = colorFor((a.cumul + b.cumul) / 2);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x(i), y(a.cumul));
      ctx.lineTo(x(i + 1), y(b.cumul));
      ctx.stroke();
    }

    points.forEach((p, i) => {
      const color = trancheOf(p.cumul).color;
      ctx.beginPath();
      ctx.arc(x(i), y(p.cumul), p.source === 'appareils' ? 3.5 : 4, 0, Math.PI * 2);
      if (p.source === 'appareils') {
        ctx.fillStyle = '#F5F1E7';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#F5F1E7';
        ctx.stroke();
      }
    });

    ctx.fillStyle = '#9A9280';
    ctx.font = '9.5px IBM Plex Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText('0', padL - 5, y(0) + 3);
    ctx.fillText(fmt(maxCumul, 0), padL - 5, y(maxCumul) + 9);
    ctx.textAlign = 'left';
    ctx.fillText(points[0].date.slice(5), padL, h - 6);
    ctx.textAlign = 'right';
    ctx.fillText(points[points.length - 1].date.slice(5), w - padR, h - 6);
  }, [points]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: 220, display: 'block' }} />;
}

export default function App({ profil }) {
  const [montant, setMontant] = useState(10000);
  const [date, setDate] = useState(todayISO());
  const [compteur, setCompteur] = useState('');
  const [cumul, setCumul] = useState(0);
  const [premiere, setPremiere] = useState(true);
  const [recu, setRecu] = useState('');

  const [appEntries, setAppEntries] = useState([
    { nom: 'Réfrigérateur', w: 150, h: 24, qte: 1 },
    { nom: 'Climatiseur', w: 1200, h: 6, qte: 1 }
  ]);

  const [consoEntries, setConsoEntries] = useState([]);
  const [consoDate, setConsoDate] = useState(todayISO());
  const [consoKwh, setConsoKwh] = useState('');

  const res = useMemo(() => calculer(montant, parseFloat(cumul) || 0, premiere), [montant, cumul, premiere]);
  const coutMoyen = res.kwhTotal > 0 ? montant / res.kwhTotal : 0;
  const trancheActuelle = res.dernierTranche || trancheOf(parseFloat(cumul) || 0);

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
      return { date: e.date, kwh: e.kwh, cumul: run, source: e.source };
    });
  }, [consoEntries]);

  useEffect(() => {
    if (consoPoints.length) {
      setCumul(String(Math.round(consoPoints[consoPoints.length - 1].cumul * 10) / 10));
    }
  }, [consoPoints]);

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
      if (existing) return prev.map(e => e.date === consoDate ? { ...e, kwh: appTotalKwh, source: 'appareils' } : e);
      return [...prev, { date: consoDate, kwh: appTotalKwh, source: 'appareils' }];
    });
  }
  function addConsoEntry() {
    const k = parseFloat(consoKwh);
    if (!consoDate || isNaN(k) || k < 0) return;
    setConsoEntries(prev => {
      const existing = prev.find(e => e.date === consoDate);
      if (existing) return prev.map(e => e.date === consoDate ? { ...e, kwh: k, source: 'manuel' } : e);
      return [...prev, { date: consoDate, kwh: k, source: 'manuel' }];
    });
    setConsoKwh('');
  }
  function removeConsoEntry(d) {
    setConsoEntries(prev => prev.filter(e => e.date !== d));
  }

  return (
    <div className="wrap">
      <div className="brand">
        <div className="brand-mark"><i className="ti ti-bolt" aria-hidden="true"></i></div>
        <div>
          <div className="brand-name">Woyofal Transparency</div>
          <div className="brand-tag">Simulateur de recharge — Niveau 1</div>
        </div>
      </div>

      {profil && (
        <div className="user-bar">
          <div className="who">
            <div className="avatar">{(profil.prenom?.[0] || '') + (profil.nom?.[0] || '')}</div>
            <div>
              <div className="name">{profil.prenom} {profil.nom}</div>
              <div className="tel">{profil.telephone}</div>
            </div>
          </div>
          <button className="logout" aria-label="Déconnexion" onClick={() => signOut(auth)}>
            <i className="ti ti-logout" aria-hidden="true"></i>
          </button>
        </div>
      )}

      <div className="meter">
        <div className="meter-top">
          <div className="meter-label"><i className="ti ti-gauge" aria-hidden="true"></i>Énergie créditée</div>
          <div className="meter-tranche-pill" style={{ background: 'rgba(255,255,255,0.08)', color: trancheActuelle.color === '#145C4C' ? '#5FCBB0' : (trancheActuelle.color === '#B9791E' ? '#F0C878' : '#F0958A') }}>
            {trancheActuelle.nom}
          </div>
        </div>
        <div className="meter-value">{fmt(res.kwhTotal, 2)} <span>kWh</span></div>
        <div className="meter-grid">
          <div className="meter-item"><div className="k">Montant payé</div><div className="v">{fmtF(montant)}</div></div>
          <div className="meter-item"><div className="k">Coût moyen / kWh</div><div className="v">{res.kwhTotal > 0 ? fmt(coutMoyen, 1) + ' F' : '— F'}</div></div>
          <div className="meter-item"><div className="k">Tranche atteinte</div><div className="v">{trancheActuelle.nom}</div></div>
          <div className="meter-item"><div className="k">Redevance déduite</div><div className="v">{fmtF(res.redevance)}</div></div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div className="num">1</div><h2>Votre recharge</h2></div>
        <div className="row2">
          <div className="field">
            <label>Montant payé (FCFA)</label>
            <input type="number" min="0" step="50" value={montant} onChange={e => setMontant(parseFloat(e.target.value) || 0)} />
          </div>
          <div className="field">
            <label>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Numéro de compteur</label>
          <input type="text" placeholder="ex. 05123456789" value={compteur} onChange={e => setCompteur(e.target.value)} />
        </div>
        <div className="field">
          <label>kWh déjà consommés ce mois-ci</label>
          <input type="number" min="0" step="1" value={cumul} onChange={e => setCumul(e.target.value)} />
        </div>
        <div className="check">
          <input type="checkbox" checked={premiere} onChange={e => setPremiere(e.target.checked)} id="premiere" />
          <label htmlFor="premiere">C'est ma première recharge du mois</label>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div className="num">2</div><h2>Analyse recharge</h2></div>
        <div>
          {res.redevance > 0 && (
            <div className="breakdown-row">
              <div className="label">Redevance (1re recharge du mois)</div>
              <div className="value">-{fmtF(res.redevance)}</div>
            </div>
          )}
          {res.details.map((d, i) => (
            <div className="breakdown-row" key={i}>
              <div className="label"><span className={`tranche-tag ${d.nom.toLowerCase()}`}>{d.nom}</span>{fmt(d.kwh, 2)} kWh</div>
              <div className="value">{fmt(d.prixEffectif, 2)} F/kWh</div>
            </div>
          ))}
          <div className="breakdown-row total">
            <div className="label">Total crédité</div>
            <div className="value">{fmt(res.kwhTotal, 2)} kWh</div>
          </div>
        </div>

        <div className="compare-field">
          <div className="field">
            <label>kWh réellement reçus (indiqués sur le ticket/compteur)</label>
            <input type="number" step="0.01" placeholder="ex. 42,10" value={recu} onChange={e => setRecu(e.target.value)} />
          </div>
        </div>

        {anomalie && (
          <div className={`anomaly ${anomalie.ok ? 'ok' : 'verify'}`}>
            {anomalie.ok ? (
              <>
                <div className="title"><i className="ti ti-circle-check" aria-hidden="true"></i>Cohérent</div>
                <div className="desc">
                  L'écart entre le calcul théorique ({fmt(res.kwhTotal, 2)} kWh) et le crédit reçu ({fmt(anomalie.recuNum, 2)} kWh) est de {fmt(Math.abs(anomalie.ecart), 2)} kWh, dans la marge normale d'arrondi.
                </div>
              </>
            ) : (
              <>
                <div className="title"><i className="ti ti-alert-triangle" aria-hidden="true"></i>Écart à vérifier</div>
                <div className="desc">
                  Le calcul théorique donne {fmt(res.kwhTotal, 2)} kWh, contre {fmt(anomalie.recuNum, 2)} kWh reçus — soit un écart de {fmt(Math.abs(anomalie.ecart), 2)} kWh ({fmt(Math.abs(anomalie.ecartPct), 1)}%). Avant de conclure à une anomalie, vérifiez :
                </div>
                <ul>
                  <li>le numéro de compteur saisi correspond bien à celui de la recharge</li>
                  <li>la catégorie tarifaire (DPP) et le cumul mensuel renseigné sont exacts</li>
                  <li>ce n'est pas votre première recharge du mois alors que la case est cochée (ou l'inverse)</li>
                  <li>aucun ajustement ou régularisation n'a été appliqué par SENELEC sur cette recharge</li>
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head"><div className="num">3</div><h2>Appareils électriques</h2></div>
        <div className="card-sub">Renseignez vos appareils et leur usage quotidien pour affiner l'estimation de consommation.</div>

        <div className="preset-row">
          {APP_PRESETS.map((p, i) => (
            <button key={i} type="button" className="preset-chip" onClick={() => addAppFromPreset(p)}>
              <i className={`ti ${p.icon}`} aria-hidden="true" style={{ fontSize: 13 }}></i>{p.nom}
            </button>
          ))}
        </div>

        <div>
          <div className="app-head"><span>Appareil</span><span>Watts</span><span>H/jour</span><span>Qté</span><span></span></div>
          {appEntries.map((a, i) => (
            <div className="app-row" key={i}>
              <input type="text" value={a.nom} onChange={e => updateAppField(i, 'nom', e.target.value)} />
              <input type="number" min="0" step="1" value={a.w} onChange={e => updateAppField(i, 'w', e.target.value)} />
              <input type="number" min="0" max="24" step="0.5" value={a.h} onChange={e => updateAppField(i, 'h', e.target.value)} />
              <input type="number" min="1" step="1" value={a.qte} onChange={e => updateAppField(i, 'qte', e.target.value)} />
              <button className="del" aria-label="Supprimer" onClick={() => removeApp(i)}>×</button>
            </div>
          ))}
        </div>

        <button className="btn outline" onClick={addEmptyApp}><i className="ti ti-plus" aria-hidden="true"></i>Ajouter un appareil</button>

        <div className="breakdown-row total" style={{ marginTop: 14 }}>
          <div className="label">Estimation totale</div>
          <div className="value">{fmt(appTotalKwh, 2)} kWh / jour</div>
        </div>

        <button className="btn teal" style={{ marginTop: 10 }} onClick={sendAppToSuivi}>
          <i className="ti ti-arrow-down" aria-hidden="true"></i>Ajouter au suivi (date ci-dessous)
        </button>
      </div>

      <div className="card">
        <div className="card-head"><div className="num">4</div><h2>Suivi de consommation</h2></div>
        <div className="row2">
          <div className="field">
            <label>Date</label>
            <input type="date" value={consoDate} onChange={e => setConsoDate(e.target.value)} />
          </div>
          <div className="field">
            <label>kWh consommés ce jour</label>
            <input type="number" min="0" step="0.1" placeholder="ex. 4,2" value={consoKwh} onChange={e => setConsoKwh(e.target.value)} />
          </div>
        </div>
        <button className="btn teal" onClick={addConsoEntry}><i className="ti ti-plus" aria-hidden="true"></i>Ajouter au suivi</button>

        {consoPoints.length === 0 ? (
          <div className="foot-note" style={{ marginTop: 14 }}>Aucune entrée pour le moment. Ajoutez vos consommations jour par jour pour voir la courbe.</div>
        ) : (
          <>
            <div style={{ marginTop: 18 }}>
              <ConsoChart points={consoPoints} />
            </div>
            <div className="chart-legend">
              <div className="item"><span className="swatch" style={{ background: '#145C4C' }}></span>T1 · 0–150 kWh</div>
              <div className="item"><span className="swatch" style={{ background: '#B9791E' }}></span>T2 · 151–250 kWh</div>
              <div className="item"><span className="swatch" style={{ background: '#B2472B' }}></span>T3 · au-delà</div>
              <div className="item"><span className="dot" style={{ width: 8, height: 8, borderRadius: '50%', background: '#6E6656', display: 'inline-block' }}></span>relevé réel</div>
              <div className="item"><span className="dot" style={{ width: 8, height: 8, borderRadius: '50%', border: '1.5px solid #6E6656', display: 'inline-block' }}></span>estimation appareils</div>
            </div>
          </>
        )}

        <div style={{ marginTop: 10 }}>
          {[...consoPoints].reverse().map(p => (
            <div className="conso-row" key={p.date}>
              <span className="dot" style={{ background: trancheOf(p.cumul).color }}></span>
              <span className="d">{p.date}{p.source === 'appareils' ? ' · estimé' : ''}</span>
              <span className="k">+{fmt(p.kwh, 1)} kWh</span>
              <button className="del" aria-label="Supprimer" onClick={() => removeConsoEntry(p.date)}>×</button>
            </div>
          ))}
        </div>
      </div>

      <div className="foot-note">
        Calcul basé sur la grille tarifaire DPP SENELEC (RFM 429 F, T1 82 F, T2 136,49 F, T3 159,36 F/kWh) en vigueur depuis le 01/01/2026. Un écart signalé n'est pas une accusation — vérifiez d'abord les points listés ci-dessus.
      </div>
    </div>
  );
}
