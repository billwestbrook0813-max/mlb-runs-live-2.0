export function americanToProbRaw(american) {
  if (american == null) return null;
  const a = Number(american);
  if (Number.isNaN(a) || a === 0) return null;
  return a < 0 ? (-a) / ((-a) + 100) : 100 / (a + 100);
}

export function devigTwoWay(pOverRaw, pUnderRaw) {
  if (pOverRaw == null || pUnderRaw == null) return null;
  const sum = pOverRaw + pUnderRaw;
  if (!(sum > 0)) return null;
  return { pOver: pOverRaw / sum, pUnder: pUnderRaw / sum };
}

export function linInterp(x, x0, x1, y0, y1) {
  if (x1 === x0) return null;
  return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
}

export function impliedMedianFromAlts(alts) {
  if (!Array.isArray(alts) || alts.length < 2) return null;
  const pts = alts.map(a => {
    const pOverRaw = americanToProbRaw(a.over);
    const pUnderRaw = americanToProbRaw(a.under);
    const dv = devigTwoWay(pOverRaw, pUnderRaw);
    return { point: a.point, pOver: dv ? dv.pOver : null };
  }).filter(a => a.pOver != null);
  pts.sort((a,b) => a.point - b.point);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i+1];
    if (a.pOver === 0.5) return a.point;
    if (b.pOver === 0.5) return b.point;
    if ((a.pOver - 0.5) * (b.pOver - 0.5) < 0) {
      return linInterp(0.5, a.pOver, b.pOver, a.point, b.point);
    }
  }
  return null;
}
