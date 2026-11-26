# -*- coding: utf-8 -*-
"""
Analiza normativov peči družine OCA (FBM-40 / FBM-60, S / D / M, z in brez CL) iz štempljanja.

Ista metoda kot analiza_normativov.py (zavihek "3 Nalogi x operacije"):
  - zaključeni nalogi od 2025 ("nalogi od 2025 do danes.xlsx") z izdelano količino > 0 in štempljanjem
  - h/kos = štempljane ure / izdelani kosi, po skupinah operacij in po oddelkih P / M / E / T
  - mešani operaciji (sestavljanje - splošno, odstranjevanje folije) po oddelku delavca
  - izločen nalog brez nosilnega oddelka (prisoten na >= 50 % nalogov in >= 10 % vsote) in zunaj
    pasu 0,6-1,7 x mediane h/kos (ko je vsaj 4 nalogov)
  - normativ modela = povprečje upoštevanih nalogov; enotni predlog = povprečje vseh upoštevanih
    nalogov skupine (brez CL / CL), zaokroženo (>= 1 h na 0,1, pod 1 h na 0,05)

Izhod: "Analiza normativov OCA.xlsx"     Zagon: py analiza_OCA.py
"""
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font

MAPA = Path(__file__).resolve().parent
sys.path.insert(0, str(MAPA))
import analiza_normativov as a  # noqa: E402

IZHOD = MAPA / "Analiza normativov OCA.xlsx"
ODD = ["P", "M", "E", "T"]
ODD_IME = {"P": "Proizvodnja", "M": "Montaža", "E": "Elektro", "T": "Testiranje"}
# Trenutno v bazi (spl_normativi, družina OCA) - 26. 11. 2026
V_BAZI = {False: (1.68, 3.00, 0.42, 0.56), True: (1.68, 4.34, 0.42, 0.56)}
MIN_KROVNIH = 2  # model vstopi v povprečje skupine, če ima upoštevane naloge iz vsaj 2 krovnih
PEC = re.compile(r"^(UNIKAT - |PROTOTIP - )?Pe. konvekcijska FBM-(40|60)", re.I)


def model(naziv):
    m = re.search(r"FBM-(40|60)(/4)?\s?-?(S|D|M)?\b", naziv)
    cl = bool(re.search(r"\bCL\b", naziv))
    return f"FBM-{m.group(1)}{m.group(2) or ''}{m.group(3) or ''}" + (" CL" if cl else ""), cl


def zaokrozi(v):
    korak = 0.1 if v >= 1 else 0.05
    return round(round(v / korak) * korak, 2)


def main():
    n = a.preberi_naloge()
    p = a.preberi_porocano()
    n = n.rename(columns={"Krovni DN": "Krovni"})
    delavci = a.oddelki_delavcev(p)
    odd_del = delavci["Oddelek"].to_dict()

    p["Skupina"] = p["Op"].map(lambda o: a.OPERACIJE.get(o, (None,))[0])
    p["Odd"] = [None if not a.OPERACIJE.get(o) else (odd_del.get(d, "M") if a.OPERACIJE[o][1] == "*" else a.OPERACIJE[o][1])
                for o, d in zip(p["Op"], p["Delavec"])]
    pv = p[p["Skupina"].notna()]
    ure_sk = pv.pivot_table(index="DN", columns="Skupina", values="Ure", aggfunc="sum").fillna(0).reindex(columns=a.SKUPINE, fill_value=0)
    ure_od = pv.pivot_table(index="DN", columns="Odd", values="Ure", aggfunc="sum").fillna(0).reindex(columns=ODD, fill_value=0)
    st_del = pv.groupby("DN")["Delavec"].nunique()
    izl = p[p["Skupina"].isna()].groupby("DN")["Ure"].sum()

    f = n[n["Sifra"].str[:3].isin(["100", "110", "111"]) & n["Naziv"].astype(str).str.match(PEC)].copy()
    f[["Model", "CL"]] = f["Naziv"].astype(str).apply(lambda x: pd.Series(model(x)))

    vrstice, povzetek = [], []
    for mdl, g in sorted(f.groupby("Model"), key=lambda t: (t[0].endswith("CL"), t[0])):
        rows = []
        for _, d in g.sort_values("DatumD", ascending=False).iterrows():
            ima = d["DN"] in ure_sk.index
            sk = ure_sk.loc[d["DN"]] if ima else pd.Series(0.0, index=a.SKUPINE)
            od = ure_od.loc[d["DN"]] if ima else pd.Series(0.0, index=ODD)
            tot = float(od.sum())
            kos = d["Izdelana"]
            r = "nalog še ni zaključen" if not d["Zakljucen"] else "ni štempljanja" if tot <= 0 else "izdelana količina 0" if kos <= 0 else ""
            rows.append(dict(Sifra=d["Sifra"], Naziv=d["Naziv"], DN=int(d["DN"]), Krovni=d.get("Krovni"), Datum=d["DatumD"],
                             Status=d["StatusNaloga"], Raz=d["Razpisana"], Izd=kos, Del=int(st_del.get(d["DN"], 0)), Ure=tot,
                             H=tot / kos if kos > 0 and tot > 0 else np.nan,
                             sk={c: (sk[c] / kos if kos > 0 else np.nan) for c in a.SKUPINE},
                             od={c: (od[c] / kos if kos > 0 else np.nan) for c in ODD}, odure=od.to_dict(),
                             Razlog=r, Kand=r == "", Upo=False, Izl=float(izl.get(d["DN"], 0))))
        kand = [x for x in rows if x["Kand"]]
        # nosilni oddelki
        pris = {c: (sum(1 for x in kand if x["odure"][c] > 0) / len(kand)) if kand else 0 for c in ODD}
        povp = {c: np.mean([x["od"][c] for x in kand if x["odure"][c] > 0]) if any(x["odure"][c] > 0 for x in kand) else 0 for c in ODD}
        vs = sum(povp[c] for c in ODD if pris[c] >= 0.5)
        nos = [c for c in ODD if pris[c] >= 0.5 and vs > 0 and povp[c] / vs >= 0.10]
        popolni = []
        for x in kand:
            manjka = [c for c in nos if x["odure"][c] <= 0]
            if manjka:
                x["Razlog"] = "manjka " + ", ".join(ODD_IME[c].lower() for c in manjka)
            else:
                popolni.append(x)
        b = a.pas([x["H"] for x in popolni])
        for x in popolni:
            if b and x["H"] < b[0]:
                x["Razlog"] = f"prenizko (< {a.st(b[0])} h/kos = 60 % mediane)"
            elif b and x["H"] > b[1]:
                x["Razlog"] = f"previsoko (> {a.st(b[1])} h/kos = 170 % mediane)"
            else:
                x["Upo"], x["Razlog"] = True, "upoštevan"
        upo = [x for x in rows if x["Upo"]]
        s = dict(Model=mdl, CL=mdl.endswith("CL"), Nalogov=len(rows), Uporabnih=len(kand), Upo=len(upo),
                 Krovnih=len({x["Krovni"] for x in upo}), Kosov=sum(x["Izd"] for x in upo),
                 Pas=f"{a.st(b[0])} - {a.st(b[1])} (mediana {a.st(b[2])})" if b else "premalo nalogov za izločanje",
                 **{c: (np.mean([x["od"][c] for x in upo]) if upo else np.nan) for c in ODD},
                 H=np.mean([x["H"] for x in upo]) if upo else np.nan, Nosilni=", ".join(ODD_IME[c] for c in nos))
        povzetek.append(s)
        vrstice.append((s, rows))

    # enotni predlog po skupini (vsi upoštevani nalogi skupine); model z enim samim krovnim ne šteje
    # (ena serija - premalo podatkov, npr. FBM-40S CL) - dobi normativ skupine
    for s in povzetek:
        s["VPovp"] = s["Krovnih"] >= MIN_KROVNIH
    predlog = {}
    for cl in (False, True):
        upo = [x for s, rows in vrstice if s["CL"] == cl and s["VPovp"] for x in rows if x["Upo"]]
        sr = {c: float(np.mean([x["od"][c] for x in upo])) for c in ODD}
        zao = {c: zaokrozi(sr[c]) for c in ODD}
        predlog[cl] = dict(n=len(upo), krovnih=len({x["Krovni"] for x in upo}), sr=sr, zao=zao, sk=round(sum(zao.values()), 2),
                           H=float(np.mean([x["H"] for x in upo])))
    zapisi_excel(vrstice, povzetek, predlog, delavci)
    for cl in (False, True):
        q = predlog[cl]
        print(("CL" if cl else "brez CL"), q["n"], "nalogov,", q["krovnih"], "krovnih | povp", {c: round(v, 2) for c, v in q["sr"].items()},
              "| predlog", q["zao"], "=", q["sk"])
    for s in povzetek:
        print(f"{s['Model']:<16} nalogov {s['Nalogov']:>3} upošt {s['Upo']:>2} h/kos {s['H']:.2f}" if s["Upo"] else f"{s['Model']:<16} nalogov {s['Nalogov']:>3} upošt 0")
    print("Zapisano:", IZHOD)


def zapisi_excel(vrstice, povzetek, predlog, delavci):
    H = '0.000;-0.000;"-"'
    H2 = '0.00;-0.00;"-"'
    D = "dd.mm.yyyy"
    B = Font(name=a.FONT, bold=True, size=10)
    wb = Workbook()

    # ---------------- 1 Predlog
    ws = wb.active
    ws.title = "1 Predlog OCA"
    a.naslov(ws, "Normativi peči OCA - predlog", "h na peč po oddelkih. Enotni predlog = povprečje vseh upoštevanih nalogov skupine, "
             "zaokroženo (>= 1 h na 0,1, pod 1 h na 0,05). Podrobnosti po nalogih: zavihek 2.")
    cols = ["Skupina / model", "Nalogov", "Uporabnih", "Upoštevanih", "Krovnih", "Kosov"] + [ODD_IME[c] for c in ODD] + ["Skupaj h/kos", "Pas izločanja h/kos", "Nosilni oddelki", "V povprečju skupine"]
    a.glava(ws, 4, cols, [30, 9, 10, 11, 9, 8, 12, 10, 10, 11, 12, 30, 24, 30])
    vr = 5
    for cl in (False, True):
        q = predlog[cl]
        ime = "CL (cleaning)" if cl else "Brez CL (S, D, M, L, WT, PA, 230V, UP, Ročaj ...)"
        a.zapisi(ws, vr, [ime] + [None] * 13, fill=a.F_SIFRA, font=Font(name=a.FONT, bold=True, size=11))
        vr += 1
        for s in [s for s in povzetek if s["CL"] == cl]:
            a.zapisi(ws, vr, [s["Model"], s["Nalogov"], s["Uporabnih"], s["Upo"], s["Krovnih"], s["Kosov"]] + [s[c] for c in ODD] + [s["H"], s["Pas"], s["Nosilni"],
                      "DA" if s["VPovp"] else ("ni upoštevanih nalogov" if not s["Upo"] else "NE - samo 1 krovni, dobi normativ skupine")],
                     fmt={7: H2, 8: H2, 9: H2, 10: H2, 11: H2}, fill=None if s["VPovp"] else a.F_NEUP)
            vr += 1
        a.zapisi(ws, vr, ["Povprečje upoštevanih nalogov skupine", q["n"], None, q["n"], q["krovnih"], None] + [q["sr"][c] for c in ODD] + [q["H"], None, None, None],
                 fmt={7: H, 8: H, 9: H, 10: H, 11: H}, font=B)
        vr += 1
        a.zapisi(ws, vr, ["PREDLOG NORMATIVA (zaokroženo)", None, None, None, None, None] + [q["zao"][c] for c in ODD] + [q["sk"], None, None, None],
                 fmt={7: H2, 8: H2, 9: H2, 10: H2, 11: H2}, fill=a.F_PREDLOG, font=B)
        vr += 1
        zdaj = V_BAZI[cl]
        a.zapisi(ws, vr, ["Zdaj v bazi"] + [None] * 5 + list(zdaj) + [round(sum(zdaj), 2), None, None, None], fmt={7: H2, 8: H2, 9: H2, 10: H2, 11: H2},
                 font=Font(name=a.FONT, italic=True, size=10, color="6B7280"))
        vr += 2
    ws.cell(vr, 1, "Opombe").font = B
    for t in [
        "Osnove OC-A (OCA-k), plošče elektro (OCA-e) in ožičenja (OCA-o) se delajo na svojih nalogih z lastnimi normativi - niso v teh urah.",
        "Model z upoštevanimi nalogi iz samo enega krovnega (ena serija) ne vstopa v povprečje skupine in dobi normativ skupine - npr. FBM-40S CL (13,0 in 26,0 h/kos iz istega krovnega; pri 26,0 je izdelan 1 kos od 2).",
        "FBM-40/60 D in M od 2025 nimata nalogov - dobita normativ skupine brez CL (doslej enak kot S).",
        "Nalogi istega krovnega imajo enake h/kos (ure se razdelijo po nalogih krovnega) - stolpec Krovnih pove, koliko neodvisnih serij je za izračunom.",
        "Mešani operaciji (sestavljanje - splošno, odstranjevanje folije) gresta v P ali M po oddelku delavca (zavihek 4).",
    ]:
        vr += 1
        ws.cell(vr, 1, "- " + t).font = Font(name=a.FONT, size=10)
    ws.freeze_panes = "B5"

    # ---------------- 2 Nalogi x operacije
    ws = wb.create_sheet("2 Nalogi x operacije")
    a.naslov(ws, "Nalogi x operacije (peči OCA)", "Vrednosti po operacijah in oddelkih so h/kos. Zelena = upoštevan, rdeča = izločen, "
             "siva = ni uporaben. Oddelki P / M / E / T = vsota operacij oddelka (mešani operaciji po delavcu).")
    cols = (["Šifra", "Naziv", "Nalog", "Krovni", "Datum", "Status", "Razp. kos", "Izd. kos", "Delavcev", "Ure skupaj", "h/kos skupaj"]
            + a.SKUPINE + [ODD_IME[c] for c in ODD] + ["Upoštevan", "Razlog / opomba", "Ure ne štejejo"])
    a.glava(ws, 4, cols, [16, 38, 9, 9, 11, 20, 8, 8, 8, 9, 10] + [9] * len(a.SKUPINE) + [10] * 4 + [10, 40, 9])
    oc = 12
    zadnja = len(cols)
    vr = 5
    for s, rows in vrstice:
        info = (f"{s['Model']} · upoštevanih {s['Upo']} od {s['Nalogov']} nalogov" + (f" · povprečje {a.st(s['H'])} h/kos" if s["Upo"] else "")
                + f" · pas {s['Pas']}")
        a.zapisi(ws, vr, [s["Model"], None, None, None, None, info] + [None] * (zadnja - 6), fill=a.F_SIFRA, font=B)
        ws.cell(vr, 6).alignment = Alignment(wrap_text=False)
        vr += 1
        for x in rows:
            fill, up = (a.F_NEUP, "-") if not x["Kand"] else ((a.F_OK, "DA") if x["Upo"] else (a.F_IZL, "NE"))
            vals = [x["Sifra"], x["Naziv"], x["DN"], x["Krovni"], x["Datum"], x["Status"], x["Raz"], x["Izd"], x["Del"], x["Ure"], x["H"]]
            vals += [x["sk"][c] if x["Izd"] > 0 and x["sk"][c] > 0 else None for c in a.SKUPINE]
            vals += [x["od"][c] if x["Izd"] > 0 and x["od"][c] > 0 else None for c in ODD]
            vals += [up, x["Razlog"], x["Izl"] or None]
            a.zapisi(ws, vr, vals, fmt={5: D, 10: "0.00", 11: H, **{oc + i: H for i in range(len(a.SKUPINE) + 4)}, zadnja: "0.00"}, fill=fill)
            ws.cell(vr, 11).font = B
            for i in range(4):
                ws.cell(vr, oc + len(a.SKUPINE) + i).font = B
            vr += 1
        if s["Upo"]:
            vals = [s["Model"], "POVPREČJE UPOŠTEVANIH (h/kos)", None, None, None, None, None, s["Kosov"], None, None, s["H"]]
            vals += [None] * len(a.SKUPINE) + [s[c] for c in ODD] + [None, None, None]
            a.zapisi(ws, vr, vals, fmt={11: H, **{oc + len(a.SKUPINE) + i: H for i in range(4)}}, fill=a.F_PREDLOG, font=B)
            vr += 1
        vr += 1
    ws.freeze_panes = "D5"
    ws.auto_filter.ref = f"A4:{a.get_column_letter(zadnja)}{vr - 1}"

    # ---------------- 3 Mapiranje operacij
    ws = wb.create_sheet("3 Mapiranje operacij")
    a.naslov(ws, "Mapiranje operacij ERP", f"Operacija ERP -> skupina -> oddelek. Ne šteje: {a.IZLOCENE_OP_OPIS}.")
    a.glava(ws, 4, ["Operacija", "Skupina", "Oddelek", "Opomba"], [11, 24, 12, 60])
    for i, (op, (sk, od, op_)) in enumerate(sorted(a.OPERACIJE.items()), start=5):
        a.zapisi(ws, i, [op, sk, {"*": "po delavcu"}.get(od, ODD_IME.get(od, od)), op_])

    # ---------------- 4 Delavci - oddelek
    ws = wb.create_sheet("4 Delavci - oddelek")
    a.naslov(ws, "Oddelek delavca (za mešani operaciji)", "Delavec je proizvodnja, če ima vsaj 75 % ur na izrazito proizvodnih operacijah (2025-26); "
             "rumeno = ročna odločitev.")
    a.glava(ws, 4, ["Delavec", "Ime", "Oddelek", "Delež P", "Ure P", "Ure M", "Sestavljanje", "Folija"], [9, 26, 9, 9, 9, 9, 12, 9])
    for i, (dl, r) in enumerate(delavci.iterrows(), start=5):
        a.zapisi(ws, i, [dl, r["Ime"], r["Oddelek"], r["DelezP"], r["P"], r["M"], r["Sestavljanje"], r["Folija"]],
                 fmt={4: "0%", 5: "0.0", 6: "0.0", 7: "0.0", 8: "0.0"}, fill=a.F_ROCNO if r["Rocno"] else None)
    wb.save(IZHOD)


if __name__ == "__main__":
    main()
