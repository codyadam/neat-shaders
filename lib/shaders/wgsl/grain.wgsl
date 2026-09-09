struct Params {
  resolution: vec2f,
  time: f32,
  amount: f32,
  size: f32,
  animated: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

fn hash21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.103, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c = textureSampleLevel(src, samp, uv, 0.0);
  let cell = max(params.size, 0.5);
  var gid = floor(uv * params.resolution / cell);
  if (params.animated == 1u) {
    gid += vec2f(params.time * 37.0, params.time * 19.0);
  }
  let n = hash21(gid) * 2.0 - 1.0;
  return vec4f(clamp(c.rgb + n * params.amount, vec3f(0.0), vec3f(1.0)), c.a);
}
