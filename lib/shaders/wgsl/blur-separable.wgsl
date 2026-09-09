// Separable blur. `axis` is (1,0) or (0,1); `mode` 0 = Gaussian, 1 = box.

struct Params {
  resolution: vec2f,
  axis: vec2f,
  time: f32,
  radius: f32,
  sigma: f32,
  mode: i32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

const MAX_R: i32 = 24;

fn gauss(x: f32, sigma: f32) -> f32 {
  return exp(-(x * x) / (2.0 * sigma * sigma + 1e-5));
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let texel = 1.0 / params.resolution;
  let dir = params.axis;
  let r = clamp(i32(round(params.radius)), 1, MAX_R);
  let sigma = max(params.sigma, 0.1);
  var acc = vec4f(0.0);
  var wsum = 0.0;
  for (var i = -MAX_R; i <= MAX_R; i++) {
    if (abs(i) > r) { continue; }
    var w = 1.0;
    if (params.mode == 0) {
      w = gauss(f32(i), sigma);
    }
    acc += textureSampleLevel(src, samp, uv + dir * f32(i) * texel, 0.0) * w;
    wsum += w;
  }
  return acc / max(wsum, 1e-5);
}
