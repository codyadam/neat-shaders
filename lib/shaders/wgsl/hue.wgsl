struct Params {
  resolution: vec2f,
  time: f32,
  degrees: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c = textureSampleLevel(src, samp, uv, 0.0);
  let angle = params.degrees * 0.017453292519943295;
  let cos_a = cos(angle);
  let sin_a = sin(angle);
  let k = vec3f(0.57735, 0.57735, 0.57735);
  // Rodrigues rotation around the grey axis.
  let rgb = c.rgb * cos_a + cross(k, c.rgb) * sin_a + k * dot(k, c.rgb) * (1.0 - cos_a);
  return vec4f(rgb, c.a);
}
