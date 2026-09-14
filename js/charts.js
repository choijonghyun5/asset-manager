/**
 * 무채색 계열 SVG 차트 유틸
 * - buildDonutSVG: 자산 비중 도넛차트 (그라데이션 그레이 팔레트)
 * - buildLineChartSVG: 자산 변화 라인차트 (부드러운 곡선 + 아래쪽 그라데이션 채우기)
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
      // 클릭 가능한 세그먼트는 data-* 속성에 라벨/비중/금액 정보를 담아두고,
      // 앱 쪽에서 클릭 이벤트로 읽어서 정보를 보여준다.
      rings += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}"
        stroke-width="${stroke}" stroke-dasharray="${dashLen} ${c - dashLen}"
        stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"
        class="donut-seg"${seg.key ? ` data-key="${escapeHtml(seg.key)}"` : ""}
        data-label="${escapeHtml(seg.label || "")}" data-pct="${seg.pct != null ? seg.pct : ""}"
        data-amount="${seg.amount != null ? seg.amount : ""}"
        style="cursor:pointer;" />`;
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

// 큰 금액은 억 단위로 축약, 그 외엔 천단위 콤마만 (라인차트 라벨 전용, ₩ 기호 없이 숫자만)
function shortValueLabel(v) {
  const n = Math.round(v);
  if (Math.abs(n) >= 100000000) return (n / 100000000).toFixed(2) + "억";
  return n.toLocaleString("ko-KR");
}

// Catmull-Rom → 3차 베지어 변환으로 포인트를 자연스럽게 잇는 부드러운 곡선 경로를 만든다.
function smoothLinePath(pts) {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? i : i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

let lineChartGradientSeq = 0;

// 라벨 텍스트의 대략적인 픽셀 폭을 추정한다 (고정폭 폰트가 아니므로 넉넉하게 계산).
// 이 값을 기준으로 포인트 간 최소 간격을 늘려서 숫자 라벨끼리 겹치지 않게 한다.
function estimateLabelWidth(text, fontSize, bold) {
  const perChar = fontSize * (bold ? 0.62 : 0.56);
  return text.length * perChar;
}

function buildLineChartSVG(points, opts = {}) {
  const height = opts.height || 180;
  const padTop = 30;
  const padBottom = 24;
  const padLeft = 12;
  const padRight = 16;
  // 카드 내부에 여유 있게 들어가는 기본 폭(스크롤 없이 채우는 폭).
  // 포인트마다 값 라벨을 보여줘야 해서, 라벨이 겹치지 않을 최소 간격을 확보 못하면
  // 실제 폭을 늘려 좌우로 스크롤되게 한다.
  const baseWidth = opts.width || 300;
  // 옵션으로 넘어온 값은 "최소" 기준일 뿐, 실제 숫자 라벨 폭을 보고 더 필요하면 아래에서 늘어난다.
  const requestedMinPointGap = opts.minPointGap || 58;

  if (!points || points.length === 0) {
    return `<svg viewBox="0 0 ${baseWidth} ${height}" width="100%" height="${height}">
      <text x="${baseWidth / 2}" y="${height / 2}" text-anchor="middle" font-size="13" fill="var(--ink-soft)">표시할 데이터가 없습니다</text>
    </svg>`;
  }

  if (points.length === 1) {
    points = [points[0], { date: points[0].date, value: points[0].value }];
  }

  const n = points.length;

  // 각 포인트의 값 라벨 폭을 미리 계산해서, 이웃한 두 라벨이 겹치지 않으려면
  // 포인트 간 간격이 최소 얼마나 필요한지 구한다 (옵션 minPointGap은 하한선일 뿐).
  const labelWidths = points.map((p, i) => {
    const isLast = i === n - 1;
    return estimateLabelWidth(shortValueLabel(p.value), isLast ? 11.5 : 10.5, isLast);
  });
  let minPointGap = requestedMinPointGap;
  for (let i = 0; i < n - 1; i++) {
    // 라벨은 대부분 자기 포인트를 기준으로 가운데(또는 양끝) 정렬되므로,
    // 이웃 라벨 폭의 절반씩 + 여백(10px)만큼은 떨어뜨려야 겹치지 않는다.
    const needed = labelWidths[i] / 2 + labelWidths[i + 1] / 2 + 10;
    if (needed > minPointGap) minPointGap = needed;
  }

  const neededWidth = padLeft + padRight + minPointGap * (n - 1);
  const scrollable = neededWidth > baseWidth;
  const width = scrollable ? neededWidth : baseWidth;

  const values = points.map((p) => p.value);
  let min = Math.min(...values, 0);
  let max = Math.max(...values);
  if (min === max) {
    max = min + Math.max(Math.abs(min) * 0.1, 1000);
  }
  const range = max - min;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const xAt = (i) => padLeft + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v) => padTop + innerH - ((v - min) / range) * innerH;
  const coords = points.map((p, i) => ({ x: xAt(i), y: yAt(p.value) }));

  const linePath = smoothLinePath(coords);
  const baseline = (padTop + innerH).toFixed(1);
  const areaPath = `${linePath} L ${coords[n - 1].x.toFixed(1)} ${baseline} L ${coords[0].x.toFixed(1)} ${baseline} Z`;

  const firstLabel = shortDateLabel(points[0].date);
  const lastLabel = shortDateLabel(points[n - 1].date);

  lineChartGradientSeq += 1;
  const gradId = `lineFade${lineChartGradientSeq}`;

  const dots = coords
    .map((c, i) => {
      const isLast = i === n - 1;
      return `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${isLast ? 4 : 3.2}" fill="var(--ink)" ${
        isLast ? "" : `fill-opacity="0.55"`
      }/>`;
    })
    .join("");

  const valueLabels = coords
    .map((c, i) => {
      const isLast = i === n - 1;
      const label = shortValueLabel(points[i].value);
      let anchor = "middle";
      let lx = c.x;
      if (i === 0) {
        anchor = "start";
        lx = Math.max(c.x - 14, padLeft);
      } else if (isLast) {
        anchor = "end";
        lx = Math.min(c.x + 14, width - padRight);
      }
      const ly = Math.max(c.y - 12, 13);
      return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" font-size="${
        isLast ? 11.5 : 10.5
      }" font-weight="${isLast ? 700 : 600}" fill="${isLast ? "var(--ink)" : "var(--ink-soft)"}">${label}</text>`;
    })
    .join("");

  // 스크롤이 필요 없을 땐 기존처럼 100% 폭으로 채우고, 필요할 땐 실제 픽셀 폭으로 렌더링해
  // 부모의 가로 스크롤 컨테이너 안에서 좌우로 슬라이드해 볼 수 있게 한다.
  const widthAttr = scrollable ? width : "100%";

  return `<svg viewBox="0 0 ${width} ${height}" width="${widthAttr}" height="${height}" preserveAspectRatio="none" style="display:block;">
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--ink)" stop-opacity="0.28"/>
        <stop offset="55%" stop-color="var(--ink)" stop-opacity="0.09"/>
        <stop offset="100%" stop-color="var(--ink)" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <line x1="${padLeft}" y1="${(padTop + innerH / 2).toFixed(1)}" x2="${width - padRight}" y2="${(padTop + innerH / 2).toFixed(
    1
  )}" stroke="var(--border)" stroke-width="1"/>
    <path d="${areaPath}" fill="url(#${gradId})" stroke="none"/>
    <path d="${linePath}" fill="none" stroke="var(--ink)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    ${valueLabels}
    <text x="${padLeft}" y="${height - 6}" font-size="10.5" fill="var(--ink-soft)">${firstLabel}</text>
    <text x="${width - padRight}" y="${height - 6}" font-size="10.5" fill="var(--ink-soft)" text-anchor="end">${lastLabel}</text>
  </svg>`;
}
