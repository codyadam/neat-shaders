struct Params {
  resolution: vec2f,
  time: f32,
  amount: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c = textureSampleLevel(src, samp, uv, 0.0);
  let lum = dot(c.rgb, vec3f(0.2126, 0.7152, 0.0722));
  let rgb = mix(vec3f(lum), c.rgb, params.amount);
  return vec4f(rgb, c.a);
}
