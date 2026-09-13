// Map any input onto a colour palette. Default ramp is sampled from the
// WeatherNext 3 sky key art (deep cobalt → aqua → sunlit yellow-green).
// Gradient mode walks the ramp by source brightness; Nearest snaps each pixel
// to the closest stop. Palettes live here so they stay in lockstep with
// `lib/shaders/color-map.ts`.

struct Params {
  resolution: vec2f,
  time: f32,
  preset: i32,
  mode: i32,
  source: i32,
  strength: f32,
  gamma: f32,
  smoothness: f32,
  dither: f32,
  hue: f32,
  invert: u32,
  stop_0: vec3f,
  stop_1: vec3f,
  stop_2: vec3f,
  stop_3: vec3f,
  stop_4: vec3f,
  stop_5: vec3f,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

const GREY_AXIS = vec3f(0.57735, 0.57735, 0.57735);
const LAST_SPAN = 5.0;

fn luma(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
}

fn sample_key(rgb: vec3f) -> f32 {
  switch (params.source) {
    case 1: {
      return (rgb.r + rgb.g + rgb.b) / 3.0;
    }
    case 2: {
      return max(rgb.r, max(rgb.g, rgb.b));
    }
    default: {
      return luma(rgb);
    }
  }
}

fn hue_rotate(c: vec3f, angle: f32) -> vec3f {
  let cos_a = cos(angle);
  let sin_a = sin(angle);
  return clamp(c * cos_a + cross(GREY_AXIS, c) * sin_a + GREY_AXIS * dot(GREY_AXIS, c) * (1.0 - cos_a), vec3f(0.0), vec3f(1.0));
}

fn bayer4(px: vec2u) -> f32 {
  let x = px.x % 4u;
  let y = px.y % 4u;
  let idx = y * 4u + x;
  var v = 0u;
  switch (idx) {
    case 0u: { v = 0u; }
    case 1u: { v = 8u; }
    case 2u: { v = 2u; }
    case 3u: { v = 10u; }
    case 4u: { v = 12u; }
    case 5u: { v = 4u; }
    case 6u: { v = 14u; }
    case 7u: { v = 6u; }
    case 8u: { v = 3u; }
    case 9u: { v = 11u; }
    case 10u: { v = 1u; }
    case 11u: { v = 9u; }
    case 12u: { v = 15u; }
    case 13u: { v = 7u; }
    case 14u: { v = 13u; }
    default: { v = 5u; }
  }
  return (f32(v) + 0.5) / 16.0;
}

fn load_stops() -> array<vec3f, 6> {
  var s: array<vec3f, 6>;
  switch (params.preset) {
    case 1: { // Thermal
      s[0] = vec3f(0.0, 0.0, 0.016);
      s[1] = vec3f(0.231, 0.059, 0.439);
      s[2] = vec3f(0.549, 0.161, 0.506);
      s[3] = vec3f(0.871, 0.286, 0.408);
      s[4] = vec3f(0.996, 0.624, 0.427);
      s[5] = vec3f(0.988, 0.992, 0.749);
    }
    case 2: { // Sunset
      s[0] = vec3f(0.051, 0.106, 0.165);
      s[1] = vec3f(0.106, 0.227, 0.294);
      s[2] = vec3f(0.769, 0.271, 0.212);
      s[3] = vec3f(0.89, 0.392, 0.078);
      s[4] = vec3f(0.957, 0.635, 0.38);
      s[5] = vec3f(1.0, 0.91, 0.639);
    }
    case 3: { // Ember
      s[0] = vec3f(0.102, 0.02, 0.0);
      s[1] = vec3f(0.29, 0.082, 0.0);
      s[2] = vec3f(0.608, 0.173, 0.0);
      s[3] = vec3f(0.91, 0.365, 0.016);
      s[4] = vec3f(0.957, 0.549, 0.024);
      s[5] = vec3f(1.0, 0.953, 0.69);
    }
    case 4: { // Twilight
      s[0] = vec3f(0.043, 0.063, 0.149);
      s[1] = vec3f(0.18, 0.102, 0.278);
      s[2] = vec3f(0.545, 0.227, 0.384);
      s[3] = vec3f(0.878, 0.478, 0.373);
      s[4] = vec3f(0.949, 0.8, 0.561);
      s[5] = vec3f(1.0, 0.965, 0.878);
    }
    case 5: { // Mono
      s[0] = vec3f(0.0);
      s[1] = vec3f(0.2);
      s[2] = vec3f(0.4);
      s[3] = vec3f(0.6);
      s[4] = vec3f(0.8);
      s[5] = vec3f(1.0);
    }
    case 6: { // Custom
      s[0] = params.stop_0;
      s[1] = params.stop_1;
      s[2] = params.stop_2;
      s[3] = params.stop_3;
      s[4] = params.stop_4;
      s[5] = params.stop_5;
    }
    default: { // WeatherNext
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

fn gradient_color(s: array<vec3f, 6>, t: f32) -> vec3f {
  let x = clamp(t, 0.0, 1.0) * LAST_SPAN;
  let i = i32(min(floor(x), LAST_SPAN - 0.001));
  let f = clamp(x - f32(i), 0.0, 1.0);
  let sm = clamp(params.smoothness, 0.0, 1.0);
  let hard = select(0.0, 1.0, f >= 0.5);
  let w = mix(hard, f, sm);
  return mix(stop_at(s, i), stop_at(s, i + 1), w);
}

fn nearest_color(s: array<vec3f, 6>, rgb: vec3f) -> vec3f {
  var best = s[0];
  var best_d = distance(rgb, best);
  for (var i = 1; i < 6; i++) {
    let cand = stop_at(s, i);
    let d = distance(rgb, cand);
    if (d < best_d) {
      best = cand;
      best_d = d;
    }
  }
  return best;
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c = textureSampleLevel(src, samp, uv, 0.0);
  let stops = load_stops();

  var mapped: vec3f;
  if (params.mode == 1) {
    mapped = nearest_color(stops, c.rgb);
  } else {
    var t = clamp(sample_key(c.rgb), 0.0, 1.0);
    if (params.invert == 1u) {
      t = 1.0 - t;
    }
    t = pow(t, max(params.gamma, 0.01));
    let dither = clamp(params.dither, 0.0, 1.0);
    if (dither > 0.0) {
      let px = vec2u(uv * params.resolution);
      t = clamp(t + (bayer4(px) - 0.5) * dither, 0.0, 1.0);
    }
    mapped = gradient_color(stops, t);
  }

  let angle = params.hue * 0.017453292519943295;
  if (abs(angle) > 1e-5) {
    mapped = hue_rotate(mapped, angle);
  }

  let rgb = mix(c.rgb, mapped, clamp(params.strength, 0.0, 1.0));
  return vec4f(rgb, c.a);
}
