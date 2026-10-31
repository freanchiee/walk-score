# Walk Score (prototype)

Scan your walk with a phone, get a 0–100 **Walk Score** from your foot angles, a fun label and a shareable 1080×1920 card.

**Purpose:** test whether people will scan and share a walking foot-angle score. Entertainment / wellness framing only: no medical, posture-fixing, anti-aging or face-shape claims. No backend, no login, no database. **All video processing happens on the device and no video is ever uploaded.**

**Capture (default):** the person holds the phone **flat in front of their body, screen up, back camera pointing at the floor**, and records ~10 seconds of their bare feet **while walking normally**. The phone's motion sensors guide the shot live (level bubble, status chips), reject bad captures and log tilt ([Sensor-guided capture](#sensor-guided-capture)). A clip with no steps only gives a "Standing read". The older **front view** (phone on the floor at knee height, walking toward it, MediaPipe Pose) is still in the code as a second mode.

> **Accuracy status: NOT MEASURED on real footage.** The foot finder was developed on one real still photo and on synthetic scenes with known angles. Passing those proves the geometry is self-consistent; it says nothing yet about real walking clips. On the one real photo, re-encoding the *same picture* at three sizes moved one foot's reading by about 4° (−3.8° … +0.1°), so expect a few degrees of noise from segmentation alone. Do not describe the numbers as accurate until `/validate` says so on your videos. See [Validation](#validation) and [Known limitations](#known-limitations).

---

## Run it

Requires Node 20+ (developed on Node 24, Windows 11). Next.js 16 (App Router, Turbopack), React 19, Tailwind 4, TypeScript.

```bash
npm install
npm run dev     # http://localhost:3000
```

The default top-down mode uses **no model and downloads nothing**. Only the front-view mode needs MediaPipe's WASM + pose model (`npm run setup`, below).

| Command | What it does |
|---|---|
| `npm run dev` | dev server on :3000 |
| `npm run dev:https` | dev server with a self-signed certificate (the camera needs HTTPS off `localhost`) |
| `npm run build` / `npm start` | production build / serve |
| `npm test` | 221 unit tests (analysis geometry, feet finder, scoring, sensor maths and gating, calibration maths and storage, CSV/metrics/report, saved clips) |
| `npm run lint` / `npm run typecheck` | ESLint / `next typegen && tsc` |
| `npm run validate` | validation script, see [Validation](#validation) |
| `npm run setup` | front-view mode only: copy the MediaPipe WASM and download `pose_landmarker_full.task` (9.4 MB, Google's `mediapipe-models` bucket) into `public/` (git-ignored). `-- --model lite\|heavy\|all` for other sizes |

**Trying it on a phone.** `getUserMedia` needs HTTPS. Easiest: deploy to Vercel (preview URLs are HTTPS). For local testing, `npm run dev:https` and add your LAN IP to `allowedDevOrigins` in `next.config.ts`. The upload button works over plain HTTP too.

**Deploying to Vercel.** Import the repo; nothing to download at build time in top-down mode. `<Analytics />` is in the root layout. Custom events show up in the Vercel dashboard only on plans that include custom events; on localhost the SDK just logs them to the console.

**Switching capture mode.** `CAPTURE_MODE` in `src/lib/config.ts` (`"topdown"` default, or `"front"`) changes the guide, the capture screen, the recording length and the analysis pipeline together.

---

## The flow (top-down)

1. **Landing** – one-line pitch, **Scan my walk**, and an on-screen guide with a diagram: stand barefoot on a plain, evenly lit floor; hold the phone flat in front of you, screen up, with the back camera pointing at the floor so both feet are in the picture and the top of the phone points the way you walk; record ~10 s of normal walking.
2. **Capture** – record in the browser (`MediaRecorder`, rear main-lens camera, foot zones, level bubble and four status chips over the preview, a 3-2-1 that runs only while the chips are green, auto-stop at 10 s) or upload a video (no sensor data comes with an upload, so it is marked low confidence). Video is only ever decoded locally.
3. **Tap your foot** (optional) – a frame of the video appears; the person taps the gap between the big toe and the next toe of one foot. The app learns that foot's colour and size from the tap ([below](#a-tap-on-the-foot-optional)) and shows the foot it found in green with an arrow toward the toes, so a tap on the wrong thing is seen and redone before anything is analysed. A *Pick another frame* slider chooses the frame, *Skip this step* goes straight to the analysis. `MARK_STEP` in [`config.ts`](src/lib/config.ts) switches the step: `"always"` (default), `"onFailure"` (only on the error screen) or `"off"`. After a scan that could not find the feet the error screen offers **Tap your foot and try again** on the same video, with no new recording.
4. **Analysis** – each sampled frame (15 per second) is downsampled and the feet are found; then stance phases and per-step angles are computed (below), with the calibration saved on this device applied ([Calibration](#calibration-settings)). Takes a few seconds.
5. **Score** – score, fun label, 2–3 plain-language cues, left/right angle, symmetry. A clip with no ground motion is labelled **"Standing read"** and the cue says the angles come from a standing stance.
6. **Share card** – 1080×1920 PNG drawn on a canvas (score, label, both foot angles; no face, no video). Web Share API where files can be shared, otherwise download.

Every screen states that processing happens on the device; the disclaimer is on the landing, capture, tap, error and result screens.

## How the angle is computed (top-down)

Code: [`src/lib/topdown/`](src/lib/topdown) (`segment.ts` finds the feet, `analyze.ts` turns them into angles). Both are pure and deterministic.

**Why not MediaPipe Pose here.** From straight above only feet and shins are visible, and the pose model anchors on head and torso. Tested on a real top-down photo of bare feet: **0 poses at the default threshold**; at very low thresholds it "finds" two poses with visibility 0.04–0.20: the first lands loosely around the left foot (its "toe" mid-foot, the right foot not found), the second is off-screen. MediaPipe's multi-class selfie segmenter did no better (labelled the shorts as clothes but the feet as background). The foot angle is, however, directly visible in 2D from above, so no depth guessing is needed; the problem is only finding the feet.

**Finding the feet (colour + shape, no neural network).**
1. Frame → Lab colour. The floor is the dominant colour, so fit a robust Gaussian to it and compute each pixel's distance from the floor.
2. Keep pixels that differ from the floor, are skin-hued (Lab hue 15–70°), have some colour strength and are *smooth* (a rug's stripes and wood grain have high local variance; skin does not).
3. Morphological opening (drops thin stripes), connected components.
4. Per blob: principal axis with the ankle/shin trimmed off (foot length ≈ 2.6 × forefoot width), elongation, size and tilt → a 0–1 shape score. Keep the best two side by side.

### A tap on the foot (optional)

Step 2 above is the weak spot: a fixed skin-hue window cannot see socks, some skin tones or odd lighting. One tap on the gap between the big toe and the next toe lets the app learn *this* foot instead ([`seed.ts`](src/lib/topdown/seed.ts), the screen is [`MarkFoot.tsx`](src/components/MarkFoot.tsx)):

1. **Colour.** The Lab colour of the non-floor pixels in a small disk around the tap (the floor shows through the gap, so floor-coloured pixels are left out); median and MAD, so a few shadowed pixels do not matter.
2. **Grow the foot.** Everything connected to the tap that is not floor, is smooth enough and is close in colour; then the colour is refitted on the grown foot, with its shading, and widened a little for lighting changes.
3. **Check it.** A patch that is only floor, a rug, too small (< 0.2 % of the frame), too big (> 30 %) or not foot-shaped is refused with a plain reason, and *Use this point* stays disabled. A foot lying sideways in the picture gets its own message.
4. **Use it.** In every frame the tapped colour (within 3 standard deviations, in Lab) replaces the skin-hue test; the smoothness limit is relaxed for knitted socks, and the size limits are only ever *relaxed* by the tapped foot, never tightened (the grown patch may be just part of the foot). A frame where the tapped colour finds no foot falls back to the skin test, and the debug page counts both.
5. **Toes.** The end of the foot's axis on the side of the tap is the toe end, if the tap was within 30 % of the foot's extent from it; the green overlay shows it with an arrow and a *Toes point the other way* button turns it round. It is used in two ways only: on a clip with **no walking** in it, forward is the picture edge the toes point to (up or down) instead of always the top edge, which is what a phone held upside down needs (the left and right feet swap sides *and* every angle changes sign, which the unit test shows); on a **walking** clip it never changes anything, because the floor movement is a better source of the walking direction, but a tap whose toes point more than 60° away from it is reported as a warning (a tap on the heel looks like that).

The live **Feet visible** chip on the capture screen has no tap yet and still uses the skin test, so with socks it may stay red (use *Start anyway*). After a tap the report's "both feet in view" figure is the share of frames in which the scan itself found both feet, not the live chip's, so the capture-quality score is not lowered for something the tap has fixed.

**Turning blobs into angles.**
1. The phone moves with the walker, so a planted foot **slides backward through the picture at ground speed**; the walking direction is the opposite of the dominant (planted) foot velocity. The dominant velocity is found as the densest cluster of velocity samples (the median fails: a foot is planted only about half the samples once edges are smoothed), then refined as the average of the left foot's and the right foot's own cluster centres: a phone that sways sideways with each stride makes the two feet's planted velocities lean opposite ways, and the single densest cluster would be just one of them. This makes no assumption about how the phone is rotated. With no ground motion the clip is a *standing* read and the top of the phone is assumed to point forward (unless a tap says which way the toes point, see above).
2. A foot is **planted** when its velocity equals the ground flow and its silhouette is stable; runs ≥ 0.2 s become steps. Blobs cut by the frame edge are ignored (their axis is biased).
3. Per step: median of the per-frame angle between the foot's long axis (oriented toward the walking direction) and the walking direction, toe-out positive. Left/right is the side of the walking direction the foot is on.
4. Drop unstable / low-confidence / outlier steps; per foot the confidence-weighted mean (≤2 steps) or median (≥3). Symmetry = |left − right|. Quality is *clean* (≥3 steps per foot and steady), *decent* (2) or *rough* (1).

**A property worth knowing:** a wrong walking direction shifts the left and right feet in *opposite* directions. The **average** toe-out stays right, but the left/right **difference** (and so the symmetry score) is the most fragile number. Phone sway during the clip does exactly that. What the simulator says (blob level, 22 sway cases × 4 seeds, true angles 12°/5°; real hand sway may be larger or smaller, so treat these as shape, not as a promise):

| Walking direction taken from | MAE over the sway cases | Worst reading |
|---|---:|---:|
| the single densest ground-flow cluster (the old default) | 4.5° | 10.3° |
| average of the left and right foot's clusters (**default now**) | 2.3° | 7.9° |
| the same, plus half from each stance's own foot motion (opt-in preset `td-hybrid-heading`) | 2.0° | 6.8° |

Sideways sway of the phone (2.5–4 cm per stride, which splits the two feet's planted velocities by up to ~15°) is what the left/right averaging fixes: 0.3° in the sideways-only cases against 1.3–6.8° for the single cluster. Yaw sway is not fixed by it: on top of 2.5 cm of sideways sway, 3° of yaw cost about 1–2° of MAE and 5° cost 3–5°, and the opt-in preset is better for some sway phases and worse for others. `/validate` compares all of them on your real clips.

## Sensor-guided capture

The top-down shot is hand-held, so the phone's own sensors guide the capture, reject bad ones and log tilt so tilt error can be measured and later corrected. **Everything runs on the device: video and sensor samples are never uploaded, and the sensor log is held in memory only** (it is gone when the page is closed; `/debug` can save it as a file on request).

**Holding the phone:** flat in front of the body, screen up, back camera pointing at the floor, top of the phone = walking direction. **Tilt** is the angle between the camera axis and straight down, `acos(cos β · cos γ)` from the W3C orientation angles (β ≈ γ ≈ 0 means level; the same in portrait or landscape). It is checked against hand-worked poses in the unit tests and on `/debug` → *Phone sensors*.

**Live guide** (camera view, [`Capture.tsx`](src/components/Capture.tsx), [`CaptureHud.tsx`](src/components/CaptureHud.tsx)):
- two translucent foot zones and a dashed centre line (the heading reference: the top of the screen is the walking direction; it is a camera alignment aid, nobody steps on it);
- a **level bubble** in a target ring that drifts to the high side of the phone: green up to 5°, amber 5–12°, red beyond (`SENSOR_CONFIG.tilt` in [`config.ts`](src/lib/config.ts));
- status chips that turn green: **Feet visible** (the analysis's own feet finder on a small picture, 3 times a second), **Light OK** (mean luminance and clipped share), **Level**, **Steady** (gyroscope under 25°/s for 1 s);
- tap **Start**, then a 3-2-1 that only runs while every available chip is green (it holds at 3 and names what to fix; after 8 s a *Start anyway* appears and the scan is marked less certain), then ~10 s of recording with a progress ring and a live **step counter** (accelerometer peaks).

**Sensors** ([`useDeviceSensors`](src/components/useDeviceSensors.ts)): `DeviceOrientationEvent` and `DeviceMotionEvent`. On iPhone the permission prompt is started inside the tap on *Record with camera*; Android Chrome shows none but needs https. Every sample is stamped with `performance.now()`, the clock the recording start is read on, so samples can be lined up with video frames. If the sensors are denied or missing the capture still works: Level and Steady show "not available" and the result says **Rough read · low confidence**.

**Camera:** back camera, and on phones with several back cameras the plain main lens is chosen over ultra-wide, telephoto and macro ([`lens.ts`](src/lib/camera/lens.ts); by device label, 1× zoom where the browser exposes zoom).

**Gating after the recording** ([`gate.ts`](src/lib/sensors/gate.ts), [`analyze.ts`](src/lib/topdown/analyze.ts)):
- each analysed frame gets the phone's tilt from the log; frames tilted more than 12° are marked unreliable and **left out of the angle averaging** (they still help find the walking direction);
- at least **6 accelerometer steps** or the scan is turned down with "Walk a bit longer and try again.";
- fewer than half the frames within the tilt limit (or a failed measurement with a quarter of them tilted) turns it down with "The phone was tilted too much…";
- accelerometer step times are a prior for **mid-stance**: a stance that starts at a heel strike is measured mostly from its middle (about 0.3 of a stride later), keeps its confidence the closer the two agree, and loses 15 % if no step explains it;
- a **capture quality score** (0–100: tilt 35 %, steadiness 20 %, steps 20 %, light 10 %, feet in view 10 %, minus a penalty for starting before green or for yaw drift) feeds the result badge: *Clean / Decent / Rough read* is the worse of the analysis's own quality and the capture's. The weights are judgement, not measured.

**Experiments, all off by default.** Switch one on for a page load with `?exp=yaw,yawreject,flow,tilt` after the address (e.g. `/?exp=yaw,tilt`); `?exp=none` forces all off. `/debug` → *Phone sensors* lists them and the report of the last scan.
- **Yaw check** (`yaw`, `yawreject`): tracks the phone's relative yaw (`alpha` change) over the walk; warns beyond 15° and, with `yawreject`, turns the scan down beyond 30°. A person who deliberately turns shows up here too.
- **Floor optical flow** (`flow`): phase correlation of a floor patch between frames (feet masked out) gives the direction the floor slides, i.e. an independent walking direction. `/debug` → *Top-down feet* shows it next to the feet-motion heading and the "top of the picture" assumption. Needs a textured floor; on a plain one it reports that it has nothing to track.
- **Tilt correction** (`tilt`): with pitch and roll per frame and an assumed field of view (`SENSOR_CONFIG.fovLongSideDeg`, 67° along the long side) the feet are re-projected to a virtual straight-down view by the rotation-only homography H = K R K⁻¹ (the camera centre is unchanged, so no depth is needed and angles between lines on the floor are preserved). Verified against a simulated tilted pinhole camera, not on a real phone.

## The front-view mode (kept, not the default)

Phone on the floor at knee height, person walks toward it for ~10 s; MediaPipe Pose Landmarker (WASM) tracks heel/foot-index landmarks, stance is detected from heel and toe being still in the image, and the angle comes from the model's world landmarks (or an image-plane alternative), corrected for the walking direction fitted from the pelvis path. Code in [`src/lib/analysis/`](src/lib/analysis) and [`src/lib/pose/`](src/lib/pose). Its unverified assumptions: the world landmarks are in a frame looking along the camera→person line of sight; 65° field of view along the long side; torso:foot ratio 2.1. At 3–4 m it yields only ~2–3 steps per foot. It has not been run on a real walking video either.

## Score

[`src/lib/scoring/score.ts`](src/lib/scoring/score.ts), constants in [`src/lib/config.ts`](src/lib/config.ts):

- **`TARGET_BAND = { minDeg: 0, maxDeg: 10 }`** – toe-out target band. A best guess, not a clinical norm. Change it in one place.
- Per foot: `100 · exp(−½ (distance_outside_band / 10°)²)`, averaged over both feet. Symmetry: `100 · exp(−½ (|L−R| / 8°)²)`.
- **Walk Score = 0.65 · angle + 0.35 · symmetry** (weights in config). Because it is additive, a perfectly symmetric but extreme walker still keeps about 35 points; change the formula if that is not the behaviour you want.
- Labels: Runway Straight, Street Smooth, Free Spirit, Chaplin Stroll, Duck Walker, Pigeon Strut, Plot Twist. Thresholds in `LABEL_CONFIG`.
- Cues are descriptive and playful; a unit test fails if medical or corrective wording creeps in.

With a few degrees of measurement noise a score can move by 10–20 points between scans; the result screen says so ("Rough read", "Standing read").

## Debug page – `/debug`

Two tabs (top-down is the app default). For top-down you can load a video, a saved clip `.json`, a synthetic walk, or press **Run on-device self-test** (renders feet with known angles, records them to a video in this browser, then analyses that video through the real decode + feet-finder path: a quick end-to-end check of this device; in the dev browser it measured −0.1° / −0.4° error against known 12° / 4°). You get:

- the video with each foot's blob, axis and live per-frame angle coloured by state (planted-used / planted-discarded / moving / not found), ignored blobs, and the walking-direction arrow
- **"show what the feet finder sees"**: the segmentation mask over the current frame
- a stance timeline, and a table of **every step's angle**, scatter, confidence and why it was discarded
- live tuning of the analysis (instant) and of the feet finder (re-runs the video), plus the exact result screen a user would see
- **Save clip (.json)**: coordinates only, no pixels. Re-load it, or feed it to `/validate`, to try new thresholds without decoding video again.

The *Phone sensors* tab's last-scan report also says whether the scan had a tap, and if so the learned colour, how many frames were found with it and how many fell back to the skin test, where the toes point, and how that compares with the walking direction.

## Calibration (settings)

`/settings/calibration` (the **Calibration** link in the footer of the landing screen) brings the app's foot angles in line with your own hand measurement. The app reads the principal axis of each foot's silhouette; the agreed hand measurement is the line from the **heel centre to the point between the big toe and the next toe**, against the walking direction (toe-out positive, toe-in negative). The two differ by a few degrees that depend on foot shape, so the page measures the difference:

1. **The clip.** Record one on the page (the same capture screen as the app; *Save video* keeps a recording) or add video files, several at once.
2. **Mark the feet.** Step to a frame where the foot is flat (the *stance* buttons jump to the middle of each stance the app found), pick the foot, click the heel centre, then the toe gap. Points can be dragged, a magnifier follows the pointer, and it works by touch. Marks are measured against the walking direction: by default the one the app found from how the floor slides through the picture, or a line you draw along a floor line.
3. **Labels and calibration.** For every mark the page compares your angle with what the feet finder reads in the *same frame against the same direction*, so the difference is only the axis definition. The mean difference per foot is the offset. The page also shows what the app would read on each clip with it, compares the three ways of finding the walking direction on clips where you drew your own line, writes `labels.csv` (your mean per foot per clip, for `npm run validate`) and saves the calibration.

**Where it goes.** *Use on this device* stores it in the browser (`localStorage`); every scan on that device then applies it (`scanVideo` in `src/lib/pipeline.ts`: the offsets are added to each foot's angle and the chosen walking-direction method is used). `/debug` and `/validate` always show the raw readings. To ship a calibration to every user, paste the line the page prints over `DEFAULT_CALIBRATION` in `src/lib/config.ts`; *Reset this device* removes the saved one.

**What it cannot do.** An offset fitted on one person's feet is that person's foot shape; mark several different people before trusting it for others. It corrects a constant per-foot offset, not segmentation errors or walking-direction errors. Nothing is uploaded.

## Validation

> You supply 10–15 videos and a CSV of hand-measured angles. Nothing here has been validated on real footage yet.

**Inputs** (see [`validation/README.md`](validation/README.md)):

```
validation/labels.csv     video,left_deg,right_deg
validation/videos/*.mp4   the test videos (names must match the CSV)
```

Angles are **foot progression angles in degrees against the walking direction: toe-out positive, toe-in negative**, left/right = the person's own feet. The sign convention (outside = positive, inside = negative) was confirmed by the project owner on 2026-10-29. The hand-measured foot axis is the line from the **heel centre to the point between the big toe and the next toe** (also confirmed on 2026-10-29). The app does not find those two landmarks: it uses the principal axis of the whole foot silhouette (ankle trimmed), which can differ from that line by a few degrees, by a different amount for each foot shape. The report shows the per-foot bias so it can be calibrated out (`angleOffsetLeftDeg` / `angleOffsetRightDeg`).

**Run it** – either way, the same analysis code as the app:

```bash
# Terminal 1
npm run dev
# Terminal 2 – headless Edge/Chrome (already on your machine, nothing is downloaded) drives /validate
npm run validate
# options: --mode topdown|front  --labels --videos --url --browser msedge|chrome --fps --swap --out --headed
#          (front mode only: --model lite|full|heavy  --delegate CPU|GPU|auto)
```

or open <http://localhost:3000/validate>, pick the capture mode, the CSV and all the videos, press **Run validation**. (The extraction needs a browser, which is why validation runs through one rather than plain Node.)

**Output:** a per-video table, MAE (left, right, overall), bias, within-5° share, correlation/slope, the **guess-the-average baseline** and a plain verdict. If MAE is above ~5° it says so in those words and proposes fixes, ordered by what your data shows and specific to the mode (top-down: segmentation, phone steadiness, axis definition, more stance phases). A pass is flagged if guessing the average would pass too (real feet differ by several degrees between people, so include clearly toe-in / straight / toe-out walkers). It also compares estimator presets on the same extraction. Files: `validation/results/report.md` and `results.csv`. Exit code: `0` within target, `2` above target, `3` too few readable videos, `1` error.

### Validation results

*None yet – waiting for the videos.* Once they exist, paste the `report.md` summary here: date, mode, number of videos, MAE (L/R/overall), bias, baseline, verdict.

## Analytics

Vercel Web Analytics custom events (anonymous: no video, landmarks, angles or user identifiers):

| Event | When | Properties |
|---|---|---|
| `scan_started` | "Scan my walk", "Scan again" or "Try again" pressed | – |
| `score_shown` | a score is displayed | `label`, `quality`, `source` (camera/upload) |
| `share_clicked` | Share or Save image pressed (not whether the share completed) | `method` (web_share/download) |
| `second_scan` | a scan starts after a score was already shown in this page session | – |

## What has and has not been verified

**Verified** (tests + dev browser):
- 245 unit tests: foot-finder maths on rendered scenes with known angles (other floor and skin colours, a rug, shorts, an ankle at a different angle), the top-down analyzer on simulated walks (rotated phone, upside-down phone, speeds, noise, sway, standing), scoring, CSV/metrics/verdicts, saved clips.
- Real pixels: your top-down photo (bare feet on wood, striped rug, shorts) → both feet found, axes on the feet, no rug/shorts false positives; run through the real app as a 3 s clip it gives a "Standing read" (left ≈ 0°, right ≈ 3° toe-in) and a result screen + share card. The same photo drifted sideways-and-up to fake ground motion is recognised as walking, and the feet then read about ±17–18° relative to that direction, matching how far off the feet's axis the fake drift was (a good check of the walking-direction maths on real pixels, not of foot accuracy).
- Walking video through the real decode path: 17 synthetic clips with known angles (rendered with the test renderer by a throwaway script that is not in this repo, encoded to H.264 4:2:0 with ffmpeg, 30 fps; variants with motion blur, speed wobble, sideways and yaw sway, light and dark skin and floors, a yawed phone) run through `npm run validate`: **MAE 1.3°** (left 1.2°, right 1.4°), worst reading 4.9°, all within 5°. The worst cases were step-locked yaw sway of 3–5° (up to ~5° off in opposite directions for left and right). With the old single-cluster walking direction the same clips gave 2.2° and 82% within 5°. This only shows the chain (decode, feet finder, walking direction, steps, scoring) agrees with the renderer that built the clips; the renderer is mine, not a real foot.
- Sensor-guided capture, in headless Edge with a fake camera that plays a synthetic walking clip (feet visible) and **synthetic sensor events** (a script dispatching `deviceorientation` / `devicemotion` at ~60 Hz, with a stubbed iOS-style permission prompt): the permission requests and `getUserMedia` start in the same tick of the tap; the chips read Level "not OK" at 20° and OK when flat; the 3-2-1 runs only while all are green, and holds with "Start anyway" offered when Level stays red; the live counter read "Steps 7" a few seconds in; a good capture gave capture quality 95/100 and a *Clean read* of 12°/4° (the clip's true angles); tilting the phone to 22° during the recording was turned down with "The phone was tilted too much…"; standing still (0 steps) with "Walk a bit longer and try again."; no sensors, or a denied permission, still produced a score but marked **Rough read · low confidence**; with `?exp=yaw,tilt` the yaw check and the tilt correction ran and `/debug` → *Phone sensors* showed the report. Unit tests cover tilt for hand-worked poses (and the bubble direction), the step detector (several cadences and sample rates, standing, any orientation), the log's interpolation, quality, yaw, gating, light, lens choice, the floor-flow phase correlation (about 0.2 px on test textures) and the tilt correction against a simulated tilted pinhole camera (exact to 0.01°, where the uncorrected angle was off by more than 0.25°).
- Calibration page, in headless Edge on the synthetic clip with true angles 12°/4°: marks clicked at the true heel and toe positions read exactly +12.0° and +4.0° (so the click → picture-coordinate → angle maths is right, with a mouse and with taps on a phone-sized screen); the fit found offsets of −0.0° (left) and +0.6° (right), which is how far the real-pixel feet finder was from the truth on those frames; typed offsets of +2°/−1° saved and the main app then showed 14°/3° for that clip; `labels.csv` downloaded; a clip recorded on the page with the fake camera was added and analysed.
- Tap on the foot ([above](#a-tap-on-the-foot-optional)), **synthetic scenes only**. Unit tests on rendered feet: blue, white, black and green socks, in which the skin test finds no feet at all, are found after one tap with both axes within 3° of the truth, also with a rug and light shorts in the picture; a whole synthetic walk in blue socks that the skin test fails to read comes out within 3° of the true 12°/4° with the tapped colour; taps on the floor and on a striped rug are refused; taps a few pixels off the toe gap work; a foot pointing down the picture is accepted with the toes marked right; a standing clip taken with the phone upside down reads 12°/4° once the toes are known and −4°/−12° without (the failure the toes fix). In headless Edge with a fake camera playing synthetic clips (blue socks, white socks, normal skin) and synthetic sensor events: skipping the tap on socks ends in "We couldn't find your feet", **Tap your foot and try again** reopens the same video, a tap on the foot gave a *Clean read* of 12°/4° (the clips' true angles), a tap on the floor was refused with a plain reason, *Toes point the other way* turned the arrow round and the walking result stayed the same, and a tap costs about 33 ms at the working resolution on this PC (a phone will be several times slower). Not tried with a real sock, shoe, skin tone or phone.
- Browser: upload → on-device analysis → result → share card → all four analytics events; `/debug` (both tabs, mask overlay, self-test), `/validate` and `npm run validate` in both modes (the CLI on clips built from the photo and on synthetic files).

**Not verified:** any real *walking* top-down video; a phone (iOS Safari, Android Chrome), real camera recording with `MediaRecorder`, the Web Share API on a phone; other people's feet, floors, socks or shoes. Accuracy against hand measurements. The calibration page with a person's real marks on real clips: how consistent hand marks are from frame to frame, and whether an offset fitted on one person's feet carries over to other feet. **The sensor features on a real phone**: the tilt, bubble and step maths follow the W3C conventions and were checked with synthetic events, not with a real iPhone or Android; the capture-quality thresholds and weights, the step detector and the accelerometer's mid-stance timing prior are tuned on simulated signals only; the delay between the sensor clock and the video's first frame is unmeasured (`SENSOR_CONFIG.videoLatencyMs`); the floor optical flow has never seen a real floor; the tilt correction's camera-axis mapping (portrait back camera) is an assumption to check on a real phone.

## Known limitations

1. **Accuracy is unmeasured.** On the one real photo the reading moved ~4° for one foot between re-encodes of the same picture.
2. **The feet finder is a colour heuristic, not a trained model.** It works on bare feet against a plain, evenly lit floor. It will fail or mislabel when the floor is skin-coloured, strongly patterned (tiles, busy rugs) or in hard shadow. Socks and other skin tones fail the generic skin-hue test; a tap on the foot ([above](#a-tap-on-the-foot-optional)) is meant to rescue them, but that has only been tried on synthetic scenes. When it finds nothing the user gets a "try again" screen (with a tap-and-retry button) rather than a made-up number. A learned foot segmentation model would be the robust next step.
3. **Heading error becomes false asymmetry.** Phone yaw sway and a wrong walking direction move left and right in opposite directions; only the average toe-out is robust. In the simulator 3–5° of yaw sway cost 1–5° per foot (see the table above); how much a real hand sways is unmeasured. For a standing clip the walking direction is assumed to be the phone's top edge, so a rotated phone shifts the two feet in opposite directions.
4. **Phone tilt is not corrected.** The camera must point straight down; a tilted phone foreshortens the feet and changes the angles (a gyro reading could correct it in-app but is not implemented).
5. **Axis definition.** The hand-measured axis is heel centre to the point between the big toe and the next toe; the app reads the silhouette's principal axis instead, so expect a small per-foot offset that depends on foot shape (calibratable once `/validate` shows it).
6. **Cut-off feet are ignored**, so feet that run out of the picture reduce the number of usable steps.
7. **Short clips give few steps.** In the simulator every 5 s of walking gives roughly 4–5 stance phases per foot; real numbers depend on pace and framing. A standing clip gives one reading per foot. Ten seconds of normal walking needs about 10 m of clear floor.
8. **Platform coverage.** Developed and smoke-tested in desktop Chromium only. WebM from `MediaRecorder` has no duration; handled (seek-to-end trick) and tested with a synthetic clip, but not with a real camera recording.
9. **The 0–10° target band, score weights and label thresholds are guesses** (all in `config.ts`), not clinical references.
10. **Synthetic tests only prove self-consistency.** Passing them says the maths agrees with itself, not that real feet are found accurately.
11. **A calibration is only as general as the feet you marked.** The offset is the axis-definition difference for those feet; foot shapes differ. A calibration saved in a browser applies only to that browser until its values are pasted into `config.ts`.
12. **Hand marks have their own noise.** Clicking the heel centre and the toe gap on a phone-sized picture is good to a degree or two per mark; the page shows the scatter and the standard error, and asks for at least three marks per foot from different steps.
13. **Sensors differ between phones and browsers.** Rates (about 60 Hz on most), noise, whether `acceleration` and `rotationRate` are reported, and whether `alpha` is absolute or relative vary; iOS needs a tap for the permission and asks again after a long time. An https page is required for any of it.
14. **Ten seconds is a lot of walking indoors**, and the analysis of a 10 s clip from a real phone (1080p) will take longer than the desktop figure above (about 5 s for a small 5 s test clip).
15. **A tap teaches one colour from one frame.** A foot the same colour as the floor is refused ("looks like the floor"); a busy sock pattern or laced shoes can break the foot into pieces; a strong lighting change during the clip can leave the learned colour behind (those frames fall back to the skin test, and the debug page shows the count). Someone with one dark and one light sock gets one of them. The tap screen is an extra step before every score (`MARK_STEP`), a cost for people who do not need it.
16. **The toes from a tap are only a hint.** The tap does not say heel from toe by shape: a tap near the heel looks like a tap near the toes pointing the other way. On a walking clip that is caught (a warning) and changes nothing; on a standing clip it would turn a correct read round (left and right swapped, every angle's sign flipped), which is why the screen draws an arrow and offers *Toes point the other way*. A phone rotated a quarter turn is still not handled: sideways feet fail the shape test.
17. **The capture screen's live checks do not know about the tap.** *Feet visible* uses the skin test, so with socks it stays red until *Start anyway*.

## Project layout

```
src/app/            / (app), /debug, /validate, /settings/calibration, layout (Vercel Analytics)
src/components/     screens (Landing, Capture, MarkFoot (tap your foot), Analyzing, ResultScreen, ErrorScreen), debug/ (tabs, players, overlays), validate/
src/lib/config.ts   CAPTURE_MODE, MARK_STEP, TARGET_BAND, score weights, capture limits
src/lib/topdown/    feet finder (segment.ts), what a tap teaches it (seed.ts), analyzer (analyze.ts), video extraction, synthetic scenes   <- default mode
src/lib/analysis/   front-view pose analyzer, shared step aggregation, synthetic landmarks
src/lib/pose/       MediaPipe loading + frame extraction (front view), MediaRecorder helpers
src/lib/scoring/    score, labels, cues
src/lib/share/      canvas share card
src/lib/validation/ CSV, metrics, verdict/report, runner
src/lib/sensors/    tilt, level bubble, step detector, in-memory sensor log, capture quality, gating, yaw, tilt correction
src/lib/capture/    live light check;  src/lib/camera/  main-lens choice;  src/lib/flags.ts  experiment switches
src/lib/calibration/ hand-mark geometry, offset fit, saved calibration (localStorage), marking-session maths
src/components/calibration/ the /settings/calibration page (clips, marking stage, labels and calibration)
scripts/            validate.mjs, setup-mediapipe.mjs (front view only)
validation/         your labels.csv + videos/ (git-ignored)
```

Third-party: MediaPipe Tasks Vision and its pose models (front-view mode only) are Apache-2.0 licensed by Google.
