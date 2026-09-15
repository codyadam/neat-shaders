// Survey-style brand overlay: analysis-grid marks, connecting lines,
// a shrinking circle chain, and colour-mapped mosaic squares on anchors.
//
// Detection is a jittered analysis grid. Each cell is scored from its
// luma (and a 3×3 neighbourhood for contrast / combined). Local-max NMS
// plus a density cap stand in for the original tool's greedy placement.
// Zone squares remap a pixelated sample through the same palettes as
// Color map (WeatherNext by default) instead of a mosaic of source colour.

struct Params {
  resolution: vec2f,
  time: f32,
  pixel_size: f32,
  zone_size: f32,
  zone_count: i32,
  zone_stroke: u32,
  chain_enabled: u32,
  chain_count: i32,
  chain_angle: f32,
  chain_base: f32,
  chain_ratio: f32,
  intersections: u32,
  marker_size: f32,
  detect_mode: i32,
  block_size: f32,
  threshold: f32,
  max_circles: i32,
  min_distance: f32,
  shape: i32,
  min_radius: f32,
  max_radius: f32,
  stroke: f32,
  size_seed: i32,
  label_size: f32,
  overlay_opacity: f32,
  max_distance: f32,
  line_weight: f32,
  map_preset: i32,
  atlas_cols: i32,
  atlas_rows: i32,
  char_count: i32,
  ink: vec3f,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var atlas: texture_2d<f32>;
@group(0) @binding(4) var atlas_samp: sampler;

const WIN: i32 = 15;
const HALF: i32 = 7;
const WIN_N: i32 = 225;
const MAX_CHAIN: i32 = 15;
const MAX_ZONES: i32 = 8;
const LAST_SPAN: f32 = 5.0;

fn luma(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
}

fn hash21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.103, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn seed_f() -> f32 {
  return f32(params.size_seed);
}

fn cell_hash(cell: vec2i, salt: f32) -> f32 {
  return hash21(vec2f(f32(cell.x) + salt, f32(cell.y) + seed_f() * 0.17));
}

fn clamp_uv(uv: vec2f) -> vec2f {
  return clamp(uv, vec2f(0.0), vec2f(1.0));
}

fn sample_luma_px(px: vec2f) -> f32 {
  let uv = clamp_uv((px + 0.5) / params.resolution);
  return luma(textureSampleLevel(src, samp, uv, 0.0).rgb);
}

fn sample_rgb_px(px: vec2f) -> vec3f {
  let uv = clamp_uv((px + 0.5) / params.resolution);
  return textureSampleLevel(src, samp, uv, 0.0).rgb;
}

fn block() -> f32 {
  return max(params.block_size, 8.0);
}

fn cell_center(cell: vec2i) -> vec2f {
  return (vec2f(cell) + 0.5) * block();
}

fn in_frame(cell: vec2i) -> bool {
  let b = block();
  let cols = i32(ceil(params.resolution.x / b));
  let rows = i32(ceil(params.resolution.y / b));
  return cell.x >= 0 && cell.y >= 0 && cell.x < cols && cell.y < rows;
}

fn lum_at(lum: ptr<function, array<f32, 225>>, lx: i32, ly: i32) -> f32 {
  if (lx < 0 || ly < 0 || lx >= WIN || ly >= WIN) {
    return -1.0;
  }
  return (*lum)[ly * WIN + lx];
}

fn cell_score(lum: ptr<function, array<f32, 225>>, lx: i32, ly: i32) -> f32 {
  let l = lum_at(lum, lx, ly);
  if (l < 0.0) {
    return -1.0;
  }
  var mn = l;
  var mx = l;
  for (var oy = -1; oy <= 1; oy++) {
    for (var ox = -1; ox <= 1; ox++) {
      let n = lum_at(lum, lx + ox, ly + oy);
      if (n >= 0.0) {
        mn = min(mn, n);
        mx = max(mx, n);
      }
    }
  }
  let range = max(mx - mn, 0.0);
  switch (params.detect_mode) {
    case 1: { // Contrast
      return clamp(range * 180.0, 0.0, 100.0);
    }
    case 2: { // Bright
      return clamp(l * 100.0, 0.0, 100.0);
    }
    case 3: { // Dark
      return clamp((1.0 - l) * 100.0, 0.0, 100.0);
    }
    default: { // Combined
      return clamp(range * 130.0 + abs(l - 0.5) * 50.0, 0.0, 100.0);
    }
  }
}

fn nms_radius() -> i32 {
  let r = i32(ceil(max(params.min_distance, 1.0) / block()));
  return clamp(r, 1, HALF);
}

fn density_keep(cell: vec2i, score: f32) -> bool {
  let md = max(params.min_distance, 8.0);
  let slots = max((params.resolution.x * params.resolution.y) / (md * md), 1.0);
  let cap = f32(max(params.max_circles, 1));
  let dens = clamp(cap / slots, 0.04, 1.0);
  let boost = mix(dens, 1.0, clamp((score - params.threshold) / 28.0, 0.0, 1.0));
  return cell_hash(cell, 2.3) < boost;
}

fn is_selected(lum: ptr<function, array<f32, 225>>, origin: vec2i, lx: i32, ly: i32) -> bool {
  let cell = origin + vec2i(lx, ly);
  if (!in_frame(cell)) {
    return false;
  }
  let s = cell_score(lum, lx, ly);
  if (s < params.threshold) {
    return false;
  }
  let nms = nms_radius();
  let pri = s + cell_hash(cell, 0.7) * 0.05;
  for (var oy = -nms; oy <= nms; oy++) {
    for (var ox = -nms; ox <= nms; ox++) {
      if (ox == 0 && oy == 0) {
        continue;
      }
      let ncell = cell + vec2i(ox, oy);
      if (!in_frame(ncell)) {
        continue;
      }
      let ns = cell_score(lum, lx + ox, ly + oy);
      if (ns < params.threshold) {
        continue;
      }
      let npri = ns + cell_hash(ncell, 0.7) * 0.05;
      let dist = length(cell_center(ncell) - cell_center(cell));
      if (dist < max(params.min_distance, 1.0) && npri > pri) {
        return false;
      }
    }
  }
  return density_keep(cell, s);
}

fn mark_radius(cell: vec2i, score: f32) -> f32 {
  let t = clamp((score - params.threshold) / max(100.0 - params.threshold, 1.0), 0.0, 1.0);
  let jitter = mix(0.82, 1.18, cell_hash(cell, 5.1));
  return mix(max(params.min_radius, 1.0), max(params.max_radius, params.min_radius), t) * jitter;
}

fn sd_box(p: vec2f, half_ext: vec2f) -> f32 {
  let d = abs(p) - half_ext;
  return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
}

fn sd_segment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1.0e-4), 0.0, 1.0);
  return length(pa - ba * h);
}

fn outline_cov(sdf: f32, stroke: f32) -> f32 {
  return clamp(stroke * 0.5 + 0.75 - abs(sdf), 0.0, 1.0);
}

fn fill_cov(sdf: f32) -> f32 {
  return clamp(0.75 - sdf, 0.0, 1.0);
}

fn mark_sdf(p: vec2f, center: vec2f, radius: f32) -> f32 {
  let q = p - center;
  if (params.shape == 1) {
    return sd_box(q, vec2f(radius));
  }
  return length(q) - radius;
}

const COMMA_IDX: i32 = 10;

fn atlas_glyph(local: vec2f, idx: i32) -> f32 {
  if (local.x <= 0.0 || local.y <= 0.0 || local.x >= 1.0 || local.y >= 1.0) {
    return 0.0;
  }
  let cols = max(params.atlas_cols, 1);
  let rows = max(params.atlas_rows, 1);
  let n = max(params.char_count, 1);
  let i = clamp(idx, 0, n - 1);
  let col = i % cols;
  let row = i / cols;
  let pad = vec2f(0.1, 0.08);
  let u = mix(pad, vec2f(1.0) - pad, local);
  let atlas_uv = (vec2f(f32(col), f32(row)) + u) / vec2f(f32(cols), f32(rows));
  return textureSampleLevel(atlas, atlas_samp, atlas_uv, 0.0).r;
}

fn glyph_cov(p: vec2f, origin: vec2f, size: vec2f, idx: i32) -> f32 {
  return atlas_glyph((p - origin) / size, idx);
}

fn int_cov(p: vec2f, origin: vec2f, px: f32, value: i32) -> f32 {
  var digits: array<i32, 4>;
  var n = max(value, 0);
  var count = 0;
  if (n == 0) {
    digits[0] = 0;
    count = 1;
  } else {
    for (var i = 0; i < 4; i++) {
      if (n <= 0) {
        break;
      }
      digits[count] = n % 10;
      n = n / 10;
      count++;
    }
  }
  let gw = px * 0.62;
  let gh = px * 1.15;
  var acc = 0.0;
  var xoff = 0.0;
  for (var i = count - 1; i >= 0; i--) {
    acc = max(acc, glyph_cov(p, origin + vec2f(xoff, 0.0), vec2f(gw, gh), digits[i]));
    xoff += gw * 0.88;
  }
  return acc;
}

fn int_width(value: i32, px: f32) -> f32 {
  let gw = px * 0.62 * 0.88;
  var n = max(value, 0);
  var count = 1;
  n = n / 10;
  for (var i = 0; i < 3; i++) {
    if (n <= 0) {
      break;
    }
    count++;
    n = n / 10;
  }
  return f32(count) * gw;
}

fn label_cov(p: vec2f, center: vec2f, radius: f32) -> f32 {
  let px = max(params.label_size, 0.0);
  if (px < 3.5) {
    return 0.0;
  }
  let origin = center + vec2f(radius + px * 0.45, -px * 0.55);
  let x = i32(center.x);
  let y = i32(center.y);
  var acc = int_cov(p, origin, px, x);
  let w = int_width(x, px);
  let comma_w = px * 0.42;
  acc = max(acc, glyph_cov(p, origin + vec2f(w, px * 0.12), vec2f(comma_w, px * 1.05), COMMA_IDX));
  acc = max(acc, int_cov(p, origin + vec2f(w + comma_w * 0.72, 0.0), px, y));
  return acc;
}

fn stop_at(s: array<vec3f, 6>, i: i32) -> vec3f {
  switch (i) {
    case 0: { return s[0]; }
    case 1: { return s[1]; }
    case 2: { return s[2]; }
    case 3: { return s[3]; }
    case 4: { return s[4]; }
    default: { return s[5]; }
  }
}

fn load_stops() -> array<vec3f, 6> {
  var s: array<vec3f, 6>;
  switch (params.map_preset) {
    case 1: {
      s[0] = vec3f(0.0, 0.0, 0.016);
      s[1] = vec3f(0.231, 0.059, 0.439);
      s[2] = vec3f(0.549, 0.161, 0.506);
      s[3] = vec3f(0.871, 0.286, 0.408);
      s[4] = vec3f(0.996, 0.624, 0.427);
      s[5] = vec3f(0.988, 0.992, 0.749);
    }
    case 2: {
      s[0] = vec3f(0.051, 0.106, 0.165);
      s[1] = vec3f(0.106, 0.227, 0.294);
      s[2] = vec3f(0.769, 0.271, 0.212);
      s[3] = vec3f(0.89, 0.392, 0.078);
      s[4] = vec3f(0.957, 0.635, 0.38);
      s[5] = vec3f(1.0, 0.91, 0.639);
    }
    case 3: {
      s[0] = vec3f(0.102, 0.02, 0.0);
      s[1] = vec3f(0.29, 0.082, 0.0);
      s[2] = vec3f(0.608, 0.173, 0.0);
      s[3] = vec3f(0.91, 0.365, 0.016);
      s[4] = vec3f(0.957, 0.549, 0.024);
      s[5] = vec3f(1.0, 0.953, 0.69);
    }
    case 4: {
      s[0] = vec3f(0.043, 0.063, 0.149);
      s[1] = vec3f(0.18, 0.102, 0.278);
      s[2] = vec3f(0.545, 0.227, 0.384);
      s[3] = vec3f(0.878, 0.478, 0.373);
      s[4] = vec3f(0.949, 0.8, 0.561);
      s[5] = vec3f(1.0, 0.965, 0.878);
    }
    case 5: {
      s[0] = vec3f(0.0);
      s[1] = vec3f(0.2);
      s[2] = vec3f(0.4);
      s[3] = vec3f(0.6);
      s[4] = vec3f(0.8);
      s[5] = vec3f(1.0);
    }
    default: {
      s[0] = vec3f(0.157, 0.282, 0.855);
      s[1] = vec3f(0.176, 0.463, 0.933);
      s[2] = vec3f(0.208, 0.694, 0.957);
      s[3] = vec3f(0.239, 0.82, 0.945);
      s[4] = vec3f(0.525, 0.918, 0.855);
      s[5] = vec3f(0.843, 0.973, 0.722);
    }
  }
  return s;
}

fn gradient_color(s: array<vec3f, 6>, t: f32) -> vec3f {
  let x = clamp(t, 0.0, 1.0) * LAST_SPAN;
  let i = i32(min(floor(x), LAST_SPAN - 0.001));
  let f = clamp(x - f32(i), 0.0, 1.0);
  return mix(stop_at(s, i), stop_at(s, i + 1), f);
}

fn mapped_mosaic(p: vec2f) -> vec3f {
  let ps = max(params.pixel_size, 2.0);
  let snapped = (floor(p / ps) + 0.5) * ps;
  let rgb = sample_rgb_px(snapped);
  let t = clamp(luma(rgb), 0.0, 1.0);
  return gradient_color(load_stops(), t);
}

fn zone_anchor(i: i32) -> vec2f {
  let n = max(params.zone_count, 1);
  let cols = max(i32(ceil(sqrt(f32(n)))), 1);
  let rows = max(i32(ceil(f32(n) / f32(cols))), 1);
  let gx = i % cols;
  let gy = i / cols;
  let h1 = hash21(vec2f(f32(i) * 13.1, seed_f()));
  let h2 = hash21(vec2f(seed_f() + 9.0, f32(i) * 7.7 + 3.0));
  let uv = vec2f(
    (f32(gx) + 0.16 + 0.68 * h1) / f32(cols),
    (f32(gy) + 0.16 + 0.68 * h2) / f32(rows),
  );
  let guess = uv * params.resolution;
  let gc = vec2i(guess / block());
  var best = cell_center(gc);
  var best_s = -1.0;
  for (var oy = -1; oy <= 1; oy++) {
    for (var ox = -1; ox <= 1; ox++) {
      let cell = gc + vec2i(ox, oy);
      if (!in_frame(cell)) {
        continue;
      }
      let c = cell_center(cell);
      let l = sample_luma_px(c);
      var s = abs(l - 0.5) * 80.0 + l * 20.0;
      if (params.detect_mode == 2) {
        s = l * 100.0;
      } else if (params.detect_mode == 3) {
        s = (1.0 - l) * 100.0;
      }
      if (s > best_s) {
        best_s = s;
        best = c;
      }
    }
  }
  return best;
}

fn apply_zones(p: vec2f, src_rgb: vec3f) -> vec3f {
  let n = clamp(params.zone_count, 0, MAX_ZONES);
  if (n <= 0) {
    return src_rgb;
  }
  let half_z = max(params.zone_size, 8.0);
  var rgb = src_rgb;
  var in_zone = false;
  for (var i = 0; i < n; i++) {
    let c = zone_anchor(i);
    if (sd_box(p - c, vec2f(half_z)) <= 0.0) {
      in_zone = true;
    }
  }
  if (in_zone) {
    rgb = mapped_mosaic(p);
  }
  return rgb;
}

fn zone_stroke_cov(p: vec2f) -> f32 {
  if (params.zone_stroke == 0u) {
    return 0.0;
  }
  let n = clamp(params.zone_count, 0, MAX_ZONES);
  let half_z = max(params.zone_size, 8.0);
  var acc = 0.0;
  for (var i = 0; i < n; i++) {
    acc = max(acc, outline_cov(sd_box(p - zone_anchor(i), vec2f(half_z)), max(params.stroke, 0.6)));
  }
  return acc;
}

fn chain_spacing(r0: f32, r1: f32) -> f32 {
  return mix(abs(r0 - r1), r0 + r1, 0.4);
}

fn overlay_chain(p: vec2f) -> f32 {
  if (params.chain_enabled == 0u) {
    return 0.0;
  }
  let n = clamp(params.chain_count, 3, MAX_CHAIN);
  let mid = n / 2;
  let ang = params.chain_angle * 0.017453292519943295;
  let dir = vec2f(sin(ang), cos(ang));
  var radii: array<f32, 15>;
  var centers: array<vec2f, 15>;
  let ratio = max(params.chain_ratio, 0.35);
  let base = max(params.chain_base, 8.0);
  for (var i = 0; i < n; i++) {
    radii[i] = base * pow(ratio, abs(f32(i - mid)));
  }
  centers[mid] = params.resolution * 0.5;
  for (var i = mid + 1; i < n; i++) {
    centers[i] = centers[i - 1] + dir * chain_spacing(radii[i - 1], radii[i]);
  }
  for (var i = mid - 1; i >= 0; i--) {
    centers[i] = centers[i + 1] - dir * chain_spacing(radii[i], radii[i + 1]);
  }

  var acc = 0.0;
  let sw = max(params.stroke, 0.35);
  for (var i = 0; i < n; i++) {
    acc = max(acc, outline_cov(length(p - centers[i]) - radii[i], sw));
  }
  if (params.intersections == 1u) {
    let ms = max(params.marker_size, 0.5);
    for (var i = 0; i < n - 1; i++) {
      let c1 = centers[i];
      let c2 = centers[i + 1];
      let r1 = radii[i];
      let r2 = radii[i + 1];
      let d = length(c2 - c1);
      if (d < 1.0 || d > r1 + r2 || d < abs(r1 - r2)) {
        continue;
      }
      let a = (r1 * r1 - r2 * r2 + d * d) / (2.0 * d);
      let h = sqrt(max(r1 * r1 - a * a, 0.0));
      let ex = (c2 - c1) / d;
      let midp = c1 + ex * a;
      let perp = vec2f(-ex.y, ex.x) * h;
      acc = max(acc, fill_cov(length(p - (midp + perp)) - ms));
      acc = max(acc, fill_cov(length(p - (midp - perp)) - ms));
    }
  }
  return acc;
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let src_c = textureSampleLevel(src, samp, uv, 0.0);
  let p = uv * params.resolution;
  var rgb = apply_zones(p, src_c.rgb);

  let b = block();
  let base_cell = vec2i(floor(p / b));
  let origin = base_cell - vec2i(HALF, HALF);

  var lum: array<f32, 225>;
  for (var y = 0; y < WIN; y++) {
    for (var x = 0; x < WIN; x++) {
      let cell = origin + vec2i(x, y);
      if (in_frame(cell)) {
        lum[y * WIN + x] = sample_luma_px(cell_center(cell));
      } else {
        lum[y * WIN + x] = -1.0;
      }
    }
  }

  var sel: array<u32, 225>;
  var rad: array<f32, 225>;
  let nms = nms_radius();
  for (var y = 0; y < WIN; y++) {
    for (var x = 0; x < WIN; x++) {
      var chosen = 0u;
      var r = 0.0;
      if (x >= nms && y >= nms && x < WIN - nms && y < WIN - nms) {
        if (is_selected(&lum, origin, x, y)) {
          chosen = 1u;
          let cell = origin + vec2i(x, y);
          r = mark_radius(cell, cell_score(&lum, x, y));
        }
      }
      sel[y * WIN + x] = chosen;
      rad[y * WIN + x] = r;
    }
  }

  var overlay = 0.0;
  let sw = max(params.stroke, 0.3);
  for (var y = nms; y < WIN - nms; y++) {
    for (var x = nms; x < WIN - nms; x++) {
      if (sel[y * WIN + x] == 0u) {
        continue;
      }
      let cell = origin + vec2i(x, y);
      let c = cell_center(cell);
      let r = rad[y * WIN + x];
      overlay = max(overlay, outline_cov(mark_sdf(p, c, r), sw));
      overlay = max(overlay, label_cov(p, c, r));
    }
  }

  let max_d = max(params.max_distance, 0.0);
  if (max_d > 0.5) {
    let lw = max(params.line_weight, 0.15);
    for (var i = 0; i < WIN_N; i++) {
      if (sel[i] == 0u) {
        continue;
      }
      let ix = i % WIN;
      let iy = i / WIN;
      let ci = cell_center(origin + vec2i(ix, iy));
      for (var j = i + 1; j < WIN_N; j++) {
        if (sel[j] == 0u) {
          continue;
        }
        let jx = j % WIN;
        let jy = j / WIN;
        let cj = cell_center(origin + vec2i(jx, jy));
        let d = distance(ci, cj);
        if (d > max_d || d < 1.0) {
          continue;
        }
        overlay = max(overlay, outline_cov(sd_segment(p, ci, cj), lw * 2.0));
      }
    }
  }

  overlay = max(overlay, overlay_chain(p));
  overlay = max(overlay, zone_stroke_cov(p));
  overlay *= clamp(params.overlay_opacity, 0.0, 1.0);

  rgb = mix(rgb, params.ink, clamp(overlay, 0.0, 1.0));
  return vec4f(rgb, src_c.a);
}
