# -*- coding: utf-8 -*-
"""
Skupine podobnih izdelkov za povprečenje normativov.

Vsako pravilo: (regularni izraz na naziv, ime skupine). Pravila se preverjajo po vrsti,
velja prvo, ki ustreza. Šifra, ki ne ustreza nobenemu pravilu, je samostojna.
Velikosti (40 / 60 / 05 / 08 / 10 ...) in strani (leva / desna) se namenoma ne ločujejo -
podobni izdelki dobijo enak normativ. Ločujejo se dodatki, ki spremenijo delo (CL, New, S / M ...).
"""
import re

PRAVILA = [
    # --- Osnove (kovinski del)
    (r"^Osnova - kovinski del OC-A-\d+-CL", "Osnova - kovinski del OC-A CL"),
    (r"^Osnova - kovinski del OC-A", "Osnova - kovinski del OC-A"),
    (r"^Osnova - kovinski del OC-B-\d+ HTB NEW", "Osnova - kovinski del OC-B HTB New"),
    (r"^Osnova - kovinski del OD-C", "Osnova - kovinski del OD-C"),
    (r"^Osnova (brez dna|z dnom) - kovinski del OP-D", "Osnova - kovinski del OP-D-660"),
    (r"^Osnova (leva|desna) - kovinski del OC-B-\d+-FBS-CL", "Osnova L/D - kovinski del OC-B FBS-CL"),
    (r"^Osnova (leva|desna) - kovinski del OC-B", "Osnova L/D - kovinski del OC-B HTB/FBS"),
    # --- Komore, stranice
    (r"^Komora - zvarjenec PV-B", "Komora - zvarjenec PV-B"),
    (r"^Komora - obod z vlekom OC-B", "Komora - obod z vlekom OC-B"),
    (r"^Stranica komore hrbtna z vlekom OC-B-(05|08|10)", "Stranica komore hrbtna z vlekom OC-B"),
    (r"^Stranica zunanja - sestav strop/dno OD-C", "Stranica zunanja - sestav strop/dno OD-C"),
    (r"^Stranica prednja (leva|desna) - zvarjenec OC-B", "Stranica prednja L/D - zvarjenec OC-B"),
    (r"^Stranica prednja dekorativna", "Stranica prednja dekorativna HC"),
    (r"^Stranica zunanja (leva|desna) OC-B", "Stranica zunanja L/D OC-B"),
    (r"^Stranica zunanja (leva|desna) OC-A", "Stranica zunanja L/D OC-A"),
    (r"^Stranica zunanja (leva|desna) OP-D", "Stranica zunanja L/D OP-D-660"),
    (r"^Stranica zunanja hrbtna OC-B", "Stranica zunanja hrbtna OC-B"),
    (r"^Stranica zunanja komplet SCH", "Stranica zunanja komplet SCH"),
    (r"^Stranica bočna (leva|desna) OD-C", "Stranica bočna L/D OD-C"),
    (r"^Stranica hrbtna OC-A", "Stranica hrbtna OC-A"),
    (r"^Stranica (leva|desna) HC,HV,HN-C", "Stranica L/D HC,HV,HN-C-116"),
    (r"^Stranica zadnja OC-B-\d+ New", "Stranica zadnja OC-B New"),
    (r"^Prekriv stranice komore zadnje OD-C", "Prekriv stranice komore zadnje OD-C"),
    # --- Vrata
    (r"^Vrata (leva|desna) ?- ?zvarjenec OC-A-\d+-CL", "Vrata L/D - zvarjenec OC-A CL"),
    (r"^Vrata (leva|desna) ?- ?zvarjenec OC-A", "Vrata L/D - zvarjenec OC-A"),
    (r"^Vrata (leva|desna) ?- ?zvarjenec OC-B-\d+-HTB New", "Vrata L/D - zvarjenec OC-B HTB New"),
    (r"^Vrata (leva|desna) ?- ?zvarjenec OC-B", "Vrata L/D - zvarjenec OC-B"),
    (r"^Vrata (leva|desna) ?- ?zvarjenec PV-B-?\d+-?(D2|M)", "Vrata L/D - zvarjenec PV-B D2/M"),
    (r"^Vrata (leva|desna) ?- ?zvarjenec PV-B", "Vrata L/D - zvarjenec PV-B S/SW"),
    (r"^Vrata (leva|desna) - sestav PV-B-\d+ M", "Vrata L/D - sestav PV-B M/D2"),
    (r"^Vrata (leva|desna) - sestav PV-B-\d+- ?S", "Vrata L/D - sestav PV-B S"),
    (r"^Vrata (leva|desna) - sestav SCH ?\d", "Vrata L/D - sestav SCH 4/8"),
    (r"^Vrata (leva|desna) - sestav OC-B", "Vrata L/D - sestav OC-B"),
    (r"^Vrata desna - steklo zunanje sestav OC-B", "Vrata desna - steklo zunanje sestav OC-B"),
    (r"^Prekriv vrat (levi|desni) OC-B", "Prekriv vrat L/D OC-B"),
    (r"^Steklo vrat notranje - sestav OC-B", "Steklo vrat notranje - sestav OC-B"),
    (r"^Tečaj vrat (levi|desni) .*OD-C.*zvarjenec|^Tečaj vrat (levi|desni) - zvarjenec OD-C", "Tečaj vrat L/D - zvarjenec OD-C"),
    (r"^Tečaj vrat (spodaj|spodnji|zgoraj).*OC-A", "Tečaj vrat OC-A"),
    (r"^Tečaj (vrat )?vitrine", "Tečaj vitrine - zvarjenec SCH"),
    (r"^Ročaj vrat (levi|desni) - barvanje PV-B", "Ročaj vrat L/D - barvanje PV-B"),
    (r"^Ročaj vrat (levi|desni) - barvanje SCH", "Ročaj vrat L/D - barvanje SCH"),
    # --- Dimniki, cevi
    (r"^Dimnik zunanji", "Dimnik zunanji - zvarjenec"),
    (r"^(Dimnik vmesni|Dimnik reducirni|Koleno dimnika)", "Dimnik vmesni / reducirni / koleno - zvarjenec"),
    (r"^Obod dimnika", "Obod dimnika"),
    (r"^Prirobnica dimnika zunanjega", "Prirobnica dimnika zunanjega"),
    (r"^Cev dozirna - zvarjenec", "Cev dozirna - zvarjenec"),
    (r"^Cev fi20x1,\d l=[6-9]\d\d\b", "Cev fi20 dolga (krivljena)"),
    (r"^Cevi? (INOX|RF|inox|fi|dimnika|iztoka|spojna|pranja|prezračevalne)", "Cev - razrez"),
    # --- Ožičenja, elektro
    (r"^Ožičenje OC-A-FBM-S", "Ožičenje OC-A-FBM-S"),
    (r"^Ožičenje OC-B-HTB", "Ožičenje OC-B-HTB"),
    (r"^Ožičenje OD-C-FD", "Ožičenje OD-C-FD"),
    (r"^Ožičenje OP-D-D", "Ožičenje OP-D-D"),
    (r"^Ožičenje PV-B-HTBP", "Ožičenje PV-B-HTBP"),
    (r"^Ožičenje dodatek OC-B", "Ožičenje dodatek OC-B"),
    (r"^Ožičenje vrata (leva|desna) OC-", "Ožičenje vrata L/D OC-A/OC-B"),
    (r"^Ožičenje vrata .*obojestranska", "Ožičenje vrata obojestranska"),
    (r"^Plošča elektro 400V/3N - podsestav OC-B", "Plošča elektro 400V/3N - podsestav OC-B"),
    (r"^Plošča elektro 400V/3N - (pod)?sestav OD-C", "Plošča elektro 400V/3N - OD-C"),
    (r"^Plošča elektro 400V/3N - sestav OC-A", "Plošča elektro 400V/3N - sestav OC-A"),
    (r"^Plošča elektro 400V/3N - sestav OP-D", "Plošča elektro 400V/3N - sestav OP-D-660"),
    (r"^Plošča elektro 230V/1N", "Plošča elektro 230V/1N PV-B"),
    (r"^Elektronika krmilnik - sestav OC-B-(HTB|TP|T_)", "Elektronika krmilnik - sestav OC-B HTB/TP/T"),
    (r"^Elektronika krmilnik - sestav OC-B-HTB|^Elektronika krmilnik - sestav brez gumba OC-B", "Elektronika krmilnik - sestav OC-B HTB/TP/T"),
    (r"^Elektronika krmilnik - sestav (PV-B_)?S-Control", "Elektronika krmilnik - sestav S-Control"),
    (r"^Elektronika krmilnik - sestav OD-C-Condilux", "Elektronika krmilnik - sestav OD-C Condilux"),
    (r"^Krmiljenje.*Condilux", "Krmiljenje OD-C Condilux"),
    (r"^Svetilo LED trak (levi|desni) - sestav OC-B", "Svetilo LED trak L/D - sestav OC-B"),
    (r"^Nosilec LED svetil (levi|desni)", "Nosilec LED svetil L/D - sestav"),
    (r"^Plošča upravljalna OC-B", "Plošča upravljalna OC-B"),
    (r"^Plošča upravljalna OD-C", "Plošča upravljalna OD-C"),
    (r"^Ventil reducirni", "Ventil reducirni - sestav"),
    # --- Kompleti povezovalni
    (r"^Komplet povezovalni ENOJNI OC-B (FB|HTB) 0", "Komplet povezovalni ENOJNI OC-B FB/HTB"),
    (r"^Komplet povezovalni DVOJNI OC-(A|B) (FB|FBM|HTB) 0", "Komplet povezovalni DVOJNI OC-A/OC-B"),
    (r"^(UNIKAT - )?Komplet povezovalni ENOJNI OD-C FD", "Komplet povezovalni ENOJNI OD-C FD"),
    (r"^Komplet povezovalni KOMBI OC-B / OD-C", "Komplet povezovalni KOMBI OC-B / OD-C"),
    (r"^Komplet povezovalni HC-98,", "Komplet povezovalni HC-98, OC-A, OC-B"),
    (r"^Komplet nadomestni OC-B-[\d/]+ Inverter", "Komplet nadomestni OC-B Inverter improvement"),
    # --- Kondenzatorji, posode
    (r"^Kondenzator nape (komplet )?(TPS )?- sestav (HC-B,C|PA)|^Kondenzator nape komplet TPS", "Kondenzator nape komplet - sestav HC-B,C / TPS"),
    (r"^Kondenzator nape s posodama", "Kondenzator nape s posodama - sestav HC-B,C"),
    (r"^Nosilec (prednji|zadnji) ohišja kondenzatorja", "Nosilec ohišja kondenzatorja"),
    (r"^Posoda kondenza (spredaj|zadaj) HC", "Posoda kondenza HC-B,C"),
    (r"^Posoda kondenza (spredaj|zadaj) - zvarjenec", "Posoda kondenza - zvarjenec HC-B,C"),
    # --- Generatorji, dodatki
    (r"^Generator vlaženja - zvarjenec (OC-B|OD-C)", "Generator vlaženja - zvarjenec OC-B / OD-C"),
    (r"^Dodatek vzhajalnika", "Dodatek vzhajalnika FD"),
    (r"^Dodatek nape HC,HV-B", "Dodatek nape HC,HV-B OD-C-68"),
    (r"^Prekriv ventilatorja - zvarjenec", "Prekriv ventilatorja - zvarjenec OC"),
    (r"^Prekriv ventilatorja (OC|oc)", "Prekriv ventilatorja OC"),
    (r"^Prekriv ventilatorja (levi|desni|horizontalni) PV-B", "Prekriv ventilatorja PV-B"),
    (r"^Prekriv izolacije", "Prekriv izolacije"),
    (r"^Zapiranje odprtin komore na OC-B", "Zapiranje odprtin komore OC-B"),
    (r"^Vitrina grelna brez stranic", "Vitrina grelna brez stranic - sestav SCH"),
    # --- Podstavki, okvirji, vodila
    (r"^Okvir podstavka zgoraj", "Okvir podstavka zgoraj - zvarjenec RN-B,C"),
    (r"^Okvir (nevtralnega )?podstavka", "Okvir podstavka - zvarjenec"),
    (r"^Stebri.ek podstavka FBM", "Stebriček podstavka FBM"),
    (r"^Stebriček (levi|desni) OC-B", "Stebriček L/D OC-B"),
    (r"^Pokončnik vodil RN", "Pokončnik vodil RN-B,C"),
    (r"^Profil vodila?\b", "Profil vodil"),
    (r"^Profil vezni", "Profil vezni HC,HV"),
    (r"^Profil vmesni peč-peč", "Profil vmesni peč-peč OC-B"),
    (r"^Vodila obod (leva|desna)", "Vodila obod L/D OC-B"),
    (r"^Vogalnik (levi|desni) RN", "Vogalnik L/D RN-B,C"),
    (r"^Naslon pe.i (spredaj|prednji)", "Naslon peči spredaj RN"),
    (r"^Nosilec peči( -)? O", "Nosilec peči (plošča)"),
    (r"^Prirobnica elektro zapirala", "Prirobnica elektro zapirala"),
    (r"^Zaščita IP na bočni stranici", "Zaščita IP na bočni stranici OD-C"),
    (r"^(UNIKAT - )?Podstavek (nevtralni|h=)", "UNIKAT - Podstavek nevtralni"),
    (r"^(UNIKAT - )?Vodila \d+[ -]?niv", "Vodila N-nivojska - komplet OC-B"),
    (r"^(UNIKAT - )?Pladenj", "Pladenj ALU / INOX"),
]

_PRAVILA = [(re.compile(v, re.I), s) for v, s in PRAVILA]


def skupina(naziv):
    n = str(naziv).strip()
    for rx, s in _PRAVILA:
        if rx.search(n):
            return s
    return None
