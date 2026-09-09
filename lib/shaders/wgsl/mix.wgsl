// Composite an effect over its input using opacity and an optional luma mask.

struct Params {
  resolution: vec2f,
  time: f32,
  opacity: f32,
  invert: u32,
  feather: f32,
  contrast: f32,
  has_mask: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var orig: texture_2d<f32>;
@group(0) @binding(4) var mask: texture_2d<f32>;

const MAX_FEATHER: i32 = 8;

fn luma_of(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.299, 0.587, 0.114));
}

fn mask_at(uv: vec2f) -> f32 {
  if (params.has_mask == 0u) {
    return 1.0;
  }
  let m = textureSampleLevel(mask, samp, uv, 0.0);
  var l = luma_of(m.rgb);
  if (params.invert == 1u) {
    l = 1.0 - l;
  }
  l = clamp((l - 0.5) * params.contrast + 0.5, 0.0, 1.0);
  return l;
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let effect_c = textureSampleLevel(src, samp, uv, 0.0);
  let orig_c = textureSampleLevel(orig, samp, uv, 0.0);

  var coverage = mask_at(uv);
  let feather = clamp(params.feather, 0.0, f32(MAX_FEATHER));
  if (feather > 0.05 && params.has_mask == 1u) {
    let texel = 1.0 / params.resolution;
    let r = i32(ceil(feather));
    var acc = 0.0;
    var wsum = 0.0;
    for (var dy = -MAX_FEATHER; dy <= MAX_FEATHER; dy++) {
      if (abs(dy) > r) { continue; }
      for (var dx = -MAX_FEATHER; dx <= MAX_FEATHER; dx++) {
        if (abs(dx) > r) { continue; }
        let d = length(vec2f(f32(dx), f32(dy)));
        if (d > feather + 0.001) { continue; }
        let w = 1.0 - d / (feather + 0.001);
        acc += mask_at(uv + vec2f(f32(dx), f32(dy)) * texel) * w;
        wsum += w;
      }
    }
    coverage = acc / max(wsum, 1e-4);
  }

  let a = clamp(coverage * params.opacity, 0.0, 1.0);
  return mix(orig_c, effect_c, a);
}
