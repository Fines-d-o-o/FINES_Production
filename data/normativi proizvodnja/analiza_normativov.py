# -*- coding: utf-8 -*-
"""
Analiza normativov proizvodnje (klasifikacije 096, 097, 099 in proizvodni unikati 110).

Vhod (ista mapa):
  - "nalogi od 2025 do danes.xlsx"  (izvoz delovnih nalogov - količine)
  - "Porocano_delo.xlsx"            (izvoz poročanega dela - štempljanje)
  - normativi iz baze (spl_normativi) - prebere se prek Supabase REST (.env.local),
    če baza ni dosegljiva, se uporabi ../Normativi_V2.xlsx ("Vsi normativi").

Izhod: "Analiza normativov proizvodnja.xlsx"

Zagon:  py analiza_normativov.py
"""
import getpass
import json
import math
import os
import re
import sys
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
import skupine  # noqa: E402

MAPA = Path(__file__).resolve().parent
KOREN = MAPA.parent.parent
IZHOD = MAPA / "Analiza normativov proizvodnja.xlsx"

KLASIFIKACIJE = ["096", "097", "099", "110"]

# Pravilo izločanja: upoštevajo se vrednosti v pasu [SPODNJA × mediana, ZGORNJA × mediana].
# Preverjeno na primeru 1, 1.5, 1, 3, 3, 3.5, 3, 4, 2.5, 3.2, 3, 3, 12, 15 -> ostane 2.5 - 4.
SPODNJA = 0.6
ZGORNJA = 1.7
MIN_ZA_IZLOCANJE = 4      # pod tem številom nalogov se ne izloča (premalo podatkov)
PRAG_PRICAKOVANA = 0.5    # operacija je "pričakovana", če je štempljana na >= 50 % nalogov

# ---------------------------------------------------------------------------
# Mapiranje operacij ERP -> skupina -> oddelek (P / M / E / T).  None = ne šteje.
# ---------------------------------------------------------------------------
OPERACIJE = {
    2: ("Programiranje", "P", "Priprava programa - čas na nalog, deli se s kosi"),
    3: ("Razrez", "P", ""),
    5: ("Razrez", "P", "Prebijanje"),
    50: ("Razrez", "P", "TS: Razrez"),
    53: ("Razrez", "P", "Razrez - ostalo"),
    6: ("Krivljenje", "P", ""),
    48: ("Krivljenje", "P", "TS: Krivljenje"),
    32: ("Krivljenje", "P", "TS: Preoblikovanje - vlek"),
    7: ("Vijaki in matice", "P", "Varjenje vijakov"),
    8: ("Vijaki in matice", "P", "Vtiskovanje matic"),
    9: ("Uporovno varjenje", "P", ""),
    10: ("Varjenje", "P", "TIG"),
    28: ("Varjenje", "P", "MIG/MAG"),
    47: ("Varjenje", "P", "Laser"),
    27: ("Varjenje", "P", "Varjenje - podpora"),
    51: ("Varjenje", "P", "TS: Sestavljanje in varjenje"),
    11: ("Brušenje", "P", ""),
    12: ("Odstranjevanje folije", "*", "Deli se po oddelku delavca (proizvodnja / montaža)"),
    14: ("Vrtanje", "P", ""),
    13: ("Sestavljanje", "*", "Deli se po oddelku delavca (proizvodnja / montaža)"),
    22: ("Sestavljanje", "P", "Sestavljanje - vrata (vedno proizvodnja)"),
    24: ("Sestavljanje", "P", "Sestavljanje - prezračevanje (vedno proizvodnja)"),
    25: ("Sestavljanje", "P", "Sestavljanje - generator vlaženja (vedno proizvodnja)"),
    26: ("Sestavljanje", "P", "Razrez izolacije (vedno proizvodnja)"),
    15: ("Elektro", "E", "Vezava proizvoda"),
    16: ("Elektro", "E", "Vezava ožičenja"),
    17: ("Elektro", "E", "Izdelava ožičenja"),
    23: ("Elektro", "E", "Priprava krmilnika"),
    18: ("Preizkušanje", "T", ""),
    19: ("Čiščenje in pakiranje", "M", "Čiščenje in zaključno sestavljanje"),
    20: ("Čiščenje in pakiranje", "M", "Pakiranje"),
}
IZLOCENE_OP_OPIS = "logistika, vzdrževanje, inventura, ostalo"
# Analiza (prisotnost, izločanje, normativ) teče na teh skupinah - mešani skupini nista razdeljeni.
SKUPINE = [
    "Programiranje", "Razrez", "Krivljenje", "Vijaki in matice", "Uporovno varjenje",
    "Varjenje", "Brušenje", "Odstranjevanje folije", "Vrtanje", "Sestavljanje",
    "Elektro", "Preizkušanje", "Čiščenje in pakiranje",
]
# Mešani skupini: del dela opravi proizvodnja, del montaža (po oddelku delavca, ki je štempljal).
# Delež se uporabi šele pri razdelitvi normativa na oddelke in operacije proizvodnje.
MESANE = ["Odstranjevanje folije", "Sestavljanje"]
ODDELEK_SKUPINE = {"Odstranjevanje folije": "*", "Sestavljanje": "*"}
for _k, (_s, _o, _) in OPERACIJE.items():
    if _s not in ODDELEK_SKUPINE:
        ODDELEK_SKUPINE[_s] = _o
# Operacije proizvodnje za tabelo normativov operacij (mešani skupini samo proizvodni del)
P_IZHOD = ["Programiranje", "Razrez", "Krivljenje", "Vijaki in matice", "Uporovno varjenje", "Varjenje",
           "Brušenje", "Odstranjevanje folije - proizvodnja", "Vrtanje", "Sestavljanje - proizvodnja"]

# Predlog: skupina operacij proizvodnje -> delovno mesto (fp_delovna_mesta)
DELOVNO_MESTO = {
    "Programiranje": "Razrez", "Razrez": "Razrez", "Krivljenje": "Krivljenje - 1 / 2",
    "Uporovno varjenje": "Varjenje - točkovno", "Varjenje": "Varjenje - malo / veliko",
    "Brušenje": "Brušenje", "Vijaki in matice": "Dodatno delo", "Vrtanje": "Dodatno delo",
    "Odstranjevanje folije - proizvodnja": "Dodatno delo", "Sestavljanje - proizvodnja": "Dodatno delo",
}

# Oddelek delavca: iz deleža ur na izrazito proizvodnih / montažnih operacijah (2025-26).
# PRAG: delavec je "proizvodnja", če ima vsaj 75 % takih ur v proizvodnji. Ročni popravki spodaj.
OP_IZRAZITO_P = {2, 3, 5, 6, 7, 8, 9, 10, 11, 14, 27, 28, 32, 47, 48, 50, 51, 53}
OP_IZRAZITO_M = {15, 16, 17, 18, 19, 20, 23}
PRAG_DELAVEC_P = 0.75
# Odločitev 2026-11-25: Ilić in Steklačič sta v proizvodnji; Kranjc (zdaj na drugi poziciji),
# Kastelic in Gaćić (ne delata več) - vse, kar so štempljali, gre v proizvodnjo.
DELAVEC_ROCNO = {76: "P", 41: "P", 46: "P", 73: "P", 68: "P"}  # šifra delavca ERP -> "P" / "M"
# Osnove (kovinski del) se v celoti delajo v proizvodnji - mešani operaciji gresta 100 % v proizvodnjo,
# ne glede na delavca (štempljanje montaže na osnovah je verjetno napačno).
VEDNO_P = re.compile(r"^\s*OSNOVA\b", re.I)
# Elektronika (sestavi 099) ostane v celoti v montaži - mešani operaciji gresta 100 % v montažo (2026-11-25).
# Kovinski deli z "elektro" v nazivu (096 / 097, npr. Plošča elektro OD-C, prirobnice) niso elektronika.
VEDNO_M = re.compile(r"ELEKTRONIK|PLOŠČA ELEKTRO|DOZA ELEKTRO|KRMIL|KOMPLET POVEZOVALNI ELEKTRO", re.I)
ODDELKI = [("P", "Proizvodnja"), ("M", "Montaža"), ("E", "Elektro"), ("T", "Testiranje")]

# 110: v obseg spadajo samo proizvodni unikati (kovinski deli), ne celotne naprave
UNIKAT_NAPRAVA = re.compile(r"^(UNIKAT\s*-\s*)?(PEČ|PEC|VZHAJALNIK|NAPA|VITRINA|HLADILN|PROTOTIP)\b", re.I)


# zvarjeni / sestavljeni kovinski deli: samo razrez / krivljenje ... brez varjenja ali sestavljanja je sumljivo
SESTAVLJEN = re.compile(r"(ZVARJ|KOVINSKI DEL|OSNOVA|KOMORA|PODSTAVEK|VODILA|NOSILEC)", re.I)
SAMO_PRIPRAVA = {"Programiranje", "Razrez", "Krivljenje", "Brušenje", "Odstranjevanje folije", "Vrtanje",
                 "Vijaki in matice"}


def st(x, d=2):
    """Število v slovenskem zapisu."""
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return "-"
    if d == 2 and abs(x) < 0.1:
        d = 3
    return f"{x:.{d}f}".replace(".", ",")


# ---------------------------------------------------------------------------
# Branje podatkov
# ---------------------------------------------------------------------------
def preberi_naloge():
    n = pd.read_excel(MAPA / "nalogi od 2025 do danes.xlsx")
    n.columns = [str(c).strip() for c in n.columns]
    n = n.rename(columns={
        "Zap.številka naloga": "DN", "Koda artikla": "Sifra", "Naziv artikla": "Naziv",
        "Razpisana količina": "Razpisana", "Izdelana količina": "Izdelana",
        "Status naloga": "StatusNaloga", "Tip naloga": "TipNaloga",
    })
    n["Sifra"] = n["Sifra"].astype(str).str.strip()
    n["Klas"] = n["Sifra"].str[:3]
    n["DatumD"] = pd.to_datetime(n["Datum"], format="%d.%m.%Y", errors="coerce")
    n["Zakljucen"] = n["StatusNaloga"].astype(str).str.startswith("Izdelan")
    return n


def preberi_porocano():
    p = pd.read_excel(MAPA / "Porocano_delo.xlsx", header=None, skiprows=3)
    p.columns = ["DN", "Opis", "Status", "Datum", "Rok", "Sifra", "Naziv", "Zacetek", "Konec",
                 "Delavec", "Ime", "Op", "OpNaziv", "DM", "DMNaziv", "Ure", "Cena", "Vrednost"]
    p["Ure"] = (p["Ure"].astype(str).str.replace(".", "", regex=False)
                .str.replace(",", ".", regex=False).astype(float))
    p = p[p["Op"].notna() & (p["Ure"] > 0)].copy()
    p["Op"] = p["Op"].astype(int)
    return p


def preberi_normative_baza():
    env = KOREN / ".env.local"
    try:
        vals = {}
        for line in env.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                vals[k.strip()] = v.strip()
        url, key = vals["NEXT_PUBLIC_SUPABASE_URL"], vals["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]
        # Baza je dostopna samo prijavljenim (041) - prijava z uporabnikom aplikacije.
        # E-pošta / geslo iz okolja (FINES_EMAIL, FINES_GESLO), sicer vprašanje v konzoli.
        email = os.environ.get("FINES_EMAIL") or (input("E-pošta (prijava v bazo): ") if sys.stdin.isatty() else "")
        geslo = os.environ.get("FINES_GESLO") or (getpass.getpass("Geslo: ") if sys.stdin.isatty() else "")
        if not email or not geslo:
            raise RuntimeError("ni prijave - nastavi FINES_EMAIL in FINES_GESLO")
        req = urllib.request.Request(
            f"{url}/auth/v1/token?grant_type=password", method="POST",
            data=json.dumps({"email": email, "password": geslo}).encode(),
            headers={"apikey": key, "Content-Type": "application/json"})
        zeton = json.loads(urllib.request.urlopen(req, timeout=30).read())["access_token"]
        vrstice, off = [], 0
        while True:
            q = (f"{url}/rest/v1/spl_normativi?select=ident,naziv,normativ_skupni,normativ_proizvodnja,"
                 f"normativ_montaza,normativ_elektro,normativ_testiranje,visible&order=id&offset={off}&limit=1000")
            req = urllib.request.Request(q, headers={"apikey": key, "Authorization": f"Bearer {zeton}"})
            del_ = json.loads(urllib.request.urlopen(req, timeout=30).read())
            vrstice += del_
            if len(del_) < 1000:
                break
            off += 1000
        d = pd.DataFrame(vrstice)
        d = d[d["visible"]]
        return d.set_index("ident")["normativ_skupni"].astype(float), "baza spl_normativi"
    except Exception as e:  # noqa: BLE001
        print("POZOR: baza ni dosegljiva, uporabim Normativi_V2.xlsx (lahko je zastarel):", e)
        d = pd.read_excel(KOREN / "data" / "Normativi_V2.xlsx", "Vsi normativi")
        return d.set_index(d.columns[0])["Normativ"].astype(float), "Normativi_V2.xlsx"


# ---------------------------------------------------------------------------
# Izločanje
# ---------------------------------------------------------------------------
def pas(vrednosti):
    """Vrne (spodnja, zgornja meja, mediana) ali None, če je premalo vrednosti."""
    v = [x for x in vrednosti if x > 0]
    if len(v) < MIN_ZA_IZLOCANJE:
        return None
    m = float(np.median(v))
    return SPODNJA * m, ZGORNJA * m, m


def test_pravila():
    primer = [1, 1.5, 1, 3, 3, 3.5, 3, 4, 2.5, 3.2, 3, 3, 12, 15]
    lo, hi, _ = pas(primer)
    ostane = sorted(x for x in primer if lo <= x <= hi)
    assert min(ostane) == 2.5 and max(ostane) == 4, ostane
    return ostane


# ---------------------------------------------------------------------------
# Analiza
# ---------------------------------------------------------------------------
def oddelki_delavcev(p):
    """Oddelek delavca (P / M) iz deleža ur na izrazito proizvodnih operacijah v letih 2025-26."""
    q = p[p["Datum"].astype(str).str[-4:].isin(["2025", "2026"])]
    q = q.assign(k=q["Op"].map(lambda o: "P" if o in OP_IZRAZITO_P else ("M" if o in OP_IZRAZITO_M else "x")))
    t = q.pivot_table(index="Delavec", columns="k", values="Ure", aggfunc="sum").fillna(0)
    for c in ("P", "M"):
        if c not in t.columns:
            t[c] = 0.0
    t["Ime"] = q.groupby("Delavec")["Ime"].first()
    t["Sestavljanje"] = q[q["Op"] == 13].groupby("Delavec")["Ure"].sum()
    t["Folija"] = q[q["Op"] == 12].groupby("Delavec")["Ure"].sum()
    t = t.fillna({"Sestavljanje": 0, "Folija": 0})
    t["DelezP"] = t["P"] / (t["P"] + t["M"]).replace(0, np.nan)
    t["Oddelek"] = np.where(t["DelezP"].fillna(0) >= PRAG_DELAVEC_P, "P", "M")
    t["Rocno"] = False
    for d, o in DELAVEC_ROCNO.items():
        if d in t.index:
            t.loc[d, "Oddelek"], t.loc[d, "Rocno"] = o, True
    return t.sort_values(["Oddelek", "DelezP"], ascending=[False, False])


def v_obsegu_110(naziv, delez_p):
    if UNIKAT_NAPRAVA.search(str(naziv)):
        return False, "naprava (peč / vzhajalnik / napa ...) - normativ montaže, ni proizvodni del"
    if delez_p is not None and delez_p < 0.6:
        return False, f"pretežno montažne / elektro operacije ({st(delez_p * 100, 0)} % proizvodnje)"
    return True, "proizvodni unikat"


def analiziraj():
    test_pravila()
    n = preberi_naloge()
    p = preberi_porocano()
    obst, vir_obst = preberi_normative_baza()

    delavci = oddelki_delavcev(p)
    odd_del = delavci["Oddelek"].to_dict()
    p["Skupina"] = p["Op"].map(lambda o: OPERACIJE.get(o, (None,))[0])
    # SkupinaDel: mešani skupini razdeljeni na "- proizvodnja" / "- montaža" (op. 22-26 vedno proizvodnja)
    p["SkupinaDel"] = p["Skupina"]
    mes = p["Skupina"].isin(MESANE)
    po_delavcu = p["Op"].map(lambda o: OPERACIJE.get(o, (None, None))[1] == "*")
    vedno_p = set(n.loc[n["Naziv"].astype(str).map(lambda x: bool(VEDNO_P.match(x))), "DN"])
    vedno_m = set(n.loc[n["Sifra"].str.startswith("099") &
                        n["Naziv"].astype(str).map(lambda x: bool(VEDNO_M.search(x))), "DN"])
    p.loc[mes, "SkupinaDel"] = [
        f"{sk} - {'montaža' if pd_ and dn in vedno_m else 'proizvodnja' if (not pd_) or dn in vedno_p or odd_del.get(dl, 'M') == 'P' else 'montaža'}"
        for sk, dl, pd_, dn in zip(p.loc[mes, "Skupina"], p.loc[mes, "Delavec"], po_delavcu[mes], p.loc[mes, "DN"])]
    izl_ur = p[p["Skupina"].isna()].groupby("DN")["Ure"].sum()
    pv = p[p["Skupina"].notna()]
    ure_dn_sk = pv.pivot_table(index="DN", columns="Skupina", values="Ure", aggfunc="sum").fillna(0)
    for s in SKUPINE:
        if s not in ure_dn_sk.columns:
            ure_dn_sk[s] = 0.0
    ure_dn_sk = ure_dn_sk[SKUPINE]
    st_delavcev = pv.groupby("DN")["Delavec"].nunique()
    # ure proizvodnega dela mešanih skupin po nalogu
    ure_dn_mesP = pv[pv["SkupinaDel"].str.endswith(" - proizvodnja", na=False)] \
        .pivot_table(index="DN", columns="Skupina", values="Ure", aggfunc="sum").fillna(0)

    s = n[n["Klas"].isin(KLASIFIKACIJE)].copy()

    # -------- seznam šifer
    seznam = []
    for sif, g in s.groupby("Sifra"):
        naziv = g.sort_values("DatumD")["Naziv"].iloc[-1]
        dns = g["DN"].tolist()
        u = ure_dn_sk.reindex(dns).fillna(0)
        tot = u.sum(axis=1)
        p_ure = sum(u[c].sum() for c in SKUPINE if ODDELEK_SKUPINE[c] in ("P", "*"))
        delez_p = (p_ure / tot.sum()) if tot.sum() > 0 else None
        klas = sif[:3]
        if klas == "110":
            vob, razlog = v_obsegu_110(naziv, delez_p)
        else:
            vob, razlog = True, ""
        ob = obst.get(sif, np.nan)
        seznam.append({
            "Sifra": sif, "Naziv": naziv, "Klas": klas,
            "TipNaloga": g["TipNaloga"].mode().iloc[0],
            "StNalogov": len(g), "StZakljucenih": int(g["Zakljucen"].sum()),
            "StStempljanih": int((tot > 0).sum()),
            "Izdelanih": int(g["Izdelana"].sum()),
            "PrviNalog": g["DatumD"].min(), "ZadnjiNalog": g["DatumD"].max(),
            "UreSkupaj": float(tot.sum()),
            "Obstojeci": ob if (isinstance(ob, float) and ob > 0) or (not isinstance(ob, float)) else np.nan,
            "VBazi": sif in obst.index,
            "VObsegu": vob, "RazlogObseg": razlog,
        })
    seznam = pd.DataFrame(seznam)
    seznam["Obstojeci"] = seznam["Sifra"].map(lambda x: obst.get(x, np.nan))
    seznam["ImaNormativ"] = seznam["Obstojeci"].fillna(0) > 0

    # -------- analiza po šifri
    predlogi, detajl = [], []
    for _, r in seznam.iterrows():
        sif = r["Sifra"]
        g = s[s["Sifra"] == sif].sort_values("DatumD")
        rows = []
        for _, d in g.iterrows():
            u = ure_dn_sk.loc[d["DN"]] if d["DN"] in ure_dn_sk.index else pd.Series(0.0, index=SKUPINE)
            tot = float(u.sum())
            kos = d["Izdelana"] if d["Izdelana"] > 0 else 0
            razlog = ""
            if not d["Zakljucen"]:
                razlog = "nalog še ni zaključen"
            elif tot <= 0:
                razlog = "ni štempljanja"
            elif kos <= 0:
                razlog = "izdelana količina 0"
            rows.append({
                "DN": int(d["DN"]), "Datum": d["DatumD"], "Status": d["StatusNaloga"],
                "Razpisana": d["Razpisana"], "Izdelana": d["Izdelana"], "Ure": tot,
                "Delavcev": int(st_delavcev.get(d["DN"], 0)),
                "IzlUre": float(izl_ur.get(d["DN"], 0)),
                "hkos": (tot / kos) if kos > 0 and tot > 0 else np.nan,
                "ops": {c: (u[c] / kos if kos > 0 else np.nan) for c in SKUPINE},
                "opsure": {c: u[c] for c in SKUPINE},
                "Razlog": razlog, "Kand": razlog == "",
                "Upostevan": False, "OpIzl": set(), "Manjka": [],
            })
        kand = [x for x in rows if x["Kand"]]
        nk = len(kand)
        rez = {"Sifra": sif, "Naziv": r["Naziv"], "Klas": r["Klas"], "Obstojeci": r["Obstojeci"],
               "VObsegu": r["VObsegu"], "StNalogov": len(rows), "StKand": nk}

        if nk == 0:
            razlogi = pd.Series([x["Razlog"] for x in rows]).value_counts()
            rez.update({"Predlog": np.nan, "Zanesljivost": "X", "Metoda": "",
                        "Komentar": "Ni uporabnih nalogov - " + ", ".join(
                            f"{k} ({v}×)" for k, v in razlogi.items()) + ". Normativa ni mogoče izračunati."})
            for c in SKUPINE:
                rez[c] = np.nan
            predlogi.append(rez)
            detajl.append((rez, rows))
            continue

        # pričakovane operacije
        prisot = {c: sum(1 for x in kand if x["opsure"][c] > 0) for c in SKUPINE}
        pricak = [c for c in SKUPINE if prisot[c] > 0 and prisot[c] / nk >= PRAG_PRICAKOVANA]
        obcasne = [c for c in SKUPINE if 0 < prisot[c] and c not in pricak]

        # normativ po operaciji (samo nalogi, kjer je operacija štempljana)
        op_norm, op_info = {}, {}
        for c in SKUPINE:
            vals = [(x, x["ops"][c]) for x in kand if x["opsure"][c] > 0]
            if not vals:
                op_norm[c] = np.nan
                continue
            b = pas([v for _, v in vals])
            ost = []
            for x, v in vals:
                if b and not (b[0] <= v <= b[1]):
                    x["OpIzl"].add(c)
                else:
                    ost.append(v)
            if not ost:  # bimodalno - pas okoli mediane izloči vse, ne izločamo
                ost = [v for _, v in vals]
                for x, _ in vals:
                    x["OpIzl"].discard(c)
            op_norm[c] = float(np.mean(ost)) if c in pricak else np.nan
            op_info[c] = (len(ost), len(vals))
        vsota_op = float(np.nansum([op_norm[c] for c in pricak])) if pricak else np.nan

        # popolni nalogi = imajo vse pričakovane operacije, ki nosijo >= 10 % vsote
        nosilne = [c for c in pricak if vsota_op > 0 and op_norm[c] / vsota_op >= 0.10]
        for x in kand:
            x["Manjka"] = [c for c in nosilne if x["opsure"][c] <= 0]
        popolni = [x for x in kand if not x["Manjka"]]

        # izločanje po skupnem h/kos (na popolnih nalogih)
        b = pas([x["hkos"] for x in popolni])
        izl_nizki, izl_visoki = [], []
        for x in kand:
            if x["Manjka"]:
                x["Razlog"] = "manjka " + ", ".join(m.lower() for m in x["Manjka"])
                continue
            if b and x["hkos"] < b[0]:
                x["Razlog"] = f"prenizko (< {st(b[0])} h/kos = {int(SPODNJA*100)} % mediane)"
                izl_nizki.append(x)
            elif b and x["hkos"] > b[1]:
                x["Razlog"] = f"previsoko (> {st(b[1])} h/kos = {int(ZGORNJA*100)} % mediane)"
                izl_visoki.append(x)
            else:
                x["Upostevan"] = True
        upo = [x for x in kand if x["Upostevan"]]
        bimodalno = False
        if not upo and popolni:  # pas izloči vse - vrednosti v dveh skupinah, ne izločamo
            bimodalno = True
            izl_nizki, izl_visoki = [], []
            for x in popolni:
                x["Upostevan"], x["Razlog"] = True, "upoštevan (dve skupini vrednosti)"
            upo = popolni
        hk = [x["hkos"] for x in upo]
        povp_dn = float(np.mean(hk)) if hk else np.nan
        sum_ure = sum(x["Ure"] for x in upo)
        sum_kos = sum(x["Izdelana"] for x in upo)
        utez = sum_ure / sum_kos if sum_kos else np.nan

        # odločitev
        if len(upo) >= 3:
            predlog, metoda = povp_dn, "povprečje upoštevanih nalogov"
        elif not np.isnan(vsota_op) and vsota_op > 0:
            predlog, metoda = vsota_op, "vsota operacij"
        else:
            predlog, metoda = povp_dn, "povprečje nalogov"

        cv = float(np.std(hk) / np.mean(hk)) if len(hk) >= 2 and np.mean(hk) > 0 else np.nan
        razl = (vsota_op - povp_dn) / povp_dn if hk and povp_dn > 0 and not np.isnan(vsota_op) else np.nan
        if len(upo) >= 5 and not bimodalno and (np.isnan(cv) or cv <= 0.35) and (np.isnan(razl) or abs(razl) <= 0.25):
            zan = "A"
        elif len(upo) >= 3 or (nk >= 3 and not np.isnan(vsota_op)):
            zan = "B"
        else:
            zan = "C"

        # vpliv serije
        serija = ""
        if len(upo) >= 4:
            q = pd.Series([x["Izdelana"] for x in upo])
            h = pd.Series(hk)
            if q.nunique() > 1:
                rho = q.rank().corr(h.rank())
                if rho <= -0.6:
                    serija = ("Izrazit vpliv velikosti serije (manjše serije imajo višji h/kos, "
                              f"korelacija {st(rho)}) - normativ velja za serije okoli "
                              f"{int(np.median(q))} kos.")

        # komentar
        k = []
        k.append(f"Upoštevanih {len(upo)} od {len(rows)} nalogov" +
                 (f" ({nk} zaključenih s štempljanjem)." if nk != len(rows) else "."))
        neup = [x for x in rows if not x["Kand"]]
        if neup:
            k.append("Ni uporabnih: " + "; ".join(f"{x['DN']} ({x['Razlog']})" for x in neup[:6]) +
                     (f" in še {len(neup) - 6}" if len(neup) > 6 else "") + ".")
        manjk = [x for x in kand if x["Manjka"]]
        if manjk:
            k.append("Izločeni zaradi manjkajočih operacij: " + "; ".join(
                f"{x['DN']} - {st(x['hkos'])} h/kos, manjka {', '.join(m.lower() for m in x['Manjka'])}"
                for x in manjk[:6]) + (f" in še {len(manjk) - 6}" if len(manjk) > 6 else "") + ".")
        if izl_nizki or izl_visoki:
            k.append(f"Izločeni kot odstopanje (mediana {st(b[2])} h/kos, pas {st(b[0])}-{st(b[1])}): " +
                     "; ".join(f"{x['DN']} - {st(x['hkos'])}" for x in izl_nizki + izl_visoki) + ".")
        if hk:
            k.append(f"Upoštevani h/kos: {st(min(hk))}-{st(max(hk))}, povprečje {st(povp_dn)}"
                     + (f", tehtano (Σure/Σkos) {st(utez)}" if len(hk) > 1 else "") + ".")
        if not np.isnan(vsota_op):
            k.append(f"Vsota normativov operacij {st(vsota_op)} h/kos" +
                     (f" (razlika {'+' if razl >= 0 else ''}{st(razl * 100, 0)} % glede na povprečje nalogov)"
                      if not np.isnan(razl) else "") + ".")
        k.append("Operacije: " + ", ".join(f"{c.lower()} {prisot[c]}/{nk}" for c in pricak) + ".")
        if obcasne:
            k.append("Občasne, ne štejejo v normativ: " + ", ".join(
                f"{c.lower()} {prisot[c]}/{nk}" for c in obcasne) + ".")
        opizl = {c: sum(1 for x in kand if c in x["OpIzl"]) for c in pricak}
        if any(opizl.values()):
            k.append("Pri operacijah izločene vrednosti: " + ", ".join(
                f"{c.lower()} {v}×" for c, v in opizl.items() if v) + ".")
        pozor_povp = False
        if bimodalno:
            k.append("POZOR: vrednosti so v dveh ločenih skupinah - izločanje ni mogoče, preveri ročno.")
            zan_bimodalno = True
        if len(upo) < 3:
            k.append("Premalo nalogov za izločanje odstopanj - vrednost je predpostavka, preveri ročno.")
        if not np.isnan(cv) and cv > 0.35:
            k.append(f"Velik raztros upoštevanih ({st(cv * 100, 0)} %).")
        if serija:
            k.append(serija)
        if (r["Klas"] != "096" and pricak and set(pricak) <= SAMO_PRIPRAVA
                and SESTAVLJEN.search(str(r["Naziv"]))):
            k.append("POZOR: zvarjen / sestavljen del, štempljano pa samo " +
                     ", ".join(c.lower() for c in pricak) + " (brez varjenja / sestavljanja) - " +
                     ("verjetno nepopolno štempljanje, normativ je najverjetneje prenizek." if len(upo) < 3 else
                      "enako na vseh upoštevanih nalogih - morda se varjenje štemplja drugam; preveri, ali je normativ popoln."))
            if len(upo) < 3:
                zan = "C"
                pozor_povp = True
        kos_upo = [x["Izdelana"] for x in upo] or [x["Izdelana"] for x in kand]
        a_, b_ = int(min(kos_upo)), int(max(kos_upo))
        k.append(f"Velikost serij {a_}-{b_} kos." if a_ != b_ else f"Velikost serije {a_} kos.")
        if r["Obstojeci"] > 0:
            k.append(f"Obstoječi normativ v bazi {st(r['Obstojeci'])} h/kos "
                     f"(predlog {'+' if predlog >= r['Obstojeci'] else ''}{st((predlog / r['Obstojeci'] - 1) * 100, 0)} %).")

        rez.update({"Predlog": predlog, "Zanesljivost": zan, "Metoda": metoda,
                    "StUpo": len(upo), "Min": min(hk) if hk else np.nan, "Max": max(hk) if hk else np.nan,
                    "PovpDN": povp_dn, "Utez": utez, "VsotaOp": vsota_op, "CV": cv, "IzlociPovp": pozor_povp,
                    "Komentar": " ".join(k)})
        for c in SKUPINE:
            rez[c] = op_norm[c]
        # delež proizvodnje pri mešanih skupinah (po delavcih, na uporabnih nalogih)
        delP = {}
        for c in MESANE:
            vse = sum(x["opsure"][c] for x in kand)
            pdel = sum(float(ure_dn_mesP.at[x["DN"], c]) if (x["DN"] in ure_dn_mesP.index and c in ure_dn_mesP.columns)
                       else 0.0 for x in kand)
            delP[c] = (pdel / vse) if vse > 0 else 1.0
        for c in MESANE:
            on = op_norm[c] if c in pricak and not np.isnan(op_norm[c]) else np.nan
            rez[f"{c} - proizvodnja"] = on * delP[c] if not np.isnan(on) else np.nan
            rez[f"{c} - montaža"] = on * (1 - delP[c]) if not np.isnan(on) else np.nan
            rez[f"Delez P {c}"] = delP[c] if not np.isnan(on) else np.nan
        mes_t = [f"{c.lower()} {st(delP[c] * 100, 0)} % proizvodnja / {st((1 - delP[c]) * 100, 0)} % montaža"
                 for c in MESANE if c in pricak]
        if mes_t:
            rez["Komentar"] += " Po delavcih: " + "; ".join(mes_t) + "."
        # oddelki: deleži iz operacij, preračunani na predlog (vsota = skupni)
        odd = {o: 0.0 for o, _ in ODDELKI}
        for c in pricak:
            if np.isnan(op_norm[c]):
                continue
            if ODDELEK_SKUPINE[c] == "*":
                odd["P"] += op_norm[c] * delP[c]
                odd["M"] += op_norm[c] * (1 - delP[c])
            else:
                odd[ODDELEK_SKUPINE[c]] += op_norm[c]
        so = sum(odd.values())
        if so > 0 and not np.isnan(predlog):
            pr3 = max(round(predlog, 3), 0.001)  # baza hrani 3 decimalke - ne sme biti 0
            vals = {o: round(odd[o] / so * pr3, 3) for o in odd}
            ost = round(pr3 - sum(vals.values()), 3)
            o_max = max(vals, key=vals.get)
            vals[o_max] = round(vals[o_max] + ost, 3)
            for o in vals:
                rez["Odd_" + o] = vals[o]
        predlogi.append(rez)
        detajl.append((rez, rows))

    predlogi = pd.DataFrame(predlogi)
    return seznam, predlogi, detajl, vir_obst, p, delavci


# ---------------------------------------------------------------------------
# Povprečenje podobnih izdelkov (skupine.py)
# ---------------------------------------------------------------------------
UTEZ = {"A": 9, "B": 3, "C": 1}
P_SKUPINE = P_IZHOD


def korak(v):
    return 0.1 if v >= 1 else (0.05 if v >= 0.1 else 0.01)


def zaokrozi(v, smer):
    """smer: -1 navzdol, +1 navzgor, 0 najbližje. Vsaj 0,01, največ 2 decimalki."""
    k = korak(v)
    x = v / k
    n = math.floor(x + 1e-9) if smer < 0 else (math.ceil(x - 1e-9) if smer > 0 else round(x))
    return round(max(n * k, 0.01), 2)


def razdeli(skupno, deli):
    """Razdeli skupno (3 decimalke) po deležih; ostanek zaokroževanja gre največjemu."""
    vs = sum(v for v in deli.values() if v and v > 0)
    if vs <= 0:
        return None
    out = {k: round((v if v and v > 0 else 0) / vs * skupno, 3) for k, v in deli.items()}
    kmax = max(out, key=out.get)
    out[kmax] = round(out[kmax] + round(skupno - sum(out.values()), 3), 3)
    return out


def povprecenje(predlogi):
    v = predlogi[predlogi["VObsegu"]].copy()
    v["Skupina"] = v["Naziv"].map(skupine.skupina)
    v["Uporaben"] = (v["Predlog"].fillna(0) > 0) & v["Zanesljivost"].isin(list("ABC")) & \
        ~v.get("IzlociPovp", pd.Series(False, index=v.index)).fillna(False).astype(bool)
    rez, sk_rows = {}, []

    def deli_odd(rr):
        return {o: rr.get("Odd_" + o) for o, _ in ODDELKI}

    def deli_op(rr):
        return {c: rr.get(c) for c in P_SKUPINE}

    for ime, g in v.groupby(v["Skupina"].fillna("")):
        clani = [g] if ime else [g.loc[[i]] for i in g.index]   # samostojne: vsaka zase
        for gg in clani:
            upor = gg[gg["Uporaben"]]
            izl = []
            if len(upor) >= 3:
                m = float(np.median(upor["Predlog"]))
                ok = upor["Predlog"].between(SPODNJA * m, ZGORNJA * m)
                izl = list(upor[~ok].itertuples())
                upor = upor[ok]
            skupina_ime = ime or None
            if upor.empty:
                for i in gg.index:
                    rez[i] = {"Skupina": skupina_ime, "Povp": np.nan, "Vir": "ni podatkov",
                              "KomSk": ("Ni podatkov ne pri šifri ne pri podobnih izdelkih." if ime else
                                        "Ni podatkov - normativ ni mogoče določiti.")}
                if ime:
                    sk_rows.append({"Skupina": ime, "Sifer": len(gg), "SPodatki": 0, "Upostevani": "",
                                    "Tehtano": np.nan, "Povp": np.nan, "Komentar": "ni podatkov"})
                continue
            w = upor["Zanesljivost"].map(UTEZ)
            teht = float((upor["Predlog"] * w).sum() / w.sum())
            naj = min(upor["Zanesljivost"])            # 'A' < 'B' < 'C'
            m_naj = float(upor[upor["Zanesljivost"] == naj]["Predlog"].mean())
            if len(upor) == 1:
                smer, smer_t = -1, "navzdol (ni podobnih podatkov)"
            elif abs(m_naj - teht) < 1e-9:
                smer, smer_t = 0, "na najbližje"
            else:
                smer = 1 if m_naj > teht else -1
                smer_t = f"{'navzgor' if smer > 0 else 'navzdol'} (proti {naj})"
            povp = zaokrozi(teht, smer)
            seznam_v = ", ".join(f"{r.Sifra[-5:]} {st(r.Predlog)} {r.Zanesljivost}" for r in upor.itertuples())
            kom = []
            if ime and len(gg) > 1:
                kom.append(f"Skupina '{ime}' ({len(gg)} šifer). Upoštevani: {seznam_v}.")
                if izl:
                    kom.append("Izločeni (odstopajo od mediane skupine): " +
                               ", ".join(f"{r.Sifra[-5:]} {st(r.Predlog)}" for r in izl) + ".")
                brez = gg[~gg["Uporaben"]]
                if len(brez):
                    kom.append("Brez uporabnih lastnih podatkov (dobijo vrednost skupine): " +
                               ", ".join(f"{s_[-5:]}" + (" POZOR" if p_ else "")
                                         for s_, p_ in zip(brez["Sifra"], brez.get("IzlociPovp", False))) + ".")
                kom.append(f"Tehtano povprečje (A×9, B×3, C×1) {st(teht, 3)} → zaokroženo {smer_t} {st(povp)}.")
                if len(upor) > 1 and upor["Predlog"].max() / upor["Predlog"].min() > 1.25:
                    kom.append(f"RAZPON: člani od {st(upor['Predlog'].min())} do {st(upor['Predlog'].max())} - "
                               "preveri, ali skupina res sodi skupaj.")
                vb = gg["Obstojeci"][gg["Obstojeci"].fillna(0) > 0]
                if vb.nunique() > 1:
                    kom.append("V bazi imajo člani različne normative (" +
                               ", ".join(sorted({st(x) for x in vb})) + ") - preveri, ali jih res izenačimo.")
            else:
                kom.append(f"Samostojna šifra: {st(teht, 3)} → zaokroženo {smer_t} {st(povp)}.")
                if bool(gg.get("IzlociPovp", pd.Series([False])).iloc[0]):
                    kom.append("POZOR - verjetno nepopolno štempljanje (glej komentar analize).")
            kom_t = " ".join(kom)
            # povprečni deleži oddelkov / operacij skupine (za člane brez lastnih)
            sk_odd = {o: float(upor.get("Odd_" + o, pd.Series(dtype=float)).fillna(0).mean()) for o, _ in ODDELKI}
            sk_op = {c: float(upor.get(c, pd.Series(dtype=float)).fillna(0).mean()) for c in P_SKUPINE}
            for i, rr in gg.iterrows():
                lastni = bool(rr["Uporaben"])
                odd = deli_odd(rr) if lastni and any((x or 0) > 0 for x in deli_odd(rr).values()) else sk_odd
                op = deli_op(rr) if lastni and any((x or 0) > 0 for x in deli_op(rr).values()
                                                    if not (isinstance(x, float) and np.isnan(x))) else sk_op
                op = {c: (0 if (x is None or (isinstance(x, float) and np.isnan(x))) else x) for c, x in op.items()}
                rez[i] = {"Skupina": skupina_ime, "Povp": povp,
                          "Vir": ("skupina" if ime and len(gg) > 1 else "samostojna") if lastni else
                          ("iz podobnih" if ime and len(gg) > 1 else "samostojna - POZOR"),
                          "KomSk": kom_t, "OddPovp": razdeli(povp, odd), "OpDel": op}
            if ime:
                sk_rows.append({"Skupina": ime, "Sifer": len(gg), "SPodatki": int(gg["Uporaben"].sum()),
                                "Upostevani": seznam_v, "Tehtano": teht, "Povp": povp, "Komentar": kom_t})
    for k in ("Skupina", "Povp", "Vir", "KomSk", "OddPovp", "OpDel"):
        v[k] = [rez.get(i, {}).get(k) for i in v.index]
    return v, pd.DataFrame(sk_rows).sort_values("Skupina")


# ---------------------------------------------------------------------------
# Excel
# ---------------------------------------------------------------------------
ORANZNA = "F28C28"
TEMNA = "2F3640"
F_GLAVA = PatternFill("solid", fgColor=TEMNA)
F_SIFRA = PatternFill("solid", fgColor="E8EAED")
F_PREDLOG = PatternFill("solid", fgColor="FDE9D9")
F_IZL = PatternFill("solid", fgColor="FBE3E4")
F_NEUP = PatternFill("solid", fgColor="F2F2F2")
F_OK = PatternFill("solid", fgColor="E3F4E8")
F_ROCNO = PatternFill("solid", fgColor="FFF9DB")
ZAN_BARVA = {"A": "C6EFCE", "B": "FFEB9C", "C": "FCD5B4", "X": "D9D9D9"}
TANKA = Side(style="thin", color="D0D4D9")
OBROBA = Border(bottom=TANKA)
FONT = "Calibri"


def glava(ws, vrstica, naslovi, sirine):
    for i, (t, w) in enumerate(zip(naslovi, sirine), start=1):
        c = ws.cell(vrstica, i, t)
        c.font = Font(name=FONT, bold=True, color="FFFFFF", size=10)
        c.fill = F_GLAVA
        c.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[vrstica].height = 42


def naslov(ws, besedilo, pod):
    ws["A1"] = besedilo
    ws["A1"].font = Font(name=FONT, bold=True, size=16, color=TEMNA)
    ws["A2"] = pod
    ws["A2"].font = Font(name=FONT, italic=True, size=10, color="6B7280")


def zapisi(ws, vr, vals, fmt=None, fill=None, font=None):
    for i, v in enumerate(vals, start=1):
        if isinstance(v, float) and np.isnan(v):
            v = None
        if isinstance(v, pd.Timestamp):
            v = v.to_pydatetime()
        c = ws.cell(vr, i, v)
        c.font = font or Font(name=FONT, size=10)
        c.border = OBROBA
        c.alignment = Alignment(vertical="top", wrap_text=isinstance(v, str) and len(v) > 40)
        if fmt and fmt.get(i):
            c.number_format = fmt[i]
        if fill:
            c.fill = fill


def zapisi_excel(seznam, predlogi, detajl, vir_obst, p, delavci, povp, sk):
    wb = Workbook()
    H = '0.000;-0.000;"-"'
    D = "dd.mm.yyyy"
    pr = predlogi.set_index("Sifra")

    # ---------------- 0 Navodila
    ws = wb.active
    ws.title = "Navodila"
    naslov(ws, "Analiza normativov proizvodnje", "Klasifikacije 096, 097, 099 in proizvodni unikati 110 - "
           "nalogi od 2025 dalje, poročano delo iz ERP")
    v_obs = seznam[seznam["VObsegu"]]
    zan = predlogi[predlogi["VObsegu"]]["Zanesljivost"].value_counts()
    brez = v_obs[~v_obs["ImaNormativ"]]
    besedila = [
        ("Zavihki", None),
        ("1 Seznam šifer", "Vse šifre 096/097/099/110 z nalogi od 2025 dalje, število nalogov, kosov in ur ter obstoječi "
                           "normativ v bazi. Stolpec 'V obsegu' izloči naprave med unikati 110."),
        ("2 Normativi - predlog", "En predlog na šifro: skupni normativ (h/kos), zanesljivost, normativ po operacijah, "
                                  "razdelitev po oddelkih in komentar. Rumena stolpca na desni sta za ročni pregled."),
        ("3 Nalogi x operacije", "Za vsako šifro: siva vrstica šifre, nato vsak nalog (h/kos po operacijah) in na koncu "
                                 "oranžna vrstica s predlogom. Zelena = upoštevan, rdeča = izločen (razlog v stolpcu), "
                                 "siva = ni uporaben. Prečrtana rdeča vrednost operacije = izločena pri normativu te operacije."),
        ("4 Mapiranje operacij", "Katera ERP operacija spada v katero skupino in oddelek. PROSIM PREVERI - to je predlog."),
        ("5 Uvoz v bazo", "Oblika tabele spl_normativi (ident, skupni, P, M, E, T) s povprečenimi vrednostmi. "
                          "NE UVAŽAJ pred potrditvijo."),
        ("6 Povprečenje", "Seznam šifer s povprečenim predlogom po skupinah podobnih izdelkov in komentarjem skupine. "
                          "Tudi šifre brez lastnih podatkov dobijo predlog, če imajo podoben izdelek ('iz podobnih')."),
        ("7 Skupine", "Povzetek skupin: člani, upoštevane vrednosti, tehtano povprečje in zaokrožen normativ."),
        ("8 Operacije proizvodnje", "Za šifre z normativom proizvodnje > 0 razdelitev na operacije / delovna mesta - "
                                    "za novo tabelo normativov operacij. NE UVAŽAJ pred potrditvijo."),
        ("9 Delavci - oddelek", "Kateri delavec šteje kot proizvodnja / montaža (za delitev sestavljanja in folije)."),
        ("", None),
        ("Metoda", None),
        ("Enota", "Normativ = ure na kos. Na nalog: poročane ure (ERP že razdeli čas, ko je delavec hkrati na več nalogih) "
                  "÷ izdelana količina. Upoštevajo se samo zaključeni nalogi z izdelano količino > 0 in štempljanjem."),
        ("Pričakovane operacije", f"Operacija je pričakovana, če je štempljana na vsaj {int(PRAG_PRICAKOVANA*100)} % "
                                  "uporabnih nalogov šifre. Redkejše so 'občasne' in ne štejejo v normativ (navedene v komentarju)."),
        ("Manjkajoče operacije", "Nalog, ki nima štempljane pričakovane operacije z vsaj 10 % deleža, se izloči iz "
                                 "skupnega povprečja (manjkajoče štempljanje)."),
        ("Izločanje odstopanj", f"Upoštevajo se vrednosti med {int(SPODNJA*100)} % in {int(ZGORNJA*100)} % mediane. "
                                "Primer 1; 1,5; 1; 3; 3; 3,5; 3; 4; 2,5; 3,2; 3; 3; 12; 15 -> mediana 3, pas 1,8-5,1 -> "
                                f"ostane 2,5-4. Pod {MIN_ZA_IZLOCANJE} nalogi se ne izloča. Enako za vsako operacijo posebej."),
        ("Predlog", "Če so vsaj 3 upoštevani nalogi: povprečje njihovih h/kos. Sicer vsota normativov operacij. "
                    "Vsota operacij je v vsakem primeru zraven za kontrolo."),
        ("Zanesljivost", "A = vsaj 5 upoštevanih nalogov, raztros ≤ 35 %, vsota operacij v ±25 %.  "
                         "B = vsaj 3 nalogi.  C = 1-2 naloga (predpostavka).  X = ni podatkov."),
        ("Povprečenje", "Podobni izdelki (skupine.py - velikosti in strani se ne ločujejo, dodatki kot CL / New se) "
                        "dobijo enak normativ: tehtano povprečje A×9, B×3, C×1 (X in POZOR ne štejejo), zaokroženo nad "
                        "1 h na 0,1, 0,1-1 h na 0,05, pod 0,1 na 0,01 (najmanj 0,01) - v smeri najbolje ocenjenih. "
                        "Samostojne šifre navzdol."),
        ("Ne šteje", f"Operacije {IZLOCENE_OP_OPIS} niso del normativa."),
        ("", None),
        ("Stanje", None),
        ("Šifer skupaj", f"{len(seznam)} (v obsegu {len(v_obs)}, od tega brez normativa v bazi {len(brez)})"),
        ("Zanesljivost (v obsegu)", ", ".join(f"{k}: {zan.get(k, 0)}" for k in "ABCX")),
        ("Obstoječi normativi", f"vir: {vir_obst}"),
        ("Preverjanje metode", "Primerjava z normativi, ki so že v bazi (097 / 099): mediana razmerja predlog / obstoječi "
                               "je 0,98 pri zanesljivosti A in B. Pri C (1-2 naloga) je mediana 1,21, posamezni odstopajo "
                               "tudi večkratno - C je samo predpostavka."),
        ("096 - pozor", "096 v bazi skoraj nimajo normativov, zato metoda na njih ni preverjena. Večina 096 ima samo "
                        "laserski razrez; ERP čas razreza razdeli med vse naloge na isti plošči, zato je h/kos delež "
                        "plošče (lahko zelo majhen, npr. 0,005 h = 18 s) in bolj razpršen."),
        ("Operacije vs. predlog", "Ko je predlog povprečje nalogov, se stolpci operacij ne seštejejo točno v predlog "
                                  "(vsaka operacija ima svoje izločanje). Razdelitev P/M/E/T je preračunana na predlog."),
        ("Obdobje", "Upoštevani so nalogi od 2025 dalje (starejši imajo preveč napak). Manjkajoči normativi "
                    "se dodajajo sproti."),
    ]
    vr = 4
    for a, b in besedila:
        ws.cell(vr, 1, a).font = Font(name=FONT, bold=True, size=12 if b is None else 10,
                                      color=ORANZNA if b is None else TEMNA)
        if b:
            c = ws.cell(vr, 2, b)
            c.font = Font(name=FONT, size=10)
            c.alignment = Alignment(wrap_text=True, vertical="top")
            ws.row_dimensions[vr].height = max(15, 15 * (len(b) // 110 + 1))
        vr += 1
    ws.column_dimensions["A"].width = 26
    ws.column_dimensions["B"].width = 120
    ws.sheet_view.showGridLines = False

    # ---------------- 1 Seznam šifer
    ws = wb.create_sheet("1 Seznam šifer")
    naslov(ws, "Seznam šifer", "Šifre 096/097/099/110 z delovnimi nalogi od 2025 dalje")
    cols = ["Šifra", "Naziv", "Klas.", "Tip naloga", "Nalogov", "Zaključenih", "S štempljanjem",
            "Izdelanih kosov", "Prvi nalog", "Zadnji nalog", "Štempljane ure", "Normativ v bazi (h/kos)",
            "V obsegu", "Razlog (obseg)", "Predlog (h/kos)", "Zanesljivost"]
    glava(ws, 4, cols, [14, 46, 7, 24, 9, 11, 11, 10, 11, 11, 11, 12, 9, 40, 11, 12])
    srt = seznam.sort_values(["VObsegu", "ImaNormativ", "Klas", "Sifra"], ascending=[False, True, True, True])
    vr = 5
    for _, r in srt.iterrows():
        p_ = pr.loc[r["Sifra"]]
        zapisi(ws, vr, [r["Sifra"], r["Naziv"], r["Klas"], r["TipNaloga"], r["StNalogov"], r["StZakljucenih"],
                        r["StStempljanih"], r["Izdelanih"], r["PrviNalog"], r["ZadnjiNalog"], r["UreSkupaj"],
                        r["Obstojeci"] if r["ImaNormativ"] else None, "DA" if r["VObsegu"] else "NE",
                        r["RazlogObseg"], p_["Predlog"], p_["Zanesljivost"]],
               fmt={9: D, 10: D, 11: "0.0", 12: H, 15: H},
               fill=None if r["VObsegu"] else F_NEUP)
        ws.cell(vr, 16).fill = PatternFill("solid", fgColor=ZAN_BARVA[p_["Zanesljivost"]])
        ws.cell(vr, 16).alignment = Alignment(horizontal="center")
        vr += 1
    ws.freeze_panes = "C5"
    ws.auto_filter.ref = f"A4:{get_column_letter(len(cols))}{vr - 1}"

    # ---------------- 2 Normativi - predlog
    ws = wb.create_sheet("2 Normativi - predlog")
    naslov(ws, "Normativi - predlog", "h/kos. Rumena stolpca izpolni ob ročnem pregledu.")
    cols = (["Šifra", "Naziv", "Klas.", "V bazi (h/kos)", "PREDLOG (h/kos)", "Zanes.", "Metoda",
             "Nalogov", "Upošt.", "Min", "Max", "Σure/Σkos", "Vsota operacij"] + SKUPINE +
            [f"{o} - {nz}" for o, nz in ODDELKI] + ["Komentar", "Potrjen normativ", "Opomba pregleda"])
    sirine = [14, 40, 6, 9, 11, 7, 14, 8, 7, 7, 7, 9, 9] + [9] * len(SKUPINE) + [9] * 4 + [90, 11, 30]
    glava(ws, 4, cols, sirine)
    srt = predlogi[predlogi["VObsegu"]].copy()
    srt["_ima"] = srt["Obstojeci"].fillna(0) > 0
    srt = srt.sort_values(["_ima", "Zanesljivost", "Klas", "Sifra"])
    vr = 5
    fmt = {i: H for i in range(4, 6)}
    fmt.update({i: H for i in range(10, 14 + len(SKUPINE) + 4)})
    for _, r in srt.iterrows():
        vals = [r["Sifra"], r["Naziv"], r["Klas"], r["Obstojeci"] if r["Obstojeci"] > 0 else None,
                r["Predlog"], r["Zanesljivost"], r["Metoda"], r["StNalogov"], r.get("StUpo"),
                r.get("Min"), r.get("Max"), r.get("Utez"), r.get("VsotaOp")]
        vals += [r[c] for c in SKUPINE]
        vals += [r.get("Odd_" + o) for o, _ in ODDELKI]
        vals += [r["Komentar"], None, None]
        zapisi(ws, vr, vals, fmt=fmt)
        ws.cell(vr, 5).font = Font(name=FONT, bold=True, size=11)
        ws.cell(vr, 6).fill = PatternFill("solid", fgColor=ZAN_BARVA[r["Zanesljivost"]])
        ws.cell(vr, 6).alignment = Alignment(horizontal="center", vertical="top")
        kc = ws.cell(vr, len(cols) - 2)
        kc.alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[vr].height = min(150, 14 * (len(r["Komentar"]) // 105 + 1))
        ws.cell(vr, len(cols) - 1).fill = F_ROCNO
        ws.cell(vr, len(cols)).fill = F_ROCNO
        vr += 1
    ws.freeze_panes = "F5"
    ws.auto_filter.ref = f"A4:{get_column_letter(len(cols))}{vr - 1}"

    # ---------------- 3 Nalogi x operacije
    ws = wb.create_sheet("3 Nalogi x operacije")
    naslov(ws, "Nalogi x operacije", "Vrednosti po operacijah so h/kos. Zelena = upoštevan, rdeča = izločen, "
           "siva = ni uporaben. Prečrtano = izločeno pri normativu operacije.")
    cols = (["Šifra", "Naziv", "Nalog", "Datum", "Status", "Razp. kos", "Izd. kos", "Delavcev",
             "Ure skupaj", "h/kos skupaj"] + SKUPINE + ["Upoštevan", "Razlog / opomba", "Ure ne štejejo"])
    glava(ws, 4, cols, [14, 36, 9, 11, 20, 8, 8, 8, 9, 10] + [9] * len(SKUPINE) + [10, 46, 9])
    vr = 5
    zadnja = len(cols)
    oc = 11  # prvi stolpec operacij
    srt_sif = srt["Sifra"].tolist() + predlogi[~predlogi["VObsegu"]]["Sifra"].tolist()
    det = {rez["Sifra"]: (rez, rows) for rez, rows in detajl}
    for sif in srt_sif:
        rez, rows = det[sif]
        info = (f"Predlog {st(rez['Predlog'])} h/kos · zanesljivost {rez['Zanesljivost']}"
                + (f" · v bazi {st(rez['Obstojeci'])}" if rez["Obstojeci"] > 0 else " · brez normativa v bazi")
                + ("" if rez["VObsegu"] else " · NI V OBSEGU"))
        zapisi(ws, vr, [sif, rez["Naziv"], None, None, info] + [None] * (zadnja - 5),
               fill=F_SIFRA, font=Font(name=FONT, bold=True, size=10))
        ws.cell(vr, 5).alignment = Alignment(wrap_text=False)
        vr += 1
        for x in rows:
            if not x["Kand"]:
                fill, up = F_NEUP, "-"
            elif x["Upostevan"]:
                fill, up = F_OK, "DA"
            else:
                fill, up = F_IZL, "NE"
            vals = [sif, None, x["DN"], x["Datum"], x["Status"], x["Razpisana"], x["Izdelana"], x["Delavcev"],
                    x["Ure"], x["hkos"]]
            vals += [(x["ops"][c] if x["opsure"][c] > 0 and x["Izdelana"] > 0 else
                      (x["opsure"][c] if x["opsure"][c] > 0 else None)) for c in SKUPINE]
            vals += [up, x["Razlog"], x["IzlUre"] or None]
            zapisi(ws, vr, vals, fmt={4: D, 9: "0.00", 10: H, **{oc + i: H for i in range(len(SKUPINE))},
                                      zadnja: "0.00"}, fill=fill)
            ws.cell(vr, 1).font = Font(name=FONT, size=9, color="9CA3AF")
            for i, c in enumerate(SKUPINE):
                if c in x["OpIzl"]:
                    ws.cell(vr, oc + i).font = Font(name=FONT, size=10, color="C00000", strike=True)
                if x["Izdelana"] <= 0 and x["opsure"][c] > 0:
                    ws.cell(vr, oc + i).font = Font(name=FONT, size=10, italic=True, color="6B7280")
            ws.cell(vr, 10).font = Font(name=FONT, size=10, bold=True)
            vr += 1
        if not np.isnan(rez["Predlog"]) if isinstance(rez["Predlog"], float) else True:
            vals = [sif, "PREDLOG NORMATIVA (h/kos)", None, None, rez.get("Metoda", ""), None, None, None,
                    rez.get("VsotaOp"), rez["Predlog"]] + [rez[c] for c in SKUPINE] + \
                   [rez["Zanesljivost"], None, None]
            zapisi(ws, vr, vals, fmt={9: H, 10: H, **{oc + i: H for i in range(len(SKUPINE))}},
                   fill=F_PREDLOG, font=Font(name=FONT, bold=True, size=10))
            ws.cell(vr, 9).number_format = '"Σop "0.000'
            vr += 1
        vr += 1
    ws.freeze_panes = "D5"
    ws.auto_filter.ref = f"A4:{get_column_letter(zadnja)}{vr - 1}"

    # ---------------- 4 Mapiranje operacij
    ws = wb.create_sheet("4 Mapiranje operacij")
    naslov(ws, "Mapiranje operacij", "Sestavljanje - splošno in Odstranjevanje folije se delita po oddelku delavca "
           "(zavihek 9). Ure = štempljane ure na šifrah v obsegu (2025+).")
    cols = ["Šifra op. ERP", "Naziv operacije ERP", "Skupina", "Oddelek", "Delovno mesto (predlog)",
            "Opomba", "Ure (v obsegu)"]
    glava(ws, 4, cols, [10, 36, 34, 14, 22, 46, 12])
    sifre_obs = set(seznam[seznam["VObsegu"]]["Sifra"])
    nal_obs = set(pd.read_excel(MAPA / "nalogi od 2025 do danes.xlsx").iloc[:, 0])
    pp = p[p["Sifra"].isin(sifre_obs) & p["DN"].isin(nal_obs)]
    ure_op = pp.groupby(["Op", "SkupinaDel"])["Ure"].sum()
    imena = p.groupby("Op")["OpNaziv"].first()
    vr = 5
    for op in sorted(imena.index):
        sk_ = OPERACIJE.get(op)
        if sk_ and sk_[1] == "*":
            for del_ in ("proizvodnja", "montaža"):
                skn = f"{sk_[0]} - {del_}"
                o = "P" if del_ == "proizvodnja" else "M"
                zapisi(ws, vr, [op, imena[op], skn, dict(ODDELKI)[o], DELOVNO_MESTO.get(skn, "-"),
                                f"štemplja delavec {'proizvodnje' if o == 'P' else 'montaže'}",
                                float(ure_op.get((op, skn), 0))], fmt={7: "0.0"}, fill=F_ROCNO)
                vr += 1
            continue
        skn = (f"{sk_[0]} - proizvodnja" if sk_[0] in MESANE else sk_[0]) if sk_ else None
        zapisi(ws, vr, [op, imena[op], skn or "NE ŠTEJE", dict(ODDELKI).get(sk_[1]) if sk_ else "-",
                        DELOVNO_MESTO.get(skn, "-") if sk_ else "-",
                        sk_[2] if sk_ else IZLOCENE_OP_OPIS,
                        float(pp[pp["Op"] == op]["Ure"].sum())],
               fmt={7: "0.0"}, fill=None if sk_ else F_NEUP)
        vr += 1
    ws.freeze_panes = "A5"
    ws.auto_filter.ref = f"A4:G{vr - 1}"
    vr += 1
    ws.cell(vr, 1, "Predlog novih operacij v ERP").font = Font(name=FONT, bold=True, size=12, color=ORANZNA)
    for i, t in enumerate([
        "Sestavljanje - splošno  →  preimenovati v 'Sestavljanje - končno (montaža)'",
        "Novo: 'Sestavljanje - napa' (proizvodnja)",
        "Novo: 'Sestavljanje - voziček / podstavek' (proizvodnja)",
        "Odstranjevanje folije  →  'Odstranjevanje folije - proizvodnja' in 'Odstranjevanje folije - montaža'",
        "Do takrat analiza razdeli obstoječi operaciji po oddelku delavca, ki je štempljal (zavihek 9).",
    ], start=1):
        ws.cell(vr + i, 1, "•")
        ws.cell(vr + i, 2, t).font = Font(name=FONT, size=10)

    # ---------------- 5 Uvoz v bazo (povprečeni normativi)
    ws = wb.create_sheet("5 Uvoz v bazo")
    naslov(ws, "Uvoz v bazo (spl_normativi) - NE UVAŽAJ PRED POTRDITVIJO",
           "Vrednosti po povprečenju (zavihek 6). P+M+E+T = skupni (3 decimalke). NOV = šifre ni v bazi ali ima 0; "
           "PREVERI = v bazi že ima normativ.")
    cols = ["ident", "naziv", "normativ_skupni", "normativ_proizvodnja", "normativ_montaza",
            "normativ_elektro", "normativ_testiranje", "vir", "zanesljivost", "akcija", "obstoječi", "skupina"]
    glava(ws, 4, cols, [14, 44, 12, 12, 12, 12, 12, 16, 11, 10, 10, 40])
    vr = 5
    for _, r in povp.sort_values(["Klas", "Sifra"]).iterrows():
        if not (isinstance(r["Povp"], float) and r["Povp"] > 0) or not r["OddPovp"]:
            continue
        ima = r["Obstojeci"] > 0
        zapisi(ws, vr, [r["Sifra"], r["Naziv"], round(r["Povp"], 3)] +
               [r["OddPovp"].get(o) for o, _ in ODDELKI] +
               [r["Vir"], r["Zanesljivost"], "PREVERI" if ima else "NOV", r["Obstojeci"] if ima else None,
                r["Skupina"]], fmt={i: "0.000" for i in range(3, 8)})
        ws.cell(vr, 9).fill = PatternFill("solid", fgColor=ZAN_BARVA[r["Zanesljivost"]])
        vr += 1
    ws.freeze_panes = "C5"
    ws.auto_filter.ref = f"A4:L{vr - 1}"

    # ---------------- 6 Povprečenje
    ws = wb.create_sheet("6 Povprečenje")
    naslov(ws, "Povprečenje podobnih izdelkov",
           "Seznam šifer s povprečenim predlogom. Šifre iste skupine so skupaj (izmenično obarvane). "
           "Uteži A×9, B×3, C×1; zaokrožitev proti najbolje ocenjenim, samostojne navzdol.")
    cols = ["Skupina", "Šifra", "Naziv", "Klas.", "Nalogov", "Izdelanih kosov", "Normativ v bazi",
            "Predlog (analiza)", "Zanes.", "POVP. PREDLOG", "Vir", "Razlika do baze", "Komentar skupine",
            "Potrjen normativ", "Opomba pregleda"]
    glava(ws, 4, cols, [30, 14, 44, 6, 8, 9, 10, 10, 7, 11, 16, 10, 80, 11, 30])
    sez_i = seznam.set_index("Sifra")
    srt6 = povp.assign(_s=povp["Skupina"].isna(), _sk=povp["Skupina"].fillna("~")) \
        .sort_values(["_s", "_sk", "Sifra"])
    vr, prej, pas_ = 5, "#", False
    F_PAS = PatternFill("solid", fgColor="EEF1F5")
    for _, r in srt6.iterrows():
        if r["Skupina"] != prej or r["Skupina"] is None:
            pas_ = not pas_
            prej = r["Skupina"]
        ob = r["Obstojeci"] if r["Obstojeci"] > 0 else None
        razl = (r["Povp"] / ob - 1) if ob and isinstance(r["Povp"], float) and r["Povp"] > 0 else None
        zapisi(ws, vr, [r["Skupina"] if isinstance(r["Skupina"], str) else "(samostojna)", r["Sifra"], r["Naziv"], r["Klas"],
                        sez_i.loc[r["Sifra"], "StNalogov"], sez_i.loc[r["Sifra"], "Izdelanih"], ob,
                        r["Predlog"], r["Zanesljivost"], r["Povp"], r["Vir"], razl, r["KomSk"], None, None],
               fmt={7: H, 8: H, 10: '0.00;-0.00;"-"', 12: '+0%;-0%;0%'}, fill=F_PAS if pas_ else None)
        ws.cell(vr, 10).font = Font(name=FONT, bold=True, size=11)
        ws.cell(vr, 9).fill = PatternFill("solid", fgColor=ZAN_BARVA[r["Zanesljivost"]])
        ws.cell(vr, 9).alignment = Alignment(horizontal="center", vertical="top")
        if r["Vir"] == "iz podobnih":
            ws.cell(vr, 11).font = Font(name=FONT, size=10, color="1F6FB2", bold=True)
        if razl is not None and abs(razl) >= 0.25:
            ws.cell(vr, 12).font = Font(name=FONT, size=10, color="C00000", bold=True)
        ws.cell(vr, 13).alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[vr].height = min(120, 14 * (len(r["KomSk"] or "") // 95 + 1))
        ws.cell(vr, 14).fill = F_ROCNO
        ws.cell(vr, 15).fill = F_ROCNO
        vr += 1
    ws.freeze_panes = "D5"
    ws.auto_filter.ref = f"A4:{get_column_letter(len(cols))}{vr - 1}"

    # ---------------- 7 Skupine
    ws = wb.create_sheet("7 Skupine")
    naslov(ws, "Skupine podobnih izdelkov", "Ena vrstica na skupino. Pravila skupin so v datoteki skupine.py.")
    cols = ["Skupina", "Šifer", "S podatki", "Upoštevani (šifra, h/kos, zanes.)", "Tehtano povprečje",
            "POVP. PREDLOG", "Komentar"]
    glava(ws, 4, cols, [38, 7, 9, 60, 11, 11, 80])
    vr = 5
    for _, r in sk.iterrows():
        zapisi(ws, vr, [r["Skupina"], r["Sifer"], r["SPodatki"], r["Upostevani"], r["Tehtano"], r["Povp"],
                        r["Komentar"]], fmt={5: H, 6: '0.00;-0.00;"-"'})
        ws.cell(vr, 6).font = Font(name=FONT, bold=True, size=11)
        for c in (4, 7):
            ws.cell(vr, c).alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[vr].height = min(120, 14 * (len(r["Komentar"] or "") // 95 + 1))
        vr += 1
    ws.freeze_panes = "B5"
    ws.auto_filter.ref = f"A4:G{vr - 1}"

    # ---------------- 8 Operacije proizvodnje
    ws = wb.create_sheet("8 Operacije proizvodnje")
    naslov(ws, "Normativi operacij proizvodnje - NE UVAŽAJ PRED POTRDITVIJO",
           "Za vsako šifro z normativom proizvodnje > 0: razdelitev normativa proizvodnje na operacije "
           "(deleži iz štempljanja šifre, sicer iz skupine). Vsota operacij = normativ_proizvodnja.")
    cols = ["ident", "naziv", "normativ_proizvodnja", "operacija", "delovno mesto (predlog)", "ure (h/kos)",
            "delež", "vir deležev"]
    glava(ws, 4, cols, [14, 44, 12, 34, 22, 11, 8, 16])
    vr = 5
    for _, r in povp.sort_values(["Klas", "Sifra"]).iterrows():
        oddp = r["OddPovp"] or {}
        pn = oddp.get("P") or 0
        if pn <= 0 or not r["OpDel"]:
            continue
        ops = razdeli(pn, r["OpDel"])
        if not ops:
            continue
        prvi = True
        for c in P_SKUPINE:
            if ops.get(c, 0) <= 0:
                continue
            zapisi(ws, vr, [r["Sifra"], r["Naziv"] if prvi else None, pn if prvi else None, c,
                            DELOVNO_MESTO.get(c, "-"), ops[c], ops[c] / pn,
                            "lastni" if r["Vir"] in ("skupina", "samostojna") else "skupina"],
                   fmt={3: "0.000", 6: "0.000", 7: "0%"})
            if prvi:
                for cc in range(1, 9):
                    ws.cell(vr, cc).border = Border(top=Side(style="thin", color="9CA3AF"), bottom=TANKA)
            prvi = False
            vr += 1
    ws.freeze_panes = "D5"
    ws.auto_filter.ref = f"A4:H{vr - 1}"

    # ---------------- 9 Delavci - oddelek
    ws = wb.create_sheet("9 Delavci - oddelek")
    naslov(ws, "Delavci - oddelek", f"Oddelek iz deleža ur na izrazito proizvodnih operacijah 2025-26 "
           f"(proizvodnja, če ≥ {int(PRAG_DELAVEC_P * 100)} %). Popravek: DELAVEC_ROCNO v skripti. "
           "Rumeno = mešano delo, preveri.")
    cols = ["Šifra delavca", "Ime", "Ure proizvodnih op.", "Ure montažnih op.", "Delež proizvodnje",
            "Ure sestavljanje - splošno", "Ure odstranjevanje folije", "Oddelek", "Ročno"]
    glava(ws, 4, cols, [10, 24, 12, 12, 11, 13, 13, 12, 8])
    vr = 5
    for d, r in delavci.iterrows():
        dp = r["DelezP"] if r["DelezP"] == r["DelezP"] else 0
        zapisi(ws, vr, [int(d), r["Ime"], r["P"], r["M"], r["DelezP"], r["Sestavljanje"], r["Folija"],
                        "Proizvodnja" if r["Oddelek"] == "P" else "Montaža", "DA" if r["Rocno"] else ""],
               fmt={3: "0.0", 4: "0.0", 5: "0%", 6: "0.0", 7: "0.0"},
               fill=F_ROCNO if 0.3 < dp < 0.9 else None)
        vr += 1
    ws.freeze_panes = "C5"
    ws.auto_filter.ref = f"A4:I{vr - 1}"

    for w in wb.worksheets:
        w.sheet_view.zoomScale = 90
    wb.save(IZHOD)
    return IZHOD


if __name__ == "__main__":
    sez, pred, det, vir, por, delavci = analiziraj()
    pred.to_pickle(MAPA / "_predlogi.pkl") if "--pkl" in sys.argv else None
    povp, sk = povprecenje(pred)
    pot = zapisi_excel(sez, pred, det, vir, por, delavci, povp, sk)
    v = pred[pred["VObsegu"]]
    print("Skupin:", len(sk), "| šifer v skupinah:", int(povp["Skupina"].notna().sum()),
          "| s povp. predlogom:", int((povp["Povp"].fillna(0) > 0).sum()),
          "| iz podobnih:", int((povp["Vir"] == "iz podobnih").sum()))
    print("Zapisano:", pot)
    print("Šifer:", len(sez), "v obsegu:", len(v))
    print(v["Zanesljivost"].value_counts().to_string())
