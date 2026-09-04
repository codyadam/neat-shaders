// Dot grid — a halftone-style dot field that "enters" as a staggered wave of
// growing dots, then idles while a roaming highlight swells the dots around a
// randomly picked cell. Non-interactive WGSL port of the SceneDotGrid canvas
// component: the pointer is replaced by a time-driven auto highlight, and the
// settled dot size can follow the source luminance so the grid halftones the
// media underneath.
//
// Everything is stateless in `time`: the entrance is a function of each dot's
// rank in the chosen order, and the highlight uses exponential envelopes on the
// current/previous picked cell to reproduce the grow/shrink lerps of the
// original animation loop.

struct Params {
  resolution: vec2f,
  time: f32,

  // Layout (source pixels).
  pitch: f32,
  dot_size_min: f32,
  dot_size_max: f32,
  padding: f32,
  shape: i32,          // 0 circle, 1 square, 2 diamond
  softness: f32,

  // Halftone sizing from the source.
  size_source: i32,    // 0 off, 1 bright = large, 2 dark = large
  size_influence: f32,
  size_gamma: f32,

  // Colors.
  color_mode: i32,     // 0 solid, 1 source, 2 source x active
  active_color: vec3f,
  idle_color: vec3f,
  idle_alpha: f32,
  background: vec3f,
  background_alpha: f32,
  source_backdrop: f32,

  // Entrance wave.
  entrance_enabled: u32,
  entrance_order: i32, // 0 rows, 1 columns, 2 diagonal, 3 radial, 4 random
  enter_spread: f32,
  enter_duration: f32,
  loop_enabled: u32,
  loop_hold: f32,
  time_offset: f32,

  // Roaming highlight.
  highlight_enabled: u32,
  highlight_cycle: f32,
  influence_radius: f32,
  grow_scale: f32,
  grow_rate: f32,
  shrink_rate: f32,

  // The single "public data" speck in the top-left corner.
  speck_enabled: u32,
  speck_color: vec3f,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

/** Neighbourhood searched around the fragment's cell; grown dots overlap neighbours. */
const REACH: i32 = 2;

struct Grid {
  cols: i32,
  rows: i32,
  start: vec2f,
  pitch: f32,
}

struct Highlight {
  focus_a: vec2f,
  focus_b: vec2f,
  env_a: f32,
  env_b: f32,
}

fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn hash01(v: u32) -> f32 {
  return f32(pcg(v)) / 4294967295.0;
}

fn ease_out_cubic(t: f32) -> f32 {
  let u = 1.0 - t;
  return 1.0 - u * u * u;
}

fn luminance(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.299, 0.587, 0.114));
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
  g.pitch = max(params.pitch, 1.0);
  g.cols = 0;
  g.rows = 0;
  g.start = vec2f(0.0);

  let dmax = max(params.dot_size_max, 0.0);
  let pad = max(params.padding, 0.0);
  let inner = params.resolution - vec2f(pad * 2.0);
  if (inner.x < dmax || inner.y < dmax) {
    return g;
  }

  g.cols = i32(floor((inner.x - dmax) / g.pitch)) + 1;
  g.rows = i32(floor((inner.y - dmax) / g.pitch)) + 1;
  if (g.cols < 1 || g.rows < 1) {
    g.cols = 0;
    g.rows = 0;
    return g;
  }

  // Centre the field inside the padded box.
  let span = vec2f(f32(g.cols - 1), f32(g.rows - 1)) * g.pitch;
  g.start = vec2f(pad) + (inner - span) * 0.5;
  return g;
}

fn dot_center(g: Grid, col: i32, row: i32) -> vec2f {
  return g.start + vec2f(f32(col), f32(row)) * g.pitch;
}

/** Position of a dot in the entrance order, normalised to [0, 1]. */
fn entrance_rank(g: Grid, col: i32, row: i32) -> f32 {
  let count = g.cols * g.rows;
  if (count <= 1) {
    return 0.0;
  }
  let denom = f32(count - 1);
  switch (params.entrance_order) {
    case 1: {
      return f32(col * g.rows + row) / denom;
    }
    case 2: {
      return f32(row + col) / max(f32(g.rows + g.cols - 2), 1.0);
    }
    case 3: {
      let half = vec2f(f32(g.cols - 1), f32(g.rows - 1)) * 0.5;
      let d = length(vec2f(f32(col), f32(row)) - half);
      return d / max(length(half), 1e-4);
    }
    case 4: {
      return hash01(u32(row * g.cols + col) * 2654435761u + 7u);
    }
    default: {
      return f32(row * g.cols + col) / denom;
    }
  }
}

/** Total length of the entrance (stagger + last dot's grow). */
fn entrance_total() -> f32 {
  return max(params.enter_spread, 0.0) + max(params.enter_duration, 0.001);
}

/** Local time on the animation timeline, wrapped when looping. */
fn timeline() -> f32 {
  var t = params.time + params.time_offset;
  if (params.entrance_enabled == 1u && params.loop_enabled == 1u) {
    let period = entrance_total() + max(params.loop_hold, 0.0);
    t = t - floor(t / period) * period;
  }
  return t;
}

fn entrance_progress(t: f32, rank: f32) -> f32 {
  if (params.entrance_enabled == 0u) {
    return 1.0;
  }
  let local = (t - rank * max(params.enter_spread, 0.0)) / max(params.enter_duration, 0.001);
  return ease_out_cubic(clamp(local, 0.0, 1.0));
}

fn cell_from_pick(g: Grid, k: u32) -> vec2f {
  let count = u32(g.cols * g.rows);
  let index = i32(pcg(k * 7919u + 13u) % count);
  return dot_center(g, index % g.cols, index / g.cols);
}

/**
 * Time-driven stand-in for the pointer: every `highlight_cycle` seconds a new
 * cell is picked. The new cell's influence grows with rate `grow_rate`, the
 * previous cell's influence decays with `shrink_rate`.
 */
fn build_highlight(g: Grid, t: f32) -> Highlight {
  var h: Highlight;
  h.focus_a = vec2f(-1e6);
  h.focus_b = vec2f(-1e6);
  h.env_a = 0.0;
  h.env_b = 0.0;
  if (params.highlight_enabled == 0u || g.cols * g.rows < 1) {
    return h;
  }

  // Highlights only run once the entrance has settled, like the original.
  var th = t;
  if (params.entrance_enabled == 1u) {
    th = t - entrance_total();
  }
  if (th < 0.0) {
    return h;
  }

  let cycle = max(params.highlight_cycle, 0.05);
  let k = floor(th / cycle);
  let age = th - k * cycle;
  let ku = u32(k) + 1u;

  h.focus_a = cell_from_pick(g, ku);
  h.env_a = 1.0 - exp(-max(params.grow_rate, 0.0) * age);
  if (ku > 1u) {
    h.focus_b = cell_from_pick(g, ku - 1u);
    h.env_b = exp(-max(params.shrink_rate, 0.0) * age);
  }
  return h;
}

fn influence(center: vec2f, focus: vec2f) -> f32 {
  let radius = max(params.influence_radius, 1e-3);
  let d2 = dot(center - focus, center - focus);
  if (d2 >= radius * radius) {
    return 0.0;
  }
  let t = sqrt(d2) / radius;
  // Under the focus → 1, at the edge → 0 (same quadratic falloff as the original).
  return 1.0 - t * t;
}

fn highlight_scale(h: Highlight, center: vec2f) -> f32 {
  let grow = max(params.grow_scale, 1.0) - 1.0;
  let a = influence(center, h.focus_a) * h.env_a;
  let b = influence(center, h.focus_b) * h.env_b;
  return 1.0 + grow * min(a + b, 1.0);
}

/** Average source colour under a dot (4 taps, quarter-pitch apart). */
fn sample_dot(center: vec2f, g: Grid) -> vec4f {
  let texel = 1.0 / params.resolution;
  let uv = center * texel;
  let o = g.pitch * 0.25 * texel;
  var c = textureSampleLevel(src, samp, uv + vec2f(-o.x, -o.y), 0.0);
  c += textureSampleLevel(src, samp, uv + vec2f(o.x, -o.y), 0.0);
  c += textureSampleLevel(src, samp, uv + vec2f(-o.x, o.y), 0.0);
  c += textureSampleLevel(src, samp, uv + vec2f(o.x, o.y), 0.0);
  return c * 0.25;
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
  // Source pixels per output pixel; keeps edges crisp at any zoom / export scale.
  let fw = fwidth(p);
  let aa = 0.5 * max(fw.x, fw.y) + max(params.softness, 0.0);

  let source = textureSampleLevel(src, samp, uv, 0.0);
  var out = vec4f(params.background, clamp(params.background_alpha, 0.0, 1.0));
  out = over(vec4f(source.rgb, source.a * clamp(params.source_backdrop, 0.0, 1.0)), out);

  let g = build_grid();
  if (g.cols < 1) {
    return out;
  }

  let t = timeline();
  let h = build_highlight(g, t);

  let dmin = max(params.dot_size_min, 0.0);
  let dmax = max(params.dot_size_max, dmin);
  let needs_source = params.size_source != 0 || params.color_mode != 0;

  // Largest radius any dot can reach, used to skip cells early.
  let max_radius = (dmin + (dmax - dmin) * max(params.grow_scale, 1.0)) * 0.5;

  let cell = vec2i(round((p - g.start) / g.pitch));
  var dots = vec4f(0.0);

  for (var dy = -REACH; dy <= REACH; dy++) {
    for (var dx = -REACH; dx <= REACH; dx++) {
      let col = cell.x + dx;
      let row = cell.y + dy;
      if (col < 0 || col >= g.cols || row < 0 || row >= g.rows) {
        continue;
      }
      let center = dot_center(g, col, row);
      let d = shape_distance(p - center);
      if (d > max_radius + aa) {
        continue;
      }

      let is_speck = params.speck_enabled == 1u && col == 0 && row == 0;
      let progress = entrance_progress(t, entrance_rank(g, col, row));
      let size = progress * highlight_scale(h, center);

      var settled = vec4f(params.active_color, 1.0);
      var size_factor = 1.0;
      if (needs_source) {
        let s = sample_dot(center, g);
        let lum = pow(clamp(luminance(s.rgb), 0.0, 1.0), max(params.size_gamma, 0.01));
        if (params.size_source == 1) {
          size_factor = mix(1.0, lum, clamp(params.size_influence, 0.0, 1.0));
        } else if (params.size_source == 2) {
          size_factor = mix(1.0, 1.0 - lum, clamp(params.size_influence, 0.0, 1.0));
        }
        if (params.color_mode == 1) {
          settled = vec4f(s.rgb, s.a);
        } else if (params.color_mode == 2) {
          settled = vec4f(s.rgb * params.active_color, s.a);
        }
      }
      if (is_speck) {
        settled = vec4f(params.speck_color, 1.0);
      }

      let final_size = max(dmax * size_factor, dmin);
      let radius = (dmin + (final_size - dmin) * size) * 0.5;
      let coverage = 1.0 - smoothstep(radius - aa, radius + aa, d);
      if (coverage <= 0.0) {
        continue;
      }

      let idle = vec4f(params.idle_color, clamp(params.idle_alpha, 0.0, 1.0));
      let color = mix(idle, settled, progress);
      dots = over(vec4f(color.rgb, color.a * coverage), dots);
    }
  }

  return over(dots, out);
}
