// Dual Kawase-style wide blur at the source resolution (same-size downsample kernel).

struct Params {
  resolution: vec2f,
  time: f32,
  offset: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let texel = (1.0 / params.resolution) * max(params.offset, 0.5);
  var c = textureSampleLevel(src, samp, uv, 0.0) * 4.0;
  c += textureSampleLevel(src, samp, uv + vec2f( 1.0,  1.0) * texel, 0.0);
  c += textureSampleLevel(src, samp, uv + vec2f( 1.0, -1.0) * texel, 0.0);
  c += textureSampleLevel(src, samp, uv + vec2f(-1.0,  1.0) * texel, 0.0);
  c += textureSampleLevel(src, samp, uv + vec2f(-1.0, -1.0) * texel, 0.0);
  c += textureSampleLevel(src, samp, uv + vec2f( 2.0,  0.0) * texel, 0.0) * 2.0;
  c += textureSampleLevel(src, samp, uv + vec2f(-2.0,  0.0) * texel, 0.0) * 2.0;
  c += textureSampleLevel(src, samp, uv + vec2f( 0.0,  2.0) * texel, 0.0) * 2.0;
  c += textureSampleLevel(src, samp, uv + vec2f( 0.0, -2.0) * texel, 0.0) * 2.0;
  return c / 16.0;
}
