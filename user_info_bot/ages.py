"""Data de criacao estimada pelo ID. Interpolacao GetIDs."""

from datetime import datetime, timezone

# id -> unix ms. Tabela publica do GetIDs.
AGES = {
    2768409: 1383264000000,
    7679610: 1388448000000,
    11538514: 1391212000000,
    15835244: 1392940000000,
    23646077: 1393459000000,
    38015510: 1393632000000,
    44634663: 1399334000000,
    46145305: 1400198000000,
    54845238: 1411257000000,
    63263518: 1414454000000,
    101260938: 1425600000000,
    101323197: 1426204000000,
    111220210: 1429574000000,
    103258382: 1432771000000,
    103151531: 1433376000000,
    116812045: 1437696000000,
    122600695: 1437782000000,
    109393468: 1439078000000,
    112594714: 1439683000000,
    124872445: 1439856000000,
    130029930: 1441324000000,
    125828524: 1444003000000,
    133909606: 1444176000000,
    157242073: 1446768000000,
    143445125: 1448928000000,
    148670295: 1452211000000,
    152079341: 1453420000000,
    171295414: 1457481000000,
    181783990: 1460246000000,
    222021233: 1465344000000,
    225034354: 1466208000000,
    278941742: 1473465000000,
    285253072: 1476835000000,
    294851037: 1479600000000,
    297621225: 1481846000000,
    328594461: 1482969000000,
    337808429: 1487707000000,
    341546272: 1487782000000,
    352940995: 1487894000000,
    369669043: 1490918000000,
    400169472: 1501459000000,
    805158066: 1563208000000,
    1974255900: 1634000000000,
}

_IDS = sorted(AGES)


def estimate_created(user_id: int | None) -> str:
    if user_id is None or user_id <= 0:
        return ""
    uid = int(user_id)
    first, last = _IDS[0], _IDS[-1]
    if uid < first:
        dt = datetime.fromtimestamp(AGES[first] / 1000, tz=timezone.utc)
        return f"antes de {dt.month:02d}/{dt.year}"
    if uid > last:
        dt = datetime.fromtimestamp(AGES[last] / 1000, tz=timezone.utc)
        return f"depois de {dt.month:02d}/{dt.year}"
    lo = first
    for hi in _IDS:
        if uid <= hi:
            t0, t1 = AGES[lo], AGES[hi]
            if hi == lo:
                mid = t0
            else:
                ratio = (uid - lo) / (hi - lo)
                mid = t0 + ratio * (t1 - t0)
            dt = datetime.fromtimestamp(mid / 1000, tz=timezone.utc)
            return f"~{dt.month:02d}/{dt.year}"
        lo = hi
    return ""
