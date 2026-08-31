# American cockroach asset prompts

Generated with the built-in ImageGen tool. The linked *Periplaneta americana* article was used for the reddish-brown adult coloration, full wings, and pale yellow pronotum margin.

## Reference image

Create one anatomically plausible adult American cockroach (*Periplaneta americana*) from a perfectly orthographic 90-degree top-down view. Isolate it on a genuinely transparent background. Center it with the head pointing straight upward, and keep the complete antennae, six legs, wings, abdomen, and cerci visible. Use a reddish-brown body, long wings covering the abdomen, natural glossy chitin, and a pale yellowish margin on the pronotum. Render it as a detailed natural-history illustration blended with a realistic game asset. Use soft neutral overhead light and clean alpha edges. No floor, cast shadow, perspective distortion, motion blur, text, labels, watermark, extra limbs, missing limbs, or cropped anatomy.

## Eight-frame crawl cycle

Using the reference image as the exact identity and anatomy guide, create a seamless eight-frame in-place crawling cycle in a 4-by-2 sprite sheet. Keep the torso rigid and centered at identical coordinates, head pointing upward, and preserve scale, markings, wings, lighting, and camera angle. Use a biologically plausible alternating-tripod gait: tripod A is left foreleg, right middle leg, and left hind leg; tripod B is right foreleg, left middle leg, and right hind leg. During frames 1–4, tripod A performs stance and rearward push while tripod B swings forward; during frames 5–8, exchange roles and return seamlessly to frame 1. Only the legs and antennae move. There is no body bob, yaw, translation, scale change, or drift. Use transparent equal cells with generous gutters and no dividers, labels, motion blur, background, extra limbs, or clipped anatomy.

The generated frames were then deterministically registered by their torso masks to the fixed pixel pivot `(192, 272)`. All output frames retain a full `384 × 512` canvas so animation players cannot recenter individual transparent bounds.
