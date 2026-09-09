// Bloom: add the blurred highlights in `src` back onto `orig`.

struct Params {
  resolution: vec2f,
  time: f32,
  threshold: f32,
  radius: f32,
  sigma: f32,
  strength: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var orig: texture_2d<f32>;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let base = textureSampleLevel(orig, samp, uv, 0.0);
  let bloom = textureSampleLevel(src, samp, uv, 0.0);
  return vec4f(base.rgb + bloom.rgb * params.strength, base.a);
}
