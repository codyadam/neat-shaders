// Lit surface — a soft light that sweeps over the media along a looping path,
// revealing / tinting / washing whatever it passes over. Non-interactive WGSL
// port of the LitSurfaceCanvas component: the pointer focus is replaced by the
// auto-sweep, and click ripples by rings emitted periodically from the moving
// focus. Optional grid mode quantises the light into tiles, optional edge
// highlight makes source edges catch the light.
//
// Distances are expressed as fractions of the shorter side so the look is the
// same at any resolution; circles stay round because the maths runs in pixels.

struct Params {
  resolution: vec2f,
  focus_offset: vec2f,
  time: f32,

  // Sweep.
  sweep_path: i32,     // 0 linear, 1 diagonal, 2 bounce, 3 orbit, 4 figure eight, 5 static
  sweep_cycle: f32,
  sweep_ease: f32,
  path_extent: f32,
  time_offset: f32,

  // Light.
  falloff_radius: f32,
  falloff_power: f32,
  intensity: f32,
  ambient: f32,
  blend_mode: i32,     // 0 reveal, 1 glow, 2 wash
  light_color: vec3f,
  tint_strength: f32,
  edge_highlight: f32,

  // Tiles.
  grid_enabled: u32,
  grid_size: f32,
  grid_gap: f32,
  grid_gap_darkness: f32,
  grid_shimmer: f32,

  // Ripples.
  ripples_enabled: u32,
  ripple_period: f32,
  ripple_duration: f32,
  ripple_speed: f32,
  ripple_width: f32,
  ripple_strength: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

const TAU: f32 = 6.28318530717958;
/** Ripples that may be alive at once (duration can exceed the period). */
const MAX_RIPPLES: i32 = 4;

fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn hash01(v: u32) -> f32 {
  return f32(pcg(v)) / 4294967295.0;
}

fn hash_cell(cell: vec2i, seed: u32) -> f32 {
  let x = u32(cell.x + 4096) * 73856093u;
  let y = u32(cell.y + 4096) * 19349663u;
  return hash01(x ^ y ^ (seed * 83492791u));
}

fn luminance(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.299, 0.587, 0.114));
}

fn short_side() -> f32 {
  return max(min(params.resolution.x, params.resolution.y), 1.0);
}

fn ease_phase(phase: f32) -> f32 {
  return mix(phase, smoothstep(0.0, 1.0, phase), clamp(params.sweep_ease, 0.0, 1.0));
}

/** Focus position (in pixels) for an absolute time on the sweep timeline. */
fn sweep_focus(t: f32) -> vec2f {
  let cycle = max(params.sweep_cycle, 0.05);
  let phase = fract(t / cycle);
  // Start/finish off-canvas so linear paths never pop in or out.
  let r = params.falloff_radius * short_side() / params.resolution;
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

/** Radial falloff in [0, 1] for a point `p` lit from `focus`. */
fn falloff(p: vec2f, focus: vec2f) -> f32 {
  let radius = max(params.falloff_radius, 1e-3) * short_side();
  let d = length(p - focus) / radius;
  let base = smoothstep(1.0, 0.0, d);
  return pow(base, max(params.falloff_power, 0.05));
}

/**
 * Rings emitted from the focus every `ripple_period` seconds, expanding at
 * `ripple_speed` and fading out over `ripple_duration`.
 */
fn ripples(p: vec2f, t: f32) -> f32 {
  if (params.ripples_enabled == 0u) {
    return 0.0;
  }
  let period = max(params.ripple_period, 0.05);
  let duration = max(params.ripple_duration, 0.05);
  let side = short_side();
  let width = max(params.ripple_width, 1e-3) * side;
  let speed = max(params.ripple_speed, 0.0) * side;

  var sum = 0.0;
  let latest = floor(t / period);
  for (var i = 0; i < MAX_RIPPLES; i++) {
    let k = latest - f32(i);
    if (k < 0.0) {
      break;
    }
    let born = k * period;
    let age = t - born;
    if (age >= duration) {
      break;
    }
    let origin = sweep_focus(born);
    let ring = speed * age;
    let d = abs(length(p - origin) - ring);
    let band = 1.0 - smoothstep(0.0, width, d);
    let fade = 1.0 - age / duration;
    sum += band * fade * fade;
  }
  return sum * max(params.ripple_strength, 0.0);
}

/** Sobel edge magnitude of the source luminance. */
fn edges(uv: vec2f) -> f32 {
  let texel = 1.0 / params.resolution;
  let tl = luminance(textureSampleLevel(src, samp, uv + texel * vec2f(-1.0, -1.0), 0.0).rgb);
  let tc = luminance(textureSampleLevel(src, samp, uv + texel * vec2f(0.0, -1.0), 0.0).rgb);
  let tr = luminance(textureSampleLevel(src, samp, uv + texel * vec2f(1.0, -1.0), 0.0).rgb);
  let ml = luminance(textureSampleLevel(src, samp, uv + texel * vec2f(-1.0, 0.0), 0.0).rgb);
  let mr = luminance(textureSampleLevel(src, samp, uv + texel * vec2f(1.0, 0.0), 0.0).rgb);
  let bl = luminance(textureSampleLevel(src, samp, uv + texel * vec2f(-1.0, 1.0), 0.0).rgb);
  let bc = luminance(textureSampleLevel(src, samp, uv + texel * vec2f(0.0, 1.0), 0.0).rgb);
  let br = luminance(textureSampleLevel(src, samp, uv + texel * vec2f(1.0, 1.0), 0.0).rgb);
  let gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  let gy = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);
  return clamp(length(vec2f(gx, gy)), 0.0, 1.0);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let p = uv * params.resolution;
  let t = params.time + params.time_offset;
  let source = textureSampleLevel(src, samp, uv, 0.0);
  let focus = sweep_focus(t);

  // Where the light is evaluated: the fragment, or its tile's centre.
  var sample_at = p;
  var tile_factor = 1.0;
  if (params.grid_enabled == 1u) {
    let size = max(params.grid_size, 1.0);
    let cell = vec2i(floor(p / size));
    sample_at = (vec2f(cell) + 0.5) * size;

    let local = p - vec2f(cell) * size;
    let gap = clamp(params.grid_gap, 0.0, size * 0.5);
    if (gap > 0.0 && (local.x < gap || local.y < gap)) {
      tile_factor *= 1.0 - clamp(params.grid_gap_darkness, 0.0, 1.0);
    }

    // Per-tile flicker, interpolated between two hashed keyframes at 3 Hz.
    let shimmer = clamp(params.grid_shimmer, 0.0, 1.0);
    if (shimmer > 0.0) {
      let key = t * 3.0;
      let k0 = u32(floor(key));
      let n = mix(hash_cell(cell, k0), hash_cell(cell, k0 + 1u), smoothstep(0.0, 1.0, fract(key)));
      tile_factor *= mix(1.0, 0.5 + n, shimmer);
    }
  }

  var light = falloff(sample_at, focus) * max(params.intensity, 0.0) * tile_factor;
  light += ripples(sample_at, t);

  let ambient = clamp(params.ambient, 0.0, 1.0);
  let lit = clamp(light, 0.0, 1.0);
  let tint = mix(vec3f(1.0), params.light_color, clamp(params.tint_strength, 0.0, 1.0));
  // Overdrive above 1 keeps adding light instead of clipping at the falloff edge.
  let gain = ambient + (1.0 - ambient) * lit + max(light - 1.0, 0.0);

  var rgb = source.rgb;
  switch (params.blend_mode) {
    case 1: {
      rgb = source.rgb * mix(ambient, 1.0, lit) + params.light_color * light * clamp(params.tint_strength, 0.0, 1.0);
    }
    case 2: {
      rgb = mix(source.rgb * mix(ambient, 1.0, lit), params.light_color, lit * clamp(params.tint_strength, 0.0, 1.0));
    }
    default: {
      rgb = source.rgb * gain * mix(vec3f(1.0), tint, lit);
    }
  }

  if (params.edge_highlight > 0.0) {
    let e = edges(uv);
    rgb += params.light_color * e * params.edge_highlight * light;
  }

  return vec4f(rgb, source.a);
}
