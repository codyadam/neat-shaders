// Papari-style generalised Kuwahara: 8 circular sectors, polynomial weights,
// inverse-variance blend of sector means (Artistic Edge and Corner Enhancing Smoothing).

struct Params {
  resolution: vec2f,
  time: f32,
  radius: i32,
  sharpness: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

const MAX_R: i32 = 8;
const PI: f32 = 3.14159265358979;
const ETA: f32 = 0.1;
const LAMBDA: f32 = 0.5;

fn luminance(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.299, 0.587, 0.114));
}

fn poly_weight(local: vec2f) -> f32 {
  let v = (local.x + ETA) - LAMBDA * local.y * local.y;
  return max(v * v, 0.0);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let texel = 1.0 / params.resolution;
  let radius = clamp(params.radius, 1, MAX_R);
  let r2 = radius * radius;
  let rf = f32(radius);

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

  for (var dy = -MAX_R; dy <= MAX_R; dy++) {
    for (var dx = -MAX_R; dx <= MAX_R; dx++) {
      let d2 = dx * dx + dy * dy;
      if (d2 > r2) { continue; }

      let off = vec2f(f32(dx), f32(dy));
      var sector: i32 = 0;
      if (!(dx == 0 && dy == 0)) {
        let t = atan2(off.y, off.x) + PI;
        sector = clamp(i32(floor(t * (4.0 / PI))), 0, 7);
      }
      let angle = f32(sector) * (PI * 0.25) + PI * 0.125;
      let ca = cos(-angle);
      let sa = sin(-angle);
      let local = vec2f(off.x * ca - off.y * sa, off.x * sa + off.y * ca) / rf;
      let w = poly_weight(local);

      let c = textureSampleLevel(src, samp, uv + off * texel, 0.0);
      let lum = luminance(c.rgb);
      sum_rgb[sector] += c.rgb * w;
      sum_lum[sector] += lum * w;
      sum_lum_sq[sector] += lum * lum * w;
      count[sector] += w;
    }
  }

  let center = textureSampleLevel(src, samp, uv, 0.0);
  let q = max(params.sharpness, 0.1);
  var acc = vec3f(0.0);
  var wsum = 0.0;
  for (var s = 0; s < 8; s++) {
    if (count[s] < 1e-5) { continue; }
    let mean = sum_rgb[s] / count[s];
    let m = sum_lum[s] / count[s];
    let v = max(sum_lum_sq[s] / count[s] - m * m, 0.0);
    let weight = 1.0 / pow(1.0 + v * 256.0, q);
    acc += mean * weight;
    wsum += weight;
  }

  if (wsum < 1e-6) {
    return center;
  }
  return vec4f(acc / wsum, center.a);
}
