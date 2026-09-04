// Sector Kuwahara filter — WGSL port of the Godot canvas_item shader.
//
// The Godot original samples SCREEN_TEXTURE and scales the kernel by the
// world-space size of a screen pixel so the effect is zoom independent. Here the
// input is the layer's own texture rendered at its native resolution, so
// `world_per_px` is 1 by construction and the kernel step is simply
// `texel * kernel_spread * canvas_scale`.

struct Params {
  resolution: vec2f,
  canvas_scale: vec2f,
  time: f32,
  kernel_spread: f32,
  radius: i32,
  edge_clamp: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

const MAX_R: i32 = 5;
const PI: f32 = 3.14159265358979;

fn luminance(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.299, 0.587, 0.114));
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let texel = 1.0 / params.resolution;
  let duv = texel * params.kernel_spread * params.canvas_scale;

  var count: array<f32, 8>;
  var sum_rgb: array<vec3f, 8>;
  var sum_lum: array<f32, 8>;
  var sum_lum_sq: array<f32, 8>;
  for (var i = 0; i < 8; i++) {
    count[i] = 0.0;
    sum_rgb[i] = vec3f(0.0);
    sum_lum[i] = 0.0;
    sum_lum_sq[i] = 0.0;
  }

  let radius = clamp(params.radius, 1, MAX_R);
  let r2 = radius * radius;
  let lo = vec2f(params.edge_clamp);
  let hi = vec2f(1.0 - params.edge_clamp);

  for (var dy = -MAX_R; dy <= MAX_R; dy++) {
    for (var dx = -MAX_R; dx <= MAX_R; dx++) {
      let d2 = dx * dx + dy * dy;
      if (d2 > r2) {
        continue;
      }

      var sector: i32 = 0;
      if (!(dx == 0 && dy == 0)) {
        let t = atan2(f32(dy), f32(dx)) + PI;
        sector = clamp(i32(floor(t * (4.0 / PI))), 0, 7);
      }

      var suv = uv + vec2f(f32(dx), f32(dy)) * duv;
      suv = clamp(suv, lo, hi);
      let c = textureSampleLevel(src, samp, suv, 0.0);
      let lum = luminance(c.rgb);

      sum_rgb[sector] += c.rgb;
      sum_lum[sector] += lum;
      sum_lum_sq[sector] += lum * lum;
      count[sector] += 1.0;
    }
  }

  let center = textureSampleLevel(src, samp, uv, 0.0);
  var best_var = 1e20;
  var best_rgb = center.rgb;
  for (var s = 0; s < 8; s++) {
    if (count[s] < 1.0) {
      continue;
    }
    let m = sum_lum[s] / count[s];
    let v = sum_lum_sq[s] / count[s] - m * m;
    if (v < best_var) {
      best_var = v;
      best_rgb = sum_rgb[s] / count[s];
    }
  }

  return vec4f(best_rgb, center.a);
}
