# KnowBreak Review Studio

## Run

```bash
cd app
npm install
npm run dev
```

Default URL: `http://localhost:8800`

## What It Does

- Reads project artifacts from `../out` (or `KB_OUT_DIR` if provided)
- Provides review UI for:
  - Script (`scripts.json`)
  - Storyboard (`storyboards.json`)
  - Images (`images.json`)
- Stores review state under each version directory:
  - `reviews/script_review.json`
  - `reviews/storyboard_review.json`
  - `reviews/image_review.json`
- Image review supports:
  - Upload replacement image
  - Manual 9:16 crop with drag + zoom
  - Paste image from clipboard (`Ctrl/Cmd + V`) in crop modal

## API

- `GET /api/projects`
- `GET/PUT /api/projects/:videoId/:version/script`
- `GET/PUT /api/projects/:videoId/:version/storyboard`
- `GET/PUT /api/projects/:videoId/:version/images`
- `POST /api/projects/:videoId/:version/images/replace`
- `POST /api/projects/:videoId/:version/reviews/:stage/approve`
- `GET /api/assets/:path*` for local image preview
