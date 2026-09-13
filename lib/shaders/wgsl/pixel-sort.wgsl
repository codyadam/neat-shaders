// Interval pixel sort (Asendorf / G'MIC / satyarth pixelsort).
//
// Masked interval variants:
//   0 Threshold — sort runs whose luma sits between lower and upper
//   1 Edges     — Sobel edges break runs (G'MIC contours)
//   2 Random    — jittered run lengths (satyarth random)
//   3 Waves     — nearly uniform run lengths (satyarth waves)
//
// A layer mask (Blend → Mask) is always an extra gate: dark mask pixels
// stay put and split intervals, matching pixelsort `-m` / G'MIC "bottom layer".

struct Params {
  resolution: vec2f,
  time: f32,
  axis: i32,
  interval: i32,
  sort_by: i32,
  max_span: i32,
  reverse: u32,
  invert_interval: u32,
  lower: f32,
  upper: f32,
  length: f32,
  strength: f32,
  has_mask: u32,
  mask_invert: u32,
  mask_contrast: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var mask: texture_2d<f32>;

const MAX_SPAN: i32 = 64;

fn luma(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
}

fn rgb_hue(rgb: vec3f) -> f32 {
  let cmax = max(rgb.r, max(rgb.g, rgb.b));
  let cmin = min(rgb.r, min(rgb.g, rgb.b));
  let d = cmax - cmin;
  if (d < 1e-5) {
    return 0.0;
  }
  var h = 0.0;
  if (cmax == rgb.r) {
    h = (rgb.g - rgb.b) / d;
  } else if (cmax == rgb.g) {
    h = 2.0 + (rgb.b - rgb.r) / d;
  } else {
    h = 4.0 + (rgb.r - rgb.g) / d;
  }
  return fract(h / 6.0);
}

fn sort_key(rgb: vec3f) -> f32 {
  switch (params.sort_by) {
    case 1: {
      return 0.5 * (max(rgb.r, max(rgb.g, rgb.b)) + min(rgb.r, min(rgb.g, rgb.b)));
    }
    case 2: {
      return rgb_hue(rgb);
    }
    case 3: {
      let mx = max(rgb.r, max(rgb.g, rgb.b));
      let mn = min(rgb.r, min(rgb.g, rgb.b));
      return select(0.0, (mx - mn) / mx, mx > 1e-5);
    }
    case 4: {
      return (rgb.r + rgb.g + rgb.b) / 3.0;
    }
    case 5: {
      return min(rgb.r, min(rgb.g, rgb.b));
    }
    case 6: {
      return max(rgb.r, max(rgb.g, rgb.b));
    }
    case 7: {
      return rgb.r;
    }
    case 8: {
      return rgb.g;
    }
    case 9: {
      return rgb.b;
    }
    default: {
      return luma(rgb);
    }
  }
}

fn hash21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.103, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn src_size() -> vec2i {
  return vec2i(textureDimensions(src));
}

fn load_src(px: vec2i) -> vec4f {
  let dim = src_size();
  let q = clamp(px, vec2i(0), dim - 1);
  return textureLoad(src, q, 0);
}

fn layer_mask_ok(px: vec2i) -> bool {
  if (params.has_mask == 0u) {
    return true;
  }
  let uv = (vec2f(px) + vec2f(0.5)) / params.resolution;
  let m = textureSampleLevel(mask, samp, uv, 0.0);
  var l = luma(m.rgb);
  if (params.mask_invert == 1u) {
    l = 1.0 - l;
  }
  l = clamp((l - 0.5) * params.mask_contrast + 0.5, 0.0, 1.0);
  return l >= 0.5;
}

fn sobel_luma(px: vec2i) -> f32 {
  let tl = luma(load_src(px + vec2i(-1, -1)).rgb);
  let t  = luma(load_src(px + vec2i( 0, -1)).rgb);
  let tr = luma(load_src(px + vec2i( 1, -1)).rgb);
  let l  = luma(load_src(px + vec2i(-1,  0)).rgb);
  let r  = luma(load_src(px + vec2i( 1,  0)).rgb);
  let bl = luma(load_src(px + vec2i(-1,  1)).rgb);
  let b  = luma(load_src(px + vec2i( 0,  1)).rgb);
  let br = luma(load_src(px + vec2i( 1,  1)).rgb);
  let gx = -tl + tr - 2.0 * l + 2.0 * r - bl + br;
  let gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  return length(vec2f(gx, gy));
}

fn interval_member(px: vec2i, c: vec4f) -> bool {
  var ok = true;
  switch (params.interval) {
    case 1: {
      ok = sobel_luma(px) < params.lower;
    }
    case 2, 3: {
      ok = true;
    }
    default: {
      let v = luma(c.rgb);
      ok = v >= params.lower && v <= params.upper;
    }
  }
  if (params.invert_interval == 1u) {
    ok = !ok;
  }
  return ok && layer_mask_ok(px);
}

fn along_of(px: vec2i) -> i32 {
  if (params.axis == 1) {
    return px.y;
  }
  return px.x;
}

fn perp_of(px: vec2i) -> i32 {
  if (params.axis == 1) {
    return px.x;
  }
  return px.y;
}

fn step_axis() -> vec2i {
  if (params.axis == 1) {
    return vec2i(0, 1);
  }
  return vec2i(1, 0);
}

fn bin_of(px: vec2i) -> i32 {
  let len = max(params.length, 2.0);
  let a = f32(along_of(px));
  let p = f32(perp_of(px));
  if (params.interval == 2) {
    let j = hash21(vec2f(p, 11.7)) * len;
    return i32(floor((a + j) / len));
  }
  if (params.interval == 3) {
    let j = hash21(vec2f(p, 3.1)) * 10.0;
    return i32(floor((a + j) / len));
  }
  return 0;
}

fn in_same_run(origin: vec2i, other: vec2i) -> bool {
  if (!interval_member(other, load_src(other))) {
    return false;
  }
  if (params.interval == 2 || params.interval == 3) {
    return bin_of(origin) == bin_of(other);
  }
  return true;
}

fn comes_before(a: vec4f, ia: i32, b: vec4f, ib: i32) -> bool {
  let ka = sort_key(a.rgb);
  let kb = sort_key(b.rgb);
  if (ka < kb) {
    return true;
  }
  if (ka > kb) {
    return false;
  }
  return ia < ib;
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let dim = src_size();
  var px = vec2i(uv * vec2f(dim));
  px = clamp(px, vec2i(0), dim - 1);
  let center = load_src(px);

  if (!interval_member(px, center)) {
    return center;
  }

  let dir = step_axis();
  let limit = clamp(params.max_span, 2, MAX_SPAN);
  let axis_max = select(dim.x, dim.y, params.axis == 1) - 1;

  var start_i = 0;
  for (var s = 1; s <= MAX_SPAN; s++) {
    if (s > limit) { break; }
    let along = along_of(px) - s;
    if (along < 0) { break; }
    let q = px - dir * s;
    if (!in_same_run(px, q)) { break; }
    start_i = s;
  }

  var end_i = 0;
  for (var s = 1; s <= MAX_SPAN; s++) {
    if (s > limit) { break; }
    let along = along_of(px) + s;
    if (along > axis_max) { break; }
    let q = px + dir * s;
    if (!in_same_run(px, q)) { break; }
    end_i = s;
  }

  let span = start_i + end_i + 1;
  var dest_rank = start_i;
  if (params.reverse == 1u) {
    dest_rank = span - 1 - dest_rank;
  }

  var chosen = center;
  for (var i = 0; i < MAX_SPAN; i++) {
    if (i >= span) { break; }
    let qi = i - start_i;
    let q = px + dir * qi;
    let cq = load_src(q);
    var rank = 0;
    for (var j = 0; j < MAX_SPAN; j++) {
      if (j >= span) { break; }
      let pj = j - start_i;
      let p = px + dir * pj;
      let cp = load_src(p);
      if (comes_before(cp, along_of(p), cq, along_of(q))) {
        rank += 1;
      }
    }
    if (rank == dest_rank) {
      chosen = cq;
      break;
    }
  }

  let rgb = mix(center.rgb, chosen.rgb, clamp(params.strength, 0.0, 1.0));
  return vec4f(rgb, center.a);
}
