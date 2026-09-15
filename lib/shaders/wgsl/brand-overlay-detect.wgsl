// Pass 1: write a sparse detection map. Selected analysis-cell centres store
// selected=1, radius, and score so the overlay pass can form a distance mesh.

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
  mesh_marker: f32,
  map_preset: i32,
  atlas_cols: i32,
  atlas_rows: i32,
  char_count: i32,
  ink: vec3f,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

fn luma(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
}

fn hash21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.103, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn cell_hash(cell: vec2i, salt: f32) -> f32 {
  return hash21(vec2f(f32(cell.x) + salt, f32(cell.y) + f32(params.size_seed) * 0.17));
}

fn block() -> f32 {
  return max(params.block_size, 2.0);
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

fn luma_px(px: vec2f) -> f32 {
  let uv = clamp(px / params.resolution, vec2f(0.0), vec2f(1.0));
  return luma(textureSampleLevel(src, samp, uv, 0.0).rgb);
}

fn score_cell(cell: vec2i) -> f32 {
  if (!in_frame(cell)) {
    return -1.0;
  }
  let c = cell_center(cell);
  let o = block() * 0.32;
  let l0 = luma_px(c);
  let l1 = luma_px(c + vec2f(-o, -o));
  let l2 = luma_px(c + vec2f(o, -o));
  let l3 = luma_px(c + vec2f(-o, o));
  let l4 = luma_px(c + vec2f(o, o));
  let mean = (l0 + l1 + l2 + l3 + l4) * 0.2;
  let mn = min(l0, min(min(l1, l2), min(l3, l4)));
  let mx = max(l0, max(max(l1, l2), max(l3, l4)));
  let range = max(mx - mn, 0.0);
  switch (params.detect_mode) {
    case 1: {
      return clamp(range * 140.0, 0.0, 100.0);
    }
    case 2: {
      return clamp(mean * 100.0, 0.0, 100.0);
    }
    case 3: {
      return clamp((1.0 - mean) * 100.0, 0.0, 100.0);
    }
    default: {
      return clamp(range * 90.0 + abs(mean - 0.5) * 55.0, 0.0, 100.0);
    }
  }
}

fn min_distance() -> f32 {
  return max(params.min_distance, 0.0);
}

fn grid_size() -> vec2i {
  let b = block();
  return vec2i(
    max(i32(ceil(params.resolution.x / b)), 1),
    max(i32(ceil(params.resolution.y / b)), 1),
  );
}

fn dart_cell(i: i32, attempt: i32) -> vec2i {
  let g = grid_size();
  let h1 = hash21(vec2f(f32(i) * 1.7 + f32(attempt) * 9.3, f32(params.size_seed)));
  let h2 = hash21(vec2f(f32(params.size_seed) + 4.1, f32(i) * 5.9 + f32(attempt) * 2.4));
  return vec2i(
    min(i32(h1 * f32(g.x)), g.x - 1),
    min(i32(h2 * f32(g.y)), g.y - 1),
  );
}

fn is_selected(cell: vec2i) -> bool {
  if (!in_frame(cell)) {
    return false;
  }
  let s = score_cell(cell);
  if (s < params.threshold) {
    return false;
  }

  let cap = clamp(params.max_circles, 1, 300);
  let md = min_distance();
  let t = params.threshold;
  let span = max(100.0 - t, 1.0);
  var placed: array<vec2f, 300>;
  var n = 0;

  for (var i = 0; i < cap; i++) {
    var chosen = vec2i(-1, -1);
    var chosen_px = vec2f(0.0);
    for (var attempt = 0; attempt < 8; attempt++) {
      let cand = dart_cell(i, attempt);
      if (!in_frame(cand)) {
        continue;
      }
      let cs = score_cell(cand);
      if (cs < t) {
        continue;
      }
      let u = clamp((cs - t) / span, 0.0, 1.0);
      let accept = hash21(vec2f(f32(i) * 11.0 + f32(attempt), f32(params.size_seed) * 0.13));
      if (accept > pow(max(u, 0.04), 1.25)) {
        continue;
      }
      let px = cell_center(cand);
      if (md > 0.5 && n > 0) {
        var far = true;
        for (var j = 0; j < n; j++) {
          if (distance(px, placed[j]) < md) {
            far = false;
            break;
          }
        }
        if (!far) {
          continue;
        }
      }
      chosen = cand;
      chosen_px = px;
      break;
    }
    if (chosen.x < 0) {
      continue;
    }
    if (chosen.x == cell.x && chosen.y == cell.y) {
      return true;
    }
    placed[n] = chosen_px;
    n++;
  }
  return false;
}

fn mark_radius(cell: vec2i, score: f32) -> f32 {
  let t = clamp((score - params.threshold) / max(100.0 - params.threshold, 1.0), 0.0, 1.0);
  let jitter = mix(0.82, 1.18, cell_hash(cell, 5.1));
  return mix(max(params.min_radius, 1.0), max(params.max_radius, params.min_radius), t) * jitter;
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let p = uv * params.resolution;
  let b = block();
  let cell = vec2i(floor(p / b));
  let center = cell_center(cell);
  let blob = clamp(block() * 0.4, 0.6, 2.25);
  if (length(p - center) > blob) {
    return vec4f(0.0);
  }
  if (!is_selected(cell)) {
    return vec4f(0.0);
  }
  let s = score_cell(cell);
  let r = mark_radius(cell, s);
  return vec4f(1.0, r / 128.0, s / 100.0, 1.0);
}
