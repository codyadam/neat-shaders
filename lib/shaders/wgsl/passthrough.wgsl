// Identity shader: shows the source untouched. Useful as an A/B reference.

struct Params {
  resolution: vec2f,
  time: f32,
  opacity: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c = textureSampleLevel(src, samp, uv, 0.0);
  return vec4f(c.rgb, c.a * params.opacity);
}
