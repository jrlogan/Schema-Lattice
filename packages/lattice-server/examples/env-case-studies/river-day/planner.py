"""River Day Planner: builds go/caution/no-go briefings from cached public-data responses in ../data."""
import json, csv, os, sys
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
J = lambda f: json.load(open(os.path.join(D, f)))
DAY = "2026-10-31"
SPOTS = {
  "fh": {"name": "Mill River Trail at Fair Haven", "lat": 41.3095, "lon": -72.9035},
  "cp": {"name": "Criscuolo Park (harbor)", "lat": 41.2985, "lon": -72.9010},
}
def weather(k):
    fc = J(f"nws_fc_{k}.json")["properties"]; hr = J(f"nws_hr_{k}.json")["properties"]
    day = next(p for p in fc["periods"] if p["startTime"].startswith(DAY) and p["isDaytime"])
    hrs = [p for p in hr["periods"] if p["startTime"].startswith(DAY) and 8 <= int(p["startTime"][11:13]) <= 13]
    pop = max((p["probabilityOfPrecipitation"]["value"] or 0) for p in hrs)
    winds = [int(p["windSpeed"].split()[0]) for p in hrs]
    temps = [p["temperature"] for p in hrs]
    return dict(text=day["detailedForecast"], pop=pop, wind_max=max(winds), tmin=min(temps), tmax=max(temps),
                issued=fc["updateTime"], src=J(f"nws_pt_{k}.json")["properties"]["forecast"])
def tides():
    p = J("tide_hilo.json")["predictions"]
    obs = J("wl_now.json")["data"][-1]; pred = {x["t"]: float(x["v"]) for x in J("tide_6min_now.json")["predictions"]}
    return p, obs, round(float(obs["v"]) - pred[obs["t"]], 2)
def bacteria():
    out = []
    for f, site in (("wqp_sts.csv", "STS-R-MR-2.79"), ("wqp_bact_results.csv", "1CTDPHBM-8700")):
        rows = [r for r in csv.DictReader(open(os.path.join(D, f), encoding="utf-8-sig")) if r["MonitoringLocationIdentifier"] == site]
        rows.sort(key=lambda r: r["ActivityStartDate"])
        r = rows[-1]
        val = r["ResultMeasureValue"] or r["ResultDetectionConditionText"]
        out.append((site, r["OrganizationFormalName"], r["ActivityStartDate"], r["CharacteristicName"], val, r["ResultMeasure/MeasureUnitCode"], len(rows)))
    return out
def attains(uid):
    for L in (2,):
        for f in J(f"attains_L{L}.json")["features"]:
            a = f["attributes"]
            if a["assessmentunitidentifier"] == uid:
                causes = [c for c in ("pathogens","nutrients","oxygen_depletion","polychlorinated_biphenyls_pcbs","trash") if a.get(c) == "Cause"]
                return a, causes
def fema(k):
    return J(f"fema_{k}.json")["features"][0]["attributes"]
UNIT = {"fh": ("CT-C1_023-SB", "nearest unit, ~200 m (point query within 150 m found none)"),
        "cp": ("CT-C1_014-SB", "within 150 m")}
def verdict(w, fz, causes, k):
    level, why = "GO", []
    if w["pop"] >= 60 or w["wind_max"] >= 25: level = "NO-GO"; why.append("weather")
    elif w["pop"] >= 30 or w["wind_max"] >= 15: level = "CAUTION"; why.append("weather marginal")
    if "pathogens" in causes: why.append("pathogen-impaired water: gloves, no wading, wash hands")
    if fz["SFHA_TF"] == "T":
        if level == "GO": level = "CAUTION"
        why.append(f"in FEMA {fz['FLD_ZONE']} (1%-annual-chance) zone: work the low-tide window, off the shoreline before the rising tide")
    return level, why
def main():
    hl, obs, anom = tides(); bac = bacteria(); lines = []
    lows = [x for x in hl if x["type"] == "L"]; highs = [x for x in hl if x["type"] == "H"]
    lines.append(f"# River Day briefing — Saturday {DAY}\n\nBuilt 2026-10-29 from public APIs found via schemalattice.com. Times are local (EDT).\n")
    lines.append("## Harbor tide (NOAA CO-OPS 8465705 New Haven, predictions, ft above MLLW)\n")
    for x in hl: lines.append(f"- {x['t'][11:]} {'High' if x['type']=='H' else 'Low'} {float(x['v']):.2f} ft")
    lines.append(f"- Best shoreline window: about 08:15–11:15 around the {lows[0]['t'][11:]} low ({float(lows[0]['v']):.2f} ft). Afternoon high {float(highs[1]['v']):.2f} ft is about mean higher high water (MHHW is 6.72 ft above MLLW).")
    lines.append(f"- Now: observed {obs['v']} ft at {obs['t']} vs prediction, {anom:+.2f} ft (water running above predicted tide). Predictions do not include surge; recheck Friday evening.\n")
    lines.append("## Water quality\n")
    for s in bac: lines.append(f"- {s[0]} ({s[1]}): latest {s[3]} {s[4]} {s[5]} on {s[2]} ({s[6]} results fetched)")
    lines.append("- No bacteria sample from 2026 at either site in the Water Quality Portal. Rain: none reported at KHVN since 2026-10-25 (all observations Clear/Fog), forecast dry through Saturday, so no after-rain bacteria spike expected.")
    lines.append("- USGS 01196573 (Quinnipiac River at Fair Haven, about 1.5 km east of the Mill River; not the same river), latest 2026-10-29 00:54 EDT: water 13.9 °C, DO 8.2 mg/L (90 %), turbidity 4.7 FNU, salinity 25 PSU. Context only; no bacteria parameter.\n")
    for k, s in SPOTS.items():
        w = weather(k); fz = fema(k); uid, how = UNIT[k]; a, causes = attains(uid)
        level, why = verdict(w, fz, causes, k)
        lines.append(f"## {s['name']} ({s['lat']}, {s['lon']}) — **{level}**\n")
        lines.append(f"- Weather (NWS {w['src']}, issued {w['issued']}): {w['text']} 08:00–13:00: {w['tmin']}–{w['tmax']} °F, wind to {w['wind_max']} mph, precip chance {w['pop']}%.")
        lines.append(f"- Impairment (EPA ATTAINS areas layer, {how}): {a['assessmentunitname']} [{uid}], cycle {a['reportingcycle']}, IR category {a['ircategory']}, {a['overallstatus']}; recreation {a['recreation_use']}; causes: {', '.join(causes)}. Report: {a['waterbodyreportlink']}")
        bfe = f", BFE {fz['STATIC_BFE']:.0f} ft {fz['V_DATUM']}" if fz["STATIC_BFE"] > -9000 else ""
        lines.append(f"- Flood hazard (FEMA NFHL layer 28, {fz['DFIRM_ID']}): zone {fz['FLD_ZONE']}{' ('+fz['ZONE_SUBTY'].lower()+')' if fz['ZONE_SUBTY'] else ''}, SFHA {fz['SFHA_TF']}{bfe}.")
        lines.append(f"- Why: {'; '.join(why) or 'no concerns'}.\n")
    open(os.path.join(D, "..", "briefing.md"), "w").write("\n".join(lines) + "\n")
    print("\n".join(lines))
main()
