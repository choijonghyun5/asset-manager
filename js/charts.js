/**
 * 무채색 계열 SVG 차트 유틸
 * - buildDonutSVG: 자산 비중 도넛차트 (그라데이션 그레이 팔레트)
 * - buildLineChartSVG: 자산 변화 라인차트 (격자 없이 미니멀하게)
 */

function buildDonutSVG(segments, opts = {}) {
  const size = opts.size || 148;
  const stroke = opts.stroke || 22;
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + Math.max(x.value, 0), 0);

  let rings = "";
  if (total <= 0) {
    rings = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${stroke}"/>`;
  } else {
    let offset = 0;
    segments.forEach((seg) => {
      if (seg.value <= 0) return;
      const frac = seg.value / total;
      const len = frac * c;
      // 세그먼트 사이 미세한 간격(gap)을 위해 살짝 줄여줌
      const gap = segments.length > 1 ? Math.min(2, len * 0.06) : 0;
      const dashLen = Math.max(len - gap, 0);
      rings += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}"
        stroke-width="${stroke}" stroke-dasharray="${dashLen} ${c - dashLen}"
        stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})" />`;
      offset += len;
    });
  }

  const centerText = opts.centerLabel
    ? `<text x="${cx}" y="${cy - (opts.centerSub ? 6 : 0)}" text-anchor="middle" font-size="${
        opts.centerLabelSize || 17
      }" font-weight="700" fill="var(--ink)">${escapeHtml(opts.centerLabel)}</text>`
    : "";
  const centerSub = opts.centerSub
    ? `<text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="11" fill="var(--ink-soft)">${escapeHtml(
        opts.centerSub
      )}</text>`
    : "";

  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="display:block;">${rings}${centerText}${centerSub}</svg>`;
}

function shortDateLabel(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `${y.slice(2)}.${m}.${d}`;
}

function buildLineChartSVG(points, opts = {}) {
  const width = opts.width || 320;
  const height = opts.height || 168;
  const padTop = 22;
  const padBottom = 24;
  const padLeft = 6;
  const padRight = 6;

  if (!points || points.length === 0) {
    return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
      <text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-size="13" fill="var(--ink-soft)">표시할 데이터가 없습니다</text>
    </svg>`;
  }

  if (points.length === 1) {
    points = [points[0], { date: points[0].date, value: points[0].value }];
  }

  const values = points.map((p) => p.value);
  let min = Math.min(...values, 0);
  let max = Math.max(...values);
  if (min === max) {
    max = min + Math.max(Math.abs(min) * 0.1, 1000);
  }
  const range = max - min;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;
  const n = points.length;

  const xAt = (i) => padLeft + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v) => padTop + innerH - ((v - min) / range) * innerH;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(p.value).toFixed(1)}`)
    .join(" ");
  const baseline = (padTop + innerH).toFixed(1);
  const areaPath = `${linePath} L ${xAt(n - 1).toFixed(1)} ${baseline} L ${xAt(0).toFixed(1)} ${baseline} Z`;

  const lastX = xAt(n - 1);
  const lastY = yAt(points[n - 1].value);
  const lastVal = points[n - 1].value;
  const valueLabel = lastVal >= 100000000
    ? (lastVal / 100000000).toFixed(2) + "억"
    : "₩" + Math.round(lastVal).toLocaleString("ko-KR");

  const firstLabel = shortDateLabel(points[0].date);
  const lastLabel = shortDateLabel(points[n - 1].date);
  const labelX = Math.min(Math.max(lastX, 28), width - 10);
  const labelAnchor = lastX > width - 40 ? "end" : "middle";

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" style="display:block;">
    <path d="${areaPath}" fill="var(--bg-secondary)" stroke="none"/>
    <path d="${linePath}" fill="none" stroke="var(--ink)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="3.6" fill="var(--ink)"/>
    <text x="${labelX.toFixed(1)}" y="${Math.max(yAt(lastVal) - 10, 12).toFixed(1)}" text-anchor="${labelAnchor}" font-size="11.5" font-weight="700" fill="var(--ink)">${valueLabel}</text>
    <text x="${padLeft}" y="${height - 6}" font-size="10.5" fill="var(--ink-soft)">${firstLabel}</text>
    <text x="${width - padRight}" y="${height - 6}" font-size="10.5" fill="var(--ink-soft)" text-anchor="end">${lastLabel}</text>
  </svg>`;
}
