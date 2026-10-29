# Validation inputs

Put your test material here (both are git-ignored, they are private):

```
validation/
  labels.csv        <- your hand measurements (see labels.example.csv)
  videos/           <- the 10-15 test videos (.mp4 .mov .m4v .webm .mkv)
  results/          <- written by `npm run validate` (report.md, results.csv)
```

## Recording the test videos

Record them exactly the way the app asks (top-down, the default mode):

- phone held flat in front of you, screen up, **back camera pointing at the floor** at the **bare feet**, both feet in the picture,
  the top of the phone pointing the way the person walks;
- about 10 seconds of normal **walking** in a straight line at your usual pace (the app records 10 s) (a clip with no steps only gives a "Standing read" and is not
  what the app is for);
- a plain, evenly lit floor (busy rugs, patterned tiles and hard shadows make the feet finder fail).

**Use people (or deliberate stances) with clearly different foot angles**: toe-in, straight and toe-out. If every video has about the same angle,
even "guess the average" scores well and a pass says nothing about accuracy (the report warns you when that happens).

## labels.csv

```csv
video,left_deg,right_deg
walk01.mp4,8,5
walk02.mp4,14,12
walk03.mov,-3,2
```

- `video` is matched to the file name (case-insensitive; the extension is optional).
- Angles are **foot progression angles in degrees measured against the walking direction**:
  **toe-out positive, toe-in negative**. `left` / `right` are the person's own feet. (Convention confirmed: outside = positive, inside = negative.)
- The foot's **long axis** is the line from the **heel centre to the point between the big toe and the next toe** (confirmed); measure it against
  the walking direction. The app does not find those two landmarks: it reads the principal axis of the whole foot silhouette (ankle trimmed),
  which differs from your line by a few degrees, by a different amount for each foot shape. The report shows each foot's bias so it can be
  calibrated out (`angleOffsetLeftDeg` / `angleOffsetRightDeg`).
- **Measure against the walking direction, not against the edge of the picture.** A hand-held phone is never perfectly aligned with the walker, so the
  picture's vertical axis can be several degrees off. In a walking clip the walking direction is the direction the floor slides through the picture
  (opposite to its motion). Pause on a few mid-stance frames per foot (foot flat, not at heel strike or toe-off), measure each against that direction and
  average them; a plank line or tape strip on the floor makes the direction easy to see.
- Lines starting with `#` are ignored.
- **No need to measure in a video player:** the app's calibration page (`/settings/calibration`) lets you mark the heel centre and toe gap on frames of a
  clip and downloads this `labels.csv` for you (your mean per foot per clip). Clips recorded on that page can be saved from its clip list, so the same
  video can go into `videos/`.

## Run it

Terminal 1: `npm run dev`
Terminal 2: `npm run validate`

or open <http://localhost:3000/validate>, pick the capture mode, the CSV and all the videos, press **Run validation**.
Front-view clips (phone on the floor, person walking toward it) need `--mode front` and `npm run setup` once.

Details and options: see the main README ("Validation").
