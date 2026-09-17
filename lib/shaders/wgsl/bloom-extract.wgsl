// Bloom: keep pixels brighter than the threshold.

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

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c = textureSampleLevel(src, samp, uv, 0.0);
  let lum = dot(c.rgb, vec3f(0.2126, 0.7152, 0.0722));
  let knee = max(params.threshold * 0.25, 1e-4);
  let soft = clamp(lum - params.threshold + knee, 0.0, 2.0 * knee);
  let contrib = max(lum - params.threshold, soft * soft / (4.0 * knee));
  let w = contrib / max(lum, 1e-4);
  return vec4f(c.rgb * w, 1.0);
}
