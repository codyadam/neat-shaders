// Anisotropic Kuwahara: elliptical 8-sector filter aligned to the structure tensor in `src`.
// `orig` is the colour image (layer input).

struct Params {
  resolution: vec2f,
  time: f32,
  radius: i32,
  eccentricity: f32,
  sharpness: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var orig: texture_2d<f32>;

const MAX_R: i32 = 5;
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

fn tensor_at(uv: vec2f) -> vec3f {
  let texel = 1.0 / params.resolution;
  var acc = vec3f(0.0);
  var wsum = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let w = 1.0;
      acc += textureSampleLevel(src, samp, uv + vec2f(f32(x), f32(y)) * texel, 0.0).rgb * w;
      wsum += w;
    }
  }
  return acc / wsum;
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let texel = 1.0 / params.resolution;
  let t = tensor_at(uv);
  let Jxx = t.x;
  let Jyy = t.y;
  let Jxy = t.z;
  let trace = Jxx + Jyy;
  let det = Jxx * Jyy - Jxy * Jxy;
  let disc = max(trace * trace * 0.25 - det, 0.0);
  let sqrt_d = sqrt(disc);
  let l1 = trace * 0.5 + sqrt_d;
  let l2 = trace * 0.5 - sqrt_d;

  var ev = vec2f(Jxy, l1 - Jxx);
  if (dot(ev, ev) < 1e-10) {
    ev = vec2f(l1 - Jyy, Jxy);
  }
  var tangent = vec2f(-ev.y, ev.x);
  if (dot(tangent, tangent) < 1e-10) {
    tangent = vec2f(1.0, 0.0);
  } else {
    tangent = normalize(tangent);
  }
  let normal = vec2f(-tangent.y, tangent.x);

  let aniso = (l1 - l2) / (l1 + l2 + 1e-5);
  let ecc = 1.0 + max(params.eccentricity, 0.0) * clamp(aniso, 0.0, 1.0);

  let radius = clamp(params.radius, 1, MAX_R);
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
      let off = vec2f(f32(dx), f32(dy));
      let local = vec2f(dot(off, tangent), dot(off, normal) * ecc);
      if (dot(local, local) > rf * rf) { continue; }

      var sector: i32 = 0;
      if (!(dx == 0 && dy == 0)) {
        let ang = atan2(local.y, local.x) + PI;
        sector = clamp(i32(floor(ang * (4.0 / PI))), 0, 7);
      }
      let angle = f32(sector) * (PI * 0.25) + PI * 0.125;
      let ca = cos(-angle);
      let sa = sin(-angle);
      let sl = vec2f(local.x * ca - local.y * sa, local.x * sa + local.y * ca) / rf;
      let w = poly_weight(sl);

      let c = textureSampleLevel(orig, samp, uv + off * texel, 0.0);
      let lum = luminance(c.rgb);
      sum_rgb[sector] += c.rgb * w;
      sum_lum[sector] += lum * w;
      sum_lum_sq[sector] += lum * lum * w;
      count[sector] += w;
    }
  }

  let center = textureSampleLevel(orig, samp, uv, 0.0);
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
