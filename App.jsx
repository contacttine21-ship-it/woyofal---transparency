import React, { useState, useMemo, useRef, useEffect } from 'react';

const TRANCHES = [
  { min: 0, max: 150, prix: 82, nom: 'T1' },
  { min: 150, max: 250, prix: 136.49, nom: 'T2' },
  { min: 250, max: Infinity, prix: 159.36, nom: 'T3' }
];
const REDEVANCE = 429;

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
      details.push({ nom: tranche.nom, kwh: kwhAffecte, prixEffectif });
      kwhTotal += kwhAffecte;
      cumul += kwhAffecte;
    }
  }

  return { kwhTotal, redevance, details, dernierTranche: details.length ? details[details.length - 1].nom : '—' };
}

function ConsoChart({ points }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = 180;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const padL = 34, padR = 10, padT = 10, padB = 20;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const maxCumul = Math.max(points[points.length - 1].cumul, 250) * 1.08;

    const x = i => padL + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
    const y = v => padT + plotH - (v / maxCumul) * plotH;

    [150, 250].forEach(seuil => {
      if (seuil > maxCumul) return;
      ctx.strokeStyle = '#B9B2A0';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y(seuil));
      ctx.lineTo(w - padR, y(seuil));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#8A8375';
      ctx.font = '10px IBM Plex Mono, monospace';
      ctx.fillText(seuil + ' kWh', padL + 2, y(seuil) - 3);
    });

    ctx.strokeStyle = '#1F6F5C';
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p, i) => {
      const px = x(i), py = y(p.cumul);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();

    ctx.fillStyle = '#1F6F5C';
    points.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(x(i), y(p.cumul), 3, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = '#8A8375';
    ctx.font = '10px IBM Plex Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText('0', padL - 4, y(0) + 3);
    ctx.fillText(fmt(maxCumul, 0), padL - 4, y(maxCumul) + 8);
    ctx.textAlign = 'left';
    ctx.fillText(points[0].date.slice(5), padL, h - 4);
    ctx.textAlign = 'right';
    ctx.fillText(points[points.length - 1].date.slice(5), w - padR, h - 4);
  }, [points]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: 180 }} />;
}

export default function App() {
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
      return { date: e.date, kwh: e.kwh, cumul: run };
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
      if (existing) return prev.map(e => e.date === consoDate ? { ...e, kwh: appTotalKwh } : e);
      return [...prev, { date: consoDate, kwh: appTotalKwh }];
    });
  }
  function addConsoEntry() {
    const k = parseFloat(consoKwh);
    if (!consoDate || isNaN(k) || k < 0) return;
    setConsoEntries(prev => {
      const existing = prev.find(e => e.date === consoDate);
      if (existing) return prev.map(e => e.date === consoDate ? { ...e, kwh: k } : e);
      return [...prev, { date: consoDate, kwh: k }];
    });
    setConsoKwh('');
  }
  function removeConsoEntry(d) {
    setConsoEntries(prev => prev.filter(e => e.date !== d));
  }

  return (
    <div className="wrap">
      <div className="brand">
        <div>
          <div className="brand-name">Woyofal Transparency</div>
          <div className="brand-tag">Simulateur de recharge — Niveau 1</div>
        </div>
      </div>

      <div className="meter">
        <div className="meter-label">Énergie créditée (estimée)</div>
        <div className="meter-value">{fmt(res.kwhTotal, 2)} <span>kWh</span></div>
        <div className="meter-grid">
          <div className="meter-item"><div className="k">Montant payé</div><div className="v">{fmtF(montant)}</div></div>
          <div className="meter-item"><div className="k">Coût moyen / kWh</div><div className="v">{res.kwhTotal > 0 ? fmt(coutMoyen, 1) + ' F' : '— F'}</div></div>
          <div className="meter-item"><div className="k">Tranche atteinte</div><div className="v">{res.dernierTranche}</div></div>
          <div className="meter-item"><div className="k">Redevance déduite</div><div className="v">{fmtF(res.redevance)}</div></div>
        </div>
      </div>

      <div className="card">
        <h2>1. Votre recharge</h2>
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
        <h2>2. Analyse recharge</h2>
        <div>
          {res.redevance > 0 && (
            <div className="breakdown-row">
              <div className="label">Redevance (1re recharge du mois)</div>
              <div className="value">-{fmtF(res.redevance)}</div>
            </div>
          )}
          {res.details.map((d, i) => (
            <div className="breakdown-row" key={i}>
              <div className="label"><span className="tranche-tag">{d.nom}</span>{fmt(d.kwh, 2)} kWh</div>
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
                <div className="title">Cohérent</div>
                <div className="desc">
                  L'écart entre le calcul théorique ({fmt(res.kwhTotal, 2)} kWh) et le crédit reçu ({fmt(anomalie.recuNum, 2)} kWh) est de {fmt(Math.abs(anomalie.ecart), 2)} kWh, dans la marge normale d'arrondi.
                </div>
              </>
            ) : (
              <>
                <div className="title">Écart à vérifier</div>
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
        <h2>3. Appareils électriques</h2>
        <div className="foot-note left">Renseignez vos appareils et leur usage quotidien pour affiner l'estimation de consommation.</div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {APP_PRESETS.map((p, i) => (
            <button key={i} type="button" className="preset-chip" onClick={() => addAppFromPreset(p)}>+ {p.nom}</button>
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

        <button className="btn outline" onClick={addEmptyApp}>+ Ajouter un appareil</button>

        <div className="breakdown-row total" style={{ marginTop: 14 }}>
          <div className="label">Estimation totale</div>
          <div className="value">{fmt(appTotalKwh, 2)} kWh / jour</div>
        </div>

        <button className="btn teal" style={{ marginTop: 10 }} onClick={sendAppToSuivi}>
          Ajouter cette estimation au suivi (date ci-dessous)
        </button>
      </div>

      <div className="card">
        <h2>4. Suivi de consommation</h2>
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
        <button className="btn teal" onClick={addConsoEntry}>Ajouter au suivi</button>

        {consoPoints.length === 0 ? (
          <div className="foot-note" style={{ marginTop: 14 }}>Aucune entrée pour le moment. Ajoutez vos consommations jour par jour pour voir la courbe.</div>
        ) : (
          <div style={{ marginTop: 18 }}>
            <ConsoChart points={consoPoints} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <span className="foot-note" style={{ margin: 0 }}>● cumul kWh</span>
              <span className="foot-note" style={{ margin: 0 }}>┄ seuils T1/T2</span>
            </div>
          </div>
        )}

        <div style={{ marginTop: 10 }}>
          {[...consoPoints].reverse().map(p => (
            <div className="conso-row" key={p.date}>
              <span className="d">{p.date}</span>
              <span className="k">+{fmt(p.kwh, 1)} kWh</span>
              <span className="k">cumul {fmt(p.cumul, 1)}</span>
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
