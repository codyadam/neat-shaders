// Directional / motion blur along an angle.

struct Params {
  resolution: vec2f,
  time: f32,
  distance: f32,
  angle: f32,
  samples: i32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

const MAX_SAMPLES: i32 = 32;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let n = clamp(params.samples, 3, MAX_SAMPLES);
  let dir = vec2f(cos(params.angle), sin(params.angle));
  let step_uv = dir * (params.distance / params.resolution.x) / f32(n - 1);
  let origin = uv - step_uv * f32(n - 1) * 0.5;
  var acc = vec4f(0.0);
  for (var i = 0; i < MAX_SAMPLES; i++) {
    if (i >= n) { continue; }
    acc += textureSampleLevel(src, samp, origin + step_uv * f32(i), 0.0);
  }
  return acc / f32(n);
}
