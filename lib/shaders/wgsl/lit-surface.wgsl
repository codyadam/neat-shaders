// Lit surface — a field of hashed, rounded, tall cells on a fixed spacing grid
// that light up around a focus point: brighter cells grow, pick a colour from a
// palette derived from the main colour, and split chromatically along the
// radial direction. Ripples emitted from the focus travel outward as a crest
// with an inverse glow and a suppression dip behind the ring. Everything is
// composited additively ("lighter") over the media / background.
//
// Non-interactive WGSL port of LitSurfaceCanvas + drawLitSurfaceWash: the
// pointer becomes an optional auto-sweep (or a static focus, or a flood that
// lights every cell), and click ripples become periodic emissions from the
// focus. All animation is a pure function of `time`.

struct Params {
  resolution: vec2f,
  focus_offset: vec2f,
  time: f32,

  // Light.
  light_mode: i32,     // 0 sweep, 1 static focus, 2 flood
  sweep_path: i32,     // 0 linear, 1 diagonal, 2 bounce, 3 orbit, 4 figure eight
  sweep_cycle: f32,
  sweep_ease: f32,
  path_extent: f32,
  time_offset: f32,
  falloff_radius: f32,
  opacity: f32,
  flood_level: f32,

  // Cells.
  dot_spacing: f32,
  dot_radius: f32,
  dot_aspect: f32,
  corner_radius: f32,
  size_jitter: f32,
  brightness_growth: f32,

  // Colour.
  main_color: vec3f,
  palette_variation: f32,
  chromatic_strength: f32,
  chromatic_offset: f32,
  composite: i32,      // 0 additive (lighter), 1 normal (source-over)
  background: vec3f,
  background_alpha: f32,
  source_backdrop: f32,

  // Ripples.
  ripples_enabled: u32,
  ripple_period: f32,
  ripple_duration: f32,
  ripple_opacity: f32,
  ripple_max_radius: f32,
  ripple_ring_width: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

const TAU: f32 = 6.28318530717958;
/** Cells searched around the fragment; grown / offset cells spill into neighbours. */
const MAX_REACH: i32 = 3;
/** Ripples that may be alive at once (duration can exceed the period). */
const MAX_RIPPLES: i32 = 4;
const GREY_AXIS: vec3f = vec3f(0.57735026919);

struct Ripple {
  brightness: f32,
  suppress: f32,
}

fn cell_hash(col: i32, row: i32, seed: f32) -> f32 {
  let n = sin(f32(col) * 127.1 + f32(row) * 311.7 + seed * 17.3) * 43758.5453;
  return fract(n);
}

fn ease_out_cubic(t: f32) -> f32 {
  let u = 1.0 - t;
  return 1.0 - u * u * u;
}

fn ease_phase(phase: f32) -> f32 {
  return mix(phase, smoothstep(0.0, 1.0, phase), clamp(params.sweep_ease, 0.0, 1.0));
}

/** Rotate a colour about the grey axis (hue shift) by `angle` radians. */
fn hue_rotate(c: vec3f, angle: f32) -> vec3f {
  let k = GREY_AXIS;
  let cos_a = cos(angle);
  let sin_a = sin(angle);
  return clamp(c * cos_a + cross(k, c) * sin_a + k * dot(k, c) * (1.0 - cos_a), vec3f(0.0), vec3f(1.0));
}

/** Four-entry palette around the main colour; `palette_variation` scales the spread. */
fn palette(index: i32) -> vec3f {
  let main = clamp(params.main_color, vec3f(0.0), vec3f(1.0));
  let v = clamp(params.palette_variation, 0.0, 1.0);
  switch (index) {
    case 1: {
      return mix(main, vec3f(1.0), 0.35 * v);
    }
    case 2: {
      return hue_rotate(main, 0.45 * v);
    }
    case 3: {
      return mix(hue_rotate(main, -0.45 * v), vec3f(1.0), 0.15 * v);
    }
    default: {
      return main;
    }
  }
}

/** Focus position (pixels) for an absolute time on the sweep timeline. */
fn sweep_focus(t: f32) -> vec2f {
  let cycle = max(params.sweep_cycle, 0.05);
  let phase = fract(t / cycle);
  // Start/finish off-canvas so linear paths never pop in or out.
  let r = params.falloff_radius / params.resolution;
  let extent = clamp(params.path_extent, 0.0, 2.0);
  var f = vec2f(0.5);

  switch (params.sweep_path) {
    case 0: {
      f = vec2f(mix(-r.x, 1.0 + r.x, ease_phase(phase)), 0.5);
    }
    case 1: {
      let e = ease_phase(phase);
      f = vec2f(mix(-r.x, 1.0 + r.x, e), mix(-r.y, 1.0 + r.y, e));
    }
    case 2: {
      let tri = 1.0 - abs(2.0 * phase - 1.0);
      f = vec2f(mix(0.5 - 0.5 * extent, 0.5 + 0.5 * extent, ease_phase(tri)), 0.5);
    }
    case 3: {
      let a = phase * TAU;
      f = vec2f(0.5) + 0.5 * extent * vec2f(cos(a), sin(a));
    }
    case 4: {
      let a = phase * TAU;
      f = vec2f(0.5) + 0.5 * extent * vec2f(sin(a), 0.5 * sin(2.0 * a));
    }
    default: {
      f = vec2f(0.5);
    }
  }

  return (f + params.focus_offset * 0.5) * params.resolution;
}

fn focus_at(t: f32) -> vec2f {
  if (params.light_mode == 0) {
    return sweep_focus(t);
  }
  return (vec2f(0.5) + params.focus_offset * 0.5) * params.resolution;
}

fn brightness_from_proximity(proximity: f32, base: f32) -> f32 {
  return base * (0.08 + 0.92 * proximity) * (0.3 + proximity * 0.7);
}

fn hover_brightness(c: vec2f, focus: vec2f, falloff: f32, base: f32) -> f32 {
  let dist = length(c - focus);
  if (dist > falloff) {
    return 0.0;
  }
  return brightness_from_proximity(1.0 - dist / falloff, base);
}

fn ripple_at(c: vec2f, origin: vec2f, age: f32, falloff: f32, base: f32) -> Ripple {
  var out: Ripple;
  out.brightness = 0.0;
  out.suppress = 0.0;
  if (age >= 1.0) {
    return out;
  }

  let progress = ease_out_cubic(age);
  let max_radius = falloff * max(params.ripple_max_radius, 0.0);
  let radius = progress * max_radius;
  let life_fade = 1.0 - age * age;

  let dist = length(c - origin);
  let ring_width = max(falloff * params.ripple_ring_width, 1e-3);
  let ring_mix = max(0.0, 1.0 - abs(dist - radius) / ring_width);

  let inside = dist < radius;
  let inverse_prox = select(0.0, dist / max(radius, 0.001), inside);

  let crest = base * life_fade * ring_mix * 0.9;
  let inverse_glow = select(0.0, base * life_fade * inverse_prox * 0.45, inside);
  out.brightness = crest + inverse_glow;
  out.suppress = select(0.0, (1.0 - inverse_prox) * life_fade * 0.55, inside);
  return out;
}

/** Signed distance to a rounded box centred at the origin. */
fn rounded_box(d: vec2f, half: vec2f, corner: f32) -> f32 {
  let r = min(corner, min(half.x, half.y));
  let q = abs(d) - (half - vec2f(r));
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

/** Premultiplied accumulate: additive "lighter" or normal "source-over". */
fn blend(acc: vec4f, color: vec3f, alpha: f32) -> vec4f {
  let a = clamp(alpha, 0.0, 1.0);
  if (params.composite == 1) {
    return vec4f(color * a + acc.rgb * (1.0 - a), a + acc.a * (1.0 - a));
  }
  return vec4f(acc.rgb + color * a, min(acc.a + a, 1.0));
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let p = uv * params.resolution;
  let fw = fwidth(p);
  let aa = 0.5 * max(fw.x, fw.y);
  let t = params.time + params.time_offset;

  let source = textureSampleLevel(src, samp, uv, 0.0);
  let bg_a = clamp(params.background_alpha, 0.0, 1.0);
  let src_a = source.a * clamp(params.source_backdrop, 0.0, 1.0);
  // Base layer, premultiplied: source backdrop over background.
  var base = vec4f(params.background * bg_a, bg_a);
  base = vec4f(source.rgb * src_a + base.rgb * (1.0 - src_a), src_a + base.a * (1.0 - src_a));

  let spacing = max(params.dot_spacing, 1.0);
  let falloff = max(params.falloff_radius, 1.0);
  let hover_opacity = max(params.opacity, 0.0);
  let ripple_opacity = max(params.ripple_opacity, 0.0);
  let flood = params.light_mode == 2;
  let focus = focus_at(t);
  let flood_center = (vec2f(0.5) + params.focus_offset * 0.5) * params.resolution;

  // Conservative reach so grown / chromatically offset cells are still found.
  let max_brightness = hover_opacity + select(0.0, ripple_opacity * 1.35, params.ripples_enabled == 1u);
  let max_width = params.dot_radius * 2.0 * 1.2 * (0.85 + max_brightness * max(params.brightness_growth, 0.0));
  let max_extent = max_width * max(params.dot_aspect, 1.0) * 0.5 + max(params.chromatic_offset, 0.0);
  let reach = min(MAX_REACH, i32(ceil(max_extent / spacing)) + 1);

  let offset = vec2f(spacing * 0.5);
  let max_col = i32(ceil(params.resolution.x / spacing)) + 1;
  let max_row = i32(ceil(params.resolution.y / spacing)) + 1;
  let cell = vec2i(floor((p - offset) / spacing + vec2f(0.5)));

  let ripple_period = max(params.ripple_period, 0.05);
  let ripple_duration = max(params.ripple_duration, 0.05);
  let latest = floor(t / ripple_period);

  var dots = vec4f(0.0);

  for (var dy = -MAX_REACH; dy <= MAX_REACH; dy++) {
    if (abs(dy) > reach) {
      continue;
    }
    for (var dx = -MAX_REACH; dx <= MAX_REACH; dx++) {
      if (abs(dx) > reach) {
        continue;
      }
      let col = cell.x + dx;
      let row = cell.y + dy;
      if (col < 0 || col > max_col || row < 0 || row > max_row) {
        continue;
      }
      let c = vec2f(f32(col), f32(row)) * spacing + offset;

      // Brightness: hover / flood, plus ripples with suppression.
      var brightness = 0.0;
      if (flood) {
        brightness = brightness_from_proximity(clamp(params.flood_level, 0.0, 1.0), hover_opacity);
      } else {
        brightness = hover_brightness(c, focus, falloff, hover_opacity);
      }

      var suppress = 0.0;
      if (params.ripples_enabled == 1u) {
        for (var i = 0; i < MAX_RIPPLES; i++) {
          let k = latest - f32(i);
          if (k < 0.0) {
            break;
          }
          let born = k * ripple_period;
          let age = (t - born) / ripple_duration;
          if (age >= 1.0) {
            break;
          }
          let r = ripple_at(c, focus_at(born), age, falloff, ripple_opacity);
          brightness += r.brightness;
          suppress = max(suppress, r.suppress);
        }
      }
      if (suppress > 0.0 && brightness > 0.0) {
        brightness *= 1.0 - suppress;
      }
      if (brightness < 0.006) {
        continue;
      }

      // Radial direction for the chromatic split.
      let anchor = select(focus, flood_center, flood);
      let dv = c - anchor;
      let dist = length(dv);
      let n = select(vec2f(0.0), dv / max(dist, 0.001), dist > 0.001);
      let proximity = select(max(0.0, 1.0 - dist / falloff), clamp(params.flood_level, 0.0, 1.0), flood);
      let edge_mix = min(1.0, dist / max(falloff * 0.55, 1.0));
      let chromatic = params.chromatic_strength * (0.25 + proximity * 0.75) * (0.35 + edge_mix * 0.65);
      let split = params.chromatic_offset * chromatic;

      let size_scale = mix(1.0, 0.72 + cell_hash(col, row, 1.0) * 0.48, clamp(params.size_jitter, 0.0, 1.0));
      let width = params.dot_radius * 2.0 * size_scale * (0.85 + brightness * params.brightness_growth);
      let half = vec2f(width, width * max(params.dot_aspect, 0.01)) * 0.5;
      let corner = min(half.x, half.y) * 2.0 * clamp(params.corner_radius, 0.0, 0.5);
      let color = palette(i32(floor(cell_hash(col, row, 0.0) * 4.0)));

      if (chromatic > 0.08 && split > 0.2) {
        let warm = vec3f(1.0, max(0.196, color.r - 0.314), max(0.235, color.b - 0.235));
        let cool = vec3f(max(0.196, color.r - 0.392), min(1.0, color.g + 0.078), 1.0);
        let cov_a = 1.0 - smoothstep(-aa, aa, rounded_box(p - (c - n * split), half, corner));
        dots = blend(dots, warm, brightness * 0.85 * cov_a);
        let cov_b = 1.0 - smoothstep(-aa, aa, rounded_box(p - c, half, corner));
        dots = blend(dots, color, brightness * cov_b);
        let cov_c = 1.0 - smoothstep(-aa, aa, rounded_box(p - (c + n * split), half, corner));
        dots = blend(dots, cool, brightness * 0.85 * cov_c);
      } else {
        let cov = 1.0 - smoothstep(-aa, aa, rounded_box(p - c, half, corner));
        dots = blend(dots, color, brightness * cov);
      }
    }
  }

  // Dots over the base layer (premultiplied), then back to straight alpha.
  var out = vec4f(0.0);
  if (params.composite == 1) {
    out = vec4f(dots.rgb + base.rgb * (1.0 - dots.a), dots.a + base.a * (1.0 - dots.a));
  } else {
    out = vec4f(base.rgb + dots.rgb, min(base.a + dots.a, 1.0));
  }
  if (out.a <= 0.0) {
    return vec4f(0.0);
  }
  return vec4f(min(out.rgb / out.a, vec3f(1.0)), out.a);
}
