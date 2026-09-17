struct Params {
  resolution: vec2f,
  time: f32,
  intensity: f32,
  roundness: f32,
  smoothness: f32,
  scale: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c = textureSampleLevel(src, samp, uv, 0.0);
  let p = uv * 2.0 - 1.0;
  let aspect = params.resolution.x / max(params.resolution.y, 1.0);
  let q = vec2f(p.x * aspect, p.y);
  let d = mix(max(abs(q.x), abs(q.y)), length(q), clamp(params.roundness, 0.0, 1.0));
  let scaled = d / max(params.scale, 0.01);
  let edge = smoothstep(params.smoothness, 1.0, scaled);
  let v = 1.0 - edge * params.intensity;
  return vec4f(c.rgb * v, c.a);
}
