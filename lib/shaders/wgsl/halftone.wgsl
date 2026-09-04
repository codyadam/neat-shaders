// Halftone — fixed-grid dot halftone driven by the source luminance. WGSL port
// of the HalftoneMedia canvas component without the pointer / playback
// plumbing: one sample per grid cell, dot radius from darkness (or brightness
// when inverted), a luma threshold that skips background cells, and an
// optional "sample colour" mode that paints each dot with the quantised source
// colour instead of the tint.
//
// The 2D original downsamples the media to a cols×rows bitmap so each cell
// gets a box-filtered sample; here each cell averages nine bilinear taps
// spread across the cell, which lands very close at typical cell sizes.

struct Params {
  resolution: vec2f,
  time: f32,

  // Grid (source pixels).
  size: f32,
  max_diameter: f32,
  min_diameter: f32,
  shape: i32,          // 0 circle, 1 square, 2 diamond
  softness: f32,

  // Sampling.
  threshold: f32,
  invert: u32,
  gamma: f32,
  alpha_cutoff: f32,

  // Colour.
  sample_color: u32,
  color_bits: i32,
  tint: vec3f,
  background: vec3f,
  background_alpha: f32,
  source_backdrop: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

/** Cells searched around the fragment; dots larger than the pitch spill over. */
const REACH: i32 = 2;

struct Grid {
  cols: i32,
  rows: i32,
  start: vec2f,
  size: f32,
}

fn luma(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
}

/** Straight-alpha "over" compositing. */
fn over(top: vec4f, bottom: vec4f) -> vec4f {
  let a = top.a + bottom.a * (1.0 - top.a);
  if (a <= 0.0) {
    return vec4f(0.0);
  }
  let rgb = (top.rgb * top.a + bottom.rgb * bottom.a * (1.0 - top.a)) / a;
  return vec4f(rgb, a);
}

fn build_grid() -> Grid {
  var g: Grid;
  g.size = max(params.size, 1.0);
  g.cols = i32(floor((params.resolution.x - g.size) / g.size)) + 1;
  g.rows = i32(floor((params.resolution.y - g.size) / g.size)) + 1;
  if (g.cols < 1 || g.rows < 1) {
    g.cols = 0;
    g.rows = 0;
    g.start = vec2f(0.0);
    return g;
  }
  g.start = (params.resolution - vec2f(f32(g.cols - 1), f32(g.rows - 1)) * g.size) * 0.5;
  return g;
}

/** Box-ish average of the source over one cell (3×3 bilinear taps). */
fn sample_cell(center: vec2f, size: f32) -> vec4f {
  let texel = 1.0 / params.resolution;
  let step = size / 3.0;
  var acc = vec4f(0.0);
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let p = center + vec2f(f32(i), f32(j)) * step;
      acc += textureSampleLevel(src, samp, p * texel, 0.0);
    }
  }
  return acc / 9.0;
}

/** Quantise to `bits` per channel, replicating bits so 0 → 0 and 1 → 1. */
fn quantize(rgb: vec3f, bits: i32) -> vec3f {
  let b = clamp(bits, 1, 8);
  if (b >= 8) {
    return rgb;
  }
  let levels = exp2(f32(b)) - 1.0;
  return round(clamp(rgb, vec3f(0.0), vec3f(1.0)) * levels) / levels;
}

fn shape_distance(d: vec2f) -> f32 {
  switch (params.shape) {
    case 1: {
      return max(abs(d.x), abs(d.y));
    }
    case 2: {
      return (abs(d.x) + abs(d.y)) * 0.70710678;
    }
    default: {
      return length(d);
    }
  }
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let p = uv * params.resolution;
  let fw = fwidth(p);
  let aa = 0.5 * max(fw.x, fw.y) + max(params.softness, 0.0);

  let source = textureSampleLevel(src, samp, uv, 0.0);
  var out = vec4f(params.background, clamp(params.background_alpha, 0.0, 1.0));
  out = over(vec4f(source.rgb, source.a * clamp(params.source_backdrop, 0.0, 1.0)), out);

  let g = build_grid();
  if (g.cols < 1) {
    return out;
  }

  let inverted = params.invert == 1u;
  let threshold = clamp(params.threshold, 0.0, 1.0);
  // Normal: skip near-white. Invert: skip near-black.
  let luma_cut = select(threshold, 1.0 - threshold, inverted);
  let max_radius = max(params.max_diameter, 0.0) * 0.5;
  let min_radius = max(0.0, min(params.min_diameter, params.max_diameter)) * 0.5;
  let gamma = max(params.gamma, 0.01);

  let cell = vec2i(round((p - g.start) / g.size));
  var dots = vec4f(0.0);

  for (var dy = -REACH; dy <= REACH; dy++) {
    for (var dx = -REACH; dx <= REACH; dx++) {
      let col = cell.x + dx;
      let row = cell.y + dy;
      if (col < 0 || col >= g.cols || row < 0 || row >= g.rows) {
        continue;
      }
      let center = g.start + vec2f(f32(col), f32(row)) * g.size;
      let d = shape_distance(p - center);
      if (d > max_radius + aa) {
        continue;
      }

      let s = sample_cell(center, g.size);
      if (s.a < params.alpha_cutoff) {
        continue;
      }

      let l = clamp(luma(s.rgb), 0.0, 1.0);
      let is_background = select(l >= luma_cut, l <= luma_cut, inverted);
      var radius = min_radius;
      if (!is_background) {
        let weight = pow(select(1.0 - l, l, inverted), gamma);
        radius = min_radius + (max_radius - min_radius) * weight;
      }
      if (radius < 0.35) {
        continue;
      }

      let coverage = 1.0 - smoothstep(radius - aa, radius + aa, d);
      if (coverage <= 0.0) {
        continue;
      }

      var color = params.tint;
      if (params.sample_color == 1u) {
        color = quantize(s.rgb, params.color_bits);
      }
      dots = over(vec4f(color, coverage), dots);
    }
  }

  return over(dots, out);
}
